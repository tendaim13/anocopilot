import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaver } from "@langchain/langgraph";

import {
  scoreAndBuildAccountDossier,
  type AccountCandidateDossier,
} from "@/lib/ano/company-discovery";
import type { IndustryProfile, ResearchClaim } from "@/lib/ano/market-synthesis";
import {
  assertDraftCanCreateProposal,
  compilePlaybookOutreachDrafts,
  evaluateContactEligibility,
  type OutreachExecutionView,
} from "@/lib/ano/outreach-execution";
import {
  compileFactualAccountPlaybook,
  type ContactCandidateView,
} from "@/lib/ano/people-playbooks";
import {
  buildConversationMessageParts,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import { classifyConversationWorkItem } from "@/lib/ano/work-queue";
import {
  createOutreachExecutionGraph,
  type OutreachExecutionExecutor,
} from "@/server/langgraph/outreach-execution-graph";

const convId = "00000000-0000-4000-8000-000000000501";
const decisionId = "00000000-0000-4000-8000-000000000502";
const searchId = "00000000-0000-4000-8000-000000000503";
const accountId = "00000000-0000-4000-8000-000000000504";
const claimId = "00000000-0000-4000-8000-000000000505";
const sourceId = "00000000-0000-4000-8000-000000000506";
const personSearchId = "00000000-0000-4000-8000-000000000507";
const contactId = "00000000-0000-4000-8000-000000000508";
const playbookId = "00000000-0000-4000-8000-000000000509";
const proposalId = "00000000-0000-4000-8000-000000000510";
const now = "2026-11-21T04:05:00.000Z";

const industry: IndustryProfile = {
  id: "00000000-0000-4000-8000-000000000511",
  marketProfileId: "00000000-0000-4000-8000-000000000512",
  name: "Commercial HVAC & Mechanical Services",
  summary: "High quote follow-up complexity.",
  operationalProblems: ["Slow manual quote follow-ups across tenders"],
  solutionFit: ["Automated quote-to-job reminders"],
  buyerRoleHypotheses: ["Managing Director"],
  evidenceStrength: "moderate",
  claimIds: [claimId],
  unknowns: ["Current CRM adoption"],
};

const claims: ResearchClaim[] = [
  {
    id: claimId,
    kind: "observation",
    statement: "Commercial service firms report quote follow-up leakage.",
    sourceIds: [sourceId],
    comparisonBasis: null,
    evidenceStrength: "moderate",
    citationStatus: "supported",
  },
];

const account: AccountCandidateDossier = scoreAndBuildAccountDossier(
  {
    id: "prospeo-501",
    name: "Selangor HVAC Engineering Sdn Bhd",
    domain: "shvac.my",
    website: "https://shvac.my",
    industry: "HVAC",
    employeeRange: "11-50",
    location: { city: "Shah Alam", country: "Malaysia" },
  },
  {
    dossierId: accountId,
    conversationId: convId,
    targetDecisionId: decisionId,
    companySearchId: searchId,
    targetMarketName: "Malaysia",
    targetIndustryName: industry.name,
    canonicalLocations: ["Malaysia"],
    linkedClaimIds: [claimId],
    capturedAt: now,
    lifecycleState: "shortlisted",
  },
);

const verifiedContact: ContactCandidateView = {
  id: contactId,
  conversationId: convId,
  targetDecisionId: decisionId,
  accountCandidateId: accountId,
  accountName: account.name,
  accountDomain: "shvac.my",
  personSearchId,
  sourceKey: "prospeo-person:p-501",
  fullName: "Farah Nordin",
  firstName: "Farah",
  lastName: "Nordin",
  title: "Managing Director",
  seniority: "C-Level",
  department: "Executive",
  location: "Shah Alam, Malaysia",
  linkedInUrl: null,
  roleRationale: "Primary commercial decision-maker",
  confidence: "high",
  claimIds: [claimId],
  selectedForVerification: true,
  verificationStatus: "verified",
  verifiedDetails: {
    email: "farah@shvac.my",
    emailQualification: "nominative@pro",
    phone: "+60355552222",
    verifiedDomain: "shvac.my",
    provider: "dropcontact",
    verifiedAt: now,
  },
  retrievedAt: now,
  verifiedAt: now,
};

const unverifiedContact: ContactCandidateView = {
  ...verifiedContact,
  verificationStatus: "not_requested",
  verifiedDetails: null,
};

const playbook = compileFactualAccountPlaybook({
  playbookId,
  conversationId: convId,
  targetDecisionId: decisionId,
  account,
  targetMarketName: "Malaysia",
  industry,
  claims,
  contacts: [verifiedContact],
  offerSummary: "Quote follow-up automation",
  nowIso: now,
});

test("evaluateContactEligibility blocks unverified emails and suppressed contacts", () => {
  const unverifiedCheck = evaluateContactEligibility(unverifiedContact, "email");
  assert.equal(unverifiedCheck.status, "blocked_unverified_email");
  assert.equal(unverifiedCheck.canProposeEmailSend, false);
  assert.equal(unverifiedCheck.canProposeCalendarSchedule, false);
  assert.equal(unverifiedCheck.canProposeCallTask, true);

  const missingCheck = evaluateContactEligibility(null, "email");
  assert.equal(missingCheck.status, "blocked_missing_contact");
  assert.equal(missingCheck.canProposeEmailSend, false);

  const suppressedCheck = evaluateContactEligibility(verifiedContact, "email", ["FARAH@shvac.my"]);
  assert.equal(suppressedCheck.status, "blocked_suppressed");
  assert.equal(suppressedCheck.canProposeEmailSend, false);
  assert.equal(suppressedCheck.canProposeMercurySync, false);

  const verifiedEmailCheck = evaluateContactEligibility(verifiedContact, "email");
  assert.equal(verifiedEmailCheck.status, "eligible");
  assert.equal(verifiedEmailCheck.canProposeEmailSend, true);
  assert.equal(verifiedEmailCheck.canProposeCalendarSchedule, true);
});

test("compilePlaybookOutreachDrafts and assertDraftCanCreateProposal enforce channel & eligibility guards", () => {
  const drafts = compilePlaybookOutreachDrafts({
    playbook,
    contacts: [verifiedContact],
    nowIso: now,
  });

  assert.equal(drafts.length, 4);
  const emailDraft = drafts.find((d) => d.channel === "email")!;
  const linkedinDraft = drafts.find((d) => d.channel === "linkedin")!;
  assert.equal(emailDraft.eligibility.canProposeEmailSend, true);
  assert.equal(linkedinDraft.eligibility.status, "review_only_channel");
  assert.equal(linkedinDraft.eligibility.canProposeEmailSend, false);

  assert.doesNotThrow(() => assertDraftCanCreateProposal(emailDraft, "email_send"));
  assert.throws(
    () => assertDraftCanCreateProposal(linkedinDraft, "email_send"),
    /requires an eligible|review-only/i,
  );
});

test("outreach-execution graph enforces playbook prerequisite and explicit per-action approval", async () => {
  const noopExecutor: OutreachExecutionExecutor = {
    async compileOutreachDrafts() {
      throw new Error("Should not compile");
    },
    async saveEditedDraftVersion() {
      throw new Error("Should not edit");
    },
    async stageExecutionProposal() {
      throw new Error("Should not stage");
    },
    async recordDecisionAndExecute() {
      throw new Error("Should not decide");
    },
  };

  const guardGraph = createOutreachExecutionGraph(noopExecutor, new MemorySaver());
  await assert.rejects(
    () =>
      guardGraph.invoke(
        {
          stage: "generate_drafts",
          conversationId: convId,
          playbooks: [],
          currentNode: "verify_approved_playbooks",
        },
        { configurable: { thread_id: "phase-f-no-playbook" } },
      ),
    /Compile at least one factual Phase E account playbook/,
  );

  const drafts = compilePlaybookOutreachDrafts({
    playbook,
    contacts: [verifiedContact],
    nowIso: now,
  });

  let viewState: OutreachExecutionView = {
    drafts,
    proposals: [],
    mercuryConnected: false,
  };

  const liveGraph = createOutreachExecutionGraph(
    {
      async compileOutreachDrafts() {
        return viewState;
      },
      async saveEditedDraftVersion() {
        return viewState;
      },
      async stageExecutionProposal({ proposalType }) {
        viewState = {
          ...viewState,
          proposals: [
            {
              id: proposalId,
              conversationId: convId,
              accountPlaybookId: playbookId,
              accountCandidateId: accountId,
              accountName: account.name,
              contactCandidateId: contactId,
              contactName: verifiedContact.fullName,
              contactEmail: verifiedContact.verifiedDetails!.email,
              outreachDraftId: drafts[0].id,
              providerActionRequestId: null,
              proposalType,
              targetReference: "farah@shvac.my",
              status: "awaiting_approval",
              version: 1,
              summary: "Send email v1 to Farah Nordin",
              payload: { channel: "email" },
              executionReceipt: {},
              decisions: [],
              executedAt: null,
              createdAt: now,
              updatedAt: now,
            },
          ],
        };
        return viewState;
      },
      async recordDecisionAndExecute({ decision }) {
        viewState = {
          ...viewState,
          proposals: [
            {
              ...viewState.proposals[0],
              status: decision === "approved" ? "executed" : decision,
              executedAt: decision === "approved" ? now : null,
            },
          ],
        };
        return viewState;
      },
    },
    new MemorySaver(),
  );

  const stageConfig = { configurable: { thread_id: "phase-f-stage" } };
  await liveGraph.invoke(
    {
      stage: "create_proposal",
      conversationId: convId,
      playbooks: [playbook],
      draftId: drafts[0].id,
      proposalType: "email_send",
      currentNode: "verify_approved_playbooks",
    },
    stageConfig,
  );

  const staged = await liveGraph.getState(stageConfig);
  assert.equal(staged.values.currentNode, "await_proposal_approval");
  assert.equal(staged.values.view?.proposals[0]?.status, "awaiting_approval");

  const approveConfig = { configurable: { thread_id: "phase-f-approve" } };
  await liveGraph.invoke(
    {
      stage: "decide_proposal",
      conversationId: convId,
      playbooks: [playbook],
      proposalId,
      decision: "approved",
      currentNode: "verify_approved_playbooks",
    },
    approveConfig,
  );
  const executed = await liveGraph.getState(approveConfig);
  assert.equal(executed.values.currentNode, "proposal_executed");
  assert.equal(executed.values.view?.proposals[0]?.status, "executed");
});

test("Phase F message parts and work queue classify pending outreach and Mercury proposals", () => {
  const conversation: ResearchConversationView = {
    conversation: {
      id: convId,
      title: "Malaysia commercial trades",
      status: "complete_without_research",
      threadId: `ano:ws:${convId}`,
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: "00000000-0000-4000-8000-000000000599",
      status: "complete_without_research",
      graphVersion: "phase-a-v1",
      currentNode: "complete_without_research",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [],
    brief: null,
    pendingQuestion: null,
    plan: null,
    events: [],
  };

  const drafts = compilePlaybookOutreachDrafts({
    playbook,
    contacts: [verifiedContact],
    nowIso: now,
  });

  const parts = buildConversationMessageParts(conversation, null, null, null, null, {
    drafts,
    proposals: [
      {
        id: proposalId,
        conversationId: convId,
        accountPlaybookId: playbookId,
        accountCandidateId: accountId,
        accountName: account.name,
        contactCandidateId: contactId,
        contactName: verifiedContact.fullName,
        contactEmail: verifiedContact.verifiedDetails!.email,
        outreachDraftId: drafts[0].id,
        providerActionRequestId: null,
        proposalType: "mercury_task",
        targetReference: account.name,
        status: "awaiting_approval",
        version: 1,
        summary: "Stage Mercury task",
        payload: {},
        executionReceipt: {},
        decisions: [],
        executedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    mercuryConnected: false,
  });

  assert.ok(parts.some((p) => p.type === "artifact" && p.artifactType === "outreach_drafts"));
  assert.ok(parts.some((p) => p.type === "artifact" && p.artifactType === "execution_proposals"));
  assert.deepEqual(parts.at(-1), { type: "status", state: "awaiting_approval" });

  const workItem = classifyConversationWorkItem({
    conversation: {
      id: convId,
      title: "Malaysia",
      status: "complete_without_research",
      createdAt: now,
      updatedAt: now,
    },
    targetDecision: { status: "locked", updatedAt: now },
    pendingProposals: { count: 2, updatedAt: now },
  });

  assert.equal(workItem?.category, "provider_scope_approval_required");
  assert.equal(workItem?.label, "Approve outreach / Mercury proposal");
});

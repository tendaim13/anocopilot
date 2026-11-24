import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaver } from "@langchain/langgraph";

import {
  scoreAndBuildAccountDossier,
  type AccountCandidateDossier,
} from "@/lib/ano/company-discovery";
import type { IndustryProfile, ResearchClaim } from "@/lib/ano/market-synthesis";
import {
  buildDropcontactVerificationPreview,
  buildPersonSearchPreview,
  compileFactualAccountPlaybook,
  deriveBuyerRoleRecommendations,
  normalizeDiscoveredPersonCandidate,
  type ContactCandidateView,
  type PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import {
  buildConversationMessageParts,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import { classifyConversationWorkItem } from "@/lib/ano/work-queue";
import {
  verifyContactsWithDropcontact,
  DropcontactClientError,
} from "@/server/connectors/dropcontact/dropcontact-client";
import {
  searchProspeoPeople,
} from "@/server/connectors/prospeo/prospeo-client";
import {
  createAccountToPeopleGraph,
  type AccountToPeopleExecutor,
} from "@/server/langgraph/account-to-people-graph";

const convId = "00000000-0000-4000-8000-000000000401";
const decisionId = "00000000-0000-4000-8000-000000000402";
const searchId = "00000000-0000-4000-8000-000000000403";
const accountId = "00000000-0000-4000-8000-000000000404";
const claimId = "00000000-0000-4000-8000-000000000405";
const sourceId = "00000000-0000-4000-8000-000000000406";
const personSearchId = "00000000-0000-4000-8000-000000000407";
const contactId1 = "00000000-0000-4000-8000-000000000408";
const contactId2 = "00000000-0000-4000-8000-000000000409";
const verificationRunId = "00000000-0000-4000-8000-000000000410";
const playbookId = "00000000-0000-4000-8000-000000000411";
const now = "2026-11-21T03:50:00.000Z";

const industry: IndustryProfile = {
  id: "00000000-0000-4000-8000-000000000412",
  marketProfileId: "00000000-0000-4000-8000-000000000413",
  name: "Commercial HVAC & Mechanical Services",
  summary: "High quote follow-up complexity across commercial site tenders.",
  operationalProblems: ["Slow manual quote follow-ups across commercial projects"],
  solutionFit: ["Automated quote-to-job follow-up reminders"],
  buyerRoleHypotheses: ["Managing Director", "Operations Manager"],
  evidenceStrength: "moderate",
  claimIds: [claimId],
  unknowns: ["Current CRM adoption level at mid-size contractors"],
};

const claims: ResearchClaim[] = [
  {
    id: claimId,
    kind: "observation",
    statement: "Mid-market commercial trades report delayed tender follow-up.",
    sourceIds: [sourceId],
    comparisonBasis: null,
    evidenceStrength: "moderate",
    citationStatus: "supported",
  },
];

const shortlistedAccount: AccountCandidateDossier = scoreAndBuildAccountDossier(
  {
    id: "prospeo-co-401",
    name: "Putrajaya Mechanical Engineering Sdn Bhd",
    domain: "pme.my",
    website: "https://pme.my",
    industry: "Commercial HVAC",
    employeeRange: "11-50",
    location: { city: "Putrajaya", country: "Malaysia" },
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

test("account-to-people graph rejects execution without shortlisted companies", async () => {
  const noopExecutor: AccountToPeopleExecutor = {
    async proposeRolesPreview() {
      throw new Error("Should not propose without shortlisted accounts");
    },
    async executeApprovedPersonSearch() {
      throw new Error("Should not search without shortlisted accounts");
    },
    async prepareVerificationPreview() {
      throw new Error("Should not preview verification without shortlisted accounts");
    },
    async executeApprovedVerification() {
      throw new Error("Should not execute verification without shortlisted accounts");
    },
    async generatePlaybooks() {
      throw new Error("Should not generate playbooks without shortlisted accounts");
    },
  };

  const graph = createAccountToPeopleGraph(noopExecutor, new MemorySaver());
  await assert.rejects(
    () =>
      graph.invoke(
        {
          stage: "propose_roles",
          conversationId: convId,
          shortlistedAccounts: [],
          roleOverrides: [],
          currentNode: "verify_shortlisted_accounts",
        },
        { configurable: { thread_id: "phase-e-no-shortlist" } },
      ),
    /Shortlist at least one company in Phase D/,
  );
});

test("Stage A & B separate named discovery, selective Dropcontact preview, and factual playbooks", async () => {
  const roles = deriveBuyerRoleRecommendations(industry, null);
  const personPreview = buildPersonSearchPreview({
    personSearchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    shortlistedAccounts: [shortlistedAccount],
    roleRecommendations: roles,
    nowIso: now,
  });

  assert.equal(personPreview.maximumResults, 25);
  assert.equal(personPreview.estimatedMaximumCredits, 1);
  assert.equal(personPreview.status, "awaiting_approval");

  const contact1: ContactCandidateView = normalizeDiscoveredPersonCandidate(
    {
      id: "person-1",
      fullName: "Amir Hakim",
      firstName: "Amir",
      lastName: "Hakim",
      title: "Managing Director",
      companyId: "prospeo-co-401",
      companyName: shortlistedAccount.name,
      companyDomain: "pme.my",
      linkedInUrl: "https://linkedin.com/in/amir-hakim",
    },
    {
      candidateId: contactId1,
      conversationId: convId,
      targetDecisionId: decisionId,
      personSearchId,
      account: shortlistedAccount,
      roleRecommendations: roles,
      capturedAt: now,
    },
  );

  const contact2: ContactCandidateView = normalizeDiscoveredPersonCandidate(
    {
      id: "person-2",
      fullName: "Nurul Aina",
      firstName: "Nurul",
      lastName: "Aina",
      title: "Operations Manager",
      companyId: "prospeo-co-401",
      companyName: shortlistedAccount.name,
      companyDomain: "pme.my",
    },
    {
      candidateId: contactId2,
      conversationId: convId,
      targetDecisionId: decisionId,
      personSearchId,
      account: shortlistedAccount,
      roleRecommendations: roles,
      capturedAt: now,
    },
  );

  assert.equal(contact1.verificationStatus, "not_requested");
  assert.equal(contact1.verifiedDetails, null);

  // Only select contact1 for Dropcontact (selective, never bulk-enrich contact2)
  const dcPreview = buildDropcontactVerificationPreview({
    verificationRunId,
    conversationId: convId,
    personSearchId,
    selectedContacts: [contact1],
    nowIso: now,
  });

  assert.equal(dcPreview.estimatedCredits, 1);
  assert.deepEqual(dcPreview.selectedContactIds, [contactId1]);
  assert.equal(dcPreview.previewPairs[0]?.fullName, "Amir Hakim");
  assert.equal(dcPreview.previewPairs[0]?.companyName, shortlistedAccount.name);

  // Simulate selective Dropcontact completion for contact1 while contact2 stays named-only
  const verifiedContact1: ContactCandidateView = {
    ...contact1,
    selectedForVerification: true,
    verificationStatus: "verified",
    verifiedAt: now,
    verifiedDetails: {
      email: "amir@pme.my",
      emailQualification: "nominative@pro",
      phone: "+60388881111",
      verifiedDomain: "pme.my",
      provider: "dropcontact",
      verifiedAt: now,
    },
  };

  const playbook = compileFactualAccountPlaybook({
    playbookId,
    conversationId: convId,
    targetDecisionId: decisionId,
    account: shortlistedAccount,
    targetMarketName: "Malaysia",
    industry,
    claims,
    contacts: [verifiedContact1, contact2],
    offerSummary: "Automated quote follow-up workflows",
    nowIso: now,
  });

  assert.equal(playbook.accountCandidateId, accountId);
  assert.deepEqual(playbook.claimIds, [claimId]);
  assert.equal(playbook.buyerAngles[0]?.contactProvenance, "verified_contact");
  assert.equal(playbook.buyerAngles[1]?.contactProvenance, "named_unverified");
  assert.ok(
    playbook.evidenceBackedPoints.some((point) => point.kind === "research_claim"),
  );
  assert.ok(
    playbook.evidenceBackedPoints.some((point) => point.kind === "company_signal"),
  );
  assert.ok(
    playbook.evidenceBackedPoints.some((point) => point.kind === "contact_record"),
  );

  let viewState: PeopleDiscoveryView = {
    shortlistedCount: 1,
    personSearch: personPreview,
    contacts: [],
    verificationRun: null,
    playbooks: [],
  };

  const graph = createAccountToPeopleGraph(
    {
      async proposeRolesPreview() {
        return viewState;
      },
      async executeApprovedPersonSearch() {
        viewState = {
          ...viewState,
          personSearch: { ...personPreview, status: "completed", resultCount: 2 },
          contacts: [contact1, contact2],
        };
        return viewState;
      },
      async prepareVerificationPreview() {
        viewState = {
          ...viewState,
          verificationRun: dcPreview,
        };
        return viewState;
      },
      async executeApprovedVerification() {
        viewState = {
          ...viewState,
          contacts: [verifiedContact1, contact2],
          verificationRun: { ...dcPreview, status: "completed", verifiedCount: 1 },
        };
        return viewState;
      },
      async generatePlaybooks() {
        viewState = {
          ...viewState,
          playbooks: [playbook],
        };
        return viewState;
      },
    },
    new MemorySaver(),
  );

  const stageAConfig = { configurable: { thread_id: "phase-e-stage-a" } };
  await graph.invoke(
    {
      stage: "propose_roles",
      conversationId: convId,
      shortlistedAccounts: [shortlistedAccount],
      currentNode: "verify_shortlisted_accounts",
    },
    stageAConfig,
  );
  assert.equal(
    (await graph.getState(stageAConfig)).values.currentNode,
    "await_person_search_approval",
  );

  await graph.invoke(
    {
      stage: "prepare_verification",
      conversationId: convId,
      shortlistedAccounts: [shortlistedAccount],
      selectedContactIds: [contactId1],
      currentNode: "verify_shortlisted_accounts",
    },
    { configurable: { thread_id: "phase-e-stage-b-preview" } },
  );
  assert.equal(
    (await graph.getState({ configurable: { thread_id: "phase-e-stage-b-preview" } })).values
      .currentNode,
    "await_contact_verification_approval",
  );

  await graph.invoke(
    {
      stage: "generate_playbooks",
      conversationId: convId,
      shortlistedAccounts: [shortlistedAccount],
      currentNode: "verify_shortlisted_accounts",
    },
    { configurable: { thread_id: "phase-e-playbooks" } },
  );
  assert.equal(
    (await graph.getState({ configurable: { thread_id: "phase-e-playbooks" } })).values
      .playbooks.length,
    1,
  );
});

test("Prospeo person search client and Dropcontact verification client parse bounded responses without retries", async () => {
  const prevProspeo = process.env.PROSPEO_KEY;
  const prevDropcontact = process.env.DROPCONTACT_API_KEY;
  process.env.PROSPEO_KEY = "test-prospeo";
  process.env.DROPCONTACT_API_KEY = "test-dropcontact";

  try {
    const prospeoResult = await searchProspeoPeople(
      { company: { company_websites: { include: ["pme.my"] } } },
      (async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        assert.equal(body.page, 1);
        return new Response(
          JSON.stringify({
            error: false,
            free: false,
            results: [
              {
                person: {
                  person_id: "p-1",
                  first_name: "Amir",
                  last_name: "Hakim",
                  current_job_title: "Managing Director",
                  linkedin_url: "https://linkedin.com/in/amir",
                },
                company: {
                  company_id: "prospeo-co-401",
                  name: "Putrajaya Mechanical Engineering",
                  domain: "pme.my",
                },
              },
            ],
            pagination: { total_count: 1 },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    );
    assert.equal(prospeoResult.people[0]?.fullName, "Amir Hakim");
    assert.equal(prospeoResult.people[0]?.companyDomain, "pme.my");

    const dcResult = await verifyContactsWithDropcontact(
      [
        {
          contactId: contactId1,
          fullName: "Amir Hakim",
          firstName: "Amir",
          lastName: "Hakim",
          companyName: "Putrajaya Mechanical Engineering",
          website: "https://pme.my",
          fieldsSent: ["first_name", "last_name", "full_name", "company", "website"],
        },
      ],
      (async () =>
        new Response(
          JSON.stringify({
            success: true,
            request_id: "dc-req-1",
            credits_left: 99,
            data: [
              {
                email: [{ email: "amir@pme.my", qualification: "nominative@pro" }],
                phone: "+60388881111",
                website: "https://pme.my",
                custom_fields: { ano_contact_id: contactId1 },
              },
            ],
          }),
          { status: 200 },
        )) as typeof fetch,
    );
    assert.equal(dcResult.requestId, "dc-req-1");
    assert.equal(dcResult.results[0]?.verified, true);
    assert.equal(dcResult.results[0]?.email, "amir@pme.my");

    await assert.rejects(
      () =>
        verifyContactsWithDropcontact(
          [
            {
              contactId: contactId1,
              fullName: "Amir Hakim",
              firstName: "Amir",
              lastName: "Hakim",
              companyName: "Putrajaya Mechanical Engineering",
              website: null,
              fieldsSent: ["full_name", "company"],
            },
          ],
          (async () => new Response(JSON.stringify({ error: true }), { status: 429 })) as typeof fetch,
        ),
      (err: unknown) => err instanceof DropcontactClientError && err.code === "RATE_LIMITED",
    );
  } finally {
    if (prevProspeo === undefined) delete process.env.PROSPEO_KEY;
    else process.env.PROSPEO_KEY = prevProspeo;
    if (prevDropcontact === undefined) delete process.env.DROPCONTACT_API_KEY;
    else process.env.DROPCONTACT_API_KEY = prevDropcontact;
  }
});

test("Phase E message parts and work queue reflect pending verification and playbook artifacts", () => {
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
      id: "00000000-0000-4000-8000-000000000499",
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

  const roles = deriveBuyerRoleRecommendations(industry, null);
  const personPreview = buildPersonSearchPreview({
    personSearchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    shortlistedAccounts: [shortlistedAccount],
    roleRecommendations: roles,
    nowIso: now,
  });

  const parts = buildConversationMessageParts(conversation, null, null, null, {
    shortlistedCount: 1,
    personSearch: personPreview,
    contacts: [],
    verificationRun: null,
    playbooks: [],
  });
  assert.ok(
    parts.some((p) => p.type === "artifact" && p.artifactType === "people_discovery"),
  );
  assert.deepEqual(parts.at(-1), { type: "status", state: "awaiting_approval" });

  const workQueueItem = classifyConversationWorkItem({
    conversation: {
      id: convId,
      title: "Malaysia",
      status: "complete_without_research",
      createdAt: now,
      updatedAt: now,
    },
    targetDecision: { status: "locked", updatedAt: now },
    verificationRun: { status: "awaiting_approval", estimatedCredits: 2, updatedAt: now },
  });
  assert.equal(workQueueItem?.category, "provider_scope_approval_required");
  assert.equal(workQueueItem?.label, "Approve email verification");
});

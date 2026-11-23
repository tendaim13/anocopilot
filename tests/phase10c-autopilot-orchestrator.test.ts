import assert from "node:assert/strict";
import test from "node:test";

import type { DemoWorkspaceSession } from "@/contracts/ano";
import {
  AUTOPILOT_STAGES,
  buildAutopilotExecutiveSummaryMarkdown,
  isOpenMarketRecommendationIntent,
  nextPendingAutopilotStage,
  rankAccountsForAutopilotShortlist,
  selectAutopilotTargetRoute,
  selectPriorityContactsForWaterfall,
  stagesBefore,
  type AutopilotExecutableStage,
  type AutopilotRunView,
  type AutopilotStageSummary,
} from "@/lib/ano/autopilot";
import type { AccountCandidateDossier, CompanySearchView } from "@/lib/ano/company-discovery";
import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type { OutreachTemplatePackView } from "@/lib/ano/outreach-templates";
import type { ContactCandidateView, PeopleDiscoveryView } from "@/lib/ano/people-playbooks";
import type {
  ResearchBrief,
  ResearchConversationView,
  ResearchPlan,
} from "@/lib/ano/research-conversation";
import {
  executeAutopilotStepWithDeps,
  type AutopilotOrchestratorDeps,
} from "@/server/domain/autopilot-orchestrator-service";
import type { StoredProductSource } from "@/server/persistence/product-source-store";

const NOW = "2026-11-23T12:00:00.000Z";
const CONV_ID = "00000000-0000-4000-8000-000000002001";
const RUN_ID = "00000000-0000-4000-8000-000000002002";
const PLAN_ID = "00000000-0000-4000-8000-000000002003";
const MSG_ID = "00000000-0000-4000-8000-000000002004";
const RESEARCH_RUN_ID = "00000000-0000-4000-8000-000000002005";
const SRC_ID = "00000000-0000-4000-8000-000000002006";
const CLAIM_1 = "00000000-0000-4000-8000-000000002011";
const CLAIM_2 = "00000000-0000-4000-8000-000000002012";
const MKT_MY = "00000000-0000-4000-8000-000000002021";
const MKT_SG = "00000000-0000-4000-8000-000000002022";
const IND_MY = "00000000-0000-4000-8000-000000002031";
const IND_SG = "00000000-0000-4000-8000-000000002032";
const DECISION_ID = "00000000-0000-4000-8000-000000002041";
const SYNTH_ID = "00000000-0000-4000-8000-000000002042";
const SEARCH_ID = "00000000-0000-4000-8000-000000002051";
const PERSON_SEARCH_ID = "00000000-0000-4000-8000-000000002061";
const VERIFY_RUN_ID = "00000000-0000-4000-8000-000000002062";
const PACK_ID = "00000000-0000-4000-8000-000000002071";

const MOCK_SESSION: DemoWorkspaceSession = {
  kind: "demo",
  actorId: "demo-user",
  actorEmail: "demo@local.ano",
  workspace: {
    id: "00000000-0000-4000-8000-000000002000",
    name: "Test Workspace",
    slug: "test-ws",
    role: "owner",
  },
};

function makeBrief(overrides: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    offer: "Automated patient recall software for dental clinics",
    goal: "Book demos with multi-chair dental practices",
    businessLocation: "Malaysia",
    targetMarkets: ["Malaysia"],
    intakeComplete: true,
    marketHints: ["Dental clinics"],
    locationHints: ["Malaysia"],
    buyerHints: ["Managing Director", "Practice Manager"],
    constraints: [],
    unknowns: [],
    sourceMessageIds: [MSG_ID],
    ...overrides,
  };
}

function makePlan(): ResearchPlan {
  return {
    id: PLAN_ID,
    version: 1,
    approvalStatus: "approved",
    createdAt: NOW,
    summary: "Evaluate dental practice adoption and outbound segments.",
    researchQuestions: [
      "What drives recall drop-off in private dental clinics?",
      "Which regions have higher multi-chair practice density?",
    ],
    comparisonCriteria: ["Clinic density", "Software readiness"],
    intendedSourceClasses: ["Industry bodies and primary research", "Independent reporting"],
    plannedScope: {
      markets: ["Malaysia"],
      industries: ["Dental Clinics"],
      buyerRoles: ["Managing Director", "Practice Manager"],
    },
    budget: {
      maximumSearches: 50,
      maximumFetches: 100,
      providerSpend: "not_available_in_phase_a",
    },
    uncertainties: [],
  };
}

function makeSynthesis(locked = false): MarketSynthesis {
  return {
    id: SYNTH_ID,
    conversationId: CONV_ID,
    researchRunId: RESEARCH_RUN_ID,
    status: "ready_for_decision",
    recommendationMode: "directly_supported",
    assessment: {
      fetchedSourceCount: 4,
      sourceClassCount: 2,
      coverageStrength: "moderate",
      comparisonReady: true,
      contradictions: [],
      gaps: [],
      summary: "Research ready for segment selection.",
    },
    claims: [
      {
        id: CLAIM_1,
        kind: "observation",
        statement: "Private dental chains track missed hygiene recall visits closely.",
        sourceIds: [SRC_ID],
        comparisonBasis: null,
        evidenceStrength: "moderate",
        citationStatus: "supported",
      },
      {
        id: CLAIM_2,
        kind: "comparable",
        statement: "Regional clinic expansion favors automated SMS follow-up.",
        sourceIds: [SRC_ID],
        comparisonBasis: "Regional adoption rate across urban practices",
        evidenceStrength: "strong",
        citationStatus: "supported",
      },
    ],
    markets: [
      {
        id: MKT_MY,
        name: "Malaysia",
        summary: "Growing urban dental clinics in Klang Valley and Penang.",
        evidenceStrength: "moderate",
        claimIds: [CLAIM_1],
        unknowns: [],
        nextResearchActions: [],
      },
      {
        id: MKT_SG,
        name: "Singapore",
        summary: "High digital clinic density in central Singapore.",
        evidenceStrength: "strong",
        claimIds: [CLAIM_1, CLAIM_2],
        unknowns: [],
        nextResearchActions: [],
      },
    ],
    industries: [
      {
        id: IND_MY,
        marketProfileId: MKT_MY,
        name: "Dental Clinics",
        summary: "Private multi-chair dental practices.",
        operationalProblems: ["No-show and overdue recall appointments"],
        solutionFit: ["Automated 6-month patient recall sequences"],
        buyerRoleHypotheses: ["Managing Director", "Practice Manager"],
        evidenceStrength: "moderate",
        claimIds: [CLAIM_1],
        unknowns: [],
      },
      {
        id: IND_SG,
        marketProfileId: MKT_SG,
        name: "Dental Practices",
        summary: "Boutique specialist dental centers.",
        operationalProblems: ["Chair utilization gaps"],
        solutionFit: ["Recall booking automation"],
        buyerRoleHypotheses: ["Principal Dentist", "Clinic Manager"],
        evidenceStrength: "strong",
        claimIds: [CLAIM_1, CLAIM_2],
        unknowns: [],
      },
    ],
    decision: {
      id: DECISION_ID,
      status: locked ? "locked" : "awaiting_selection",
      marketProfileId: locked ? MKT_MY : null,
      industryProfileId: locked ? IND_MY : null,
      rationale: locked ? "Selected Malaysia Dental Clinics" : null,
      selectedAt: locked ? NOW : null,
    },
    failureMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeAccount(index: number, overrides: Partial<AccountCandidateDossier> = {}): AccountCandidateDossier {
  const suffix = String(index).padStart(4, "0");
  return {
    id: `00000000-0000-4000-8000-00000001${suffix}`,
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    companySearchId: SEARCH_ID,
    sourceKey: `prospeo:acc-${index}`,
    name: `Dental Clinic ${index}`,
    domain: index % 2 === 0 ? `clinic${index}.com.my` : null,
    website: index % 2 === 0 ? `https://clinic${index}.com.my` : null,
    linkedInUrl: null,
    industry: "Dental Clinics",
    location: "Petaling Jaya, Malaysia",
    employeeBand: "11-50",
    employeeCount: 20,
    description: "Private dental group.",
    lifecycleState: "discovered",
    fit: {
      locationScore: 35,
      industryScore: 30,
      signalScore: 15,
      totalScore: 80 - index,
      confidence: "high",
      rationale: "Strong location and clinic alignment.",
      industryHypothesisNote: "Phase C alignment.",
    },
    signals: [],
    claimIds: [CLAIM_1],
    evidenceUrls: [],
    unknowns: [],
    retrievedAt: NOW,
    ...overrides,
  };
}

function makeContact(
  index: number,
  overrides: Partial<ContactCandidateView> = {},
): ContactCandidateView {
  const suffix = String(index).padStart(4, "0");
  return {
    id: `00000000-0000-4000-8000-00000002${suffix}`,
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    accountCandidateId: `00000000-0000-4000-8000-000000010001`,
    accountName: "SmileBay Dental",
    accountDomain: "smilebaydental.com",
    personSearchId: PERSON_SEARCH_ID,
    sourceKey: `website:contact-${index}`,
    fullName: `Dr. Candidate ${index}`,
    firstName: "Candidate",
    lastName: `Person${index}`,
    title: "Managing Director",
    seniority: "Founder/Owner",
    department: "C-Suite",
    location: "Penang, Malaysia",
    linkedInUrl: "https://linkedin.com/in/example",
    sourceUrl: "https://smilebaydental.com/team",
    discoveryProvider: "website_team",
    publicEmail: null,
    publicEmailKind: null,
    publicPhone: null,
    roleRationale: "Primary clinic decision-maker.",
    confidence: "high",
    claimIds: [CLAIM_1],
    selectedForVerification: false,
    verificationStatus: "not_requested",
    verifiedDetails: null,
    retrievedAt: NOW,
    verifiedAt: null,
    ...overrides,
  };
}

function makeTemplatePack(): OutreachTemplatePackView {
  return {
    id: PACK_ID,
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    version: 1,
    tone: "peer_direct",
    ctaStyle: "easy_yes",
    entryOffer: "14-day recall audit",
    senderName: "Alex",
    targetRoles: ["Managing Director", "Practice Manager"],
    steps: [
      {
        stepKey: "initial",
        stepNumber: 1,
        label: "Initial email",
        channel: "email",
        dayOffset: 0,
        subject: "recall follow up at {{company_name}}",
        body: "Hi {{first_name}}, noticing how {{company_name}} handles patient checkup reminders cleanly. Open to seeing how clinics automate 6-month recall bookings?",
        mergeFieldsUsed: ["{{company_name}}", "{{first_name}}"],
        lint: { passed: true, wordCount: 24, maxWords: 60, issues: [] },
      },
    ],
    claimIds: [CLAIM_1],
    generationMode: "fallback",
    lastInstruction: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const FORBIDDEN_BILLING_PATTERN = /credit|cr\/found|billing|\$0|\$\d|token|cost/i;

test("pure autopilot helpers route markets, boost websites, filter waterfall contacts, and keep summary free of billing copy", () => {
  assert.equal(nextPendingAutopilotStage([]), "brief_and_plan");
  assert.equal(nextPendingAutopilotStage(["brief_and_plan", "market_research"]), "synthesis_and_lock");
  assert.equal(nextPendingAutopilotStage([...AUTOPILOT_STAGES]), "done");
  assert.deepEqual(stagesBefore("company_discovery"), [
    "brief_and_plan",
    "market_research",
    "synthesis_and_lock",
  ]);
  assert.equal(isOpenMarketRecommendationIntent("Recommend best market"), true);
  assert.equal(isOpenMarketRecommendationIntent("Malaysia"), false);

  const synthesis = makeSynthesis(false);
  const explicitChoice = selectAutopilotTargetRoute(synthesis, makeBrief({ targetMarkets: ["Malaysia"] }));
  assert.equal(explicitChoice?.market.name, "Malaysia");

  const recommendedChoice = selectAutopilotTargetRoute(
    synthesis,
    makeBrief({ targetMarkets: ["Recommend best market"] }),
  );
  assert.equal(recommendedChoice?.market.name, "Singapore");

  const accounts = [
    makeAccount(1, { website: null, domain: null, fit: { ...makeAccount(1).fit, totalScore: 95 } }),
    makeAccount(2, { website: "https://clinic2.com.my", domain: "clinic2.com.my", fit: { ...makeAccount(2).fit, totalScore: 84 } }),
    makeAccount(3, { lifecycleState: "dismissed", fit: { ...makeAccount(3).fit, totalScore: 100 } }),
  ];
  const ranked = rankAccountsForAutopilotShortlist(accounts, 10);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].name, "Dental Clinic 2");
  assert.equal(ranked[1].name, "Dental Clinic 1");

  const mixedContacts = [
    makeContact(1, {
      fullName: "Verified Person",
      verificationStatus: "verified",
      verifiedDetails: {
        email: "verified@clinic.com",
        emailQualification: "nominative@pro",
        phone: null,
        verifiedDomain: "clinic.com",
        provider: "prospeo",
        verifiedAt: NOW,
      },
    }),
    makeContact(2, {
      fullName: "SmileBay Dental Team",
      title: "Public Clinic Contact (Website)",
      firstName: "SmileBay",
      lastName: null,
    }),
    makeContact(3, {
      fullName: "Alice Public",
      firstName: "Alice",
      lastName: "Public",
      seniority: "Director",
      title: "Director",
      publicEmail: "alice@clinic.com",
      publicEmailKind: "direct_public",
    }),
    ...Array.from({ length: 12 }, (_, idx) =>
      makeContact(10 + idx, {
        fullName: `Founder MissingEmail ${idx}`,
        firstName: "Founder",
        lastName: `No${idx}`,
        seniority: "Founder/Owner",
        title: "Founder",
        publicEmail: null,
      }),
    ),
  ];
  const waterfallTargets = selectPriorityContactsForWaterfall(mixedContacts, 10);
  assert.equal(waterfallTargets.length, 10);
  assert.equal(
    waterfallTargets.every(
      (c) => !c.publicEmail && c.verificationStatus !== "verified" && c.title !== "Public Clinic Contact (Website)",
    ),
    true,
  );

  const summary = buildAutopilotExecutiveSummaryMarkdown({
    businessLocation: "Malaysia",
    marketName: "Malaysia",
    industryName: "Dental Clinics",
    topClaimStatement: "Private chains focus on overdue recall follow-ups.",
    discoveredCompanyCount: 15,
    shortlistedCompanyNames: ["SmileBay Dental", "Livingwell Dentistry"],
    totalContacts: 9,
    verifiedEmailCount: 4,
    publicEmailCount: 3,
    withPhoneCount: 5,
    templatePack: makeTemplatePack(),
    warnings: [],
  });
  assert.equal(FORBIDDEN_BILLING_PATTERN.test(summary), false);
});

test("checkpointed 6-stage stepping completes in order, respects leases, pauses cleanly, and preserves completed stages", async () => {
  const stageCalls: AutopilotExecutableStage[] = [];
  const messagesPosted: Array<{ text: string; dedupeKey: string }> = [];

  let runState: AutopilotRunView = {
    id: RUN_ID,
    conversationId: CONV_ID,
    status: "running",
    currentStage: "brief_and_plan",
    completedStages: [],
    stageSummaries: {},
    warnings: [],
    lastError: null,
    stageInFlight: false,
    heartbeatAt: NOW,
    startedAt: NOW,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  let leaseToken: string | null = null;
  let brief = makeBrief();
  let plan: ResearchPlan | null = makePlan();
  let researchView: EvidenceResearchView | null = null;
  let synthesis: MarketSynthesis | null = makeSynthesis(false);
  let companySearch: CompanySearchView | null = null;
  let peopleView: PeopleDiscoveryView = {
    shortlistedCount: 0,
    personSearch: null,
    contacts: [],
    verificationRun: null,
    playbooks: [],
  };
  let templatePack: OutreachTemplatePackView | null = null;

  const makeConvView = (): ResearchConversationView => ({
    conversation: {
      id: CONV_ID,
      title: "Dental patient recall software",
      status: "complete_without_research",
      threadId: "thread-1",
      createdAt: NOW,
      updatedAt: NOW,
    },
    run: {
      id: RUN_ID,
      status: "complete_without_research",
      graphVersion: "1",
      currentNode: "complete",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [{ id: MSG_ID, role: "user", kind: "message", text: "Automate dental recalls", createdAt: NOW }],
    brief,
    pendingQuestion: null,
    plan,
    events: [],
  });

  const deps: AutopilotOrchestratorDeps = {
    readAutopilotRun: async () => runState,
    startOrResumeAutopilotRun: async () => runState,
    claimAutopilotStageLease: async () => {
      if (runState.status !== "running") {
        return {
          claimed: false,
          run: runState,
          stage: runState.currentStage,
          leaseToken: null,
          reason: "not_running",
        };
      }
      if (leaseToken) {
        return {
          claimed: false,
          run: { ...runState, stageInFlight: true },
          stage: runState.currentStage,
          leaseToken: null,
          reason: "in_flight",
        };
      }
      const next = nextPendingAutopilotStage(runState.completedStages);
      if (next === "done") {
        return {
          claimed: false,
          run: runState,
          stage: "done",
          leaseToken: null,
          reason: "already_done",
        };
      }
      leaseToken = "lease-1";
      runState = { ...runState, currentStage: next, stageInFlight: true };
      return { claimed: true, run: runState, stage: next, leaseToken };
    },
    completeAutopilotStageLease: async (_session, input) => {
      leaseToken = null;
      const completed = Array.from(new Set([...runState.completedStages, input.stage]));
      const next = nextPendingAutopilotStage(completed);
      const warnings = Array.from(new Set([...runState.warnings, ...(input.warnings ?? [])]));
      runState = {
        ...runState,
        completedStages: completed,
        stageSummaries: { ...runState.stageSummaries, [input.stage]: input.summary },
        warnings,
        currentStage: next,
        stageInFlight: false,
        status: next === "done" ? (warnings.length > 0 ? "completed_with_warnings" : "completed") : runState.status,
        completedAt: next === "done" ? NOW : null,
      };
      return runState;
    },
    failAutopilotStageLease: async (_session, input) => {
      leaseToken = null;
      runState = { ...runState, status: "failed", stageInFlight: false, lastError: input.errorMessage };
      return runState;
    },
    cancelAutopilotRun: async (_session, _cid, mode = "paused") => {
      leaseToken = null;
      runState = { ...runState, status: mode, stageInFlight: false };
      return runState;
    },
    checkBudget: async () => true,
    runWithUsageContext: async (_ctx, fn) => fn(),
    getConversation: async () => makeConvView(),
    readProductSources: async () => [],
    approvePlanForAutopilot: async () => {
      stageCalls.push("brief_and_plan");
      plan = makePlan();
      return makeConvView();
    },
    generateAndSaveAutopilotPlan: async () => makeConvView(),
    isSearxngAvailable: () => true,
    getEvidenceResearch: async () => researchView,
    prepareEvidenceResearch: async () => {
      stageCalls.push("market_research");
      researchView = {
        run: {
          id: RESEARCH_RUN_ID,
          conversationId: CONV_ID,
          threadId: "t-res",
          attemptNumber: 1,
          provider: "searxng",
          status: "awaiting_provider_approval",
          maximumSearches: 15,
          maximumFetches: 20,
          consumedSearches: 0,
          consumedFetches: 0,
          currentWave: 0,
          sourceCount: 0,
          failureMessage: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
        actions: [],
        queries: [],
        sources: [],
      };
      return researchView;
    },
    startEvidenceResearch: async () => {
      researchView = {
        run: {
          ...(researchView!.run),
          status: "sources_ready",
          consumedSearches: 4,
          consumedFetches: 4,
          currentWave: 1,
          sourceCount: 1,
        },
        actions: [],
        queries: [],
        sources: [
          {
            id: SRC_ID,
            title: "Malaysia Dental Study",
            url: "https://example.com/dental",
            sourceClass: "industry",
            excerpt: "Dental patient recall increases attendance.",
            publishedAt: NOW,
            retrievedAt: NOW,
            status: "fetched",
          },
        ],
      };
      return researchView;
    },
    ensureFallbackResearchRun: async () => {
      throw new Error("Should not call fallback when SearXNG succeeds");
    },
    getMarketSynthesis: async () => synthesis,
    analyseMarketSynthesis: async () => {
      stageCalls.push("synthesis_and_lock");
      return synthesis;
    },
    ensureFallbackSynthesis: async () => makeSynthesis(false),
    lockMarketRoute: async (_session, _cid, input) => {
      synthesis = {
        ...synthesis!,
        decision: {
          id: DECISION_ID,
          status: "locked",
          marketProfileId: input.marketProfileId,
          industryProfileId: input.industryProfileId,
          rationale: input.rationale ?? null,
          selectedAt: NOW,
        },
      };
      return synthesis;
    },
    isProspeoAvailable: () => true,
    getCompanySearch: async () => companySearch,
    runOsmSearch: async () => {
      stageCalls.push("company_discovery");
      companySearch = {
        id: SEARCH_ID,
        conversationId: CONV_ID,
        targetDecisionId: DECISION_ID,
        providerActionRequestId: null,
        providerKey: "openstreetmap",
        status: "completed",
        targetMarketName: "Malaysia",
        targetIndustryName: "Dental Clinics",
        requestedLocations: ["Malaysia"],
        canonicalLocations: ["Malaysia"],
        canonicalIndustries: [],
        industryKeywords: ["dental"],
        excludedCategories: [],
        linkedClaimIds: [CLAIM_1],
        criteria: ["Location: Malaysia"],
        providerFilters: {},
        maximumResults: 25,
        estimatedMaximumCredits: 0,
        estimateDetail: "Local discovery",
        resultCount: 2,
        providerReceipt: {},
        failureMessage: null,
        cohort: null,
        accounts: [
          makeAccount(1, { website: "https://smilebaydental.com", domain: "smilebaydental.com" }),
          makeAccount(2, { website: "https://livingwell.com.my", domain: "livingwell.com.my" }),
        ],
        approvedAt: NOW,
        completedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      };
      return companySearch;
    },
    prepareProspeoCompanyPreview: async () => companySearch!,
    approveCompanySearch: async () => companySearch!,
    shortlistAccount: async (_session, _cid, accountId) => {
      companySearch = {
        ...companySearch!,
        accounts: companySearch!.accounts.map((a) =>
          a.id === accountId ? { ...a, lifecycleState: "shortlisted" } : a,
        ),
      };
      return companySearch;
    },
    isDropcontactAvailable: () => true,
    getPeopleDiscovery: async () => peopleView,
    runWebsiteTeamDiscovery: async () => {
      stageCalls.push("people_and_emails");
      peopleView = {
        ...peopleView,
        shortlistedCount: 2,
        contacts: [
          makeContact(1, { publicEmail: "hello@livingwell.com.my", publicEmailKind: "shared_inbox" }),
          makeContact(2, { publicEmail: null }),
        ],
      };
      return peopleView;
    },
    proposeProspeoPeople: async () => ({
      ...peopleView,
      personSearch: {
        id: PERSON_SEARCH_ID,
        conversationId: CONV_ID,
        targetDecisionId: DECISION_ID,
        providerActionRequestId: null,
        providerKey: "prospeo",
        status: "awaiting_approval",
        shortlistedAccountIds: [makeAccount(1).id],
        shortlistedAccountNames: ["SmileBay Dental"],
        roleRecommendations: [{ title: "Founder", rationale: "Lead", claimIds: [CLAIM_1] }],
        approvedRoles: ["Founder"],
        providerFilters: {},
        maximumResults: 25,
        estimatedMaximumCredits: 1,
        estimateDetail: "People search",
        resultCount: null,
        providerReceipt: {},
        failureMessage: null,
        approvedAt: null,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    }),
    approvePersonSearch: async () => peopleView,
    prepareContactVerification: async (_session, _cid, ids, providerKey) => ({
      ...peopleView,
      verificationRun: {
        id: VERIFY_RUN_ID,
        conversationId: CONV_ID,
        personSearchId: PERSON_SEARCH_ID,
        providerActionRequestId: null,
        providerKey,
        status: "awaiting_approval",
        selectedContactIds: ids,
        previewPairs: [
          {
            contactId: ids[0],
            fullName: "Candidate Person2",
            firstName: "Candidate",
            lastName: "Person2",
            companyName: "SmileBay Dental",
            website: "https://smilebaydental.com",
            fieldsSent: ["full_name", "company_website"],
          },
        ],
        estimatedCredits: 1,
        estimateDetail: "Verification",
        verifiedCount: null,
        providerReceipt: {},
        failureMessage: null,
        approvedAt: null,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    }),
    approveContactVerification: async (_session, _cid) => {
      peopleView = {
        ...peopleView,
        contacts: peopleView.contacts.map((c) =>
          !c.publicEmail
            ? {
                ...c,
                verificationStatus: "verified",
                verifiedDetails: {
                  email: "owner@smilebaydental.com",
                  emailQualification: "nominative@pro",
                  phone: null,
                  verifiedDomain: "smilebaydental.com",
                  provider: "prospeo",
                  verifiedAt: NOW,
                },
              }
            : c,
        ),
      };
      return peopleView;
    },
    getTemplatePack: async () => templatePack,
    generateTemplatePack: async () => {
      stageCalls.push("outreach_templates");
      templatePack = makeTemplatePack();
      return templatePack;
    },
    appendExecutiveSummaryMessage: async (_session, _cid, text, dedupeKey) => {
      messagesPosted.push({ text, dedupeKey });
    },
  };

  // Overlapping active-lease check does 0 work
  leaseToken = "other-worker";
  const inFlight = await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);
  assert.equal(inFlight.skippedBecauseInFlight, true);
  assert.equal(inFlight.executedStage, null);
  leaseToken = null;

  // Step 1
  const s1 = await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);
  assert.equal(s1.executedStage, "brief_and_plan");
  assert.equal(s1.autopilotRun?.currentStage, "market_research");

  // Step 2
  const s2 = await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);
  assert.equal(s2.executedStage, "market_research");
  assert.equal(s2.autopilotRun?.currentStage, "synthesis_and_lock");

  // Pause & confirm step does not run while paused
  runState = { ...runState, status: "paused" };
  const pausedRes = await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);
  assert.equal(pausedRes.executedStage, null);
  assert.equal(pausedRes.skippedBecauseInFlight, false);

  // Resume from paused -> continues cleanly from stage 3 without repeating stages 1-2
  runState = { ...runState, status: "running" };
  const s3 = await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);
  const s4 = await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);
  const s5 = await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);
  const s6 = await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);

  assert.equal(s3.executedStage, "synthesis_and_lock");
  assert.equal(s4.executedStage, "company_discovery");
  assert.equal(s5.executedStage, "people_and_emails");
  assert.equal(s6.executedStage, "outreach_templates");
  assert.equal(s6.autopilotRun?.status, "completed");
  assert.equal(s6.autopilotRun?.currentStage, "done");
  assert.equal(messagesPosted.length, 1);

  // Re-stepping completed run performs zero provider calls
  const s7 = await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);
  assert.equal(s7.executedStage, null);
  assert.equal(s7.autopilotRun?.status, "completed");
  assert.equal(messagesPosted.length, 1);

  assert.equal(stageCalls.includes("market_research"), true);
  assert.equal(FORBIDDEN_BILLING_PATTERN.test(JSON.stringify(runState)), false);
  assert.equal(FORBIDDEN_BILLING_PATTERN.test(messagesPosted[0].text), false);
});

test("Stage 5 3-way email waterfall respects silent budgets and degrades cleanly when external providers fail or cap", async () => {
  const providerCalls: string[] = [];
  const baseRun: AutopilotRunView = {
    id: RUN_ID,
    conversationId: CONV_ID,
    status: "running",
    currentStage: "people_and_emails",
    completedStages: ["brief_and_plan", "market_research", "synthesis_and_lock", "company_discovery"],
    stageSummaries: {},
    warnings: [],
    lastError: null,
    stageInFlight: false,
    heartbeatAt: NOW,
    startedAt: NOW,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  let runState: AutopilotRunView = { ...baseRun };
  let leaseToken: string | null = null;
  let peopleView: PeopleDiscoveryView = {
    shortlistedCount: 2,
    personSearch: null,
    contacts: [],
    verificationRun: null,
    playbooks: [],
  };

  const makeStage5Deps = (options: {
    prospeoBudget: boolean;
    dropcontactFails: boolean;
  }): AutopilotOrchestratorDeps => ({
    readAutopilotRun: async () => runState,
    startOrResumeAutopilotRun: async () => runState,
    claimAutopilotStageLease: async () => {
      leaseToken = "lease-stage5";
      return { claimed: true, run: runState, stage: "people_and_emails", leaseToken };
    },
    completeAutopilotStageLease: async (_s, input) => {
      leaseToken = null;
      runState = {
        ...runState,
        completedStages: [...runState.completedStages, input.stage],
        stageSummaries: { ...runState.stageSummaries, [input.stage]: input.summary },
        warnings: [...runState.warnings, ...(input.warnings ?? [])],
        currentStage: "outreach_templates",
      };
      return runState;
    },
    failAutopilotStageLease: async () => runState,
    cancelAutopilotRun: async () => runState,
    checkBudget: async (_session, provider) => {
      providerCalls.push(`budget:${provider}`);
      if (provider === "prospeo") return options.prospeoBudget;
      return true;
    },
    runWithUsageContext: async (_ctx, fn) => fn(),
    getConversation: async () => ({
      conversation: {
        id: CONV_ID,
        title: "Test",
        status: "complete_without_research",
        threadId: "t",
        createdAt: NOW,
        updatedAt: NOW,
      },
      run: {
        id: RUN_ID,
        status: "complete_without_research",
        graphVersion: "1",
        currentNode: "complete",
        checkpointRef: null,
        failureMessage: null,
      },
      messages: [],
      brief: makeBrief(),
      pendingQuestion: null,
      plan: makePlan(),
      events: [],
    }),
    readProductSources: async () => [],
    approvePlanForAutopilot: async () => {
      throw new Error("Unused");
    },
    generateAndSaveAutopilotPlan: async () => {
      throw new Error("Unused");
    },
    isSearxngAvailable: () => false,
    getEvidenceResearch: async () => null,
    prepareEvidenceResearch: async () => null,
    startEvidenceResearch: async () => null,
    ensureFallbackResearchRun: async () => {
      throw new Error("Unused");
    },
    getMarketSynthesis: async () => makeSynthesis(true),
    analyseMarketSynthesis: async () => makeSynthesis(true),
    ensureFallbackSynthesis: async () => makeSynthesis(true),
    lockMarketRoute: async () => makeSynthesis(true),
    isProspeoAvailable: () => true,
    getCompanySearch: async () => ({
      id: SEARCH_ID,
      conversationId: CONV_ID,
      targetDecisionId: DECISION_ID,
      providerActionRequestId: null,
      providerKey: "openstreetmap",
      status: "completed",
      targetMarketName: "Malaysia",
      targetIndustryName: "Dental Clinics",
      requestedLocations: ["Malaysia"],
      canonicalLocations: ["Malaysia"],
      canonicalIndustries: [],
      industryKeywords: ["dental"],
      excludedCategories: [],
      linkedClaimIds: [CLAIM_1],
      criteria: ["Location: Malaysia"],
      providerFilters: {},
      maximumResults: 25,
      estimatedMaximumCredits: 0,
      estimateDetail: "Local",
      resultCount: 1,
      providerReceipt: {},
      failureMessage: null,
      cohort: null,
      accounts: [makeAccount(1, { lifecycleState: "shortlisted" })],
      approvedAt: NOW,
      completedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    runOsmSearch: async () => {
      throw new Error("Unused");
    },
    prepareProspeoCompanyPreview: async () => {
      throw new Error("Unused");
    },
    approveCompanySearch: async () => {
      throw new Error("Unused");
    },
    shortlistAccount: async () => {
      throw new Error("Unused");
    },
    isDropcontactAvailable: () => true,
    getPeopleDiscovery: async () => peopleView,
    runWebsiteTeamDiscovery: async () => {
      providerCalls.push("website_team");
      peopleView = {
        ...peopleView,
        shortlistedCount: 1,
        contacts: [
          makeContact(1, { publicEmail: "frontdesk@clinic.com", publicEmailKind: "shared_inbox" }),
          makeContact(2, { publicEmail: null }),
        ],
      };
      return peopleView;
    },
    proposeProspeoPeople: async () => {
      providerCalls.push("prospeo_search");
      return {
        ...peopleView,
        personSearch: {
          id: PERSON_SEARCH_ID,
          conversationId: CONV_ID,
          targetDecisionId: DECISION_ID,
          providerActionRequestId: null,
          providerKey: "prospeo",
          status: "awaiting_approval",
          shortlistedAccountIds: [makeAccount(1).id],
          shortlistedAccountNames: ["Dental Clinic 1"],
          roleRecommendations: [{ title: "Founder", rationale: "Lead", claimIds: [CLAIM_1] }],
          approvedRoles: ["Founder"],
          providerFilters: {},
          maximumResults: 25,
          estimatedMaximumCredits: 1,
          estimateDetail: "Search",
          resultCount: null,
          providerReceipt: {},
          failureMessage: null,
          approvedAt: null,
          completedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      };
    },
    approvePersonSearch: async () => peopleView,
    prepareContactVerification: async (_s, _c, ids, providerKey) => {
      providerCalls.push(`verify_prepare:${providerKey}:${ids.length}`);
      return {
        ...peopleView,
        verificationRun: {
          id: VERIFY_RUN_ID,
          conversationId: CONV_ID,
          personSearchId: PERSON_SEARCH_ID,
          providerActionRequestId: null,
          providerKey,
          status: "awaiting_approval",
          selectedContactIds: ids,
          previewPairs: [
            {
              contactId: ids[0],
              fullName: "Dr. Candidate 2",
              firstName: "Candidate",
              lastName: "Person2",
              companyName: "SmileBay Dental",
              website: "https://smilebaydental.com",
              fieldsSent: ["full_name", "company_website"],
            },
          ],
          estimatedCredits: 1,
          estimateDetail: "Verify",
          verifiedCount: null,
          providerReceipt: {},
          failureMessage: null,
          approvedAt: null,
          completedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      };
    },
    approveContactVerification: async () => {
      const providerKey = peopleView.verificationRun?.providerKey ?? "dropcontact";
      providerCalls.push(`verify_exec:${providerKey}`);
      if (providerKey === "dropcontact" && options.dropcontactFails) {
        throw new Error("Dropcontact temporary timeout");
      }
      if (providerKey === "dropcontact") {
        peopleView = {
          ...peopleView,
          contacts: peopleView.contacts.map((c) =>
            c.id === makeContact(2).id
              ? {
                  ...c,
                  verificationStatus: "verified",
                  verifiedDetails: {
                    email: "founder@smilebaydental.com",
                    emailQualification: "nominative@pro",
                    phone: null,
                    verifiedDomain: "smilebaydental.com",
                    provider: "dropcontact",
                    verifiedAt: NOW,
                  },
                }
              : c,
          ),
        };
      }
      return peopleView;
    },
    getTemplatePack: async () => null,
    generateTemplatePack: async () => makeTemplatePack(),
    appendExecutiveSummaryMessage: async () => undefined,
  });

  // Case A: Silent Prospeo budget cap skips Prospeo & runs Dropcontact cleanly
  const resA = await executeAutopilotStepWithDeps(
    MOCK_SESSION,
    CONV_ID,
    makeStage5Deps({ prospeoBudget: false, dropcontactFails: false }),
  );
  assert.equal(providerCalls.includes("prospeo_search"), false);
  assert.equal(providerCalls.some((c) => c.startsWith("verify_prepare:dropcontact:")), true);
  assert.equal(resA.autopilotRun?.stageSummaries.people_and_emails?.status, "completed");
  assert.equal(FORBIDDEN_BILLING_PATTERN.test(JSON.stringify(resA.autopilotRun)), false);

  // Case B: Dropcontact timeout still preserves Stage 1 website contacts and warns calmly
  providerCalls.length = 0;
  runState = { ...baseRun };
  const resB = await executeAutopilotStepWithDeps(
    MOCK_SESSION,
    CONV_ID,
    makeStage5Deps({ prospeoBudget: true, dropcontactFails: true }),
  );
  assert.equal(resB.autopilotRun?.stageSummaries.people_and_emails?.status, "completed_with_warnings");
  assert.equal(
    Number(resB.autopilotRun?.stageSummaries.people_and_emails?.metrics.withAnyEmail ?? 0) >= 1,
    true,
  );
  assert.equal(FORBIDDEN_BILLING_PATTERN.test(JSON.stringify(resB.autopilotRun)), false);
});

test("partial failure degradation falls back through stages 2 -> 3 -> 4 -> 6 with completed_with_warnings", async () => {
  const events: string[] = [];
  let runState: AutopilotRunView = {
    id: RUN_ID,
    conversationId: CONV_ID,
    status: "running",
    currentStage: "brief_and_plan",
    completedStages: [],
    stageSummaries: {},
    warnings: [],
    lastError: null,
    stageInFlight: false,
    heartbeatAt: NOW,
    startedAt: NOW,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  let researchView: EvidenceResearchView | null = null;
  let synthesis: MarketSynthesis | null = null;
  let companySearch: CompanySearchView | null = null;
  const productSources: StoredProductSource[] = [
    {
      id: SRC_ID,
      sourceType: "txt",
      label: "product.txt",
      sourceUrl: null,
      mimeType: "text/plain",
      byteSize: 120,
      charCount: 120,
      summaryText: "Patient recall software for private dental clinics.",
      extractionStatus: "ready",
      errorMessage: null,
      createdAt: NOW,
      extractedText: "Automated patient recall reminders for dental clinics in Malaysia.",
    },
  ];

  const deps: AutopilotOrchestratorDeps = {
    readAutopilotRun: async () => runState,
    startOrResumeAutopilotRun: async () => runState,
    claimAutopilotStageLease: async () => {
      const next = nextPendingAutopilotStage(runState.completedStages);
      return { claimed: true, run: runState, stage: next, leaseToken: `lease-${next}` };
    },
    completeAutopilotStageLease: async (_s, input) => {
      const completed = Array.from(new Set([...runState.completedStages, input.stage]));
      const next = nextPendingAutopilotStage(completed);
      const warnings = Array.from(new Set([...runState.warnings, ...(input.warnings ?? [])]));
      runState = {
        ...runState,
        completedStages: completed,
        stageSummaries: { ...runState.stageSummaries, [input.stage]: input.summary },
        warnings,
        currentStage: next,
        status: next === "done" ? (warnings.length > 0 ? "completed_with_warnings" : "completed") : "running",
        completedAt: next === "done" ? NOW : null,
      };
      return runState;
    },
    failAutopilotStageLease: async () => runState,
    cancelAutopilotRun: async () => runState,
    checkBudget: async () => true,
    runWithUsageContext: async (_ctx, fn) => fn(),
    getConversation: async () => ({
      conversation: {
        id: CONV_ID,
        title: "Product brief",
        status: "complete_without_research",
        threadId: "t",
        createdAt: NOW,
        updatedAt: NOW,
      },
      run: {
        id: RUN_ID,
        status: "complete_without_research",
        graphVersion: "1",
        currentNode: "complete",
        checkpointRef: null,
        failureMessage: null,
      },
      messages: [],
      brief: makeBrief(),
      pendingQuestion: null,
      plan: makePlan(),
      events: [],
    }),
    readProductSources: async () => productSources,
    approvePlanForAutopilot: async () => {
      throw new Error("Unused");
    },
    generateAndSaveAutopilotPlan: async () => {
      throw new Error("Unused");
    },
    isSearxngAvailable: () => false, // Force Stage 2 product-source fallback
    getEvidenceResearch: async () => researchView,
    prepareEvidenceResearch: async () => null,
    startEvidenceResearch: async () => null,
    ensureFallbackResearchRun: async () => {
      events.push("fallback_research");
      researchView = {
        run: {
          id: RESEARCH_RUN_ID,
          conversationId: CONV_ID,
          threadId: "fallback-t",
          attemptNumber: 1,
          provider: "searxng",
          status: "sources_ready",
          maximumSearches: 15,
          maximumFetches: 20,
          consumedSearches: 0,
          consumedFetches: 0,
          currentWave: 0,
          sourceCount: 1,
          failureMessage: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
        actions: [],
        queries: [],
        sources: [
          {
            id: SRC_ID,
            title: "product.txt",
            url: `https://product-brief.ano.local/${SRC_ID}`,
            sourceClass: "company",
            excerpt: productSources[0].extractedText,
            publishedAt: null,
            retrievedAt: NOW,
            status: "fetched",
          },
        ],
      };
      return researchView;
    },
    getMarketSynthesis: async () => synthesis,
    analyseMarketSynthesis: async () => {
      throw new Error("Synthesis model temporarily unavailable");
    },
    ensureFallbackSynthesis: async () => {
      events.push("fallback_synthesis");
      synthesis = makeSynthesis(false);
      return synthesis;
    },
    lockMarketRoute: async (_s, _c, input) => {
      synthesis = {
        ...synthesis!,
        decision: {
          id: DECISION_ID,
          status: "locked",
          marketProfileId: input.marketProfileId,
          industryProfileId: input.industryProfileId,
          rationale: input.rationale ?? null,
          selectedAt: NOW,
        },
      };
      return synthesis;
    },
    isProspeoAvailable: () => true,
    getCompanySearch: async () => companySearch,
    runOsmSearch: async () => {
      throw new Error("OSM timed out");
    },
    prepareProspeoCompanyPreview: async () => {
      events.push("fallback_prospeo_companies");
      companySearch = {
        id: SEARCH_ID,
        conversationId: CONV_ID,
        targetDecisionId: DECISION_ID,
        providerActionRequestId: null,
        providerKey: "prospeo",
        status: "completed",
        targetMarketName: "Malaysia",
        targetIndustryName: "Dental Clinics",
        requestedLocations: ["Malaysia"],
        canonicalLocations: ["Malaysia"],
        canonicalIndustries: [],
        industryKeywords: ["dental"],
        excludedCategories: [],
        linkedClaimIds: [CLAIM_1],
        criteria: ["Location: Malaysia"],
        providerFilters: {},
        maximumResults: 25,
        estimatedMaximumCredits: 1,
        estimateDetail: "Company search",
        resultCount: 1,
        providerReceipt: {},
        failureMessage: null,
        cohort: null,
        accounts: [makeAccount(1, { website: "https://clinic1.com.my", domain: "clinic1.com.my" })],
        approvedAt: NOW,
        completedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      };
      return companySearch;
    },
    approveCompanySearch: async () => companySearch!,
    shortlistAccount: async (_s, _c, accountId) => {
      companySearch = {
        ...companySearch!,
        accounts: companySearch!.accounts.map((a) =>
          a.id === accountId ? { ...a, lifecycleState: "shortlisted" } : a,
        ),
      };
      return companySearch;
    },
    isDropcontactAvailable: () => false,
    getPeopleDiscovery: async () => ({
      shortlistedCount: 1,
      personSearch: null,
      contacts: [],
      verificationRun: null,
      playbooks: [],
    }),
    runWebsiteTeamDiscovery: async () => ({
      shortlistedCount: 1,
      personSearch: null,
      contacts: [makeContact(1, { publicEmail: "hello@clinic1.com.my", publicEmailKind: "shared_inbox" })],
      verificationRun: null,
      playbooks: [],
    }),
    proposeProspeoPeople: async () => ({
      shortlistedCount: 1,
      personSearch: null,
      contacts: [],
      verificationRun: null,
      playbooks: [],
    }),
    approvePersonSearch: async () => ({
      shortlistedCount: 1,
      personSearch: null,
      contacts: [],
      verificationRun: null,
      playbooks: [],
    }),
    prepareContactVerification: async () => ({
      shortlistedCount: 1,
      personSearch: null,
      contacts: [],
      verificationRun: null,
      playbooks: [],
    }),
    approveContactVerification: async () => ({
      shortlistedCount: 1,
      personSearch: null,
      contacts: [],
      verificationRun: null,
      playbooks: [],
    }),
    getTemplatePack: async () => null,
    generateTemplatePack: async () => makeTemplatePack(),
    appendExecutiveSummaryMessage: async (_s, _c, text) => {
      events.push(`summary:${text.slice(0, 30)}`);
    },
  };

  for (let i = 0; i < 6; i += 1) {
    await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);
  }

  assert.equal(runState.status, "completed_with_warnings");
  assert.equal(events.includes("fallback_research"), true);
  assert.equal(events.includes("fallback_synthesis"), true);
  assert.equal(events.includes("fallback_prospeo_companies"), true);
  assert.equal(events.some((e) => e.startsWith("summary:")), true);
  assert.equal(FORBIDDEN_BILLING_PATTERN.test(JSON.stringify(runState)), false);
});

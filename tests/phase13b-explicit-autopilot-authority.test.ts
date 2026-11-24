import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { DemoWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import {
  autopilotStartRequestSchema,
  DEFAULT_AUTOPILOT_AUTHORITY_SCOPE,
  nextPendingAutopilotStage,
  resolveAutopilotAuthorityScope,
  type AutopilotRunView,
} from "@/lib/ano/autopilot";
import type { AccountCandidateDossier, CompanySearchView } from "@/lib/ano/company-discovery";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type { ContactCandidateView, PeopleDiscoveryView } from "@/lib/ano/people-playbooks";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import {
  AutopilotOrchestratorError,
  executeAutopilotStepWithDeps,
  startAutopilotForConversation,
  type AutopilotOrchestratorDeps,
} from "@/server/domain/autopilot-orchestrator-service";
import { canExecutePaidProviderCall } from "@/server/telemetry/internal-api-usage";

const ROOT = process.cwd();
const NOW = "2026-11-24T00:00:00.000Z";
const CONV_ID = "00000000-0000-4000-8000-0000000013b1";
const RUN_ID = "00000000-0000-4000-8000-0000000013b2";
const PLAN_ID = "00000000-0000-4000-8000-0000000013b3";
const CLAIM_ID = "00000000-0000-4000-8000-0000000013b4";
const MARKET_ID = "00000000-0000-4000-8000-0000000013b5";
const INDUSTRY_ID = "00000000-0000-4000-8000-0000000013b6";
const DECISION_ID = "00000000-0000-4000-8000-0000000013b7";
const SEARCH_ID = "00000000-0000-4000-8000-0000000013b8";
const PERSON_SEARCH_ID = "00000000-0000-4000-8000-0000000013b9";

const DEMO_SESSION: DemoWorkspaceSession = {
  kind: "demo",
  actorId: "demo-user",
  actorEmail: "demo@local.ano",
  workspace: {
    id: "00000000-0000-4000-8000-0000000013b0",
    name: "Phase 13B Test Workspace",
    slug: "phase-13b-test",
    role: "owner",
  },
};

test("autopilotStartRequestSchema enforces explicitApproval: true, bounded caps (50/100/25/10), and non-send/call/CRM invariants", async () => {
  assert.equal(autopilotStartRequestSchema.safeParse({}).success, false);
  assert.equal(
    autopilotStartRequestSchema.safeParse({ explicitApproval: false }).success,
    false,
  );

  const valid = autopilotStartRequestSchema.safeParse({ explicitApproval: true });
  assert.equal(valid.success, true);

  const resolved = resolveAutopilotAuthorityScope(undefined);
  assert.deepEqual(resolved, DEFAULT_AUTOPILOT_AUTHORITY_SCOPE);

  assert.equal(
    autopilotStartRequestSchema.safeParse({
      explicitApproval: true,
      authorityScope: { ...DEFAULT_AUTOPILOT_AUTHORITY_SCOPE, maxPublicSearches: 51 },
    }).success,
    false,
  );
  assert.equal(
    autopilotStartRequestSchema.safeParse({
      explicitApproval: true,
      authorityScope: { ...DEFAULT_AUTOPILOT_AUTHORITY_SCOPE, maxSourceFetches: 101 },
    }).success,
    false,
  );
  assert.equal(
    autopilotStartRequestSchema.safeParse({
      explicitApproval: true,
      authorityScope: { ...DEFAULT_AUTOPILOT_AUTHORITY_SCOPE, maxCompanyCandidates: 26 },
    }).success,
    false,
  );
  assert.equal(
    autopilotStartRequestSchema.safeParse({
      explicitApproval: true,
      authorityScope: { ...DEFAULT_AUTOPILOT_AUTHORITY_SCOPE, maxNamedContactEnrichments: 11 },
    }).success,
    false,
  );
  assert.equal(
    autopilotStartRequestSchema.safeParse({
      explicitApproval: true,
      authorityScope: { ...DEFAULT_AUTOPILOT_AUTHORITY_SCOPE, allowOutboundEmailSend: true },
    }).success,
    false,
  );
  assert.equal(
    autopilotStartRequestSchema.safeParse({
      explicitApproval: true,
      authorityScope: { ...DEFAULT_AUTOPILOT_AUTHORITY_SCOPE, allowPhoneCalls: true },
    }).success,
    false,
  );
  assert.equal(
    autopilotStartRequestSchema.safeParse({
      explicitApproval: true,
      authorityScope: { ...DEFAULT_AUTOPILOT_AUTHORITY_SCOPE, allowCrmWrites: true },
    }).success,
    false,
  );

  await assert.rejects(
    () => startAutopilotForConversation(DEMO_SESSION, CONV_ID),
    (error: unknown) =>
      error instanceof AutopilotOrchestratorError &&
      error.code === "EXPLICIT_APPROVAL_REQUIRED",
  );
});

test("executeAutopilotStepWithDeps enforces approved 50 searches / 100 fetches / 25 companies / 10 named enrichments caps", async () => {
  let preparedSearches = 0;
  let preparedFetches = 0;
  const verifyBatches: Array<{ provider: string; count: number }> = [];

  let runState: AutopilotRunView = {
    id: RUN_ID,
    conversationId: CONV_ID,
    status: "running",
    currentStage: "market_research",
    completedStages: ["brief_and_plan"],
    stageSummaries: {},
    warnings: [],
    lastError: null,
    stageInFlight: false,
    authorityScope: DEFAULT_AUTOPILOT_AUTHORITY_SCOPE,
    authorizedAt: NOW,
    authorizedBy: DEMO_SESSION.workspace.id,
    heartbeatAt: NOW,
    startedAt: NOW,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const makeAccount = (idx: number): AccountCandidateDossier => ({
    id: `00000000-0000-4000-8000-00000002${String(idx).padStart(4, "0")}`,
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    companySearchId: SEARCH_ID,
    sourceKey: `prospeo:co-${idx}`,
    name: `Company ${idx}`,
    domain: `co${idx}.example.com`,
    website: `https://co${idx}.example.com`,
    linkedInUrl: null,
    industry: "Dental Clinics",
    location: "Malaysia",
    employeeBand: "11-50",
    employeeCount: 25,
    description: null,
    lifecycleState: "shortlisted",
    fit: {
      locationScore: 35,
      industryScore: 30,
      signalScore: 20,
      totalScore: 85,
      confidence: "high",
      rationale: "Strong location and dental clinic category fit.",
      industryHypothesisNote: "Matches confirmed dental buyer pattern.",
    },
    signals: [],
    claimIds: [CLAIM_ID],
    evidenceUrls: [`https://co${idx}.example.com`],
    unknowns: [],
    retrievedAt: NOW,
  });

  const manyAccounts = Array.from({ length: 30 }, (_, idx) => makeAccount(idx + 1));

  const manyContacts: ContactCandidateView[] = Array.from({ length: 14 }, (_, idx) => ({
    id: `00000000-0000-4000-8000-00000003${String(idx + 1).padStart(4, "0")}`,
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    personSearchId: PERSON_SEARCH_ID,
    accountCandidateId: manyAccounts[0].id,
    accountName: manyAccounts[0].name,
    accountDomain: manyAccounts[0].domain,
    sourceKey: `prospeo:p-${idx + 1}`,
    fullName: `Buyer ${idx + 1}`,
    firstName: "Buyer",
    lastName: `${idx + 1}`,
    title: "Principal Dentist",
    department: null,
    seniority: null,
    linkedInUrl: null,
    location: "Malaysia",
    confidence: "high",
    roleRationale: "Primary decision-maker",
    selectedForVerification: false,
    verificationStatus: "unverified",
    verifiedDetails: null,
    publicEmail: null,
    publicEmailKind: null,
    publicPhone: null,
    sourceUrl: "https://co1.example.com/team",
    claimIds: [CLAIM_ID],
    retrievedAt: NOW,
    verifiedAt: null,
  }));

  const synthesis: MarketSynthesis = {
    id: "00000000-0000-4000-8000-0000000013ba",
    conversationId: CONV_ID,
    researchRunId: RUN_ID,
    status: "ready_for_decision",
    recommendationMode: "directly_supported",
    assessment: {
      fetchedSourceCount: 4,
      sourceClassCount: 2,
      coverageStrength: "strong",
      comparisonReady: true,
      contradictions: [],
      gaps: [],
      summary: "Locked route ready",
    },
    claims: [
      {
        id: CLAIM_ID,
        kind: "observation",
        statement: "Demand confirmed",
        sourceIds: [RUN_ID],
        comparisonBasis: null,
        evidenceStrength: "strong",
        citationStatus: "supported",
      },
    ],
    markets: [
      {
        id: MARKET_ID,
        name: "Malaysia",
        summary: "Urban practices",
        evidenceStrength: "strong",
        claimIds: [CLAIM_ID],
        unknowns: [],
        nextResearchActions: [],
      },
    ],
    industries: [
      {
        id: INDUSTRY_ID,
        marketProfileId: MARKET_ID,
        name: "Dental Clinics",
        summary: "Multi-chair clinics",
        operationalProblems: ["No-shows"],
        solutionFit: ["Recall reminders"],
        buyerRoleHypotheses: ["Principal Dentist"],
        evidenceStrength: "strong",
        claimIds: [CLAIM_ID],
        unknowns: [],
      },
    ],
    decision: {
      id: DECISION_ID,
      status: "locked",
      marketProfileId: MARKET_ID,
      industryProfileId: INDUSTRY_ID,
      rationale: "Locked",
      selectedAt: NOW,
    },
    failureMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const companySearchView: CompanySearchView = {
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
    canonicalIndustries: ["Dental"],
    industryKeywords: ["dental"],
    excludedCategories: [],
    linkedClaimIds: [CLAIM_ID],
    criteria: ["Malaysia"],
    providerFilters: {},
    maximumResults: 25,
    estimatedMaximumCredits: 1,
    estimateDetail: "Bounded",
    resultCount: manyAccounts.length,
    providerReceipt: {},
    failureMessage: null,
    cohort: null,
    accounts: manyAccounts,
    approvedAt: NOW,
    completedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };

  let peopleView: PeopleDiscoveryView = {
    shortlistedCount: 1,
    personSearch: null,
    contacts: manyContacts,
    verificationRun: null,
    playbooks: [],
  };

  const brief: ResearchBrief = {
    offer: "Recall software",
    goal: "Book dental demos",
    businessLocation: "Malaysia",
    targetMarkets: ["Malaysia"],
    intakeComplete: true,
    marketHints: ["Dental"],
    locationHints: ["Malaysia"],
    buyerHints: ["Principal Dentist"],
    constraints: [],
    sourceMessageIds: [],
    unknowns: [],
  };

  const plan: ResearchPlan = {
    id: PLAN_ID,
    version: 1,
    approvalStatus: "approved",
    createdAt: NOW,
    summary: "Plan",
    researchQuestions: ["Q1", "Q2"],
    comparisonCriteria: ["C1", "C2"],
    intendedSourceClasses: ["Industry bodies and primary research"],
    plannedScope: { markets: ["Malaysia"], industries: ["Dental Clinics"], buyerRoles: ["Principal Dentist"] },
    budget: { maximumSearches: 50, maximumFetches: 100, providerSpend: "not_available_in_phase_a" },
    uncertainties: [],
  };

  const deps: AutopilotOrchestratorDeps = {
    readAutopilotRun: async () => runState,
    startOrResumeAutopilotRun: async () => runState,
    claimAutopilotStageLease: async () => {
      const stage = nextPendingAutopilotStage(runState.completedStages);
      return { claimed: true, run: runState, stage, leaseToken: "lease-1" };
    },
    completeAutopilotStageLease: async (_s, input) => {
      const completedStages = Array.from(new Set([...runState.completedStages, input.stage]));
      runState = {
        ...runState,
        completedStages,
        currentStage: nextPendingAutopilotStage(completedStages),
        stageSummaries: { ...runState.stageSummaries, [input.stage]: input.summary },
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
      brief,
      pendingQuestion: null,
      plan,
      events: [],
    }),
    readProductSources: async () => [],
    approvePlanForAutopilot: async () => {
      throw new Error("Unused");
    },
    generateAndSaveAutopilotPlan: async () => {
      throw new Error("Unused");
    },
    isSearxngAvailable: () => true,
    getEvidenceResearch: async () => null,
    prepareEvidenceResearch: async (_s, _c, opts) => {
      preparedSearches = opts?.maximumSearches ?? 0;
      preparedFetches = opts?.maximumFetches ?? 0;
      return {
        run: {
          id: RUN_ID,
          conversationId: CONV_ID,
          threadId: "tr",
          attemptNumber: 1,
          provider: "searxng",
          status: "awaiting_provider_approval",
          maximumSearches: preparedSearches,
          maximumFetches: preparedFetches,
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
    },
    startEvidenceResearch: async () => ({
      run: {
        id: RUN_ID,
        conversationId: CONV_ID,
        threadId: "tr",
        attemptNumber: 1,
        provider: "searxng",
        status: "sources_ready",
        maximumSearches: 50,
        maximumFetches: 100,
        consumedSearches: 6,
        consumedFetches: 8,
        currentWave: 2,
        sourceCount: 1,
        failureMessage: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      actions: [],
      queries: [],
      sources: [
        {
          id: RUN_ID,
          title: "Dental Study",
          url: "https://example.com/study",
          sourceClass: "industry",
          excerpt: "Demand confirmed",
          publishedAt: NOW,
          retrievedAt: NOW,
          status: "fetched",
        },
      ],
    }),
    ensureFallbackResearchRun: async () => {
      throw new Error("Unused");
    },
    getMarketSynthesis: async () => synthesis,
    analyseMarketSynthesis: async () => synthesis,
    ensureFallbackSynthesis: async () => synthesis,
    lockMarketRoute: async () => synthesis,
    isProspeoAvailable: () => true,
    getCompanySearch: async () => ({ ...companySearchView, status: "completed" }),
    runOsmSearch: async () => companySearchView,
    prepareProspeoCompanyPreview: async () => companySearchView,
    approveCompanySearch: async () => companySearchView,
    shortlistAccount: async () => companySearchView,
    isDropcontactAvailable: () => true,
    getPeopleDiscovery: async () => peopleView,
    runWebsiteTeamDiscovery: async () => peopleView,
    proposeProspeoPeople: async () => peopleView,
    approvePersonSearch: async () => peopleView,
    prepareContactVerification: async (_s, _c, contactIds, providerKey) => {
      verifyBatches.push({ provider: providerKey, count: contactIds.length });
      return {
        ...peopleView,
        verificationRun: {
          id: RUN_ID,
          conversationId: CONV_ID,
          personSearchId: PERSON_SEARCH_ID,
          providerActionRequestId: null,
          providerKey,
          status: "awaiting_approval",
          selectedContactIds: contactIds,
          previewPairs: [],
          estimatedCredits: contactIds.length,
          estimateDetail: "Bounded",
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
    approveContactVerification: async () => peopleView,
    getTemplatePack: async () => null,
    generateTemplatePack: async () => {
      throw new Error("Unused");
    },
    appendExecutiveSummaryMessage: async () => undefined,
  };

  // Stage 2 must request full 50 searches / 100 fetches
  const stage2 = await executeAutopilotStepWithDeps(DEMO_SESSION, CONV_ID, deps);
  assert.equal(stage2.executedStage, "market_research");
  assert.equal(preparedSearches, 50);
  assert.equal(preparedFetches, 100);

  // Stage 3 already locked
  await executeAutopilotStepWithDeps(DEMO_SESSION, CONV_ID, deps);

  // Stage 4 must cap company candidates at 25
  const stage4 = await executeAutopilotStepWithDeps(DEMO_SESSION, CONV_ID, deps);
  assert.equal(stage4.executedStage, "company_discovery");
  assert.equal(stage4.autopilotRun?.stageSummaries.company_discovery?.metrics.discoveredCount, 25);

  // Stage 5 must cap cumulative named contact enrichments across Prospeo + Dropcontact at 10
  const stage5 = await executeAutopilotStepWithDeps(DEMO_SESSION, CONV_ID, deps);
  assert.equal(stage5.executedStage, "people_and_emails");
  const totalEnrichedRequested = verifyBatches.reduce((sum, item) => sum + item.count, 0);
  assert.equal(totalEnrichedRequested <= 10, true);
  assert.equal(totalEnrichedRequested, 10);
});

test("canExecutePaidProviderCall fails closed on missing config, missing budget limit, budget RPC error, or unavailable usage logging", async () => {
  const makeSession = (handlers: {
    budgetRpc: () => Promise<{ data: unknown; error: unknown }>;
    logRpc: () => Promise<{ data: unknown; error: unknown }>;
  }): WorkspaceSession =>
    ({
      kind: "supabase",
      actorId: "11111111-1111-4111-8111-111111111111",
      actorEmail: "user@example.com",
      workspace: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "WS",
        slug: "ws",
        role: "owner",
      },
      client: {
        rpc: (fn: string) => {
          if (fn === "check_internal_usage_budget") return handlers.budgetRpc();
          return handlers.logRpc();
        },
      },
    }) as unknown as WorkspaceSession;

  const healthySession = makeSession({
    budgetRpc: async () => ({ data: true, error: null }),
    logRpc: async () => ({ data: null, error: null }),
  });

  // 1. Missing provider configuration
  assert.equal(
    await canExecutePaidProviderCall(healthySession, "prospeo", {
      providerConfigured: false,
      dailyLimit: 50,
    }),
    false,
  );

  // 2. Missing daily limit
  const prevLimit = process.env.ANO_INTERNAL_DAILY_PROSPEO_LIMIT;
  delete process.env.ANO_INTERNAL_DAILY_PROSPEO_LIMIT;
  try {
    assert.equal(
      await canExecutePaidProviderCall(healthySession, "prospeo", { providerConfigured: true }),
      false,
    );
  } finally {
    if (prevLimit === undefined) delete process.env.ANO_INTERNAL_DAILY_PROSPEO_LIMIT;
    else process.env.ANO_INTERNAL_DAILY_PROSPEO_LIMIT = prevLimit;
  }

  // 3. Budget RPC failing
  const brokenBudgetSession = makeSession({
    budgetRpc: async () => ({ data: null, error: { message: "down" } }),
    logRpc: async () => ({ data: null, error: null }),
  });
  assert.equal(
    await canExecutePaidProviderCall(brokenBudgetSession, "dropcontact", {
      providerConfigured: true,
      dailyLimit: 50,
    }),
    false,
  );

  // 4. Usage logging RPC unavailable (fail closed even when budget RPC returns true)
  const brokenLogSession = makeSession({
    budgetRpc: async () => ({ data: true, error: null }),
    logRpc: async () => ({ data: null, error: { message: "insert failed" } }),
  });
  assert.equal(
    await canExecutePaidProviderCall(brokenLogSession, "prospeo", {
      providerConfigured: true,
      dailyLimit: 50,
    }),
    false,
  );

  // 5. All four checks passing -> true
  assert.equal(
    await canExecutePaidProviderCall(healthySession, "prospeo", {
      providerConfigured: true,
      dailyLimit: 50,
    }),
    true,
  );
  assert.equal(
    await canExecutePaidProviderCall(healthySession, "dropcontact", {
      providerConfigured: true,
      dailyLimit: 50,
    }),
    true,
  );
});

test("workbench requires explicit start button (no auto-start), UI shows bounded authority without credit prices, and docs agree", async () => {
  const [workbenchRaw, authorityCardRaw, threadRaw, readmeRaw, archRaw, planRaw, plannerRaw] =
    await Promise.all([
      readFile(path.join(ROOT, "src/components/research-conversation-workbench.tsx"), "utf8"),
      readFile(path.join(ROOT, "src/components/artifacts/autopilot-progress-card.tsx"), "utf8"),
      readFile(path.join(ROOT, "src/components/conversation/conversation-thread.tsx"), "utf8"),
      readFile(path.join(ROOT, "README.md"), "utf8"),
      readFile(path.join(ROOT, "docs/ARCHITECTURE.md"), "utf8"),
      readFile(path.join(ROOT, "docs/CHAT_FIRST_MATERIAL_WEB_ACTION_PLAN.md"), "utf8"),
      readFile(path.join(ROOT, "src/server/agents/research-planning-model.ts"), "utf8"),
    ]);

  assert.equal(/autoStartedConversationRef/.test(workbenchRaw), false);
  assert.match(workbenchRaw, /explicitApproval:\s*true/);
  assert.match(workbenchRaw, /onStartAutopilot=/);

  assert.match(authorityCardRaw, /export function AutopilotAuthorityCard/);
  assert.match(authorityCardRaw, /Approve & start autopilot/);
  assert.match(authorityCardRaw, /never sends email, places calls, or writes to a CRM/i);
  assert.equal(/\bcredit|cr\/found|\$\d/i.test(authorityCardRaw), false);

  assert.match(threadRaw, /<AutopilotAuthorityCard\b/);

  for (const text of [readmeRaw, archRaw, plannerRaw, planRaw]) {
    assert.equal(/runs the full pipeline automatically/i.test(text), false);
    assert.equal(/confirmation-free/i.test(text), false);
  }
  assert.equal(/Internal server budgets replace user-facing per-step approval gates/i.test(planRaw), false);
});

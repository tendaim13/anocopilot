import assert from "node:assert/strict";
import test from "node:test";

import type { DemoWorkspaceSession } from "@/contracts/ano";
import { nextPendingAutopilotStage, type AutopilotRunView } from "@/lib/ano/autopilot";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import { normaliseSynthesisDraft, type SynthesisSource } from "@/server/agents/market-synthesis-model";
import { evaluateTwoQuestionIntake } from "@/server/agents/research-planning-model";
import {
  executeAutopilotStepWithDeps,
  type AutopilotOrchestratorDeps,
} from "@/server/domain/autopilot-orchestrator-service";
import {
  buildLocationQueryCandidates,
  normalizeLocationQuery,
} from "@/server/domain/prospeo-company-discovery";

const NOW = "2026-11-24T00:00:00.000Z";
const CONV_ID = "00000000-0000-4000-8000-000000002101";
const RUN_ID = "00000000-0000-4000-8000-000000002102";
const PLAN_ID = "00000000-0000-4000-8000-000000002104";
const CLAIM_ID = "00000000-0000-4000-8000-000000002105";
const MARKET_ID = "00000000-0000-4000-8000-000000002106";
const INDUSTRY_ID = "00000000-0000-4000-8000-000000002107";
const DECISION_ID = "00000000-0000-4000-8000-000000002108";
const SOURCE_ID = "00000000-0000-4000-8000-000000002109";

const MOCK_SESSION: DemoWorkspaceSession = {
  kind: "demo",
  actorId: "demo-user",
  actorEmail: "demo@local.ano",
  workspace: {
    id: "00000000-0000-4000-8000-000000002199",
    name: "Test Workspace",
    slug: "test-workspace",
    role: "owner",
  },
};

test("normalizeLocationQuery and buildLocationQueryCandidates clean descriptive market suffixes while preserving real places", () => {
  assert.equal(normalizeLocationQuery("United States National Market"), "United States");
  assert.equal(normalizeLocationQuery("US National Market"), "United States");
  assert.equal(normalizeLocationQuery("UK B2B Market"), "United Kingdom");
  assert.equal(normalizeLocationQuery("Kuala Lumpur"), "Kuala Lumpur");
  assert.equal(normalizeLocationQuery("Selangor, Malaysia"), "Selangor, Malaysia");

  assert.deepEqual(buildLocationQueryCandidates("Greater London"), ["Greater London", "London"]);
  assert.deepEqual(buildLocationQueryCandidates("Austin, Texas, USA"), [
    "Austin, Texas, USA",
    "Austin, Texas, United States",
    "Austin, Texas",
    "Texas, United States",
    "United States",
    "Texas",
  ]);
  assert.deepEqual(buildLocationQueryCandidates("Selangor (Klang Valley)"), [
    "Selangor (Klang Valley)",
    "Selangor",
    "Klang Valley",
  ]);
});

test("normaliseSynthesisDraft strips non-geographic market suffixes from markets[].name", () => {
  const sources: SynthesisSource[] = [
    {
      id: SOURCE_ID,
      title: "US AI Training Benchmark",
      sourceClass: "industry",
      excerpt: "71% of US services firms report AI skills gaps.",
      publishedAt: NOW,
    },
  ];

  const normalized = normaliseSynthesisDraft(
    {
      claims: [
        {
          id: "claim-1",
          kind: "observation",
          statement: "71% of US services firms cite AI skills gaps.",
          sourceIds: [SOURCE_ID],
          comparisonBasis: null,
          evidenceStrength: "strong",
          citationStatus: "supported",
        },
      ],
      markets: [
        {
          id: "market-1",
          name: "United States National Market",
          summary: "Strong enterprise demand for AI training programs.",
          evidenceStrength: "strong",
          claimIds: ["claim-1"],
          unknowns: [],
          nextResearchActions: [],
        },
      ],
      industries: [
        {
          id: "industry-1",
          marketProfileId: "market-1",
          name: "Professional Services",
          summary: "Consulting and accounting firms investing in staff AI upskilling.",
          operationalProblems: ["AI skill gaps"],
          solutionFit: ["Structured team training"],
          buyerRoleHypotheses: ["Chief People Officer"],
          evidenceStrength: "strong",
          claimIds: ["claim-1"],
          unknowns: [],
        },
      ],
      contradictions: [],
      gaps: [],
      summary: "United States Professional Services leads on demand.",
    },
    sources,
  );

  assert.equal(normalized.markets[0]?.name, "United States");
});

test("evaluateTwoQuestionIntake preserves Recommend best market sentinel while using natural wording in follow-up copy", () => {
  const result = evaluateTwoQuestionIntake({
    offer: "Enterprise AI training",
    brief: {
      offer: "Enterprise AI training",
      goal: "Find companies needing AI training",
      businessLocation: null,
      targetMarkets: [],
      intakeComplete: false,
      marketHints: [],
      locationHints: [],
      buyerHints: [],
      constraints: [],
      unknowns: [],
    },
    userMessages: ["I am not sure which country or city to start with, please recommend the best market."],
  });

  assert.equal(result.intakeComplete, false);
  assert.deepEqual(result.targetMarkets, ["Recommend best market"]);
  assert.ok(result.clarification);
  assert.match(result.clarification.question, /recommend the best target market/i);
  assert.equal(result.clarification.question.includes("(Recommend best market)"), false);
});

test("Stage 4 autopilot skips physical local-map fallback on pure B2B segments when primary lookup fails", async () => {
  let osmCalled = false;
  let runState: AutopilotRunView = {
    id: RUN_ID,
    conversationId: CONV_ID,
    status: "running",
    currentStage: "company_discovery",
    completedStages: ["brief_and_plan", "market_research", "synthesis_and_lock"],
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

  const synthesis: MarketSynthesis = {
    id: "00000000-0000-4000-8000-000000002110",
    conversationId: CONV_ID,
    researchRunId: RUN_ID,
    status: "ready_for_decision",
    recommendationMode: "directly_supported",
    assessment: {
      fetchedSourceCount: 4,
      sourceClassCount: 2,
      coverageStrength: "moderate",
      comparisonReady: true,
      contradictions: [],
      gaps: [],
      summary: "US Professional Services",
    },
    claims: [
      {
        id: CLAIM_ID,
        kind: "observation",
        statement: "Demand is strong.",
        sourceIds: [SOURCE_ID],
        comparisonBasis: null,
        evidenceStrength: "strong",
        citationStatus: "supported",
      },
    ],
    markets: [
      {
        id: MARKET_ID,
        name: "United States",
        summary: "Strong enterprise services demand.",
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
        name: "Professional Services",
        summary: "Advisory and consulting firms.",
        operationalProblems: ["AI training gap"],
        solutionFit: ["Cohort workshops"],
        buyerRoleHypotheses: ["HR Director"],
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
      rationale: "Locked best market",
      selectedAt: NOW,
    },
    failureMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const brief: ResearchBrief = {
    offer: "Enterprise AI training",
    goal: "Reach US consulting firms",
    businessLocation: "Wyoming, USA",
    targetMarkets: ["Recommend best market"],
    intakeComplete: true,
    marketHints: [],
    locationHints: [],
    buyerHints: ["HR Director"],
    constraints: [],
    sourceMessageIds: [],
    unknowns: [],
  };

  const plan: ResearchPlan = {
    id: PLAN_ID,
    version: 1,
    approvalStatus: "approved",
    createdAt: NOW,
    summary: "Research US AI training demand.",
    researchQuestions: ["Which US segments invest most in AI upskilling?"],
    comparisonCriteria: ["Adoption gap"],
    intendedSourceClasses: ["Industry bodies and primary research"],
    plannedScope: {
      markets: ["United States"],
      industries: ["Professional Services"],
      buyerRoles: ["HR Director"],
    },
    budget: {
      maximumSearches: 50,
      maximumFetches: 100,
      providerSpend: "not_available_in_phase_a",
    },
    uncertainties: [],
  };

  const deps: AutopilotOrchestratorDeps = {
    readAutopilotRun: async () => runState,
    startOrResumeAutopilotRun: async () => runState,
    claimAutopilotStageLease: async () => ({
      claimed: true,
      run: runState,
      stage: "company_discovery",
      leaseToken: "lease-1",
    }),
    completeAutopilotStageLease: async (_session, input) => {
      const completed = Array.from(new Set([...runState.completedStages, input.stage]));
      const next = nextPendingAutopilotStage(completed);
      const warnings = Array.from(
        new Set([...runState.warnings, ...(input.warnings ?? input.summary.warnings ?? [])]),
      );
      runState = {
        ...runState,
        completedStages: completed,
        currentStage: next,
        stageSummaries: {
          ...runState.stageSummaries,
          [input.stage]: input.summary,
        },
        warnings,
        stageInFlight: false,
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
        title: "Enterprise AI training",
        status: "complete_without_research",
        threadId: "t1",
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
    isSearxngAvailable: () => false,
    getEvidenceResearch: async () => null,
    prepareEvidenceResearch: async () => null,
    startEvidenceResearch: async () => null,
    ensureFallbackResearchRun: async () => {
      throw new Error("Unused");
    },
    getMarketSynthesis: async () => synthesis,
    analyseMarketSynthesis: async () => synthesis,
    ensureFallbackSynthesis: async () => synthesis,
    lockMarketRoute: async () => synthesis,
    isProspeoAvailable: () => true,
    getCompanySearch: async () => null,
    runOsmSearch: async () => {
      osmCalled = true;
      throw new Error("Local map discovery should not run for pure B2B Professional Services");
    },
    prepareProspeoCompanyPreview: async () => {
      throw new Error("Temporary B2B lookup error");
    },
    approveCompanySearch: async () => {
      throw new Error("Unused");
    },
    shortlistAccount: async () => {
      throw new Error("Unused");
    },
    isDropcontactAvailable: () => false,
    getPeopleDiscovery: async () => ({
      shortlistedCount: 0,
      personSearch: null,
      contacts: [],
      verificationRun: null,
      playbooks: [],
    }),
    runWebsiteTeamDiscovery: async () => {
      throw new Error("Unused");
    },
    proposeProspeoPeople: async () => {
      throw new Error("Unused");
    },
    approvePersonSearch: async () => {
      throw new Error("Unused");
    },
    prepareContactVerification: async () => {
      throw new Error("Unused");
    },
    approveContactVerification: async () => {
      throw new Error("Unused");
    },
    getTemplatePack: async () => null,
    generateTemplatePack: async () => {
      throw new Error("Unused");
    },
    appendExecutiveSummaryMessage: async () => undefined,
  };

  const result = await executeAutopilotStepWithDeps(MOCK_SESSION, CONV_ID, deps);
  assert.equal(result.executedStage, "company_discovery");
  assert.equal(osmCalled, false);
  const warnings = result.autopilotRun?.warnings ?? [];
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Primary B2B company lookup had an issue/);
  assert.equal(warnings.some((w) => /Local map company lookup/i.test(w)), false);
});

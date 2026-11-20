import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaver } from "@langchain/langgraph";

import type { ResearchQuery } from "@/lib/ano/evidence-research";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import {
  createIterativeEvidenceResearchGraph,
  ITERATIVE_EVIDENCE_RESEARCH_RECURSION_LIMIT,
  type IterativeResearchExecutor,
  type IterativeResearchPlanner,
} from "@/server/langgraph/iterative-evidence-research-graph";
import { normalizeIterativeResearchWave } from "@/server/agents/iterative-research-planner";
import { assessFetchedSource, assessResearchCoverage, classifySourceUrl, type ResearchCoverage } from "@/server/research/deep-research-assessment";

const brief: ResearchBrief = {
  offer: "AI workflows that turn quotes into jobs",
  goal: "Find the first outbound market",
  marketHints: [], locationHints: [], buyerHints: [], constraints: [], unknowns: [],
  sourceMessageIds: ["00000000-0000-4000-8000-000000000001"],
};

const plan: ResearchPlan = {
  id: "00000000-0000-4000-8000-000000000002", version: 1, approvalStatus: "approved", createdAt: "2026-10-24T00:00:00.000Z",
  summary: "Compare markets", researchQuestions: ["Where is operational friction visible?", "Which market is reachable?"],
  comparisonCriteria: ["Problem intensity", "Market access"], intendedSourceClasses: ["Government and official statistics", "Industry bodies and primary research"],
  plannedScope: { markets: [], industries: [], buyerRoles: [] }, budget: { maximumSearches: 50, maximumFetches: 100, providerSpend: "not_available_in_phase_a" }, uncertainties: [],
};

function query(id: string, waveNumber: number, candidateMarket: string, comparisonDimension: ResearchQuery["comparisonDimension"]): ResearchQuery {
  return { id, query: `${candidateMarket} workflow evidence ${comparisonDimension}`, reason: "Closes a decision-relevant evidence gap.", sourceClass: "Government and official statistics", candidateMarket, comparisonDimension, priority: 90, waveNumber };
}

function coverage(ready: boolean): ResearchCoverage {
  return {
    candidateMarkets: ["Australia", "Malaysia"],
    cells: [], qualifyingSourceCount: ready ? 10 : 2, sourceClassCount: ready ? 2 : 1,
    comparisonReady: ready,
    gaps: ready ? [] : ["Australia: market access needs direct evidence."],
  };
}

test("source assessment penalises redundant vendor content and preserves higher-authority evidence", () => {
  assert.equal(classifySourceUrl("https://www.data.gov.au/example"), "official");
  assert.equal(classifySourceUrl("https://www.hubspot.com/blog/example"), "vendor");
  const official = assessFetchedSource({
    url: "https://www.data.gov.au/workflow-statistics", title: "Australian service workflow statistics", excerpt: "Official statistics describe service businesses and workflow digitisation in Australia.", publishedAt: "2026-01-01T00:00:00.000Z",
    query: query("00000000-0000-4000-8000-000000000010", 1, "Australia", "market_density"), priorSources: [],
  });
  const repeatedVendor = assessFetchedSource({
    url: "https://www.hubspot.com/blog/workflow", title: "Workflow automation", excerpt: "Workflow automation for workflow automation and service workflow automation.", publishedAt: null,
    query: query("00000000-0000-4000-8000-000000000011", 1, "Australia", "market_density"),
    priorSources: [{ sourceClass: "vendor", title: "Workflow automation", excerpt: "Workflow automation for workflow automation and service workflow automation." }],
  });
  assert.ok(official.overallScore > repeatedVendor.overallScore);
  assert.equal(repeatedVendor.decisionRelevant, false);
});

test("comparison readiness requires coverage across candidates and decision dimensions", () => {
  const dimensions = ["problem_urgency", "market_density", "buyer_conditions", "market_access", "solution_fit"] as const;
  const sources = ["Australia", "Malaysia"].flatMap((candidateMarket, index) => dimensions.map((comparisonDimension) => ({
    sourceClass: index === 0 ? "official" as const : "industry" as const,
    overallScore: 80,
    decisionRelevant: true,
    query: { candidateMarket, comparisonDimension },
  })));
  const assessment = assessResearchCoverage({ candidateMarkets: ["Australia", "Malaysia"], sources });
  assert.equal(assessment.comparisonReady, true);
  assert.equal(assessment.gaps.length, 0);
});

test("Ano assigns durable query IDs instead of requiring Bedrock to generate UUIDs", () => {
  const wave = normalizeIterativeResearchWave({
    objective: "Compare the first market hypotheses",
    candidateMarkets: ["Australia", "Malaysia"],
    queries: [
      { id: "model-label-1", query: "Australia sales outreach platform market evidence", reason: "Tests market density.", sourceClass: "Industry bodies and primary research", candidateMarket: "Australia", comparisonDimension: "market_density", priority: 80 },
      { id: "not-a-uuid", query: "Malaysia sales outreach platform market evidence", reason: "Tests market density.", sourceClass: "Industry bodies and primary research", candidateMarket: "Malaysia", comparisonDimension: "market_density", priority: 80 },
    ],
  }, 1, 12);

  assert.equal(wave.queries.length, 2);
  assert.ok(wave.queries.every((item) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)));
  assert.ok(wave.queries.every((item) => item.waveNumber === 1));
});

test("Ano removes previously saved and duplicate planner queries before a provider request", () => {
  const wave = normalizeIterativeResearchWave({
    objective: "Close direct evidence gaps",
    candidateMarkets: ["Australia", "Malaysia"],
    queries: [
      { query: "  Australia sales outreach platform market evidence  ", reason: "Already saved.", sourceClass: "Independent reporting", candidateMarket: "Australia", comparisonDimension: "market_density", priority: 70 },
      { query: "Malaysia sales outreach platform buyer conditions", reason: "New evidence gap.", sourceClass: "Industry bodies and primary research", candidateMarket: "Malaysia", comparisonDimension: "buyer_conditions", priority: 90 },
      { query: "malaysia sales outreach platform buyer conditions", reason: "Repeated in this plan.", sourceClass: "Industry bodies and primary research", candidateMarket: "Malaysia", comparisonDimension: "buyer_conditions", priority: 80 },
    ],
  }, 2, 12, ["Australia", "Malaysia"], ["Australia sales outreach platform market evidence"]);

  assert.equal(wave.queries.length, 1);
  assert.equal(wave.queries[0]?.query, "Malaysia sales outreach platform buyer conditions");
});

test("Ano treats an explicit no-new-query response as a clean completion signal", () => {
  const wave = normalizeIterativeResearchWave({
    objective: "No novel question is justified by the remaining evidence gaps.",
    candidateMarkets: ["Australia", "Malaysia"],
    queries: [],
  }, 3, 12, ["Australia", "Malaysia"], ["Australia sales outreach platform market evidence"]);

  assert.deepEqual(wave.queries, []);
});

test("a resumed graph continues after an excluded fetch rather than replaying it", async () => {
  const steps: string[] = [];
  const followUp = [query("00000000-0000-4000-8000-000000000023", 4, "Australia", "problem_urgency")];
  const planner: IterativeResearchPlanner = {
    async planInitialWave() { throw new Error("the initial wave must not be replayed"); },
    async planFollowUpWave() { steps.push("plan:4"); return { objective: "Close the remaining gap", candidateMarkets: ["Australia", "Malaysia"], queries: followUp }; },
  };
  let assessmentCount = 0;
  const executor: IterativeResearchExecutor = {
    async persistWave(_runId, wave) { steps.push("persist:4"); return { id: wave.id, queries: wave.queries }; },
    async executeSearch(_runId, _waveId, item) { steps.push(`search:${item.id}`); },
    async selectSourcesToFetch() { steps.push("select:excluding-prior-fetch"); return []; },
    async executeFetch() { throw new Error("no already-attempted source should be replayed"); },
    async assessCoverage() { assessmentCount += 1; steps.push(`assess:${assessmentCount}`); return coverage(assessmentCount > 1); },
    async complete() { steps.push("complete"); },
  };
  const graph = createIterativeEvidenceResearchGraph(planner, executor, new MemorySaver());
  await graph.invoke({
    researchRunId: "00000000-0000-4000-8000-000000000005", brief, plan, maximumSearches: 50, maximumFetches: 100,
    consumedSearches: 22, consumedFetches: 42, waveNumber: 3, candidateMarkets: ["Australia", "Malaysia"],
    startNode: "assess_coverage", currentNode: "assess_coverage",
  }, { configurable: { thread_id: "deep-research-excluded-fetch-test" } });
  assert.deepEqual(steps, ["assess:1", "plan:4", "persist:4", `search:${followUp[0].id}`, "select:excluding-prior-fetch", "assess:2", "complete"]);
});

test("the iterative graph plans a follow-up wave from a coverage gap and stops once the gate is met", async () => {
  const first = [query("00000000-0000-4000-8000-000000000020", 1, "Australia", "market_access"), query("00000000-0000-4000-8000-000000000021", 1, "Malaysia", "market_access")];
  const second = [query("00000000-0000-4000-8000-000000000022", 2, "Australia", "problem_urgency")];
  const steps: string[] = [];
  const planner: IterativeResearchPlanner = {
    async planInitialWave() { steps.push("plan:1"); return { objective: "Map candidate evidence", candidateMarkets: ["Australia", "Malaysia"], queries: first }; },
    async planFollowUpWave() { steps.push("plan:2"); return { objective: "Close market-access gaps", candidateMarkets: ["Australia", "Malaysia"], queries: second }; },
  };
  let assessCount = 0;
  const executor: IterativeResearchExecutor = {
    async persistWave(_runId, wave) { steps.push(`persist:${wave.waveNumber}`); return { id: wave.id, queries: wave.queries }; },
    async executeSearch(_runId, _waveId, item) { steps.push(`search:${item.id}`); },
    async selectSourcesToFetch() { steps.push("select"); return ["result"]; },
    async executeFetch() { steps.push("fetch"); },
    async assessCoverage() { assessCount += 1; steps.push(`assess:${assessCount}`); return coverage(assessCount > 1); },
    async complete(_runId, result) { assert.equal(result.comparisonReady, true); steps.push("complete"); },
  };
  const graph = createIterativeEvidenceResearchGraph(planner, executor, new MemorySaver());
  await graph.invoke({
    researchRunId: "00000000-0000-4000-8000-000000000003", brief, plan, maximumSearches: 3, maximumFetches: 4, currentNode: "plan_wave",
  }, { configurable: { thread_id: "deep-research-test" } });
  assert.deepEqual(steps, ["plan:1", "persist:1", `search:${first[0].id}`, `search:${first[1].id}`, "select", "fetch", "assess:1", "plan:2", "persist:2", `search:${second[0].id}`, "select", "fetch", "assess:2", "complete"]);
});

test("the approved eight-wave maximum reaches completion without LangGraph's default recursion cap", async () => {
  let plannedWaves = 0;
  let completed = 0;
  const planner: IterativeResearchPlanner = {
    async planInitialWave() {
      plannedWaves += 1;
      return {
        objective: "Start the approved bounded mission",
        candidateMarkets: ["Australia", "Malaysia"],
        queries: [query("00000000-0000-4000-8000-000000000101", 1, "Australia", "market_access")],
      };
    },
    async planFollowUpWave(_brief, _plan, _coverage, waveNumber) {
      plannedWaves += 1;
      return {
        objective: "Test the next approved evidence gap",
        candidateMarkets: ["Australia", "Malaysia"],
        queries: [query(`00000000-0000-4000-8000-${String(100 + waveNumber).padStart(12, "0")}`, waveNumber, "Malaysia", "buyer_conditions")],
      };
    },
  };
  const executor: IterativeResearchExecutor = {
    async persistWave(_runId, wave) { return { id: wave.id, queries: wave.queries }; },
    async executeSearch() {},
    async selectSourcesToFetch() { return []; },
    async executeFetch() {},
    async assessCoverage() { return coverage(false); },
    async complete() { completed += 1; },
  };
  const graph = createIterativeEvidenceResearchGraph(planner, executor, new MemorySaver());

  await graph.invoke({
    researchRunId: "00000000-0000-4000-8000-000000000106", brief, plan,
    maximumSearches: 50, maximumFetches: 100, currentNode: "plan_wave",
  }, {
    configurable: { thread_id: "deep-research-maximum-wave-test" },
    recursionLimit: ITERATIVE_EVIDENCE_RESEARCH_RECURSION_LIMIT,
  });

  assert.equal(plannedWaves, 8);
  assert.equal(completed, 1);
  assert.ok(ITERATIVE_EVIDENCE_RESEARCH_RECURSION_LIMIT > 41);
});

test("an interrupted mission resumes from coverage without replaying its last fetch", async () => {
  const steps: string[] = [];
  const planner: IterativeResearchPlanner = {
    async planInitialWave() { throw new Error("the initial wave must not be replayed"); },
    async planFollowUpWave() { steps.push("plan:3"); return { objective: "Close remaining gaps", candidateMarkets: ["Australia", "Malaysia"], queries: [] }; },
  };
  const executor: IterativeResearchExecutor = {
    async persistWave() { throw new Error("no new wave is needed once coverage is ready"); },
    async executeSearch() { throw new Error("no search should be replayed"); },
    async selectSourcesToFetch() { throw new Error("no fetch should be replayed"); },
    async executeFetch() { throw new Error("no fetch should be replayed"); },
    async assessCoverage() { steps.push("assess"); return coverage(true); },
    async complete(_runId, result) { assert.equal(result.comparisonReady, true); steps.push("complete"); },
  };
  const graph = createIterativeEvidenceResearchGraph(planner, executor, new MemorySaver());
  await graph.invoke({
    researchRunId: "00000000-0000-4000-8000-000000000004", brief, plan, maximumSearches: 50, maximumFetches: 100,
    consumedSearches: 19, consumedFetches: 37, waveNumber: 2, candidateMarkets: ["Australia", "Malaysia"],
    startNode: "assess_coverage", currentNode: "assess_coverage",
  }, { configurable: { thread_id: "deep-research-resume-test" } });
  assert.deepEqual(steps, ["assess", "complete"]);
});

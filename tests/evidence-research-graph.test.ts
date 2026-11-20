import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaver } from "@langchain/langgraph";

import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import type { EvidenceResearchExecutor, EvidenceResearchPlanner } from "@/server/langgraph/evidence-research-graph";
import { createEvidenceResearchGraph } from "@/server/langgraph/evidence-research-graph";

const brief: ResearchBrief = {
  offer: "AI workflows that turn quotes into jobs",
  goal: "Find the first outbound market",
  marketHints: [],
  locationHints: [],
  buyerHints: [],
  constraints: [],
  unknowns: [],
  sourceMessageIds: ["00000000-0000-4000-8000-000000000001"],
};

const plan: ResearchPlan = {
  id: "00000000-0000-4000-8000-000000000002",
  version: 1,
  approvalStatus: "approved",
  createdAt: "2026-10-23T00:00:00.000Z",
  summary: "Compare likely service-business markets using public evidence.",
  researchQuestions: ["Where is quote-to-job workflow friction visible?", "Which markets show a reachable service-business base?"],
  comparisonCriteria: ["Workflow complexity", "Public evidence coverage"],
  intendedSourceClasses: ["Government and official statistics", "Industry bodies and primary research"],
  plannedScope: { markets: [], industries: ["Service businesses"], buyerRoles: [] },
  budget: { maximumSearches: 12, maximumFetches: 30, providerSpend: "not_available_in_phase_a" },
  uncertainties: ["No location preference was supplied."],
};

const queries = [
  { id: "00000000-0000-4000-8000-000000000003", query: "Australia service business quote workflow research", reason: "Tests operational quote-to-job friction.", sourceClass: "Industry bodies and primary research" as const },
  { id: "00000000-0000-4000-8000-000000000004", query: "Malaysia service business digital workflow statistics", reason: "Tests public market context.", sourceClass: "Government and official statistics" as const },
];

test("Phase B uses a bounded, durable sequence and never exposes provider execution to the planner", async () => {
  const steps: string[] = [];
  const planner: EvidenceResearchPlanner = {
    async planQueries(receivedBrief, receivedPlan) {
      assert.equal(receivedBrief.offer, brief.offer);
      assert.equal(receivedPlan.id, plan.id);
      steps.push("plan");
      return { queries };
    },
  };
  const executor: EvidenceResearchExecutor = {
    async persistQueryPlan(runId, savedQueries) {
      assert.equal(runId, "00000000-0000-4000-8000-000000000005");
      assert.deepEqual(savedQueries, queries);
      steps.push("persist");
    },
    async executeSearch(_runId, query) { steps.push(`search:${query.id}`); },
    async selectSourcesToFetch(_runId, maximumFetches) {
      assert.equal(maximumFetches, 3);
      steps.push("select");
      return ["search-result-1", "search-result-2"];
    },
    async executeFetch(_runId, searchResultIds) {
      assert.deepEqual(searchResultIds, ["search-result-1", "search-result-2"]);
      steps.push("fetch");
    },
    async complete() { steps.push("complete"); },
  };
  const graph = createEvidenceResearchGraph(planner, executor, new MemorySaver());
  const config = { configurable: { thread_id: "phase-b-graph" } };
  await graph.invoke({
    researchRunId: "00000000-0000-4000-8000-000000000005",
    brief,
    plan,
    maximumSearches: 2,
    maximumFetches: 3,
    status: "running",
    currentNode: "plan_queries",
  }, config);
  const state = await graph.getState(config);
  assert.equal(state.values.status, "sources_ready");
  assert.deepEqual(steps, ["plan", "persist", `search:${queries[0].id}`, `search:${queries[1].id}`, "select", "fetch", "complete"]);
});

test("Phase B never exceeds its configured query ceiling", async () => {
  const searched: string[] = [];
  const planner: EvidenceResearchPlanner = { async planQueries() { return { queries: [...queries, { ...queries[0], id: "00000000-0000-4000-8000-000000000006", query: "Third query" }] }; } };
  const executor: EvidenceResearchExecutor = {
    async persistQueryPlan(_runId, savedQueries) { assert.equal(savedQueries.length, 2); },
    async executeSearch(_runId, query) { searched.push(query.id); },
    async selectSourcesToFetch() { return []; },
    async executeFetch() { throw new Error("No sources should be fetched when selection is empty."); },
    async complete() {},
  };
  const graph = createEvidenceResearchGraph(planner, executor, new MemorySaver());
  await graph.invoke({
    researchRunId: "00000000-0000-4000-8000-000000000005",
    brief,
    plan,
    maximumSearches: 2,
    maximumFetches: 1,
    status: "running",
    currentNode: "plan_queries",
  }, { configurable: { thread_id: "phase-b-ceiling" } });
  assert.deepEqual(searched, queries.map((query) => query.id));
});

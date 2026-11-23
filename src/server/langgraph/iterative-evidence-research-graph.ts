import "server-only";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type { ResearchQuery } from "@/lib/ano/evidence-research";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import type { IterativeResearchWavePlan } from "@/server/agents/iterative-research-planner";
import type { ResearchCoverage } from "@/server/research/deep-research-assessment";

export const ITERATIVE_EVIDENCE_RESEARCH_GRAPH_NAME = "iterative-evidence-research";
export const ITERATIVE_EVIDENCE_RESEARCH_GRAPH_VERSION = "deep-research-v1";
const MAX_WAVES = 8;
// Eight waves require 41 graph steps at most (five nodes per wave plus
// completion). LangGraph defaults to 25, which can stop a valid bounded run
// immediately before the final completion node. This is an internal execution
// allowance only; it does not increase the approved search or fetch budget.
export const ITERATIVE_EVIDENCE_RESEARCH_RECURSION_LIMIT = 64;
export type IterativeResearchStartNode = "plan_wave" | "assess_coverage";

export type IterativeResearchPlanner = {
  planInitialWave: (brief: ResearchBrief, plan: ResearchPlan, maximumQueries: number, priorQueries: string[]) => Promise<IterativeResearchWavePlan>;
  planFollowUpWave: (brief: ResearchBrief, plan: ResearchPlan, coverage: ResearchCoverage, waveNumber: number, maximumQueries: number, priorQueries: string[]) => Promise<IterativeResearchWavePlan>;
};

export type PersistedIterativeResearchWave = { id: string; queries: ResearchQuery[] };

export type IterativeResearchExecutor = {
  persistWave: (runId: string, wave: { id: string; waveNumber: number; objective: string; candidateMarkets: string[]; searchBudget: number; fetchBudget: number; queries: ResearchQuery[] }) => Promise<PersistedIterativeResearchWave>;
  executeSearch: (runId: string, waveId: string, query: ResearchQuery) => Promise<void>;
  selectSourcesToFetch: (runId: string, fetchBudget: number) => Promise<string[]>;
  executeFetch: (runId: string, searchResultIds: string[]) => Promise<void>;
  assessCoverage: (runId: string, candidateMarkets: string[]) => Promise<ResearchCoverage>;
  complete: (runId: string, coverage: ResearchCoverage) => Promise<void>;
};

export const IterativeEvidenceResearchState = Annotation.Root({
  researchRunId: Annotation<string>(),
  brief: Annotation<ResearchBrief>(),
  plan: Annotation<ResearchPlan>(),
  maximumSearches: Annotation<number>(),
  maximumFetches: Annotation<number>(),
  consumedSearches: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  consumedFetches: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  waveNumber: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  waveId: Annotation<string | null>({ reducer: (_left, right) => right, default: () => null }),
  candidateMarkets: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  priorQueries: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  queries: Annotation<ResearchQuery[]>({ reducer: (_left, right) => right, default: () => [] }),
  selectedSearchResultIds: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  coverage: Annotation<ResearchCoverage | null>({ reducer: (_left, right) => right, default: () => null }),
  startNode: Annotation<IterativeResearchStartNode>({ reducer: (_left, right) => right, default: () => "plan_wave" }),
  currentNode: Annotation<string>(),
});

export type IterativeEvidenceResearchStateValue = typeof IterativeEvidenceResearchState.State;

/**
 * A research mission is approved once at its maximum budget. The graph may
 * refine questions only inside that mission; it does not expand provider scope
 * or repeat an uncertain provider request.
 */
export function createIterativeEvidenceResearchGraph(
  planner: IterativeResearchPlanner,
  executor: IterativeResearchExecutor,
  checkpointer: BaseCheckpointSaver,
  options?: { maxWaves?: number },
) {
  const maxWaves = Math.max(1, Math.min(options?.maxWaves ?? MAX_WAVES, MAX_WAVES));

  const planWave = async (state: IterativeEvidenceResearchStateValue) => {
    const waveNumber = state.waveNumber + 1;
    const remainingSearches = state.maximumSearches - state.consumedSearches;
    const remainingFetches = state.maximumFetches - state.consumedFetches;
    if (remainingSearches <= 0 || remainingFetches <= 0 || waveNumber > maxWaves) {
      return { currentNode: "complete" };
    }
    const planned = waveNumber === 1
      ? await planner.planInitialWave(state.brief, state.plan, remainingSearches, state.priorQueries)
      : await planner.planFollowUpWave(state.brief, state.plan, state.coverage!, waveNumber, remainingSearches, state.priorQueries);
    const queries = planned.queries.slice(0, remainingSearches);
    if (!queries.length) return { currentNode: "complete" };
    const waveId = crypto.randomUUID();
    const persisted = await executor.persistWave(state.researchRunId, {
      id: waveId,
      waveNumber,
      objective: planned.objective,
      candidateMarkets: planned.candidateMarkets,
      searchBudget: queries.length,
      fetchBudget: Math.min(remainingFetches, Math.max(8, queries.length * 3)),
      queries,
    });
    if (!persisted.queries.length) return { currentNode: "complete" };
    return { waveId: persisted.id, waveNumber, candidateMarkets: planned.candidateMarkets, queries: persisted.queries, priorQueries: [...state.priorQueries, ...persisted.queries.map((query) => query.query)], currentNode: "execute_wave_search" };
  };

  const executeWaveSearch = async (state: IterativeEvidenceResearchStateValue) => {
    if (!state.waveId) throw new Error("Ano could not identify the planned research wave.");
    for (const query of state.queries) await executor.executeSearch(state.researchRunId, state.waveId, query);
    return { consumedSearches: state.consumedSearches + state.queries.length, currentNode: "select_sources_to_fetch" };
  };

  const routeAfterPlan = (state: IterativeEvidenceResearchStateValue) => state.currentNode === "complete" ? "complete" : "execute_wave_search";

  const selectSourcesToFetch = async (state: IterativeEvidenceResearchStateValue) => {
    const remainingFetches = state.maximumFetches - state.consumedFetches;
    const selectedSearchResultIds = remainingFetches > 0 ? await executor.selectSourcesToFetch(state.researchRunId, Math.min(remainingFetches, Math.max(8, state.queries.length * 3))) : [];
    return { selectedSearchResultIds, currentNode: "execute_wave_fetch" };
  };

  const executeWaveFetch = async (state: IterativeEvidenceResearchStateValue) => {
    if (state.selectedSearchResultIds.length) await executor.executeFetch(state.researchRunId, state.selectedSearchResultIds);
    return { consumedFetches: state.consumedFetches + state.selectedSearchResultIds.length, currentNode: "assess_coverage" };
  };

  const assessCoverage = async (state: IterativeEvidenceResearchStateValue) => {
    const coverage = await executor.assessCoverage(state.researchRunId, state.candidateMarkets);
    return { coverage, currentNode: "route_after_coverage" };
  };

  const routeAfterCoverage = (state: IterativeEvidenceResearchStateValue) => {
    if (!state.coverage || state.coverage.comparisonReady || state.consumedSearches >= state.maximumSearches || state.consumedFetches >= state.maximumFetches || state.waveNumber >= maxWaves) return "complete";
    return "plan_wave";
  };

  const complete = async (state: IterativeEvidenceResearchStateValue) => {
    const coverage = state.coverage ?? await executor.assessCoverage(state.researchRunId, state.candidateMarkets);
    await executor.complete(state.researchRunId, coverage);
    return { coverage, currentNode: "sources_ready" };
  };

  return new StateGraph(IterativeEvidenceResearchState)
    .addNode("plan_wave", planWave)
    .addNode("execute_wave_search", executeWaveSearch)
    .addNode("select_sources_to_fetch", selectSourcesToFetch)
    .addNode("execute_wave_fetch", executeWaveFetch)
    .addNode("assess_coverage", assessCoverage)
    .addNode("complete", complete)
    .addConditionalEdges(START, (state) => state.startNode)
    .addConditionalEdges("plan_wave", routeAfterPlan)
    .addEdge("execute_wave_search", "select_sources_to_fetch")
    .addEdge("select_sources_to_fetch", "execute_wave_fetch")
    .addEdge("execute_wave_fetch", "assess_coverage")
    .addConditionalEdges("assess_coverage", routeAfterCoverage)
    .addEdge("complete", END)
    .compile({ checkpointer });
}

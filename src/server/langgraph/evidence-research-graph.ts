import "server-only";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type { EvidenceResearchStatus, ResearchQuery, ResearchQueryPlan } from "@/lib/ano/evidence-research";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";

export const EVIDENCE_RESEARCH_GRAPH_NAME = "controlled-evidence-research";
export const EVIDENCE_RESEARCH_GRAPH_VERSION = "phase-b-v1";

export type EvidenceResearchPlanner = {
  planQueries: (brief: ResearchBrief, plan: ResearchPlan) => Promise<ResearchQueryPlan>;
};

/**
 * This boundary deliberately keeps provider access out of Bedrock. Each action
 * is persisted by Ano before it reaches the adapter, making a stopped run safe
 * to inspect without automatically retrying a possibly chargeable request.
 */
export type EvidenceResearchExecutor = {
  persistQueryPlan: (runId: string, queries: ResearchQuery[]) => Promise<void>;
  executeSearch: (runId: string, query: ResearchQuery) => Promise<void>;
  selectSourcesToFetch: (runId: string, maximumFetches: number) => Promise<string[]>;
  executeFetch: (runId: string, searchResultIds: string[]) => Promise<void>;
  complete: (runId: string) => Promise<void>;
};

export const EvidenceResearchGraphState = Annotation.Root({
  researchRunId: Annotation<string>(),
  brief: Annotation<ResearchBrief>(),
  plan: Annotation<ResearchPlan>(),
  maximumSearches: Annotation<number>(),
  maximumFetches: Annotation<number>(),
  queries: Annotation<ResearchQuery[]>({ reducer: (_left, right) => right, default: () => [] }),
  selectedSearchResultIds: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  status: Annotation<EvidenceResearchStatus>(),
  currentNode: Annotation<string>(),
});

export type EvidenceResearchGraphStateValue = typeof EvidenceResearchGraphState.State;

/**
 * The Phase B graph is intentionally linear and has no automatic retry policy.
 * A provider request that is interrupted or ambiguous becomes a saved manual
 * review instead of a second request that could duplicate a charge.
 */
export function createEvidenceResearchGraph(
  planner: EvidenceResearchPlanner,
  executor: EvidenceResearchExecutor,
  checkpointer: BaseCheckpointSaver,
) {
  const planQueries = async (state: EvidenceResearchGraphStateValue) => {
    const result = await planner.planQueries(state.brief, state.plan);
    const queries = result.queries.slice(0, state.maximumSearches);
    if (!queries.length) throw new Error("Ano could not create a bounded public-evidence query plan.");
    await executor.persistQueryPlan(state.researchRunId, queries);
    return { queries, status: "running" as const, currentNode: "execute_search" };
  };

  const executeSearch = async (state: EvidenceResearchGraphStateValue) => {
    for (const query of state.queries.slice(0, state.maximumSearches)) {
      await executor.executeSearch(state.researchRunId, query);
    }
    return { status: "running" as const, currentNode: "select_sources_to_fetch" };
  };

  const selectSourcesToFetch = async (state: EvidenceResearchGraphStateValue) => {
    const selectedSearchResultIds = await executor.selectSourcesToFetch(state.researchRunId, state.maximumFetches);
    return { selectedSearchResultIds, status: "running" as const, currentNode: "execute_fetch" };
  };

  const executeFetch = async (state: EvidenceResearchGraphStateValue) => {
    if (state.selectedSearchResultIds.length) {
      await executor.executeFetch(state.researchRunId, state.selectedSearchResultIds.slice(0, state.maximumFetches));
    }
    return { status: "running" as const, currentNode: "normalise_evidence" };
  };

  const normaliseEvidence = async (state: EvidenceResearchGraphStateValue) => {
    await executor.complete(state.researchRunId);
    return { status: "sources_ready" as const, currentNode: "sources_ready" };
  };

  return new StateGraph(EvidenceResearchGraphState)
    .addNode("plan_queries", planQueries)
    .addNode("execute_search", executeSearch)
    .addNode("select_sources_to_fetch", selectSourcesToFetch)
    .addNode("execute_fetch", executeFetch)
    .addNode("normalise_evidence", normaliseEvidence)
    .addEdge(START, "plan_queries")
    .addEdge("plan_queries", "execute_search")
    .addEdge("execute_search", "select_sources_to_fetch")
    .addEdge("select_sources_to_fetch", "execute_fetch")
    .addEdge("execute_fetch", "normalise_evidence")
    .addEdge("normalise_evidence", END)
    .compile({ checkpointer });
}

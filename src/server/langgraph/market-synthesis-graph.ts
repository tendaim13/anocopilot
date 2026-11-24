import "server-only";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type {
  EvidenceAssessment,
  EvidenceGroupSummary,
  MarketSynthesisDraft,
  SynthesisStatus,
} from "@/lib/ano/market-synthesis";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import type { SynthesisSource } from "@/server/agents/market-synthesis-model";

export const MARKET_SYNTHESIS_GRAPH_NAME = "evidence-market-synthesis";
export const MARKET_SYNTHESIS_GRAPH_VERSION = "phase-c-v3-map-reduce";

export type MarketSynthesisModel = {
  mapEvidenceGroups?: (
    brief: ResearchBrief,
    plan: ResearchPlan,
    sources: SynthesisSource[],
  ) => Promise<EvidenceGroupSummary[]>;
  reduceGroupSummaries?: (
    brief: ResearchBrief,
    plan: ResearchPlan,
    sources: SynthesisSource[],
    groupSummaries: EvidenceGroupSummary[],
  ) => Promise<MarketSynthesisDraft>;
  synthesise: (
    brief: ResearchBrief,
    plan: ResearchPlan,
    sources: SynthesisSource[],
  ) => Promise<MarketSynthesisDraft>;
};

export type MarketSynthesisExecutor = {
  assess: (sources: SynthesisSource[]) => EvidenceAssessment;
  saveNoUsableEvidence: (synthesisId: string, assessment: EvidenceAssessment, graphRunId: string) => Promise<void>;
  saveSynthesis: (synthesisId: string, graphRunId: string, assessment: EvidenceAssessment, draft: MarketSynthesisDraft, sources: SynthesisSource[]) => Promise<{ status: SynthesisStatus }>;
};

export const MarketSynthesisGraphState = Annotation.Root({
  synthesisId: Annotation<string>(),
  graphRunId: Annotation<string>(),
  brief: Annotation<ResearchBrief>(),
  plan: Annotation<ResearchPlan>(),
  sources: Annotation<SynthesisSource[]>(),
  groupSummaries: Annotation<EvidenceGroupSummary[]>({ reducer: (_left, right) => right, default: () => [] }),
  assessment: Annotation<EvidenceAssessment | null>({ reducer: (_left, right) => right, default: () => null }),
  draft: Annotation<MarketSynthesisDraft | null>({ reducer: (_left, right) => right, default: () => null }),
  status: Annotation<SynthesisStatus>(),
  currentNode: Annotation<string>(),
});

export type MarketSynthesisGraphStateValue = typeof MarketSynthesisGraphState.State;

/**
 * Phase C is intentionally separated from Phase B. The only inputs are source
 * IDs and bounded excerpts already saved by Ano; this graph runs bounded
 * map-reduce synthesis over all saved sources and cannot advance to prospecting.
 */
export function createMarketSynthesisGraph(model: MarketSynthesisModel, executor: MarketSynthesisExecutor, checkpointer: BaseCheckpointSaver) {
  const assessEvidenceCoverage = async (state: MarketSynthesisGraphStateValue) => {
    const assessment = executor.assess(state.sources);
    return {
      assessment,
      status: "running" as const,
      currentNode: assessment.fetchedSourceCount === 0 ? "complete_no_usable_evidence" : "map_evidence_groups",
    };
  };

  const mapEvidenceGroups = async (state: MarketSynthesisGraphStateValue) => {
    const groupSummaries = model.mapEvidenceGroups
      ? await model.mapEvidenceGroups(state.brief, state.plan, state.sources)
      : [];
    return {
      groupSummaries,
      status: "running" as const,
      currentNode: "synthesise_market_report",
    };
  };

  const synthesiseMarketReport = async (state: MarketSynthesisGraphStateValue) => {
    const draft =
      model.reduceGroupSummaries && state.groupSummaries.length > 0
        ? await model.reduceGroupSummaries(state.brief, state.plan, state.sources, state.groupSummaries)
        : await model.synthesise(state.brief, state.plan, state.sources);
    const enrichedDraft: MarketSynthesisDraft =
      state.groupSummaries.length > 0 && !draft.groupSummaries?.length
        ? { ...draft, groupSummaries: state.groupSummaries }
        : draft;
    return { draft: enrichedDraft, status: "running" as const, currentNode: "citation_audit" };
  };

  const citationAudit = async (state: MarketSynthesisGraphStateValue) => {
    if (!state.assessment || !state.draft) throw new Error("Ano could not audit an incomplete evidence synthesis.");
    const result = await executor.saveSynthesis(state.synthesisId, state.graphRunId, state.assessment, state.draft, state.sources);
    return { status: result.status, currentNode: result.status === "ready_for_decision" ? "await_target_decision" : "review_market_report" };
  };

  const completeNoUsableEvidence = async (state: MarketSynthesisGraphStateValue) => {
    if (!state.assessment) throw new Error("Ano could not record the evidence coverage result.");
    await executor.saveNoUsableEvidence(state.synthesisId, state.assessment, state.graphRunId);
    return { status: "ready_for_review" as const, currentNode: "review_market_report" };
  };

  const routeAfterAssessment = (state: MarketSynthesisGraphStateValue) =>
    state.assessment && state.assessment.fetchedSourceCount > 0 ? "map_evidence_groups" : "complete_no_usable_evidence";

  return new StateGraph(MarketSynthesisGraphState)
    .addNode("assess_evidence_coverage", assessEvidenceCoverage)
    .addNode("map_evidence_groups", mapEvidenceGroups)
    .addNode("synthesise_market_report", synthesiseMarketReport)
    .addNode("citation_audit", citationAudit)
    .addNode("complete_no_usable_evidence", completeNoUsableEvidence)
    .addEdge(START, "assess_evidence_coverage")
    .addConditionalEdges("assess_evidence_coverage", routeAfterAssessment)
    .addEdge("map_evidence_groups", "synthesise_market_report")
    .addEdge("synthesise_market_report", "citation_audit")
    .addEdge("citation_audit", END)
    .addEdge("complete_no_usable_evidence", END)
    .compile({ checkpointer });
}

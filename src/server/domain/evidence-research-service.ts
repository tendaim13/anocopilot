import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import { BedrockConfigurationError, getActivePlannerConfig } from "@/server/agents/bedrock";
import { createIterativeResearchPlanner, IterativeResearchPlannerError } from "@/server/agents/iterative-research-planner";
import { getResearchCheckpointer } from "@/server/langgraph/checkpointer";
import {
  createIterativeEvidenceResearchGraph,
  ITERATIVE_EVIDENCE_RESEARCH_RECURSION_LIMIT,
} from "@/server/langgraph/iterative-evidence-research-graph";
import { getResearchConversation } from "@/server/domain/research-conversation-service";
import {
  claimEvidenceResearchRun,
  createIterativeEvidenceResearchExecutor,
  EvidenceResearchPersistenceError,
  prepareEvidenceResearchRun,
  readEvidenceResearchView,
  stopEvidenceResearchRun,
} from "@/server/persistence/evidence-research-store";

export class EvidenceResearchServiceError extends Error {
  constructor(message: string, readonly code: string = "EVIDENCE_RESEARCH_UNAVAILABLE") {
    super(message);
    this.name = "EvidenceResearchServiceError";
  }
}

function requirePlannerConfig() {
  try {
    return getActivePlannerConfig();
  } catch (error) {
    if (error instanceof BedrockConfigurationError) {
      throw new EvidenceResearchServiceError(error.message, "PLANNER_NOT_CONFIGURED");
    }
    throw error;
  }
}

export async function getEvidenceResearchForConversation(session: WorkspaceSession, conversationId: string) {
  return readEvidenceResearchView(session, conversationId);
}

/** Creates a visible, non-executing provider scope. It never calls SearXNG. */
export async function prepareEvidenceResearchForConversation(session: WorkspaceSession, conversationId: string) {
  const conversation = await getResearchConversation(session, conversationId);
  return prepareEvidenceResearchRun(session, conversation);
}

/**
 * This is the only Phase B operation that can call private SearXNG discovery or
 * Ano-owned source retrieval. The parent approval is claimed atomically before
 * graph execution, and every child request has its own durable idempotency record.
 */
export async function startApprovedEvidenceResearch(session: WorkspaceSession, conversationId: string, runId: string): Promise<EvidenceResearchView | null> {
  const before = await getEvidenceResearchForConversation(session, conversationId);
  if (!before || before.run.id !== runId) throw new EvidenceResearchServiceError("Ano could not find that approved public-research scope.", "RUN_NOT_FOUND");
  const claim = await claimEvidenceResearchRun(session, runId);
  if (!claim.claimed) return getEvidenceResearchForConversation(session, conversationId);

  try {
    const [conversation, checkpointer] = await Promise.all([
      getResearchConversation(session, conversationId),
      getResearchCheckpointer(),
    ]);
    if (!conversation.brief || !conversation.plan || conversation.plan.approvalStatus !== "approved") {
      throw new EvidenceResearchServiceError("Ano could not verify the approved research brief before contacting a provider.", "PLAN_NOT_APPROVED");
    }
    const configuration = requirePlannerConfig();
    const graph = createIterativeEvidenceResearchGraph(
      createIterativeResearchPlanner(configuration),
      createIterativeEvidenceResearchExecutor(session),
      checkpointer,
    );
    await graph.invoke({
      researchRunId: runId,
      brief: conversation.brief,
      plan: conversation.plan,
      maximumSearches: before.run.maximumSearches,
      maximumFetches: before.run.maximumFetches,
      consumedSearches: before.run.consumedSearches,
      consumedFetches: before.run.consumedFetches,
      waveNumber: before.run.currentWave,
      candidateMarkets: claim.candidateMarkets ?? [],
      priorQueries: claim.priorQueries ?? [],
      coverage: claim.coverage ?? null,
      startNode: claim.startNode ?? "plan_wave",
      currentNode: "plan_wave",
    }, {
      configurable: { thread_id: claim.threadId ?? before.run.threadId },
      recursionLimit: ITERATIVE_EVIDENCE_RESEARCH_RECURSION_LIMIT,
    });
  } catch (error) {
    if (error instanceof IterativeResearchPlannerError && error.reason) {
      console.error("[ano:phase-b]", error.message, error.reason);
    }
    await stopEvidenceResearchRun(session, runId, error);
    if (error instanceof IterativeResearchPlannerError) return getEvidenceResearchForConversation(session, conversationId);
    if (error instanceof EvidenceResearchPersistenceError || error instanceof EvidenceResearchServiceError) return getEvidenceResearchForConversation(session, conversationId);
    return getEvidenceResearchForConversation(session, conversationId);
  }
  return getEvidenceResearchForConversation(session, conversationId);
}

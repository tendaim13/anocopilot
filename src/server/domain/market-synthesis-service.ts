import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import type { LockTargetDecisionInput } from "@/lib/ano/market-synthesis";
import { BedrockConfigurationError, getActivePlannerConfig } from "@/server/agents/bedrock";
import { createMarketSynthesisModel, MarketSynthesisModelError } from "@/server/agents/market-synthesis-model";
import { getResearchConversation } from "@/server/domain/research-conversation-service";
import { getResearchCheckpointer } from "@/server/langgraph/checkpointer";
import { createMarketSynthesisGraph } from "@/server/langgraph/market-synthesis-graph";
import {
  assessSourceLedger,
  claimMarketSynthesis,
  loadSynthesisSources,
  lockTargetDecision,
  MarketSynthesisPersistenceError,
  readMarketSynthesis,
  saveMarketSynthesis,
  saveNoUsableEvidence,
  stopMarketSynthesis,
} from "@/server/persistence/market-synthesis-store";

export class MarketSynthesisServiceError extends Error {
  constructor(message: string, readonly code: string = "MARKET_SYNTHESIS_UNAVAILABLE") {
    super(message);
    this.name = "MarketSynthesisServiceError";
  }
}

function requirePlannerConfig() {
  try {
    return getActivePlannerConfig();
  } catch (error) {
    if (error instanceof BedrockConfigurationError) {
      throw new MarketSynthesisServiceError(error.message, "PLANNER_NOT_CONFIGURED");
    }
    throw error;
  }
}

export async function getMarketSynthesisForConversation(session: WorkspaceSession, conversationId: string) {
  return readMarketSynthesis(session, conversationId);
}

/**
 * Runs the bounded, source-ID-only Phase C graph. This never calls SearXNG,
 * Prospeo, Dropcontact, email, telephony, or a CRM. A completed or stopped
 * synthesis is returned as-is rather than being retried automatically.
 */
export async function analyseMarketSynthesisForConversation(session: WorkspaceSession, conversationId: string) {
  const [conversation, input] = await Promise.all([
    getResearchConversation(session, conversationId),
    loadSynthesisSources(session, conversationId),
  ]);
  if (!conversation.brief || !conversation.plan || conversation.plan.approvalStatus !== "approved") {
    throw new MarketSynthesisServiceError("Ano could not verify the approved research brief before analyzing saved evidence.", "PLAN_NOT_APPROVED");
  }
  const assessment = assessSourceLedger(input.sources, input.missionCoverage);
  const claim = await claimMarketSynthesis(session, conversationId, input.researchRunId, assessment);
  if (!claim.claimed) return readMarketSynthesis(session, conversationId);

  try {
    const [checkpointer, configuration] = await Promise.all([getResearchCheckpointer(), Promise.resolve(requirePlannerConfig())]);
    const graph = createMarketSynthesisGraph(createMarketSynthesisModel(configuration), {
      assess: assessSourceLedger,
      saveNoUsableEvidence: (synthesisId, nextAssessment, graphRunId) => saveNoUsableEvidence(session, synthesisId, nextAssessment, graphRunId),
      saveSynthesis: (synthesisId, graphRunId, nextAssessment, draft, sources) => saveMarketSynthesis(session, synthesisId, graphRunId, nextAssessment, draft, sources),
    }, checkpointer);
    await graph.invoke({
      synthesisId: claim.synthesisId,
      graphRunId: input.graphRunId,
      brief: conversation.brief,
      plan: conversation.plan,
      sources: input.sources,
      status: "running",
      currentNode: "assess_evidence_coverage",
    }, { configurable: { thread_id: `ano:synthesis:${claim.synthesisId}` } });
  } catch (error) {
    if (error instanceof MarketSynthesisModelError && error.reason) {
      console.error("[ano:phase-c]", error.message, error.reason);
    }
    await stopMarketSynthesis(session, claim.synthesisId, input.graphRunId, error).catch(() => undefined);
    if (error instanceof MarketSynthesisModelError || error instanceof MarketSynthesisPersistenceError || error instanceof MarketSynthesisServiceError) {
      return readMarketSynthesis(session, conversationId);
    }
    return readMarketSynthesis(session, conversationId);
  }
  return readMarketSynthesis(session, conversationId);
}

export async function lockMarketRouteForConversation(session: WorkspaceSession, conversationId: string, input: LockTargetDecisionInput) {
  return lockTargetDecision(session, conversationId, input);
}

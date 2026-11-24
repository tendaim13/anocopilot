import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import type { LockTargetDecisionInput } from "@/lib/ano/market-synthesis";
import { buildFriendlyConversationTitle } from "@/lib/ano/research-conversation";
import { BedrockConfigurationError, getActivePlannerConfig } from "@/server/agents/bedrock";
import { createMarketSynthesisModel, MarketSynthesisModelError } from "@/server/agents/market-synthesis-model";
import { getResearchConversation } from "@/server/domain/research-conversation-service";
import { getResearchCheckpointer } from "@/server/langgraph/checkpointer";
import { createMarketSynthesisGraph } from "@/server/langgraph/market-synthesis-graph";
import { autoUpdateConversationTitle } from "@/server/persistence/research-conversation-store";
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
      assess: (sources) => assessSourceLedger(sources, input.missionCoverage),
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
  const synthesis = await lockTargetDecision(session, conversationId, input);
  if (synthesis.decision?.status === "locked") {
    try {
      const lockedMarket = synthesis.markets.find(
        (m) => m.id === synthesis.decision?.marketProfileId,
      );
      const lockedIndustry = synthesis.industries.find(
        (i) => i.id === synthesis.decision?.industryProfileId,
      );
      if (lockedMarket) {
        const view = await getResearchConversation(session, conversationId);
        const firstUserMessage =
          view.messages.find((msg) => msg.role === "user")?.text ?? null;
        const friendlyTitle = buildFriendlyConversationTitle({
          openingMessage: firstUserMessage,
          brief: view.brief,
          lockedMarketName: lockedMarket.name,
          lockedIndustryName: lockedIndustry?.name ?? null,
          productSourceLabels: (view.productSources ?? []).map((s) => s.label),
          productSourceSummaries: (view.productSources ?? [])
            .map((s) => s.summaryText)
            .filter((v): v is string => Boolean(v)),
        });
        await autoUpdateConversationTitle(session, conversationId, friendlyTitle, {
          preserveUpdatedAt: true,
          forceUpgrade: true,
        });
      }
    } catch {
      // Never block target-route locking if automatic title refinement cannot run.
    }
  }
  return synthesis;
}

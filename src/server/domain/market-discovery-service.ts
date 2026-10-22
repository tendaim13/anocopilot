import type { WorkspaceSession } from "@/contracts/ano";
import type { MarketBriefResult, MarketDecisionInput, ProductBriefInput } from "@/lib/ano/market-discovery";
import { BedrockConfigurationError, createBedrockConverse, getAnoAgentMode, getBedrockPlannerConfig } from "@/server/agents/bedrock";
import { runMarketHypothesis } from "@/server/agents/market-hypothesis-runtime";
import { createCheckpoint } from "@/server/agents/resume";
import { AgentRuntimeError } from "@/server/agents/runtime";
import { persistMarketBrief, saveMarketDecision } from "@/server/persistence/market-discovery-store";

export async function createMarketBriefForWorkspace(session: WorkspaceSession, input: ProductBriefInput, idempotencyKey: string): Promise<MarketBriefResult> {
  try {
    if (getAnoAgentMode() !== "bedrock") throw new BedrockConfigurationError("Ano’s market-hypothesis setup requires ANO_AGENT_MODE=bedrock. It does not substitute simulated research.");
    const config = getBedrockPlannerConfig();
    return persistMarketBrief(session, input, await runMarketHypothesis(input, config, createBedrockConverse(config)), idempotencyKey);
  } catch (error) {
    if (error instanceof BedrockConfigurationError) throw new AgentRuntimeError(error.message, "BEDROCK_CONFIGURATION", createCheckpoint("failed", 0, 0));
    throw error;
  }
}

export async function chooseMarketDecisionForWorkspace(session: WorkspaceSession, productBriefId: string, input: MarketDecisionInput) {
  return saveMarketDecision(session, productBriefId, input);
}

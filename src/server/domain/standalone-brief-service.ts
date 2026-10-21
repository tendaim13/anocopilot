import type { WorkspaceSession } from "@/contracts/ano";
import type { StandaloneBriefInput, StandaloneBriefResult } from "@/lib/ano/standalone";
import { BedrockConfigurationError, createBedrockConverse, getAnoAgentMode, getBedrockPlannerConfig } from "@/server/agents/bedrock";
import { AgentRuntimeError } from "@/server/agents/runtime";
import { createCheckpoint } from "@/server/agents/resume";
import { runStandaloneBrief } from "@/server/agents/standalone-brief-runtime";
import { persistStandaloneBrief } from "@/server/persistence/standalone-brief-store";

export async function createStandaloneBriefForWorkspace(
  session: WorkspaceSession,
  input: StandaloneBriefInput,
  idempotencyKey: string,
): Promise<StandaloneBriefResult> {
  try {
    if (getAnoAgentMode() !== "bedrock") {
      throw new BedrockConfigurationError("Ano’s standalone brief requires ANO_AGENT_MODE=bedrock. It does not fall back to simulated research.");
    }
    const config = getBedrockPlannerConfig();
    const result = await runStandaloneBrief(input, config, createBedrockConverse(config));
    return persistStandaloneBrief(session, input, result, idempotencyKey);
  } catch (error) {
    if (error instanceof BedrockConfigurationError) {
      throw new AgentRuntimeError(error.message, "BEDROCK_CONFIGURATION", createCheckpoint("failed", 0, 0));
    }
    throw error;
  }
}

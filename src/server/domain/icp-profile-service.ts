import type { WorkspaceSession } from "@/contracts/ano";
import type { IcpProfileInput, IcpProfileResult } from "@/lib/ano/icp";
import { BedrockConfigurationError, createBedrockConverse, getAnoAgentMode, getBedrockPlannerConfig } from "@/server/agents/bedrock";
import { AgentRuntimeError } from "@/server/agents/runtime";
import { createCheckpoint } from "@/server/agents/resume";
import { runIcpProfile } from "@/server/agents/icp-profile-runtime";
import { persistIcpProfile } from "@/server/persistence/icp-profile-store";

export async function createIcpProfileForWorkspace(
  session: WorkspaceSession,
  input: IcpProfileInput,
  idempotencyKey: string,
): Promise<IcpProfileResult> {
  try {
    if (getAnoAgentMode() !== "bedrock") {
      throw new BedrockConfigurationError("Ano’s ICP setup requires ANO_AGENT_MODE=bedrock. It does not fall back to simulated research.");
    }
    const config = getBedrockPlannerConfig();
    const result = await runIcpProfile(input, config, createBedrockConverse(config));
    return persistIcpProfile(session, input, result, idempotencyKey);
  } catch (error) {
    if (error instanceof BedrockConfigurationError) {
      throw new AgentRuntimeError(error.message, "BEDROCK_CONFIGURATION", createCheckpoint("failed", 0, 0));
    }
    throw error;
  }
}

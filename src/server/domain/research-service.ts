import type { WorkspaceSession } from "@/contracts/ano";
import type { ResearchAgentResult } from "@/contracts/agent";
import { BedrockConfigurationError, createBedrockConverse, getAnoAgentMode, getBedrockPlannerConfig } from "@/server/agents/bedrock";
import { runBedrockSalesResearch } from "@/server/agents/bedrock-runtime";
import { AgentRuntimeError, runSimulatedSalesResearch } from "@/server/agents/runtime";
import { createCheckpoint } from "@/server/agents/resume";
import { persistResearchRun } from "@/server/persistence/research-run-store";
import type { ResearchInput, ResearchResult } from "@/lib/ano/types";

export async function runResearchForWorkspace(session: WorkspaceSession, input: ResearchInput, idempotencyKey: string): Promise<ResearchResult> {
  let agentRun: ResearchAgentResult;
  try {
    const mode = getAnoAgentMode();
    if (mode !== "bedrock") {
      throw new BedrockConfigurationError("Ano’s simulated research runtime has been retired. Use the standalone workspace brief flow instead.");
    }
    const config = getBedrockPlannerConfig();
    agentRun = await runBedrockSalesResearch({ input, idempotencyKey }, config, createBedrockConverse(config));
  } catch (error) {
    if (error instanceof BedrockConfigurationError) {
      throw new AgentRuntimeError(error.message, "BEDROCK_CONFIGURATION", createCheckpoint("failed", 0, 0));
    }
    throw error;
  }
  return persistResearchRun(session, input, agentRun.result, idempotencyKey, agentRun);
}

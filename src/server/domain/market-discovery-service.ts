import type { WorkspaceSession } from "@/contracts/ano";
import type { MarketBriefResult, MarketDecisionInput, MarketHypothesisPatch, MarketScopeInput, ProductBriefInput } from "@/lib/ano/market-discovery";
import { BedrockConfigurationError, createBedrockConverse, getAnoAgentMode, getBedrockPlannerConfig } from "@/server/agents/bedrock";
import { runMarketHypothesis } from "@/server/agents/market-hypothesis-runtime";
import { createCheckpoint } from "@/server/agents/resume";
import { AgentRuntimeError } from "@/server/agents/runtime";
import { persistMarketBrief, readLatestMarketBrief, readMarketBrief, saveManualMarketScope, saveMarketDecision, updateMarketHypotheses } from "@/server/persistence/market-discovery-store";
import {
  approveProspeoCompanySearch,
  checkProspeoConnection,
  prepareProspeoCompanySearch,
  ProspeoDiscoveryError,
} from "@/server/persistence/prospeo-company-discovery-store";
import { canExecutePaidProviderCall } from "@/server/telemetry/internal-api-usage";

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

export async function saveManualMarketScopeForWorkspace(session: WorkspaceSession, productBriefId: string, input: MarketScopeInput) {
  return saveManualMarketScope(session, productBriefId, input);
}

export async function editMarketHypothesesForWorkspace(session: WorkspaceSession, productBriefId: string, patch: MarketHypothesisPatch) {
  return updateMarketHypotheses(session, productBriefId, patch);
}

export async function getMarketBriefForWorkspace(session: WorkspaceSession, productBriefId: string) {
  return readMarketBrief(session, productBriefId);
}

export async function getLatestMarketBriefForWorkspace(session: WorkspaceSession) {
  return readLatestMarketBrief(session);
}

export async function checkProspeoConnectionForWorkspace(session: WorkspaceSession) {
  return checkProspeoConnection(session);
}

export async function prepareProspeoCompanySearchForWorkspace(session: WorkspaceSession, productBriefId: string) {
  return prepareProspeoCompanySearch(session, productBriefId);
}

export async function approveProspeoCompanySearchForWorkspace(session: WorkspaceSession, searchId: string) {
  const budgetOk = await canExecutePaidProviderCall(session, "prospeo");
  if (!budgetOk) {
    throw new ProspeoDiscoveryError(
      "Company search is temporarily paused because workspace usage safeguards could not be verified.",
      "BUDGET_GUARD_BLOCKED",
    );
  }
  return approveProspeoCompanySearch(session, searchId);
}

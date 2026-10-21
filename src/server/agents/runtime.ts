import type { ResearchAgentRequest, ResearchAgentResult } from "@/contracts/agent";
import { runMockResearch } from "@/lib/ano/mock-research";
import { createCheckpoint } from "@/server/agents/resume";
import { salesResearchRole, validateResearchBrief } from "@/server/agents/roles/sales-research";
import { evaluateToolIntent, DEFAULT_RESEARCH_LIMITS } from "@/server/policy/tool-guard";

const simulatedRunTools = ["search_companies", "search_people", "get_account_evidence", "compute_score", "build_today_plan"] as const;

/**
 * A deterministic Phase 1 runtime in the final agent shape. Phase 4 can add a
 * Bedrock planner before this loop, but the same guard checks and bounded tool
 * execution remain mandatory.
 */
export function runSimulatedSalesResearch(request: ResearchAgentRequest): ResearchAgentResult {
  const limits = { ...DEFAULT_RESEARCH_LIMITS, ...request.limits };
  if (simulatedRunTools.length > limits.maxToolCalls) {
    throw new Error("Ano’s safe tool-call limit is lower than this research workflow requires.");
  }

  validateResearchBrief(request.input);
  const decisions = simulatedRunTools.map((tool) => ({
    tool,
    decision: evaluateToolIntent({ tool, initiatedBy: "agent", payload: {} }),
  }));

  if (decisions.some(({ decision }) => decision.disposition !== "allow")) {
    throw new Error(`${salesResearchRole.name} was blocked by the workspace tool policy.`);
  }

  const result = runMockResearch(request.input);
  return {
    result,
    checkpoint: createCheckpoint("completed", 1, decisions.length),
    decisions,
  };
}

import type { AgentToolName, GuardDecision, ToolIntent, ToolTier } from "@/contracts/agent";

const toolTiers: Record<AgentToolName, ToolTier> = {
  search_companies: "mock_read",
  search_people: "mock_read",
  get_account_evidence: "mock_read",
  compute_score: "deterministic",
  build_today_plan: "deterministic",
  save_shortlist: "ano_state",
  dismiss_candidate: "ano_state",
  mark_for_review: "ano_state",
  get_mercury_lead: "mercury_read",
  get_mercury_activity: "mercury_read",
  get_campaign_context: "mercury_read",
  provider_search: "provider_credit",
  provider_enrich_contact: "provider_credit",
  propose_mercury_task: "mercury_proposal",
  propose_mercury_draft: "mercury_proposal",
  propose_mercury_update: "mercury_proposal",
};

export const DEFAULT_RESEARCH_LIMITS = {
  maxToolCalls: 8,
  maxTurns: 6,
  maxEvidenceItems: 18,
  maxClarifications: 2,
  maxElapsedMs: 45_000,
} as const;

function denied(reason: string): GuardDecision {
  return { disposition: "deny", reason, auditLabel: "policy.denied" };
}

export function getToolTier(tool: string): ToolTier | null {
  return Object.prototype.hasOwnProperty.call(toolTiers, tool) ? toolTiers[tool as AgentToolName] : null;
}

/**
 * The policy layer is authoritative. A future model may request a tool, but it
 * cannot override this decision or introduce a tool absent from the registry.
 */
export function evaluateToolIntent(intent: ToolIntent): GuardDecision {
  const tier = getToolTier(intent.tool);
  if (!tier) return denied("This tool is not in Ano’s allowlist.");

  if (tier === "mock_read" || tier === "deterministic") {
    return { disposition: "allow", reason: "Safe, no-credit Phase 1 tool.", auditLabel: "policy.allowed" };
  }

  if (tier === "ano_state") {
    return intent.initiatedBy === "user"
      ? { disposition: "allow", reason: "User-initiated Ano state change.", auditLabel: "policy.allowed" }
      : { disposition: "ask", reason: "Ano state changes require an explicit user decision.", auditLabel: "policy.approval_required" };
  }

  if (tier === "provider_credit") {
    return { disposition: "ask", reason: "Provider actions require a workspace budget check and a user approval.", auditLabel: "policy.approval_required" };
  }

  if (tier === "mercury_proposal") {
    return { disposition: "ask", reason: "Ano may create a reviewable proposal but cannot write to Mercury.", auditLabel: "policy.proposal_required" };
  }

  return denied("Mercury read access is unavailable until the read-only connector phase is enabled.");
}

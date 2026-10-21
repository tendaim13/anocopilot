import type { AgentToolName, ToolTier } from "@/contracts/agent";

export type ToolDefinition = {
  name: AgentToolName;
  tier: ToolTier;
  description: string;
};

export const toolRegistry: ToolDefinition[] = [
  { name: "search_companies", tier: "mock_read", description: "Find simulated accounts matching an ICP." },
  { name: "search_people", tier: "mock_read", description: "Find simulated role-aligned contacts." },
  { name: "get_account_evidence", tier: "mock_read", description: "Collect attributable account observations." },
  { name: "compute_score", tier: "deterministic", description: "Apply the versioned deterministic score." },
  { name: "build_today_plan", tier: "deterministic", description: "Create Ano-owned proposed work items." },
  { name: "save_shortlist", tier: "ano_state", description: "Save a user-approved shortlist state." },
  { name: "dismiss_candidate", tier: "ano_state", description: "Save a user-approved dismissal." },
  { name: "mark_for_review", tier: "ano_state", description: "Save a user-approved review-later state." },
  { name: "get_mercury_lead", tier: "mercury_read", description: "Future read-only Mercury lead context." },
  { name: "get_mercury_activity", tier: "mercury_read", description: "Future read-only Mercury activity context." },
  { name: "get_campaign_context", tier: "mercury_read", description: "Future read-only Mercury campaign context." },
  { name: "provider_search", tier: "provider_credit", description: "Future budgeted provider discovery." },
  { name: "provider_enrich_contact", tier: "provider_credit", description: "Future budgeted provider enrichment." },
  { name: "propose_mercury_task", tier: "mercury_proposal", description: "Future reviewable Mercury task proposal." },
  { name: "propose_mercury_draft", tier: "mercury_proposal", description: "Future reviewable Mercury email draft proposal." },
  { name: "propose_mercury_update", tier: "mercury_proposal", description: "Future reviewable Mercury update proposal." },
];

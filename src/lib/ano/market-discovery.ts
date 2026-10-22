import { z } from "zod";

const optionalText = z.string().trim().max(2_000).optional().default("");

/**
 * Phase A begins with a product brief, not an ICP. Only the offer and the
 * user's outcome are required; every market detail is a hypothesis input.
 */
export const productBriefInputSchema = z.object({
  offer: z.string().trim().refine((value) => value.length > 0, "Describe what you sell."),
  objective: z.string().trim().refine((value) => value.length > 0, "Describe what you want to achieve."),
  marketHunch: optionalText,
  locationPreference: optionalText,
  buyerHunch: optionalText,
  customerExamples: optionalText,
  exclusions: optionalText,
  additionalContext: optionalText,
});

export type ProductBriefInput = z.infer<typeof productBriefInputSchema>;

export type BriefEvidence = {
  id: string;
  label: string;
  observation: string;
  source: "workspace_input";
};

export type MarketHypothesis = {
  id: string;
  title: string;
  statement: string;
  evidenceIds: string[];
  origin?: "bedrock" | "workspace_member";
  editedAt?: string;
};

export type MarketRunState =
  | "awaiting_scope_decision"
  | "awaiting_location_input"
  | "awaiting_market_evidence"
  | "market_scope_locked"
  | "awaiting_provider_approval"
  | "provider_unavailable";

export type MarketScope = {
  state: MarketRunState;
  kind: "location" | "compare" | "open" | "unselected";
  locations: string[];
  source: "workspace_input" | "workspace_decision" | "none";
  summary: string;
};

export type ProviderReadiness = {
  key: "prospeo";
  state: "disabled" | "ready" | "error";
  message: string;
  action: "none" | "check_connection" | "create_preview";
  checkedAt?: string;
  lastErrorCode?: string;
};

export type MarketAuditEvent = {
  id: string;
  at: string;
  label: string;
  detail: string;
  category: "input" | "hypothesis" | "decision" | "boundary";
};

/** Contracts used in later phases; Phase B intentionally does not populate candidates or playbooks. */
export type MarketScan = {
  id: string;
  scope: MarketScope;
  status: "not_started" | "awaiting_provider_approval" | "blocked_provider" | "preview_ready" | "search_in_progress" | "completed" | "requires_manual_review";
  evidenceIds: string[];
  comparisonCriteria: string[];
};

export type CompanyCandidate = {
  id: string;
  source: "provider";
  retrievedAt: string;
  name: string;
  matchingSignals: string[];
  evidenceIds: string[];
  industry?: string;
  location?: string;
  employeeBand?: string;
  website?: string;
  lifecycleState?: "discovered" | "shortlisted" | "dismissed" | "review";
};

export type CompanyDiscoverySearch = {
  id: string;
  status: "awaiting_approval" | "running" | "completed" | "requires_manual_review" | "failed";
  requestedAt: string;
  approvedAt?: string;
  completedAt?: string;
  scope: string[];
  criteria: string[];
  maximumResults: 25;
  estimatedMaximumCredits: 1;
  estimateDetail: string;
  providerFilters: Record<string, unknown>;
  canonicalLocations: string[];
  resultCount?: number;
  wasFree?: boolean;
  failureMessage?: string;
};

export type SalesPlaybook = {
  id: string;
  status: "draft" | "ready_for_review";
  industryHypotheses: string[];
  companyEvidenceIds: string[];
  contactEvidenceIds: string[];
};

export type LocationDecision = {
  id: string;
  type: "confirm_preference" | "choose_research_path";
  prompt: string;
  options: Array<{
    key: "lock_location" | "compare_markets" | "set_preference" | "continue_without_location";
    label: string;
    description: string;
  }>;
  status: "awaiting_choice" | "selected";
  selection?: string;
};

export type MarketBriefResult = {
  run: {
    id: string;
    status: MarketRunState;
    mode: "bedrock";
    message: string;
    modelTurns: number;
  };
  productBrief: {
    id: string;
    offer: string;
    objective: string;
  };
  evidence: BriefEvidence[];
  hypothesis: {
    marketMap: string;
    hypotheses: MarketHypothesis[];
    assumptions: string[];
    questions: string[];
  };
  locationDecision: LocationDecision;
  scope: MarketScope;
  scan: MarketScan;
  provider: ProviderReadiness;
  companyDiscovery?: {
    search?: CompanyDiscoverySearch;
    candidates: CompanyCandidate[];
  };
  timeline: MarketAuditEvent[];
};

export const marketDecisionInputSchema = z.object({
  choice: z.enum(["lock_location", "compare_markets", "set_preference", "continue_without_location"]),
});

export type MarketDecisionInput = z.infer<typeof marketDecisionInputSchema>;

export const marketScopeInputSchema = z.object({
  location: z.string().trim().refine((value) => value.length > 0, "Add a location before locking the scope."),
});

export type MarketScopeInput = z.infer<typeof marketScopeInputSchema>;

export const marketHypothesisPatchSchema = z.object({
  hypotheses: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    title: z.string().trim().refine((value) => value.length > 0, "A hypothesis needs a title."),
    statement: z.string().trim().refine((value) => value.length > 0, "A hypothesis needs a statement."),
    evidenceIds: z.array(z.string().trim().regex(/^B-\d{3}$/)).min(1).max(4),
  })).min(1).max(4),
});

export type MarketHypothesisPatch = z.infer<typeof marketHypothesisPatchSchema>;

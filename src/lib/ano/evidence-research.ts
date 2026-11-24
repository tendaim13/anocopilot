import { z } from "zod";

const conciseText = z.string().trim().min(1).max(1_000);
const sourceExcerpt = z.string().trim().min(1).max(1_200);

export const MAX_ITERATIVE_RESEARCH_WAVES = 8;
export const DEFAULT_ITERATIVE_MAX_SEARCHES = 50;
export const DEFAULT_ITERATIVE_MAX_FETCHES = 100;

export const sourceProvenanceSchema = z.enum([
  "public_web",
  "comparable_evidence",
  "workspace_supplied",
]);
export type SourceProvenance = z.infer<typeof sourceProvenanceSchema>;

export const sourceEvidenceRoleSchema = z.enum([
  "direct_evidence",
  "comparable_evidence",
  "contextual_counter_only",
  "non_qualifying",
]);
export type SourceEvidenceRole = z.infer<typeof sourceEvidenceRoleSchema>;

/** Historical Tavily rows remain readable; all new Phase B runs use SearXNG. */
export const researchProviderKeySchema = z.enum(["tavily", "searxng"]);
export type ResearchProviderKey = z.infer<typeof researchProviderKeySchema>;

export const evidenceResearchStatusSchema = z.enum([
  "awaiting_provider_approval",
  "running",
  "sources_ready",
  "requires_manual_review",
  "failed_safe",
]);
export type EvidenceResearchStatus = z.infer<typeof evidenceResearchStatusSchema>;

export const providerActionStatusSchema = z.enum([
  "awaiting_approval",
  "running",
  "succeeded",
  "failed_safe",
  "requires_manual_review",
]);

export const researchQuerySchema = z.object({
  id: z.string().uuid(),
  query: conciseText.min(3).max(380),
  reason: conciseText.max(320),
  sourceClass: z.enum([
    "Government and official statistics",
    "Industry bodies and primary research",
    "Public company reports and filings",
    "Independent reporting",
  ]),
  candidateMarket: conciseText.max(140).nullable().optional(),
  comparisonDimension: z.enum([
    "problem_urgency",
    "market_density",
    "buyer_conditions",
    "market_access",
    "solution_fit",
    "counter_evidence",
  ]).optional(),
  priority: z.number().int().min(1).max(100).optional(),
  waveNumber: z.number().int().min(1).max(8).optional(),
});
export type ResearchQuery = z.infer<typeof researchQuerySchema>;

export const researchQueryPlanSchema = z.object({
  queries: z.array(researchQuerySchema).min(1).max(12),
});
export type ResearchQueryPlan = z.infer<typeof researchQueryPlanSchema>;

export const evidenceResearchSourceSchema = z.object({
  id: z.string().uuid(),
  title: conciseText.max(500),
  url: z.string().url(),
  sourceClass: z.enum(["official", "academic", "industry", "company", "vendor", "independent", "other"]),
  sourceProvenance: sourceProvenanceSchema.optional(),
  evidenceRole: sourceEvidenceRoleSchema.optional(),
  rootDomain: z.string().trim().max(255).nullable().optional(),
  isSyndicatedDuplicate: z.boolean().optional(),
  excerpt: sourceExcerpt.nullable(),
  publishedAt: z.string().datetime().nullable(),
  retrievedAt: z.string().datetime(),
  status: z.enum(["fetched", "failed_safe", "rejected"]),
});
export type EvidenceResearchSource = z.infer<typeof evidenceResearchSourceSchema>;

export function resolveSourceProvenance(
  source: Pick<EvidenceResearchSource, "url" | "sourceProvenance">,
): SourceProvenance {
  if (
    source.url.startsWith("https://product-brief.ano.local/") ||
    source.url.startsWith("autopilot-product-seed:")
  ) {
    return "workspace_supplied";
  }
  if (source.sourceProvenance) return source.sourceProvenance;
  return "public_web";
}

export function formatSourceProvenanceLabel(provenance: SourceProvenance): string {
  switch (provenance) {
    case "workspace_supplied":
      return "Workspace supplied";
    case "comparable_evidence":
      return "Comparable evidence";
    case "public_web":
      return "Public web";
  }
}

export const evidenceResearchActionSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["research_run", "search", "fetch"]),
  status: providerActionStatusSchema,
  description: conciseText.max(500),
  maximumOperations: z.number().int().min(0).max(150),
  reportedCredits: z.number().nonnegative().nullable(),
  createdAt: z.string().datetime(),
});

export const evidenceResearchRunSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  threadId: z.string().min(1).max(300),
  attemptNumber: z.number().int().positive(),
  provider: researchProviderKeySchema,
  status: evidenceResearchStatusSchema,
  maximumSearches: z.number().int().min(1).max(50),
  maximumFetches: z.number().int().min(1).max(100),
  consumedSearches: z.number().int().min(0).default(0),
  consumedFetches: z.number().int().min(0).default(0),
  currentWave: z.number().int().min(0).default(0),
  sourceCount: z.number().int().min(0),
  publicSourceCount: z.number().int().min(0).optional(),
  comparableSourceCount: z.number().int().min(0).optional(),
  workspaceSourceCount: z.number().int().min(0).optional(),
  failureMessage: conciseText.max(600).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const evidenceResearchViewSchema = z.object({
  run: evidenceResearchRunSchema,
  actions: z.array(evidenceResearchActionSchema),
  queries: z.array(researchQuerySchema),
  sources: z.array(evidenceResearchSourceSchema),
});
export type EvidenceResearchView = z.infer<typeof evidenceResearchViewSchema>;


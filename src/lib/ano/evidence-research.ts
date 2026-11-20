import { z } from "zod";

const conciseText = z.string().trim().min(1).max(1_000);
const sourceExcerpt = z.string().trim().min(1).max(1_200);

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
  excerpt: sourceExcerpt.nullable(),
  publishedAt: z.string().datetime().nullable(),
  retrievedAt: z.string().datetime(),
  status: z.enum(["fetched", "failed_safe", "rejected"]),
});
export type EvidenceResearchSource = z.infer<typeof evidenceResearchSourceSchema>;

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


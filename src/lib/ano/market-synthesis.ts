import { z } from "zod";

const shortText = z.string().trim().min(1).max(700);
const listText = z.string().trim().min(1).max(280);
const identifier = z.string().uuid();

export const claimKindSchema = z.enum(["observation", "comparable", "inference", "hypothesis", "uncertainty"]);
export type ClaimKind = z.infer<typeof claimKindSchema>;

export const evidenceStrengthSchema = z.enum(["strong", "moderate", "limited", "insufficient"]);
export type EvidenceStrength = z.infer<typeof evidenceStrengthSchema>;

export const synthesisStatusSchema = z.enum([
  "awaiting_analysis",
  "running",
  "ready_for_decision",
  "ready_for_review",
  "insufficient_evidence",
  "requires_manual_review",
  "failed_safe",
]);
export type SynthesisStatus = z.infer<typeof synthesisStatusSchema>;

export const recommendationModeSchema = z.enum([
  "pending",
  "directly_supported",
  "comparative_inference",
  "exploratory",
  "no_usable_evidence",
]);
export type RecommendationMode = z.infer<typeof recommendationModeSchema>;

export const researchClaimSchema = z.object({
  id: identifier,
  kind: claimKindSchema,
  statement: shortText,
  sourceIds: z.array(identifier).min(1).max(6),
  comparisonBasis: z.string().trim().min(1).max(280).nullable(),
  evidenceStrength: evidenceStrengthSchema,
  citationStatus: z.enum(["supported", "limited", "needs_review"]),
});
export type ResearchClaim = z.infer<typeof researchClaimSchema>;

export const marketProfileSchema = z.object({
  id: identifier,
  name: listText.max(140),
  summary: shortText,
  evidenceStrength: evidenceStrengthSchema,
  claimIds: z.array(identifier).min(1).max(8),
  unknowns: z.array(listText).max(5),
  nextResearchActions: z.array(listText).max(4),
});
export type MarketProfile = z.infer<typeof marketProfileSchema>;

export const industryProfileSchema = z.object({
  id: identifier,
  marketProfileId: identifier.nullable(),
  name: listText.max(140),
  summary: shortText,
  operationalProblems: z.array(listText).min(1).max(5),
  solutionFit: z.array(listText).min(1).max(4),
  buyerRoleHypotheses: z.array(listText).min(1).max(5),
  evidenceStrength: evidenceStrengthSchema,
  claimIds: z.array(identifier).min(1).max(8),
  unknowns: z.array(listText).max(5),
});
export type IndustryProfile = z.infer<typeof industryProfileSchema>;

export const evidenceAssessmentSchema = z.object({
  fetchedSourceCount: z.number().int().min(0),
  sourceClassCount: z.number().int().min(0),
  coverageStrength: evidenceStrengthSchema,
  comparisonReady: z.boolean(),
  contradictions: z.array(listText).max(5),
  gaps: z.array(listText).max(6),
  summary: shortText,
});
export type EvidenceAssessment = z.infer<typeof evidenceAssessmentSchema>;

export const targetDecisionSchema = z.object({
  id: identifier,
  status: z.enum(["awaiting_selection", "locked", "rejected"]),
  marketProfileId: identifier.nullable(),
  industryProfileId: identifier.nullable(),
  rationale: shortText.nullable(),
  selectedAt: z.string().datetime().nullable(),
});
export type TargetDecision = z.infer<typeof targetDecisionSchema>;

export const marketSynthesisSchema = z.object({
  id: identifier,
  conversationId: identifier,
  researchRunId: identifier,
  status: synthesisStatusSchema,
  recommendationMode: recommendationModeSchema,
  assessment: evidenceAssessmentSchema,
  claims: z.array(researchClaimSchema).max(24),
  markets: z.array(marketProfileSchema).max(5),
  industries: z.array(industryProfileSchema).max(10),
  decision: targetDecisionSchema.nullable(),
  failureMessage: shortText.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MarketSynthesis = z.infer<typeof marketSynthesisSchema>;

/** This is the only JSON shape Bedrock may return in Phase C. */
export const marketSynthesisDraftSchema = z.object({
  claims: z.array(researchClaimSchema).min(1).max(24),
  markets: z.array(marketProfileSchema).max(5),
  industries: z.array(industryProfileSchema).max(10),
  contradictions: z.array(listText).max(5),
  gaps: z.array(listText).max(6),
  summary: shortText,
});
export type MarketSynthesisDraft = z.infer<typeof marketSynthesisDraftSchema>;

export const lockTargetDecisionInputSchema = z.object({
  marketProfileId: identifier,
  industryProfileId: identifier,
  rationale: z.string().trim().max(700).optional(),
});
export type LockTargetDecisionInput = z.infer<typeof lockTargetDecisionInputSchema>;

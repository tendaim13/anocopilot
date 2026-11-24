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

export const evidenceGroupFindingSchema = z.object({
  kind: claimKindSchema,
  statement: shortText,
  sourceIds: z.array(identifier).min(1).max(12),
  comparisonBasis: z.string().trim().min(1).max(280).nullable(),
  evidenceStrength: evidenceStrengthSchema,
});
export type EvidenceGroupFinding = z.infer<typeof evidenceGroupFindingSchema>;

export const evidenceGroupSummarySchema = z.object({
  groupKey: z.string().trim().min(1).max(180),
  market: listText.max(140),
  dimension: z.string().trim().min(1).max(80),
  sourceIds: z.array(identifier).min(1).max(100),
  sourceCount: z.number().int().min(1),
  directEvidenceCount: z.number().int().min(0),
  comparableEvidenceCount: z.number().int().min(0),
  vendorContextCount: z.number().int().min(0),
  workspaceSuppliedCount: z.number().int().min(0),
  summary: shortText,
  findings: z.array(evidenceGroupFindingSchema).max(12),
  assumptions: z.array(listText).max(6),
  unknowns: z.array(listText).max(6),
  contradictions: z.array(listText).max(5),
  evidenceStrength: evidenceStrengthSchema,
});
export type EvidenceGroupSummary = z.infer<typeof evidenceGroupSummarySchema>;

export const synthesisReportEvidenceItemSchema = z.object({
  claimId: identifier.optional(),
  statement: shortText,
  sourceIds: z.array(identifier).min(1).max(12),
  evidenceStrength: evidenceStrengthSchema,
  comparisonBasis: z.string().trim().min(1).max(280).nullable().optional(),
});
export type SynthesisReportEvidenceItem = z.infer<typeof synthesisReportEvidenceItemSchema>;

export const synthesisConfidenceSchema = z.object({
  level: evidenceStrengthSchema,
  rationale: shortText,
  totalSourcesAnalyzed: z.number().int().min(0),
  groupsAnalyzed: z.number().int().min(0),
  directEvidenceCount: z.number().int().min(0),
  comparableEvidenceCount: z.number().int().min(0),
});
export type SynthesisConfidence = z.infer<typeof synthesisConfidenceSchema>;

export const synthesisReportSchema = z.object({
  recommendation: z.object({
    headline: shortText.max(240),
    summary: shortText,
    recommendedMarket: listText.max(140).nullable(),
    recommendedIndustry: listText.max(140).nullable(),
    mode: recommendationModeSchema,
  }),
  evidence: z.array(synthesisReportEvidenceItemSchema).max(24),
  comparableEvidence: z.array(synthesisReportEvidenceItemSchema).max(24),
  assumptions: z.array(listText).max(10),
  unknowns: z.array(listText).max(12),
  confidence: synthesisConfidenceSchema,
  nextValidationActions: z.array(listText).max(10),
});
export type SynthesisReport = z.infer<typeof synthesisReportSchema>;

export const evidenceAssessmentSchema = z.object({
  fetchedSourceCount: z.number().int().min(0),
  sourceClassCount: z.number().int().min(0),
  coverageStrength: evidenceStrengthSchema,
  comparisonReady: z.boolean(),
  contradictions: z.array(listText).max(5),
  gaps: z.array(listText).max(6),
  summary: shortText,
  sourcesAnalyzedCount: z.number().int().min(0).optional(),
  evidenceGroupCount: z.number().int().min(0).optional(),
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
  groupSummaries: z.array(evidenceGroupSummarySchema).max(40).optional(),
  report: synthesisReportSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MarketSynthesis = z.infer<typeof marketSynthesisSchema>;

/** This is the only JSON shape returned from evidence synthesis. */
export const marketSynthesisDraftSchema = z.object({
  claims: z.array(researchClaimSchema).min(1).max(24),
  markets: z.array(marketProfileSchema).max(5),
  industries: z.array(industryProfileSchema).max(10),
  contradictions: z.array(listText).max(5),
  gaps: z.array(listText).max(6),
  summary: shortText,
  assumptions: z.array(listText).max(10).optional(),
  nextValidationActions: z.array(listText).max(10).optional(),
  confidenceRationale: shortText.nullable().optional(),
  groupSummaries: z.array(evidenceGroupSummarySchema).max(40).optional(),
  report: synthesisReportSchema.optional(),
});
export type MarketSynthesisDraft = z.infer<typeof marketSynthesisDraftSchema>;

export const lockTargetDecisionInputSchema = z.object({
  marketProfileId: identifier,
  industryProfileId: identifier,
  rationale: z.string().trim().max(700).optional(),
});
export type LockTargetDecisionInput = z.infer<typeof lockTargetDecisionInputSchema>;

function cleanClippedList(items: Array<string | null | undefined>, maxItems: number, maxLen: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const cleaned = item.replace(/\u0000/g, "").trim().replace(/\s+/g, " ").slice(0, maxLen);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanClip(value: string | null | undefined, maxLen: number, fallback: string): string {
  if (typeof value !== "string") return fallback.slice(0, maxLen);
  const cleaned = value.replace(/\u0000/g, "").trim().replace(/\s+/g, " ").slice(0, maxLen);
  return cleaned || fallback.slice(0, maxLen);
}

function dedupeEvidenceItems(items: SynthesisReportEvidenceItem[], maxItems: number): SynthesisReportEvidenceItem[] {
  const seen = new Set<string>();
  const out: SynthesisReportEvidenceItem[] = [];
  for (const item of items) {
    const key = item.statement.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const sourceIds = Array.from(new Set(item.sourceIds)).slice(0, 12);
    if (!sourceIds.length) continue;
    out.push({
      ...item,
      statement: cleanClip(item.statement, 700, item.statement),
      sourceIds,
      comparisonBasis:
        item.comparisonBasis !== undefined
          ? item.comparisonBasis
            ? cleanClip(item.comparisonBasis, 280, item.comparisonBasis)
            : null
          : undefined,
    });
    if (out.length >= maxItems) break;
  }
  return out;
}

export function buildStructuredSynthesisReport(input: {
  draft: MarketSynthesisDraft | null;
  assessment: EvidenceAssessment;
  recommendationMode: RecommendationMode;
  groupSummaries?: EvidenceGroupSummary[];
  totalSourcesAnalyzed?: number;
  directEvidenceCount?: number;
  comparableEvidenceCount?: number;
}): SynthesisReport {
  const groupSummaries = input.groupSummaries ?? input.draft?.groupSummaries ?? [];
  const totalSourcesAnalyzed =
    input.totalSourcesAnalyzed ??
    input.assessment.sourcesAnalyzedCount ??
    input.assessment.fetchedSourceCount;

  const groupDirectCount = groupSummaries.reduce((sum, g) => sum + g.directEvidenceCount, 0);
  const groupComparableCount = groupSummaries.reduce((sum, g) => sum + g.comparableEvidenceCount, 0);

  const claimObservations: SynthesisReportEvidenceItem[] = (input.draft?.claims ?? [])
    .filter((claim) => claim.kind === "observation")
    .map((claim) => ({
      claimId: claim.id,
      statement: claim.statement,
      sourceIds: claim.sourceIds,
      evidenceStrength: claim.evidenceStrength,
      comparisonBasis: null,
    }));

  const groupObservations: SynthesisReportEvidenceItem[] = groupSummaries.flatMap((group) =>
    group.findings
      .filter((finding) => finding.kind === "observation")
      .map((finding) => ({
        statement: finding.statement,
        sourceIds: finding.sourceIds,
        evidenceStrength: finding.evidenceStrength,
        comparisonBasis: null,
      })),
  );

  const evidence = dedupeEvidenceItems(
    claimObservations.length > 0 ? claimObservations : groupObservations,
    24,
  );

  const claimComparable: SynthesisReportEvidenceItem[] = (input.draft?.claims ?? [])
    .filter((claim) => claim.kind === "comparable")
    .map((claim) => ({
      claimId: claim.id,
      statement: claim.statement,
      sourceIds: claim.sourceIds,
      evidenceStrength: claim.evidenceStrength,
      comparisonBasis:
        claim.comparisonBasis ?? "Comparable signal from an adjacent market or operating model.",
    }));

  const groupComparable: SynthesisReportEvidenceItem[] = groupSummaries.flatMap((group) =>
    group.findings
      .filter((finding) => finding.kind === "comparable")
      .map((finding) => ({
        statement: finding.statement,
        sourceIds: finding.sourceIds,
        evidenceStrength: finding.evidenceStrength,
        comparisonBasis:
          finding.comparisonBasis ?? "Comparable signal from an adjacent market or operating model.",
      })),
  );

  const comparableEvidence = dedupeEvidenceItems(
    [...claimComparable, ...groupComparable],
    24,
  );

  const primaryMarket = input.draft?.markets[0] ?? null;
  const primaryIndustry =
    input.draft?.industries.find(
      (industry) => !primaryMarket || !industry.marketProfileId || industry.marketProfileId === primaryMarket.id,
    ) ??
    input.draft?.industries[0] ??
    null;

  const recommendedMarket = primaryMarket ? cleanClip(primaryMarket.name, 140, primaryMarket.name) : null;
  const recommendedIndustry = primaryIndustry ? cleanClip(primaryIndustry.name, 140, primaryIndustry.name) : null;

  const headline =
    input.recommendationMode === "no_usable_evidence"
      ? "No usable public evidence was found for this question."
      : recommendedMarket && recommendedIndustry
        ? `Start by testing ${recommendedMarket} · ${recommendedIndustry}`
        : recommendedMarket
          ? `Start by testing ${recommendedMarket}`
          : "Useful context found; validate target route hypotheses next";

  const summary = cleanClip(
    input.draft?.summary ?? input.assessment.summary,
    700,
    input.assessment.summary,
  );

  const rawAssumptions = cleanClippedList(
    [
      ...(input.draft?.assumptions ?? []),
      ...groupSummaries.flatMap((group) => group.assumptions),
      ...(input.draft?.claims ?? [])
        .filter((claim) => claim.kind === "inference" || claim.kind === "hypothesis")
        .map((claim) => claim.statement),
    ],
    10,
    280,
  );

  const assumptions =
    rawAssumptions.length > 0
      ? rawAssumptions
      : input.recommendationMode !== "no_usable_evidence"
        ? [
            "Initial segment prioritization assumes buyers match cited operational bottlenecks and respond to direct outreach.",
          ]
        : [];

  const unknowns = cleanClippedList(
    [
      ...input.assessment.gaps,
      ...(input.draft?.gaps ?? []),
      ...(input.draft?.markets.flatMap((m) => m.unknowns) ?? []),
      ...(input.draft?.industries.flatMap((i) => i.unknowns) ?? []),
      ...groupSummaries.flatMap((g) => g.unknowns),
      ...(input.draft?.claims ?? [])
        .filter((claim) => claim.kind === "uncertainty")
        .map((claim) => claim.statement),
    ],
    12,
    280,
  );

  const rawNextActions = cleanClippedList(
    [
      ...(input.draft?.nextValidationActions ?? []),
      ...(input.draft?.markets.flatMap((m) => m.nextResearchActions) ?? []),
    ],
    10,
    280,
  );

  const nextValidationActions =
    rawNextActions.length > 0
      ? rawNextActions
      : input.recommendationMode === "no_usable_evidence"
        ? [
            "Refine product description or target geography hints and run an updated public evidence scan.",
          ]
        : unknowns.length > 0
          ? unknowns.slice(0, 3).map((gap) => cleanClip(`Validate open question: ${gap}`, 280, gap))
          : ["Lock a candidate route to discover matching target accounts and verify buyer demand."];

  const directEvidenceCount = input.directEvidenceCount ?? Math.max(evidence.length, groupDirectCount);
  const comparableCount =
    input.comparableEvidenceCount ?? Math.max(comparableEvidence.length, groupComparableCount);

  const defaultRationale =
    input.recommendationMode === "no_usable_evidence"
      ? "No usable external evidence sources were available to score market confidence."
      : `Confidence is ${input.assessment.coverageStrength} across ${totalSourcesAnalyzed} analyzed source${totalSourcesAnalyzed === 1 ? "" : "s"} in ${groupSummaries.length} evidence group${groupSummaries.length === 1 ? "" : "s"} (${directEvidenceCount} direct, ${comparableCount} comparable).`;

  const confidence: SynthesisConfidence = {
    level: input.assessment.coverageStrength,
    rationale: cleanClip(input.draft?.confidenceRationale ?? defaultRationale, 700, defaultRationale),
    totalSourcesAnalyzed,
    groupsAnalyzed: groupSummaries.length,
    directEvidenceCount,
    comparableEvidenceCount: comparableCount,
  };

  return synthesisReportSchema.parse({
    recommendation: {
      headline: cleanClip(headline, 240, headline),
      summary,
      recommendedMarket,
      recommendedIndustry,
      mode: input.recommendationMode,
    },
    evidence,
    comparableEvidence,
    assumptions,
    unknowns,
    confidence,
    nextValidationActions,
  });
}

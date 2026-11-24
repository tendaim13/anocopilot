import { z } from "zod";

import type { AccountCandidateDossier } from "./company-discovery";
import type {
  EvidenceStrength,
  IndustryProfile,
  MarketProfile,
  MarketSynthesis,
} from "./market-synthesis";
import type { OutreachTemplatePackView } from "./outreach-templates";
import type { ContactCandidateView } from "./people-playbooks";
import {
  formatDisplayErrorMessage,
  maskVendorNamesForDisplay,
  type ResearchBrief,
} from "./research-conversation";

export const AUTOPILOT_STAGES = [
  "brief_and_plan",
  "market_research",
  "synthesis_and_lock",
  "company_discovery",
  "people_and_emails",
  "outreach_templates",
] as const;

export const autopilotExecutableStageSchema = z.enum(AUTOPILOT_STAGES);
export type AutopilotExecutableStage = z.infer<typeof autopilotExecutableStageSchema>;

export const autopilotStageSchema = z.enum([...AUTOPILOT_STAGES, "done"]);
export type AutopilotStage = z.infer<typeof autopilotStageSchema>;

export const autopilotStatusSchema = z.enum([
  "idle",
  "running",
  "paused",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
]);
export type AutopilotStatus = z.infer<typeof autopilotStatusSchema>;

export const autopilotStageSummarySchema = z.object({
  stage: autopilotExecutableStageSchema,
  status: z.enum(["completed", "completed_with_warnings", "skipped"]),
  headline: z.string().trim().min(1).max(240),
  detail: z.string().trim().min(1).max(1_000),
  metrics: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  warnings: z.array(z.string().trim().min(1).max(400)).max(10).default([]),
  completedAt: z.string().datetime(),
});
export type AutopilotStageSummary = z.infer<typeof autopilotStageSummarySchema>;

export const DEFAULT_AUTOPILOT_AUTHORITY_SCOPE = {
  maxPublicSearches: 50,
  maxSourceFetches: 100,
  maxCompanyCandidates: 25,
  maxNamedContactEnrichments: 10,
  allowOutboundEmailSend: false,
  allowPhoneCalls: false,
  allowCrmWrites: false,
} as const;

export const autopilotAuthorityScopeSchema = z.object({
  maxPublicSearches: z.number().int().min(1).max(50).default(DEFAULT_AUTOPILOT_AUTHORITY_SCOPE.maxPublicSearches),
  maxSourceFetches: z.number().int().min(1).max(100).default(DEFAULT_AUTOPILOT_AUTHORITY_SCOPE.maxSourceFetches),
  maxCompanyCandidates: z.number().int().min(1).max(25).default(DEFAULT_AUTOPILOT_AUTHORITY_SCOPE.maxCompanyCandidates),
  maxNamedContactEnrichments: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(DEFAULT_AUTOPILOT_AUTHORITY_SCOPE.maxNamedContactEnrichments),
  allowOutboundEmailSend: z.literal(false).default(false),
  allowPhoneCalls: z.literal(false).default(false),
  allowCrmWrites: z.literal(false).default(false),
});
export type AutopilotAuthorityScope = z.infer<typeof autopilotAuthorityScopeSchema>;

export function resolveAutopilotAuthorityScope(
  raw?: Partial<AutopilotAuthorityScope> | null,
): AutopilotAuthorityScope {
  const parsed = autopilotAuthorityScopeSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  return { ...DEFAULT_AUTOPILOT_AUTHORITY_SCOPE };
}

export const autopilotJobStatusSchema = z.enum([
  "queued",
  "leased",
  "completed",
  "paused",
  "cancelled",
  "failed",
]);
export type AutopilotJobStatus = z.infer<typeof autopilotJobStatusSchema>;

export const autopilotJobCheckpointSchema = z.object({
  currentStage: autopilotStageSchema.optional(),
  waveNumber: z.number().int().min(0).optional(),
  maxWaves: z.number().int().min(1).optional(),
  savedSources: z.number().int().min(0).optional(),
  progressDetail: z.string().trim().max(320).optional(),
  recovered: z.boolean().optional(),
});
export type AutopilotJobCheckpoint = z.infer<typeof autopilotJobCheckpointSchema>;

export const autopilotJobViewSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  autopilotRunId: z.string().uuid(),
  status: autopilotJobStatusSchema,
  fromStage: autopilotExecutableStageSchema.nullable().optional(),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  leaseExpiresAt: z.string().datetime().nullable().optional(),
  heartbeatAt: z.string().datetime().nullable().optional(),
  checkpoint: autopilotJobCheckpointSchema.default({}),
  outcomeNote: z.string().trim().max(400).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AutopilotJobView = z.infer<typeof autopilotJobViewSchema>;

export const autopilotRunViewSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  status: autopilotStatusSchema,
  currentStage: autopilotStageSchema,
  completedStages: z.array(autopilotExecutableStageSchema),
  stageSummaries: z
    .partialRecord(autopilotExecutableStageSchema, autopilotStageSummarySchema)
    .default({}),
  warnings: z.array(z.string().trim().min(1).max(400)).max(20).default([]),
  lastError: z.string().trim().max(600).nullable(),
  stageInFlight: z.boolean().default(false),
  leaseExpiresAt: z.string().datetime().nullable().optional(),
  activeJobId: z.string().uuid().nullable().optional(),
  recoveryCount: z.number().int().nonnegative().optional(),
  progressDetail: z.string().trim().max(320).nullable().optional(),
  authorityScope: autopilotAuthorityScopeSchema.optional(),
  authorizedAt: z.string().datetime().nullable().optional(),
  authorizedBy: z.string().uuid().nullable().optional(),
  heartbeatAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AutopilotRunView = z.infer<typeof autopilotRunViewSchema>;

export const autopilotStartRequestSchema = z.object({
  fromStage: autopilotExecutableStageSchema.optional(),
  explicitApproval: z.literal(true),
  authorityScope: autopilotAuthorityScopeSchema.optional(),
});
export type AutopilotStartRequest = z.infer<typeof autopilotStartRequestSchema>;

export const autopilotCancelRequestSchema = z.object({
  mode: z.enum(["paused", "cancelled"]).optional(),
});
export type AutopilotCancelRequest = z.infer<typeof autopilotCancelRequestSchema>;

export const AUTOPILOT_RERUN_SCOPES = [
  "companies_people_templates",
  "companies_and_people",
  "people_and_emails",
  "email_enrichment",
  "templates_only",
] as const;

export const autopilotRerunScopeSchema = z.enum(AUTOPILOT_RERUN_SCOPES);
export type AutopilotRerunScope = z.infer<typeof autopilotRerunScopeSchema>;

const RERUN_SCOPE_STAGES: Record<AutopilotRerunScope, AutopilotExecutableStage[]> = {
  companies_people_templates: ["company_discovery", "people_and_emails", "outreach_templates"],
  companies_and_people: ["company_discovery", "people_and_emails"],
  people_and_emails: ["people_and_emails"],
  email_enrichment: ["people_and_emails"],
  templates_only: ["outreach_templates"],
};

export function stagesForAutopilotRerunScope(
  scope: AutopilotRerunScope,
): AutopilotExecutableStage[] {
  return [...RERUN_SCOPE_STAGES[scope]];
}

export function computePartialRerunState(
  existing: Pick<AutopilotRunView, "completedStages" | "stageSummaries">,
  stagesToRerun: readonly AutopilotExecutableStage[],
  completedStageSummary?: AutopilotStageSummary,
): {
  completedStages: AutopilotExecutableStage[];
  stageSummaries: Partial<Record<AutopilotExecutableStage, AutopilotStageSummary>>;
  warnings: string[];
  nextStage: AutopilotStage;
  nextStatus: Extract<AutopilotStatus, "running" | "completed" | "completed_with_warnings">;
} {
  const rerunSet = new Set<AutopilotExecutableStage>(stagesToRerun);
  const completedSet = new Set<AutopilotExecutableStage>(
    existing.completedStages.filter((stage) => !rerunSet.has(stage)),
  );
  const nextSummaries: Partial<Record<AutopilotExecutableStage, AutopilotStageSummary>> = {};

  for (const stage of AUTOPILOT_STAGES) {
    if (completedSet.has(stage) && existing.stageSummaries[stage]) {
      nextSummaries[stage] = existing.stageSummaries[stage];
    }
  }

  if (completedStageSummary) {
    completedSet.add(completedStageSummary.stage);
    nextSummaries[completedStageSummary.stage] = completedStageSummary;
  }

  const completedStages = AUTOPILOT_STAGES.filter((stage) => completedSet.has(stage));
  const warningSeen = new Set<string>();
  const warnings: string[] = [];
  for (const stage of completedStages) {
    const stageWarnings = nextSummaries[stage]?.warnings ?? [];
    for (const warning of stageWarnings) {
      const clean = warning.trim();
      if (!clean || warningSeen.has(clean)) continue;
      warningSeen.add(clean);
      warnings.push(clean);
    }
  }

  const nextStage = nextPendingAutopilotStage(completedStages);
  const nextStatus =
    nextStage === "done"
      ? warnings.length > 0
        ? "completed_with_warnings"
        : "completed"
      : "running";

  return {
    completedStages,
    stageSummaries: nextSummaries,
    warnings,
    nextStage,
    nextStatus,
  };
}

const INTERNAL_METRIC_KEY_PATTERN = /credit|cost|usd|token|price|billing|spend|budget/i;
const INTERNAL_CREDIT_VALUE_PATTERN =
  /\$[0-9]+(?:\.[0-9]+)?|\b\d+(?:\.\d+)?\s*(?:credits?|cr\/found|tokens?)\b/gi;

function scrubInternalTelemetryText(value: string): string {
  return value.replace(INTERNAL_CREDIT_VALUE_PATTERN, "").replace(/\s{2,}/g, " ").trim();
}

const TECHNICAL_ERROR_PATTERN =
  /\b(?:TypeError|SyntaxError|ReferenceError|RangeError|Error:|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EPIPE|UND_ERR_[A-Z_]+|fetch failed|socket hang up|postgres|pgrst\d*|\bsql\b|stage_lease_token|lease_token|autopilot_runs|autopilot_jobs|check_internal_usage_budget|brief_and_plan|market_research|synthesis_and_lock|company_discovery|people_and_emails|outreach_templates)\b|\bHTTP\s*[45]\d{2}\b|\bstatus\s*(?:code)?\s*[45]\d{2}\b|\bat\s+[A-Za-z0-9_$.<>]+\s*\([^)]+\)|\b(?:gemini-[0-9a-z.-]+|qwen[0-9a-z.:-]+|claude-[0-9a-z.-]+|anthropic\.[0-9a-z.:-]+)\b|\b[A-Z][A-Z0-9_]{2,}_(?:KEY|TOKEN|SECRET|URL|LIMIT|ID|MODE)\b/i;

const TRANSIENT_NETWORK_OR_QUOTA_PATTERN =
  /\b(?:timed?\s*out|timeout|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed|429|503|rate limit|high demand|overloaded|quota)\b/i;

const RAW_STAGE_DESCRIPTIONS: Record<AutopilotExecutableStage, string> = {
  brief_and_plan: "analyzing your product brief",
  market_research: "market research",
  synthesis_and_lock: "target market selection",
  company_discovery: "company matching",
  people_and_emails: "decision-maker and email lookup",
  outreach_templates: "outreach drafting",
};

export function describeAutopilotStageProgress(
  stage: AutopilotExecutableStage,
  detail?: {
    wave?: number;
    maxWaves?: number;
    savedSources?: number;
    recovered?: boolean;
  },
): string {
  const meta = AUTOPILOT_STAGE_METADATA.find((item) => item.stage === stage);
  const baseHint = meta?.activeHint ?? "Working on the next research milestone…";

  if (detail?.recovered) {
    return `Continuing from saved progress: ${baseHint}`;
  }

  if (stage === "market_research" && detail?.wave && detail.wave > 0) {
    const waveText = detail.maxWaves
      ? `wave ${detail.wave} of ${detail.maxWaves}`
      : `wave ${detail.wave}`;
    const sourceText =
      typeof detail.savedSources === "number" && detail.savedSources > 0
        ? ` · ${detail.savedSources} source${detail.savedSources === 1 ? "" : "s"} saved`
        : "";
    return `Collecting public market evidence (${waveText}${sourceText})…`;
  }

  return baseHint;
}

export function formatAutopilotOutcomeMessage(
  raw: unknown,
  options?: {
    stage?: AutopilotExecutableStage;
    kind?: "error" | "warning" | "progress";
    fallback?: string;
  },
): string {
  const stageLabel = options?.stage ? RAW_STAGE_DESCRIPTIONS[options.stage] : "this stage";
  const kind = options?.kind ?? "error";
  const rawMessage =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
        ? raw
        : "";
  const normalized = rawMessage.replace(/\s+/g, " ").trim();

  if (!normalized) {
    if (options?.fallback) return options.fallback;
    if (kind === "warning") {
      return `Some details during ${stageLabel} were unavailable; completed work is saved.`;
    }
    if (kind === "progress" && options?.stage) {
      return describeAutopilotStageProgress(options.stage);
    }
    return `Ano paused safely during ${stageLabel}. Completed stages are saved and ready to resume.`;
  }

  if (TECHNICAL_ERROR_PATTERN.test(normalized)) {
    if (options?.fallback) return options.fallback;
    if (kind === "warning") {
      return "External lookup was temporarily unavailable; saved progress is preserved.";
    }
    if (TRANSIENT_NETWORK_OR_QUOTA_PATTERN.test(normalized)) {
      return `Ano paused during ${stageLabel} because an external source took too long to respond. Completed stages are saved and ready to resume.`;
    }
    return `Ano paused safely during ${stageLabel}. Completed stages are saved and ready to resume.`;
  }

  const sanitized = scrubInternalTelemetryText(
    maskVendorNamesForDisplay(
      formatDisplayErrorMessage(
        normalized,
        options?.fallback ??
          `Ano paused safely during ${stageLabel}. Completed stages are saved and ready to resume.`,
      ),
    ),
  );

  if (!sanitized) {
    return (
      options?.fallback ??
      `Ano paused safely during ${stageLabel}. Completed stages are saved and ready to resume.`
    );
  }
  return sanitized.slice(0, 400);
}

export function sanitizeAutopilotStageSummariesForChat(run: AutopilotRunView): string {
  const lines: string[] = [
    `Autopilot status: ${run.status} (currentStage=${run.currentStage}, completed=${run.completedStages.join(", ") || "none"})`,
  ];

  for (const meta of AUTOPILOT_STAGE_METADATA) {
    const summary = run.stageSummaries[meta.stage];
    if (!summary) continue;

    const safeMetricParts: string[] = [];
    for (const [key, val] of Object.entries(summary.metrics ?? {})) {
      if (INTERNAL_METRIC_KEY_PATTERN.test(key)) continue;
      const safeVal =
        typeof val === "string" ? scrubInternalTelemetryText(val) : String(val);
      if (safeVal) {
        safeMetricParts.push(`${key}=${safeVal}`);
      }
    }

    const headline = scrubInternalTelemetryText(summary.headline);
    const detail = scrubInternalTelemetryText(summary.detail);
    const metricsSuffix =
      safeMetricParts.length > 0 ? ` [${safeMetricParts.join(", ")}]` : "";
    lines.push(
      `${meta.stepNumber}. ${meta.title} (${summary.status}): ${headline} — ${detail}${metricsSuffix}`,
    );
  }

  return lines.join("\n");
}

export function selectNextVerificationProvider(input: {
  requestedProvider?: "prospeo" | "dropcontact";
  lastRunProvider?: "prospeo" | "dropcontact" | null;
  prospeoAvailable: boolean;
  dropcontactAvailable: boolean;
}): "prospeo" | "dropcontact" | null {
  if (input.requestedProvider === "prospeo") {
    return input.prospeoAvailable ? "prospeo" : input.dropcontactAvailable ? "dropcontact" : null;
  }
  if (input.requestedProvider === "dropcontact") {
    return input.dropcontactAvailable ? "dropcontact" : input.prospeoAvailable ? "prospeo" : null;
  }
  if (input.lastRunProvider === "prospeo" && input.dropcontactAvailable) {
    return "dropcontact";
  }
  if (input.prospeoAvailable) {
    return "prospeo";
  }
  if (input.dropcontactAvailable) {
    return "dropcontact";
  }
  return null;
}

export function nextPendingAutopilotStage(
  completedStages: AutopilotExecutableStage[],
): AutopilotStage {
  const completed = new Set(completedStages);
  for (const stage of AUTOPILOT_STAGES) {
    if (!completed.has(stage)) {
      return stage;
    }
  }
  return "done";
}

export function stagesBefore(stage: AutopilotExecutableStage): AutopilotExecutableStage[] {
  const index = AUTOPILOT_STAGES.indexOf(stage);
  if (index <= 0) return [];
  return AUTOPILOT_STAGES.slice(0, index);
}

const OPEN_RECOMMENDATION_INTENT_REGEX =
  /recommend|best\s+market|suggest|open|anywhere|unsure|help\s+me\s+pick/i;

export function isOpenMarketRecommendationIntent(value: string): boolean {
  return OPEN_RECOMMENDATION_INTENT_REGEX.test(value.trim());
}

const EVIDENCE_STRENGTH_SCORE: Record<EvidenceStrength, number> = {
  strong: 16,
  moderate: 12,
  limited: 8,
  insufficient: 4,
};

function significantTokens(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !OPEN_RECOMMENDATION_INTENT_REGEX.test(token)),
    ),
  );
}

function explicitMarketMatchesCandidate(
  explicitMarkets: string[],
  market: MarketProfile,
): boolean {
  const haystack = `${market.name} ${market.summary}`.toLowerCase();
  for (const requested of explicitMarkets) {
    const normalized = requested.trim().toLowerCase();
    if (!normalized) continue;
    if (haystack.includes(normalized)) return true;
    const reqTokens = significantTokens(normalized);
    if (reqTokens.length > 0 && reqTokens.every((token) => haystack.includes(token))) {
      return true;
    }
  }
  return false;
}

export function selectAutopilotTargetRoute(
  synthesis: MarketSynthesis,
  brief: ResearchBrief | null,
): { market: MarketProfile; industry: IndustryProfile; rationale: string } | null {
  if (synthesis.markets.length === 0 || synthesis.industries.length === 0) {
    return null;
  }

  const explicitMarkets = (brief?.targetMarkets ?? []).filter(
    (entry) => entry.trim().length > 0 && !isOpenMarketRecommendationIntent(entry),
  );
  const briefTokens = significantTokens(
    [
      brief?.offer ?? "",
      brief?.goal ?? "",
      ...(brief?.marketHints ?? []),
      ...(brief?.buyerHints ?? []),
    ].join(" "),
  );

  let bestPair: {
    market: MarketProfile;
    industry: IndustryProfile;
    score: number;
    matchedExplicitMarket: boolean;
  } | null = null;

  for (const market of synthesis.markets) {
    const matchingIndustries = synthesis.industries.filter(
      (industry) => !industry.marketProfileId || industry.marketProfileId === market.id,
    );

    for (const industry of matchingIndustries) {
      const matchedExplicitMarket =
        explicitMarkets.length > 0 && explicitMarketMatchesCandidate(explicitMarkets, market);

      let score = 0;
      if (matchedExplicitMarket) {
        score += 60;
      }

      score += EVIDENCE_STRENGTH_SCORE[market.evidenceStrength];
      score += EVIDENCE_STRENGTH_SCORE[industry.evidenceStrength];
      score += Math.min(market.claimIds.length, 6) * 2;
      score += Math.min(industry.claimIds.length, 6) * 2;

      const industryText = `${industry.name} ${industry.summary}`.toLowerCase();
      let overlapScore = 0;
      for (const token of briefTokens) {
        if (industryText.includes(token)) {
          overlapScore += 3;
          if (overlapScore >= 12) break;
        }
      }
      score += overlapScore;

      if (!bestPair || score > bestPair.score) {
        bestPair = { market, industry, score, matchedExplicitMarket };
      }
    }
  }

  if (!bestPair) {
    return null;
  }

  const rationale = bestPair.matchedExplicitMarket
    ? `Selected ${bestPair.market.name} and ${bestPair.industry.name} matching your requested target market (${explicitMarkets.join(", ")}) with the strongest segment fit.`
    : `Selected top-ranked ${bestPair.market.name} and ${bestPair.industry.name} based on supporting research and product-market fit.`;

  return {
    market: bestPair.market,
    industry: bestPair.industry,
    rationale,
  };
}

export function rankAccountsForAutopilotShortlist(
  accounts: AccountCandidateDossier[],
  limit = 10,
): AccountCandidateDossier[] {
  return [...accounts]
    .filter((account) => account.lifecycleState !== "dismissed")
    .sort((left, right) => {
      const leftRank =
        left.fit.totalScore +
        (left.website || left.domain ? 15 : 0) +
        (left.lifecycleState === "shortlisted" ? 5 : 0);
      const rightRank =
        right.fit.totalScore +
        (right.website || right.domain ? 15 : 0) +
        (right.lifecycleState === "shortlisted" ? 5 : 0);
      if (rightRank !== leftRank) {
        return rightRank - leftRank;
      }
      if (right.fit.totalScore !== left.fit.totalScore) {
        return right.fit.totalScore - left.fit.totalScore;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, Math.max(0, limit));
}

function isGenericWebsitePlaceholder(contact: ContactCandidateView): boolean {
  if (contact.title === "Public Clinic Contact (Website)") return true;
  if (/\bteam$/i.test(contact.fullName.trim())) return true;
  if (!contact.firstName?.trim() || !contact.lastName?.trim()) return true;
  return false;
}

function seniorityPriorityScore(contact: ContactCandidateView): number {
  const hay = `${contact.seniority ?? ""} ${contact.title ?? ""}`.toLowerCase();
  if (
    /\b(owner|founder|co-founder|c-suite|chief|ceo|cfo|cto|coo|cmo|president|managing director|partner|principal)\b/.test(
      hay,
    )
  ) {
    return 20;
  }
  if (/\b(vp|vice president|director|clinical director)\b/.test(hay)) {
    return 15;
  }
  if (/\b(head|manager|lead|practice manager|clinic manager)\b/.test(hay)) {
    return 10;
  }
  return 0;
}

export function selectPriorityContactsForWaterfall(
  contacts: ContactCandidateView[],
  limit = 10,
): ContactCandidateView[] {
  const cap = Math.min(Math.max(0, limit), 10);
  if (cap === 0) return [];

  return [...contacts]
    .filter(
      (contact) =>
        contact.verificationStatus !== "verified" && !isGenericWebsitePlaceholder(contact),
    )
    .sort((left, right) => {
      const leftScore =
        (!left.publicEmail ? 25 : 0) +
        seniorityPriorityScore(left) +
        (left.linkedInUrl ? 8 : 0) +
        (left.confidence === "high" ? 5 : 0);
      const rightScore =
        (!right.publicEmail ? 25 : 0) +
        seniorityPriorityScore(right) +
        (right.linkedInUrl ? 8 : 0) +
        (right.confidence === "high" ? 5 : 0);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left.fullName.localeCompare(right.fullName);
    })
    .slice(0, cap);
}

export type ExecutiveSummaryInput = {
  businessLocation: string | null;
  marketName: string | null;
  industryName: string | null;
  topClaimStatement: string | null;
  discoveredCompanyCount: number;
  shortlistedCompanyNames: string[];
  totalContacts: number;
  verifiedEmailCount: number;
  publicEmailCount: number;
  withPhoneCount: number;
  templatePack: OutreachTemplatePackView | null;
  warnings: string[];
};

export function buildAutopilotExecutiveSummaryMarkdown(input: ExecutiveSummaryInput): string {
  const lines: string[] = ["**Autopilot run summary**"];

  const routeParts: string[] = [];
  if (input.marketName || input.industryName) {
    const label = [input.marketName, input.industryName].filter(Boolean).join(" — ");
    routeParts.push(`Target market & segment: **${label}**`);
  }
  if (input.businessLocation) {
    routeParts.push(`Operating from ${input.businessLocation}`);
  }
  if (routeParts.length > 0) {
    lines.push(routeParts.join(". ") + ".");
  }
  if (input.topClaimStatement) {
    lines.push(`Key research takeaway: ${input.topClaimStatement}`);
  }

  if (input.discoveredCompanyCount > 0 || input.shortlistedCompanyNames.length > 0) {
    const topNames = input.shortlistedCompanyNames.slice(0, 5);
    const preview = topNames.length > 0 ? ` (${topNames.join(", ")})` : "";
    lines.push(
      `Companies: ${input.discoveredCompanyCount} matched and ${input.shortlistedCompanyNames.length} shortlisted${preview}.`,
    );
  } else {
    lines.push("Companies: no matching accounts were found for the current filters.");
  }

  const withAnyEmailCount = input.verifiedEmailCount + input.publicEmailCount;
  lines.push(
    `Contacts & emails: ${input.totalContacts} decision-makers found (${input.verifiedEmailCount} verified work email${input.verifiedEmailCount === 1 ? "" : "s"}, ${input.publicEmailCount} public website email${input.publicEmailCount === 1 ? "" : "s"}, ${input.withPhoneCount} with phone; ${withAnyEmailCount} ready for CSV export).`,
  );

  if (input.templatePack) {
    const passedCount = input.templatePack.steps.filter((s) => s.lint.passed).length;
    lines.push(
      `Outreach templates: v${input.templatePack.version} ready with ${input.templatePack.steps.length} steps (${passedCount}/${input.templatePack.steps.length} passed human-voice checks).`,
    );
  }

  const cleanWarnings = Array.from(
    new Set(input.warnings.map((w) => w.trim()).filter(Boolean)),
  ).slice(0, 4);
  if (cleanWarnings.length > 0) {
    lines.push(`Notes: ${cleanWarnings.join(" ")}`);
  }

  lines.push(
    "You can inspect any section above or ask me follow-up questions about this market, companies, contacts, or email sequence.",
  );

  return lines.join("\n\n");
}

export const AUTOPILOT_STAGE_METADATA: ReadonlyArray<{
  stage: AutopilotExecutableStage;
  stepNumber: number;
  title: string;
  activeHint: string;
}> = [
  {
    stage: "brief_and_plan",
    stepNumber: 1,
    title: "Analyzing product & location",
    activeHint: "Confirming your product brief and search scope…",
  },
  {
    stage: "market_research",
    stepNumber: 2,
    title: "Market research",
    activeHint: "Collecting public market evidence and segment demand…",
  },
  {
    stage: "synthesis_and_lock",
    stepNumber: 3,
    title: "Target market & segment",
    activeHint: "Evaluating evidence and selecting the top target segment…",
  },
  {
    stage: "company_discovery",
    stepNumber: 4,
    title: "Matching companies",
    activeHint: "Discovering and shortlisting the strongest matching companies…",
  },
  {
    stage: "people_and_emails",
    stepNumber: 5,
    title: "Finding decision-makers & emails",
    activeHint: "Extracting leadership contacts and verifying work emails…",
  },
  {
    stage: "outreach_templates",
    stepNumber: 6,
    title: "Drafting email templates",
    activeHint: "Writing plain-text human-voice outreach templates…",
  },
];

export function buildLeadsCsvDownloadUrl(
  conversationId: string,
  scope: "with_email" | "verified_only" | "all" = "with_email",
): string {
  return `/api/v1/conversations/${encodeURIComponent(conversationId)}/export?format=leads_csv&scope=${scope}`;
}

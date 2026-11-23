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
import type { ResearchBrief } from "./research-conversation";

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

export const autopilotRunViewSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  status: autopilotStatusSchema,
  currentStage: autopilotStageSchema,
  completedStages: z.array(autopilotExecutableStageSchema),
  stageSummaries: z
    .record(autopilotExecutableStageSchema, autopilotStageSummarySchema)
    .default({}),
  warnings: z.array(z.string().trim().min(1).max(400)).max(20).default([]),
  lastError: z.string().trim().max(600).nullable(),
  stageInFlight: z.boolean().default(false),
  heartbeatAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AutopilotRunView = z.infer<typeof autopilotRunViewSchema>;

export const autopilotStartRequestSchema = z.object({
  fromStage: autopilotExecutableStageSchema.optional(),
});
export type AutopilotStartRequest = z.infer<typeof autopilotStartRequestSchema>;

export const autopilotCancelRequestSchema = z.object({
  mode: z.enum(["paused", "cancelled"]).optional(),
});
export type AutopilotCancelRequest = z.infer<typeof autopilotCancelRequestSchema>;

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

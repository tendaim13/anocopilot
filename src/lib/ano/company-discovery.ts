import { z } from "zod";

import type { MarketProfile, IndustryProfile } from "./market-synthesis";
import type { ResearchBrief } from "./research-conversation";

const shortText = z.string().trim().min(1).max(700);
const listText = z.string().trim().min(1).max(280);
const identifier = z.string().uuid();

export const accountSignalTypeSchema = z.enum([
  "location_match",
  "industry_match",
  "headcount_fit",
  "digital_presence",
  "domain_verified",
]);
export type AccountSignalType = z.infer<typeof accountSignalTypeSchema>;

export const accountSignalSchema = z.object({
  id: z.string().min(1).max(160),
  signalType: accountSignalTypeSchema,
  label: z.string().trim().min(1).max(120),
  explanation: shortText,
  sourceAttribution: z.string().trim().min(1).max(120),
  evidenceUrl: z.string().url().nullable(),
  capturedAt: z.string().datetime(),
});
export type AccountSignal = z.infer<typeof accountSignalSchema>;

export const accountLifecycleStateSchema = z.enum([
  "discovered",
  "shortlisted",
  "held",
  "dismissed",
  "review",
]);
export type AccountLifecycleState = z.infer<typeof accountLifecycleStateSchema>;

export const accountFitBreakdownSchema = z.object({
  locationScore: z.number().min(0).max(40),
  industryScore: z.number().min(0).max(35),
  signalScore: z.number().min(0).max(25),
  totalScore: z.number().min(0).max(100),
  confidence: z.enum(["high", "medium", "low"]),
  rationale: shortText,
  industryHypothesisNote: shortText,
});
export type AccountFitBreakdown = z.infer<typeof accountFitBreakdownSchema>;

export const accountCandidateDossierSchema = z.object({
  id: identifier,
  conversationId: identifier,
  targetDecisionId: identifier,
  companySearchId: identifier,
  sourceKey: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(200).nullable(),
  website: z.string().trim().min(1).max(500).nullable(),
  linkedInUrl: z.string().trim().min(1).max(500).nullable(),
  industry: z.string().trim().min(1).max(160).nullable(),
  location: z.string().trim().min(1).max(200).nullable(),
  employeeBand: z.string().trim().min(1).max(80).nullable(),
  employeeCount: z.number().int().nonnegative().nullable(),
  description: z.string().trim().min(1).max(1_200).nullable(),
  lifecycleState: accountLifecycleStateSchema,
  fit: accountFitBreakdownSchema,
  signals: z.array(accountSignalSchema).max(12),
  claimIds: z.array(identifier).max(16),
  evidenceUrls: z.array(z.string().trim().min(1).max(500)).max(8),
  unknowns: z.array(listText).max(8),
  retrievedAt: z.string().datetime(),
});
export type AccountCandidateDossier = z.infer<typeof accountCandidateDossierSchema>;

export const accountCohortSummarySchema = z.object({
  totalReturned: z.number().int().min(0),
  providerTotalAvailable: z.number().int().min(0).nullable(),
  shortlistedCount: z.number().int().min(0),
  heldCount: z.number().int().min(0),
  dismissedCount: z.number().int().min(0),
  averageFitScore: z.number().min(0).max(100),
  signalBreakdown: z
    .array(
      z.object({
        signalType: accountSignalTypeSchema,
        label: z.string(),
        count: z.number().int().min(0),
      }),
    )
    .max(8),
  cohortExplanation: shortText,
  separationNote: shortText,
});
export type AccountCohortSummary = z.infer<typeof accountCohortSummarySchema>;

export const companySearchStatusSchema = z.enum([
  "awaiting_approval",
  "running",
  "completed",
  "requires_manual_review",
  "failed_safe",
]);
export type CompanySearchStatus = z.infer<typeof companySearchStatusSchema>;

export const companySearchViewSchema = z.object({
  id: identifier,
  conversationId: identifier,
  targetDecisionId: identifier,
  providerActionRequestId: identifier.nullable(),
  providerKey: z.literal("prospeo"),
  status: companySearchStatusSchema,
  targetMarketName: z.string().trim().min(1).max(160),
  targetIndustryName: z.string().trim().min(1).max(160),
  requestedLocations: z.array(listText).min(1).max(5),
  canonicalLocations: z.array(listText).min(1).max(5),
  industryKeywords: z.array(listText).max(8),
  excludedCategories: z.array(listText).max(8),
  linkedClaimIds: z.array(identifier).max(16),
  criteria: z.array(listText).min(1).max(8),
  providerFilters: z.record(z.string(), z.unknown()),
  maximumResults: z.literal(25),
  estimatedMaximumCredits: z.literal(1),
  estimateDetail: shortText,
  resultCount: z.number().int().min(0).nullable(),
  providerReceipt: z.record(z.string(), z.unknown()),
  failureMessage: shortText.nullable(),
  cohort: accountCohortSummarySchema.nullable(),
  accounts: z.array(accountCandidateDossierSchema).max(25),
  approvedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CompanySearchView = z.infer<typeof companySearchViewSchema>;

export const workspaceAccountDirectoryItemSchema = accountCandidateDossierSchema.extend({
  conversationTitle: z.string().trim().min(1).max(160),
  targetMarketName: z.string().trim().min(1).max(160),
  targetIndustryName: z.string().trim().min(1).max(160),
});
export type WorkspaceAccountDirectoryItem = z.infer<typeof workspaceAccountDirectoryItemSchema>;

export const companySearchActionInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare_preview"),
    locationOverrides: z.array(z.string().trim().min(1).max(120)).max(5).optional(),
    excludedCategories: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  }),
  z.object({
    action: z.literal("approve_search"),
    searchId: identifier,
  }),
]);
export type CompanySearchActionInput = z.infer<typeof companySearchActionInputSchema>;

export const accountStateInputSchema = z.object({
  state: z.enum(["shortlisted", "held", "dismissed"]),
});
export type AccountStateInput = z.infer<typeof accountStateInputSchema>;

export type ProspeoProviderState = {
  provider: "prospeo";
  available: boolean;
  maximumResults: 25;
  estimatedMaximumCredits: 1;
  pricingNote: string;
};

export type NormalizedProspeoCompanyInput = {
  id: string;
  name: string;
  website?: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  employeeRange?: string;
  location?: {
    country?: string;
    state?: string;
    city?: string;
  };
  description?: string;
  linkedInUrl?: string;
};

const STOP_WORDS = new Set([
  "and",
  "for",
  "the",
  "with",
  "from",
  "that",
  "this",
  "into",
  "market",
  "sector",
  "industry",
  "industries",
  "businesses",
  "companies",
  "firms",
  "services",
  "service",
]);

function uniqueClean(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    const clean = item.trim().replace(/\s+/g, " ");
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= limit) break;
  }
  return result;
}

function tokenizeKeywords(text: string) {
  return uniqueClean(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    8,
  );
}

export function deriveRequestedLocations(
  market: MarketProfile,
  brief: ResearchBrief | null,
  overrides?: string[],
): string[] {
  const cleanedOverrides = uniqueClean(overrides ?? [], 5);
  if (cleanedOverrides.length > 0) {
    return cleanedOverrides;
  }

  const marketLower = market.name.toLowerCase();
  const hints = uniqueClean(brief?.locationHints ?? [], 5);
  const matchingHints = hints.filter(
    (hint) =>
      marketLower.includes(hint.toLowerCase()) ||
      hint.toLowerCase().includes(marketLower),
  );
  if (matchingHints.length > 0) {
    return matchingHints;
  }

  return [market.name];
}

export function deriveIndustryKeywords(industry: IndustryProfile) {
  return uniqueClean([industry.name, ...tokenizeKeywords(industry.name)], 8);
}

export function buildTargetCompanySearchPreview(input: {
  searchId: string;
  conversationId: string;
  targetDecisionId: string;
  market: MarketProfile;
  industry: IndustryProfile;
  requestedLocations: string[];
  canonicalLocations: string[];
  excludedCategories?: string[];
  nowIso?: string;
}): CompanySearchView {
  const now = input.nowIso ?? new Date().toISOString();
  if (input.requestedLocations.length === 0) {
    throw new Error("Choose at least one location before preparing a company-search preview.");
  }
  if (
    input.canonicalLocations.length !== input.requestedLocations.length ||
    input.canonicalLocations.some((item) => !item.trim())
  ) {
    throw new Error(
      "Prospeo could not verify every canonical location. Ano will not create a chargeable query with an ambiguous location.",
    );
  }

  const industryKeywords = deriveIndustryKeywords(input.industry);
  const excludedCategories = uniqueClean(input.excludedCategories ?? [], 8);
  const linkedClaimIds = uniqueClean(
    [...input.market.claimIds, ...input.industry.claimIds],
    16,
  );
  const criteria = [
    `Locked market route: ${input.market.name} (${input.canonicalLocations.join(", ")})`,
    `Target segment context: ${input.industry.name}`,
    "Strict 1-page ceiling (maximum 25 companies, maximum 1 Prospeo credit)",
  ];
  if (excludedCategories.length > 0) {
    criteria.push(`Excluded categories during review: ${excludedCategories.join(", ")}`);
  }

  return companySearchViewSchema.parse({
    id: input.searchId,
    conversationId: input.conversationId,
    targetDecisionId: input.targetDecisionId,
    providerActionRequestId: null,
    providerKey: "prospeo",
    status: "awaiting_approval",
    targetMarketName: input.market.name,
    targetIndustryName: input.industry.name,
    requestedLocations: input.requestedLocations,
    canonicalLocations: input.canonicalLocations,
    industryKeywords,
    excludedCategories,
    linkedClaimIds,
    criteria,
    providerFilters: {
      company_location_search: { include: input.canonicalLocations },
    },
    maximumResults: 25,
    estimatedMaximumCredits: 1,
    estimateDetail:
      "One first-page Prospeo request returns up to 25 companies and costs at most 1 credit only when at least one company matches; exact duplicate pages may be free for 30 days.",
    resultCount: null,
    providerReceipt: {
      suggestion_requests: input.canonicalLocations.length,
      credit_bearing_request: false,
    },
    failureMessage: null,
    cohort: null,
    accounts: [],
    approvedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

function normalizeUrl(raw: string | undefined, domain?: string) {
  const trimmed = raw?.trim();
  if (trimmed) {
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }
  const cleanDomain = domain?.trim();
  return cleanDomain ? `https://${cleanDomain}` : null;
}

function formatCompanyLocation(location: NormalizedProspeoCompanyInput["location"]) {
  if (!location) return null;
  const joined = [location.city, location.state, location.country].filter(Boolean).join(", ").trim();
  return joined || null;
}

export function scoreAndBuildAccountDossier(
  company: NormalizedProspeoCompanyInput,
  context: {
    dossierId: string;
    conversationId: string;
    targetDecisionId: string;
    companySearchId: string;
    targetMarketName: string;
    targetIndustryName: string;
    canonicalLocations: string[];
    linkedClaimIds: string[];
    capturedAt: string;
    lifecycleState?: AccountLifecycleState;
  },
): AccountCandidateDossier {
  const formattedLocation = formatCompanyLocation(company.location);
  const websiteUrl = normalizeUrl(company.website, company.domain);
  const linkedInUrl = normalizeUrl(company.linkedInUrl);
  const evidenceUrls = uniqueClean(
    [websiteUrl ?? "", linkedInUrl ?? ""].filter(Boolean),
    8,
  );

  const signals: AccountSignal[] = [];

  const canonicalTokens = context.canonicalLocations
    .flatMap((loc) => loc.split(","))
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const locationLower = (formattedLocation ?? "").toLowerCase();
  const explicitLocationMatch =
    Boolean(locationLower) &&
    canonicalTokens.some((token) => locationLower.includes(token));

  signals.push({
    id: `${company.id}:location_match`,
    signalType: "location_match",
    label: explicitLocationMatch ? "Canonical location match" : "Query location cohort",
    explanation: formattedLocation
      ? `Prospeo lists location as ${formattedLocation} under approved query ${context.canonicalLocations.join(", ")}.`
      : `Returned by Prospeo for approved canonical location filter ${context.canonicalLocations.join(", ")}.`,
    sourceAttribution: "Prospeo company search",
    evidenceUrl: websiteUrl,
    capturedAt: context.capturedAt,
  });

  const locationScore = explicitLocationMatch ? 40 : formattedLocation ? 28 : 18;

  const industryKeywords = tokenizeKeywords(context.targetIndustryName);
  const companyIndustryText = `${company.industry ?? ""} ${company.description ?? ""}`.toLowerCase();
  const matchedKeywords = industryKeywords.filter((token) =>
    companyIndustryText.includes(token),
  );
  let industryScore = 0;
  if (matchedKeywords.length >= 2) {
    industryScore = 35;
  } else if (matchedKeywords.length === 1) {
    industryScore = 26;
  } else if (company.industry) {
    industryScore = 16;
  }

  if (company.industry) {
    signals.push({
      id: `${company.id}:industry_match`,
      signalType: "industry_match",
      label: matchedKeywords.length > 0 ? "Target segment keyword alignment" : "Reported industry category",
      explanation:
        matchedKeywords.length > 0
          ? `Prospeo industry "${company.industry}" aligns with ${context.targetIndustryName} (${matchedKeywords.join(", ")}).`
          : `Prospeo classifies this company under "${company.industry}". Validate alignment against ${context.targetIndustryName}.`,
      sourceAttribution: "Prospeo company search",
      evidenceUrl: websiteUrl,
      capturedAt: context.capturedAt,
    });
  }

  let signalScore = 0;
  if (company.employeeRange || typeof company.employeeCount === "number") {
    signalScore += 10;
    signals.push({
      id: `${company.id}:headcount_fit`,
      signalType: "headcount_fit",
      label: "Headcount band observed",
      explanation: `Prospeo reports ${
        company.employeeRange
          ? `employee band ${company.employeeRange}`
          : `${company.employeeCount} employees`
      }.`,
      sourceAttribution: "Prospeo company search",
      evidenceUrl: websiteUrl,
      capturedAt: context.capturedAt,
    });
  }

  if (company.domain) {
    signalScore += 8;
    signals.push({
      id: `${company.id}:domain_verified`,
      signalType: "domain_verified",
      label: "Primary company domain",
      explanation: `Prospeo returned domain ${company.domain} for downstream website inspection or Phase 7 contact verification.`,
      sourceAttribution: "Prospeo company search",
      evidenceUrl: websiteUrl,
      capturedAt: context.capturedAt,
    });
  }

  if (websiteUrl || linkedInUrl) {
    signalScore += 7;
    signals.push({
      id: `${company.id}:digital_presence`,
      signalType: "digital_presence",
      label: "Public web / LinkedIn profile",
      explanation: `Public profile URLs returned (${[
        websiteUrl ? "website" : null,
        linkedInUrl ? "LinkedIn" : null,
      ]
        .filter(Boolean)
        .join(" and ")}).`,
      sourceAttribution: "Prospeo company search",
      evidenceUrl: websiteUrl ?? linkedInUrl,
      capturedAt: context.capturedAt,
    });
  }

  const totalScore = Math.min(100, locationScore + industryScore + signalScore);
  const confidence: AccountFitBreakdown["confidence"] =
    totalScore >= 75 && signals.length >= 3
      ? "high"
      : totalScore >= 48
        ? "medium"
        : "low";

  const unknowns: string[] = [
    "Named decision-makers have not been searched yet (requires Phase 7 role & person approval).",
    "Contact email and phone details remain unverified until selective Phase 7 Dropcontact approval.",
    `Confirm whether the Phase C ${context.targetIndustryName} operational problem exists at this specific company.`,
  ];
  if (!company.industry) {
    unknowns.push("Prospeo did not return an industry classification for this company.");
  }
  if (!company.domain && !websiteUrl) {
    unknowns.push("Prospeo did not return a primary domain or website URL.");
  }

  return accountCandidateDossierSchema.parse({
    id: context.dossierId,
    conversationId: context.conversationId,
    targetDecisionId: context.targetDecisionId,
    companySearchId: context.companySearchId,
    sourceKey: `prospeo:${company.id}`,
    name: company.name,
    domain: company.domain?.trim() || null,
    website: websiteUrl,
    linkedInUrl,
    industry: company.industry?.trim() || null,
    location: formattedLocation,
    employeeBand: company.employeeRange?.trim() || null,
    employeeCount: typeof company.employeeCount === "number" ? company.employeeCount : null,
    description: company.description?.trim().slice(0, 1_200) || null,
    lifecycleState: context.lifecycleState ?? "discovered",
    fit: {
      locationScore,
      industryScore,
      signalScore,
      totalScore,
      confidence,
      rationale: `Scored ${totalScore}/100 from company-level Prospeo signals (${locationScore}/40 location, ${industryScore}/35 industry match, ${signalScore}/25 profile completeness).`,
      industryHypothesisNote: `Linked Phase C claims explain why ${context.targetIndustryName} in ${context.targetMarketName} was targeted; they are market-level hypotheses, not confirmed facts about ${company.name}.`,
    },
    signals,
    claimIds: context.linkedClaimIds,
    evidenceUrls,
    unknowns: uniqueClean(unknowns, 8),
    retrievedAt: context.capturedAt,
  });
}

const SIGNAL_LABELS: Record<AccountSignalType, string> = {
  location_match: "Location match",
  industry_match: "Industry alignment",
  headcount_fit: "Headcount band",
  domain_verified: "Company domain",
  digital_presence: "Public web / LinkedIn",
};

export function summarizeAccountCohort(
  accounts: AccountCandidateDossier[],
  targetMarketName: string,
  targetIndustryName: string,
  providerTotalAvailable: number | null,
): AccountCohortSummary {
  const counts = new Map<AccountSignalType, number>();
  let totalFit = 0;
  let shortlistedCount = 0;
  let heldCount = 0;
  let dismissedCount = 0;

  for (const account of accounts) {
    totalFit += account.fit.totalScore;
    if (account.lifecycleState === "shortlisted") shortlistedCount += 1;
    else if (account.lifecycleState === "held" || account.lifecycleState === "review") heldCount += 1;
    else if (account.lifecycleState === "dismissed") dismissedCount += 1;

    const seenInAccount = new Set<AccountSignalType>();
    for (const signal of account.signals) {
      if (seenInAccount.has(signal.signalType)) continue;
      seenInAccount.add(signal.signalType);
      counts.set(signal.signalType, (counts.get(signal.signalType) ?? 0) + 1);
    }
  }

  const signalBreakdown = (Object.keys(SIGNAL_LABELS) as AccountSignalType[])
    .map((signalType) => ({
      signalType,
      label: SIGNAL_LABELS[signalType],
      count: counts.get(signalType) ?? 0,
    }))
    .filter((entry) => entry.count > 0);

  const averageFitScore =
    accounts.length > 0 ? Math.round((totalFit / accounts.length) * 10) / 10 : 0;

  return accountCohortSummarySchema.parse({
    totalReturned: accounts.length,
    providerTotalAvailable,
    shortlistedCount,
    heldCount,
    dismissedCount,
    averageFitScore,
    signalBreakdown,
    cohortExplanation:
      accounts.length > 0
        ? `Prospeo returned ${accounts.length} candidate${accounts.length === 1 ? "" : "s"} from one approved page for ${targetMarketName} · ${targetIndustryName} (average fit ${averageFitScore}/100).`
        : `Prospeo returned 0 companies for this approved query in ${targetMarketName}. Ano did not retry or relax filters automatically.`,
    separationNote:
      "Industry-level claims come from Phase C public sources and explain why this segment was selected. Company-level signals above reflect only observed Prospeo attributes for each candidate.",
  });
}

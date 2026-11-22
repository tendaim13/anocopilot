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

export const companyDiscoveryProviderSchema = z.enum(["prospeo", "openstreetmap"]);
export type CompanyDiscoveryProvider = z.infer<typeof companyDiscoveryProviderSchema>;

export const osmTagFilterSchema = z.object({
  key: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(80),
});
export type OsmTagFilter = z.infer<typeof osmTagFilterSchema>;

export const osmResolvedAreaSchema = z.object({
  requestedQuery: z.string().min(1),
  displayName: z.string().min(1),
  osmType: z.string().min(1),
  osmId: z.number().int(),
  areaId: z.number().int().nullable(),
  boundingBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable().optional(),
});
export type OsmResolvedArea = z.infer<typeof osmResolvedAreaSchema>;

export const companySearchViewSchema = z.object({
  id: identifier,
  conversationId: identifier,
  targetDecisionId: identifier,
  providerActionRequestId: identifier.nullable(),
  providerKey: companyDiscoveryProviderSchema,
  status: companySearchStatusSchema,
  targetMarketName: z.string().trim().min(1).max(160),
  targetIndustryName: z.string().trim().min(1).max(160),
  requestedLocations: z.array(listText).min(1).max(5),
  canonicalLocations: z.array(listText).min(1).max(5),
  canonicalIndustries: z.array(listText).max(8).optional().default([]),
  industryKeywords: z.array(listText).max(15),
  excludedCategories: z.array(listText).max(8),
  linkedClaimIds: z.array(identifier).max(16),
  criteria: z.array(listText).min(1).max(8),
  providerFilters: z.record(z.string(), z.unknown()),
  maximumResults: z.literal(25),
  estimatedMaximumCredits: z.union([z.literal(0), z.literal(1)]),
  estimateDetail: shortText,
  resultCount: z.number().int().min(0).nullable(),
  providerReceipt: z.record(z.string(), z.unknown()),
  failureMessage: shortText.nullable(),
  cohort: accountCohortSummarySchema.nullable(),
  accounts: z.array(accountCandidateDossierSchema).max(50),
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
    providerKey: companyDiscoveryProviderSchema.optional(),
    resolveWebsites: z.boolean().optional(),
    locationOverrides: z.array(z.string().trim().min(1).max(120)).max(5).optional(),
    keywordOverrides: z.array(z.string().trim().min(3).max(100)).max(15).optional(),
    industryOverrides: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
    excludedCategories: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  }),
  z.object({
    action: z.literal("run_free_search"),
    resolveWebsites: z.boolean().optional(),
    locationOverrides: z.array(z.string().trim().min(1).max(120)).max(5).optional(),
    keywordOverrides: z.array(z.string().trim().min(3).max(100)).max(15).optional(),
    excludedCategories: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  }),
  z.object({
    action: z.literal("approve_search"),
    searchId: identifier,
  }),
]);
export type CompanySearchActionInput = z.infer<typeof companySearchActionInputSchema>;

export type CompanyCohortRow = {
  id: string;
  name: string;
  specialisation: string;
  city: string;
  country: string;
  domain: string | null;
  website: string | null;
  fitScore: number;
  confidence: AccountFitBreakdown["confidence"];
  lifecycleState: AccountLifecycleState;
};

export function formatAccountForCohortTable(
  account: AccountCandidateDossier,
): CompanyCohortRow {
  const cleanSpecialisation = (account.industry ?? "")
    .replace(/\s*\(OpenStreetMap\)\s*$/i, "")
    .trim();
  const locationParts = (account.location ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  let city = "—";
  let country = "—";
  if (locationParts.length >= 2) {
    city = locationParts[0];
    country = locationParts[locationParts.length - 1];
  } else if (locationParts.length === 1) {
    country = locationParts[0];
  }

  return {
    id: account.id,
    name: account.name,
    specialisation: cleanSpecialisation || "Unclassified",
    city,
    country,
    domain: account.domain,
    website: account.website,
    fitScore: account.fit.totalScore,
    confidence: account.fit.confidence,
    lifecycleState: account.lifecycleState,
  };
}

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
  provider?: CompanyDiscoveryProvider;
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
  phone?: string;
  address?: string;
  description?: string;
  linkedInUrl?: string;
  osmUrl?: string;
  osmTags?: Record<string, string>;
  websiteSource?: "openstreetmap" | "searxng" | "prospeo";
};

export type NormalizedDiscoveredCompanyInput = NormalizedProspeoCompanyInput;

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

const SELLER_PRODUCT_NOISE = new Set([
  "software",
  "automated",
  "automation",
  "platform",
  "tool",
  "tools",
  "system",
  "systems",
  "solution",
  "solutions",
  "workflow",
  "workflows",
  "build",
  "builds",
  "sell",
  "selling",
  "recall",
  "patient",
  "patients",
  "app",
  "apps",
  "saas",
  "multi",
  "chair",
  "practices",
  "practice",
  "manager",
  "owner",
  "director",
  "head",
  "lead",
  "target",
]);

/**
 * Derives clean company keywords (3–100 chars) representing the target
 * customer businesses rather than seller product jargon or generic nouns.
 */
export function deriveSearchKeywords(
  industry: IndustryProfile,
  brief: ResearchBrief | null,
  overrides?: string[],
): string[] {
  const cleanedOverrides = uniqueClean(overrides ?? [], 15).filter(
    (item) => item.length >= 3 && item.length <= 100,
  );
  if (cleanedOverrides.length > 0) {
    return cleanedOverrides;
  }

  const industryTokens = tokenizeKeywords(industry.name).filter(
    (token) => !SELLER_PRODUCT_NOISE.has(token),
  );
  const hintTokens = (brief?.marketHints ?? [])
    .flatMap((hint) => tokenizeKeywords(hint))
    .filter((token) => !SELLER_PRODUCT_NOISE.has(token));

  const combined = uniqueClean([...industryTokens, ...hintTokens], 10).filter(
    (item) => item.length >= 3 && item.length <= 100,
  );
  const fallback =
    combined.length > 0 ? combined : uniqueClean(tokenizeKeywords(industry.name), 8);

  const hasDentalContext =
    /\b(dental|dentist\w*|orthodont\w*)\b/i.test(industry.name) ||
    fallback.some((token) => /^(dental|dentist|orthodont)/i.test(token));
  if (hasDentalContext) {
    return uniqueClean(
      ["dental clinic", "dental practice", "dentist", "dental", ...fallback],
      12,
    );
  }

  return fallback;
}

const OSM_PRIMARY_RULES: Array<{ pattern: RegExp; tags: OsmTagFilter[] }> = [
  {
    pattern: /\b(dental|dentist\w*|orthodont\w*|endodont\w*|periodont\w*)\b/i,
    tags: [
      { key: "amenity", value: "dentist" },
      { key: "healthcare", value: "dentist" },
    ],
  },
  {
    pattern: /\bphysio\w*\b/i,
    tags: [{ key: "healthcare", value: "physiotherapist" }],
  },
  {
    pattern: /\b(optometr\w*|optician\w*)\b/i,
    tags: [{ key: "healthcare", value: "optometrist" }],
  },
  {
    pattern: /\bchiropract\w*\b/i,
    tags: [{ key: "healthcare", value: "chiropractor" }],
  },
  {
    pattern: /\b(vet|veterinar\w*|animal clinic|pet clinic)\b/i,
    tags: [{ key: "amenity", value: "veterinary" }],
  },
  {
    pattern: /\b(pharmac\w*|chemist\w*)\b/i,
    tags: [{ key: "amenity", value: "pharmacy" }],
  },
  {
    pattern: /\bhospital\w*\b/i,
    tags: [{ key: "amenity", value: "hospital" }],
  },
  {
    pattern: /\bplumb\w*\b/i,
    tags: [{ key: "craft", value: "plumber" }],
  },
  {
    pattern: /\b(hvac|air\s*cond\w*)\b/i,
    tags: [{ key: "craft", value: "hvac" }],
  },
  {
    pattern: /\b(electrician\w*|electrical)\b/i,
    tags: [{ key: "craft", value: "electrician" }],
  },
  {
    pattern: /\broof\w*\b/i,
    tags: [{ key: "craft", value: "roofer" }],
  },
  {
    pattern: /\bcarpenter\w*\b/i,
    tags: [{ key: "craft", value: "carpenter" }],
  },
  {
    pattern: /\blocksmith\w*\b/i,
    tags: [{ key: "craft", value: "locksmith" }],
  },
  {
    pattern: /\b(lawyer\w*|law firm\w*|solicitor\w*|attorney\w*)\b/i,
    tags: [{ key: "office", value: "lawyer" }],
  },
  {
    pattern: /\b(accountant\w*|accounting|bookkeep\w*|tax)\b/i,
    tags: [{ key: "office", value: "accountant" }],
  },
  {
    pattern: /\b(real estate|property agent\w*)\b/i,
    tags: [{ key: "office", value: "estate_agent" }],
  },
  {
    pattern: /\brestaurant\w*\b/i,
    tags: [{ key: "amenity", value: "restaurant" }],
  },
  {
    pattern: /\b(cafe\w*|coffee)\b/i,
    tags: [{ key: "amenity", value: "cafe" }],
  },
  {
    pattern: /\bhotel\w*\b/i,
    tags: [{ key: "tourism", value: "hotel" }],
  },
  {
    pattern: /\b(gym\w*|fitness)\b/i,
    tags: [{ key: "leisure", value: "fitness_centre" }],
  },
  {
    pattern: /\b(hairdress\w*|barber\w*|salon\w*)\b/i,
    tags: [{ key: "shop", value: "hairdresser" }],
  },
  {
    pattern: /\b(beauty|spa\w*)\b/i,
    tags: [{ key: "shop", value: "beauty" }],
  },
  {
    pattern: /\b(auto repair|mechanic\w*|car repair|garage\w*)\b/i,
    tags: [{ key: "shop", value: "car_repair" }],
  },
];

const OSM_MEDICAL_RULE: { pattern: RegExp; tags: OsmTagFilter[] } = {
  pattern: /\b(medical|clinic\w*|doctor\w*|physician\w*|gp|general practice|healthcare|primary care)\b/i,
  tags: [
    { key: "amenity", value: "clinic" },
    { key: "amenity", value: "doctors" },
    { key: "healthcare", value: "clinic" },
  ],
};

export function deriveOsmTagFilters(
  industryName: string,
  keywords: string[] = [],
): OsmTagFilter[] {
  const combined = `${industryName} ${keywords.join(" ")}`.trim();
  if (!combined) return [];

  const seen = new Set<string>();
  const resolved: OsmTagFilter[] = [];
  const pushTags = (tags: OsmTagFilter[]) => {
    for (const tag of tags) {
      const id = `${tag.key}=${tag.value}`;
      if (seen.has(id)) continue;
      seen.add(id);
      resolved.push(tag);
    }
  };

  for (const rule of OSM_PRIMARY_RULES) {
    if (rule.pattern.test(combined)) {
      pushTags(rule.tags);
    }
  }

  // Do not let phrases like "dental clinic" or "veterinary clinic" pull general GP doctors.
  const withoutSpecialtyClinic = combined.replace(
    /\b(?:dental|veterinar\w*|pet|animal|physio\w*|optometr\w*|chiropract\w*)\s+(?:clinic\w*|practice\w*)/gi,
    " ",
  );
  if (OSM_MEDICAL_RULE.pattern.test(withoutSpecialtyClinic)) {
    pushTags(OSM_MEDICAL_RULE.tags);
  }

  return resolved;
}

export function recommendDiscoveryProvider(
  industryName: string,
  keywords: string[] = [],
): CompanyDiscoveryProvider {
  return deriveOsmTagFilters(industryName, keywords).length > 0 ? "openstreetmap" : "prospeo";
}

const PROSPEO_INDUSTRY_RULES: Array<{ pattern: RegExp; categories: string[] }> = [
  {
    pattern: /\b(dental|dentist\w*|orthodont\w*|medical|clinic\w*|doctor\w*|healthcare|primary care)\b/i,
    categories: ["Medical Practices", "Hospitals and Health Care"],
  },
  {
    pattern: /\b(software|saas|ai|tech|it|cloud)\b/i,
    categories: ["Software Development", "Technology, Information and Internet"],
  },
  {
    pattern: /\b(construction|plumb\w*|hvac|trades?|roof\w*|electric\w*)\b/i,
    categories: ["Construction", "Facilities Services"],
  },
  {
    pattern: /\b(legal|law|solicitor\w*|attorney\w*)\b/i,
    categories: ["Law Practice"],
  },
  {
    pattern: /\b(account\w*|bookkeep\w*|tax)\b/i,
    categories: ["Accounting"],
  },
  {
    pattern: /\b(real estate|property)\b/i,
    categories: ["Real Estate"],
  },
  {
    pattern: /\b(logistic\w*|freight|supply chain|warehouse)\b/i,
    categories: ["Transportation, Logistics, Supply Chain and Storage"],
  },
  {
    pattern: /\b(hospitality|restaurant\w*|hotel\w*|cafe\w*)\b/i,
    categories: ["Hospitality", "Restaurants"],
  },
];

export function deriveProspeoIndustryCandidates(
  industryName: string,
  keywords: string[] = [],
): string[] {
  const combined = `${industryName} ${keywords.join(" ")}`.trim();
  const matches: string[] = [];
  for (const rule of PROSPEO_INDUSTRY_RULES) {
    if (rule.pattern.test(combined)) {
      matches.push(...rule.categories);
    }
  }
  if (matches.length > 0) {
    return uniqueClean(matches, 6);
  }
  return industryName.trim() ? [industryName.trim()] : [];
}

function clipText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function buildTargetCompanySearchPreview(input: {
  searchId: string;
  conversationId: string;
  targetDecisionId: string;
  market: MarketProfile;
  industry: IndustryProfile;
  providerKey?: CompanyDiscoveryProvider;
  requestedLocations: string[];
  canonicalLocations: string[];
  canonicalIndustries?: string[];
  searchKeywords?: string[];
  excludedCategories?: string[];
  osmAreas?: OsmResolvedArea[];
  osmTags?: OsmTagFilter[];
  resolveWebsites?: boolean;
  nowIso?: string;
}): CompanySearchView {
  const now = input.nowIso ?? new Date().toISOString();
  const providerKey = input.providerKey ?? "prospeo";
  if (input.requestedLocations.length === 0) {
    throw new Error("Choose at least one location before preparing a company-search preview.");
  }
  if (
    input.canonicalLocations.length !== input.requestedLocations.length ||
    input.canonicalLocations.some((item) => !item.trim())
  ) {
    throw new Error(
      providerKey === "openstreetmap"
        ? "OpenStreetMap could not resolve every requested location. Enter a specific city, state, or region."
        : "Prospeo could not verify every canonical location. Ano will not create a chargeable query with an ambiguous location.",
    );
  }

  const industryKeywords = uniqueClean(
    input.searchKeywords?.length ? input.searchKeywords : deriveSearchKeywords(input.industry, null),
    15,
  ).filter((item) => item.length >= 3 && item.length <= 100);
  const excludedCategories = uniqueClean(input.excludedCategories ?? [], 8);
  const excludeKeywords = excludedCategories.filter(
    (item) => item.length >= 3 && item.length <= 100,
  );
  const linkedClaimIds = uniqueClean(
    [...input.market.claimIds, ...input.industry.claimIds],
    16,
  );

  if (providerKey === "openstreetmap") {
    const osmTags =
      input.osmTags && input.osmTags.length > 0
        ? input.osmTags
        : deriveOsmTagFilters(input.industry.name, industryKeywords);
    if (osmTags.length === 0) {
      throw new Error(
        "OpenStreetMap discovery requires at least one physical business tag.",
      );
    }

    const areaLabels =
      input.osmAreas && input.osmAreas.length > 0
        ? input.osmAreas.map((area) => area.displayName.split(",")[0].trim() || area.requestedQuery)
        : input.canonicalLocations;
    const providerFilters: Record<string, unknown> = {
      source: "openstreetmap",
      areas: input.osmAreas ?? [],
      osm_tags: osmTags,
      limit: 25,
      excluded_terms: excludedCategories,
      resolve_missing_websites_via_searxng: Boolean(input.resolveWebsites),
    };
    const criteria = [
      clipText(`Locked market route: ${input.market.name} (${areaLabels.join(", ")})`, 280),
      clipText(`Target segment context: ${input.industry.name}`, 280),
      clipText(
        `OpenStreetMap POI tags: ${osmTags.map((tag) => `${tag.key}=${tag.value}`).join(", ")}`,
        280,
      ),
      "Strict 25-business cap ($0 credits — OpenStreetMap)",
    ];
    if (input.resolveWebsites) {
      criteria.push(
        "Bounded private SearXNG website lookup for up to 10 businesses missing an OSM website ($0)",
      );
    }
    if (excludedCategories.length > 0) {
      criteria.push(
        clipText(`Excluded keywords / categories: ${excludedCategories.join(", ")}`, 280),
      );
    }

    return companySearchViewSchema.parse({
      id: input.searchId,
      conversationId: input.conversationId,
      targetDecisionId: input.targetDecisionId,
      providerActionRequestId: null,
      providerKey: "openstreetmap",
      status: "awaiting_approval",
      targetMarketName: input.market.name,
      targetIndustryName: input.industry.name,
      requestedLocations: input.requestedLocations,
      canonicalLocations: input.canonicalLocations,
      canonicalIndustries: [],
      industryKeywords,
      excludedCategories,
      linkedClaimIds,
      criteria,
      providerFilters,
      maximumResults: 25,
      estimatedMaximumCredits: 0,
      estimateDetail:
        "Free OpenStreetMap local discovery returns up to 25 physical businesses for 0 credits. Optional missing-website lookup uses your private SearXNG instance (max 10 lookups, 0 credits). No Prospeo credits are spent.",
      resultCount: null,
      providerReceipt: {
        source: "openstreetmap",
        resolved_areas: input.osmAreas?.length ?? input.canonicalLocations.length,
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

  const canonicalIndustries = uniqueClean(input.canonicalIndustries ?? [], 8);
  const providerFilters: Record<string, unknown> = {
    company_location_search: { include: input.canonicalLocations },
  };
  if (canonicalIndustries.length > 0) {
    providerFilters.company_industry = { include: canonicalIndustries };
  }
  if (industryKeywords.length > 0 || excludeKeywords.length > 0) {
    providerFilters.company_keywords = {
      ...(industryKeywords.length > 0
        ? {
            include: industryKeywords.slice(0, 20),
            include_all: false,
            search_everywhere: false,
            sources: [
              "specialties",
              "social_media_description",
              "seo_description",
              "ai_description",
              "products_services",
            ],
          }
        : {}),
      ...(excludeKeywords.length > 0 ? { exclude: excludeKeywords.slice(0, 20) } : {}),
    };
  }

  const criteria = [
    clipText(`Locked market route: ${input.market.name} (${input.canonicalLocations.join(", ")})`, 280),
    clipText(`Target segment context: ${input.industry.name}`, 280),
  ];
  if (canonicalIndustries.length > 0) {
    criteria.push(clipText(`Prospeo industry filter: ${canonicalIndustries.join(", ")}`, 280));
  }
  if (industryKeywords.length > 0) {
    criteria.push(
      clipText(`Profile-only company keywords (OR match): ${industryKeywords.join(", ")}`, 280),
    );
  }
  criteria.push("Strict 1-page ceiling (maximum 25 companies, maximum 1 Prospeo credit)");
  if (excludedCategories.length > 0) {
    criteria.push(
      clipText(`Excluded keywords / categories: ${excludedCategories.join(", ")}`, 280),
    );
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
    canonicalIndustries,
    industryKeywords,
    excludedCategories,
    linkedClaimIds,
    criteria,
    providerFilters,
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
    providerKey?: CompanyDiscoveryProvider;
    targetMarketName: string;
    targetIndustryName: string;
    canonicalLocations: string[];
    canonicalIndustries?: string[];
    targetKeywords?: string[];
    linkedClaimIds: string[];
    capturedAt: string;
    lifecycleState?: AccountLifecycleState;
  },
): AccountCandidateDossier {
  const providerKey = context.providerKey ?? company.provider ?? "prospeo";
  const isOsm = providerKey === "openstreetmap";
  const formattedLocation = formatCompanyLocation(company.location) ?? company.address?.trim() ?? null;
  const websiteUrl = normalizeUrl(company.website, company.domain);
  const linkedInUrl = normalizeUrl(company.linkedInUrl);
  const osmUrl = normalizeUrl(company.osmUrl);
  const evidenceUrls = uniqueClean(
    [websiteUrl ?? "", linkedInUrl ?? "", osmUrl ?? ""].filter(Boolean),
    8,
  );

  const signals: AccountSignal[] = [];

  const canonicalTokens = context.canonicalLocations
    .flatMap((loc) => loc.split(","))
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const locationLower = `${formattedLocation ?? ""} ${company.address ?? ""}`.toLowerCase();
  const explicitLocationMatch =
    Boolean(locationLower.trim()) &&
    canonicalTokens.some((token) => locationLower.includes(token));

  signals.push({
    id: `${company.id}:location_match`,
    signalType: "location_match",
    label: explicitLocationMatch
      ? isOsm
        ? "Verified map area match"
        : "Canonical location match"
      : "Query location cohort",
    explanation: formattedLocation
      ? `${isOsm ? "OpenStreetMap" : "Prospeo"} lists location as ${company.address ?? formattedLocation} under approved query ${context.canonicalLocations.join(", ")}.`
      : `Returned by ${isOsm ? "OpenStreetMap" : "Prospeo"} inside approved location filter ${context.canonicalLocations.join(", ")}.`,
    sourceAttribution: isOsm ? "OpenStreetMap" : "Prospeo company search",
    evidenceUrl: isOsm ? websiteUrl ?? osmUrl : websiteUrl,
    capturedAt: context.capturedAt,
  });

  const locationScore = isOsm
    ? explicitLocationMatch
      ? 40
      : 35
    : explicitLocationMatch
      ? 40
      : formattedLocation
        ? 28
        : 18;

  const industryKeywords = uniqueClean(
    (context.targetKeywords?.length
      ? context.targetKeywords
      : tokenizeKeywords(context.targetIndustryName)
    ).map((kw) => kw.toLowerCase()),
    15,
  );
  const canonicalIndustrySet = new Set(
    (context.canonicalIndustries ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean),
  );
  const companyIndustryLower = (company.industry ?? "").trim().toLowerCase();
  const explicitCanonicalIndustryMatch =
    Boolean(companyIndustryLower) && canonicalIndustrySet.has(companyIndustryLower);
  const companySearchableText =
    `${company.name} ${company.industry ?? ""} ${company.description ?? ""} ${Object.values(company.osmTags ?? {}).join(" ")}`.toLowerCase();
  const matchedKeywords = industryKeywords.filter((token) =>
    companySearchableText.includes(token),
  );

  const osmTagEntries = Object.entries(company.osmTags ?? {}).filter(([key]) =>
    ["amenity", "healthcare", "craft", "office", "shop", "tourism", "leisure"].includes(key),
  );

  let industryScore = 0;
  if (isOsm && osmTagEntries.length > 0) {
    industryScore = 35;
  } else if (
    matchedKeywords.length >= 2 ||
    (matchedKeywords.length >= 1 && explicitCanonicalIndustryMatch)
  ) {
    industryScore = 35;
  } else if (matchedKeywords.length === 1 || explicitCanonicalIndustryMatch) {
    industryScore = 26;
  }

  const hasRelevanceMatch =
    (isOsm && osmTagEntries.length > 0) ||
    matchedKeywords.length > 0 ||
    explicitCanonicalIndustryMatch;

  if (isOsm && osmTagEntries.length > 0) {
    signals.push({
      id: `${company.id}:industry_match`,
      signalType: "industry_match",
      label: "OpenStreetMap category match",
      explanation: `OpenStreetMap lists structured POI tags (${osmTagEntries.map(([k, v]) => `${k}=${v}`).slice(0, 4).join(", ")}), directly matching ${context.targetIndustryName}.`,
      sourceAttribution: "OpenStreetMap",
      evidenceUrl: websiteUrl ?? osmUrl,
      capturedAt: context.capturedAt,
    });
  } else if (company.industry || hasRelevanceMatch) {
    const matchReasons: string[] = [];
    if (explicitCanonicalIndustryMatch && company.industry) {
      matchReasons.push(`canonical industry "${company.industry}"`);
    }
    if (matchedKeywords.length > 0) {
      matchReasons.push(`keywords: ${matchedKeywords.join(", ")}`);
    }

    signals.push({
      id: `${company.id}:industry_match`,
      signalType: "industry_match",
      label: hasRelevanceMatch ? "Target segment relevance match" : "Off-target industry category",
      explanation: hasRelevanceMatch
        ? `Matches ${context.targetIndustryName} (${matchReasons.join(" · ")}).`
        : `Prospeo classifies this company under "${company.industry}". It did not match any target keywords (${industryKeywords.join(", ") || context.targetIndustryName}).`,
      sourceAttribution: isOsm ? "OpenStreetMap" : "Prospeo company search",
      evidenceUrl: isOsm ? websiteUrl ?? osmUrl : websiteUrl,
      capturedAt: context.capturedAt,
    });
  }

  let signalScore = 0;
  if (isOsm) {
    if (company.domain || websiteUrl) {
      signalScore += 10;
      const fromSearxng = company.websiteSource === "searxng";
      signals.push({
        id: `${company.id}:domain_verified`,
        signalType: "domain_verified",
        label: fromSearxng
          ? "Official website resolved (SearXNG)"
          : "Official website listed on OpenStreetMap",
        explanation: fromSearxng
          ? `Resolved official website domain ${company.domain ?? websiteUrl} via bounded SearXNG lookup for downstream website inspection or Phase E contact discovery.`
          : `OpenStreetMap lists primary domain ${company.domain ?? websiteUrl} for website verification or Phase E buyer discovery.`,
        sourceAttribution: fromSearxng ? "SearXNG website lookup" : "OpenStreetMap",
        evidenceUrl: websiteUrl,
        capturedAt: context.capturedAt,
      });
    }

    if (
      (websiteUrl || osmUrl) &&
      (company.phone || company.osmTags?.["opening_hours"] || company.address || formattedLocation)
    ) {
      signalScore += 8;
      signals.push({
        id: `${company.id}:digital_presence`,
        signalType: "digital_presence",
        label: "Public contact & map profile",
        explanation: `Observed OpenStreetMap listing${company.phone ? ` · phone ${company.phone}` : ""}${company.address ? ` · ${company.address}` : ""}.`,
        sourceAttribution: "OpenStreetMap",
        evidenceUrl: websiteUrl ?? osmUrl,
        capturedAt: context.capturedAt,
      });
    }

    if (
      company.employeeRange ||
      typeof company.employeeCount === "number" ||
      company.osmTags?.["opening_hours"] ||
      company.osmTags?.["operator"] ||
      company.osmTags?.["branch"] ||
      company.osmTags?.["brand"]
    ) {
      signalScore += 7;
      signals.push({
        id: `${company.id}:headcount_fit`,
        signalType: "headcount_fit",
        label:
          company.employeeRange || typeof company.employeeCount === "number"
            ? "Headcount band observed"
            : "Operating profile cues observed",
        explanation:
          company.employeeRange
            ? `Employee band ${company.employeeRange}.`
            : typeof company.employeeCount === "number"
              ? `${company.employeeCount} employees reported.`
              : `OpenStreetMap records ${[
                  company.osmTags?.["operator"] ? `operator ${company.osmTags["operator"]}` : null,
                  company.osmTags?.["brand"] ? `brand ${company.osmTags["brand"]}` : null,
                  company.osmTags?.["branch"] ? `branch ${company.osmTags["branch"]}` : null,
                  company.osmTags?.["opening_hours"] ? `hours ${company.osmTags["opening_hours"]}` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}.`,
        sourceAttribution: "OpenStreetMap",
        evidenceUrl: websiteUrl ?? osmUrl,
        capturedAt: context.capturedAt,
      });
    }
    signalScore = Math.min(25, signalScore);
  } else {
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
  }

  const rawTotalScore = Math.min(100, locationScore + industryScore + signalScore);
  const totalScore = industryScore === 0 ? Math.min(35, rawTotalScore) : rawTotalScore;
  const confidence: AccountFitBreakdown["confidence"] =
    industryScore > 0 && totalScore >= 75 && signals.length >= 3
      ? "high"
      : industryScore > 0 && totalScore >= 48
        ? "medium"
        : "low";

  const unknowns: string[] = [
    "Named decision-makers have not been searched yet (requires Phase 7 role & person approval).",
    "Contact email and phone details remain unverified until selective Phase 7 Dropcontact approval.",
    `Confirm whether the Phase C ${context.targetIndustryName} operational problem exists at this specific company.`,
  ];
  if (isOsm) {
    unknowns.push(
      "Headcount, chair/provider count, and patient-recall workflow need confirmation on the clinic website or in Phase E.",
    );
    if (!websiteUrl && !company.domain) {
      unknowns.unshift(
        "Neither OpenStreetMap nor SearXNG confirmed an official clinic website domain yet (add or verify website before Phase E domain person search).",
      );
    }
  } else {
    if (industryScore === 0) {
      unknowns.unshift(
        `No target segment keyword or canonical industry match was found in Prospeo's profile (${company.industry ?? "unspecified industry"}).`,
      );
    }
    if (!company.industry) {
      unknowns.push("Prospeo did not return an industry classification for this company.");
    }
    if (!company.domain && !websiteUrl) {
      unknowns.push("Prospeo did not return a primary domain or website URL.");
    }
  }

  const domainVal =
    company.domain?.trim() ||
    (websiteUrl ? (() => {
      try {
        return new URL(websiteUrl).hostname.replace(/^www\./i, "");
      } catch {
        return null;
      }
    })() : null);

  return accountCandidateDossierSchema.parse({
    id: context.dossierId,
    conversationId: context.conversationId,
    targetDecisionId: context.targetDecisionId,
    companySearchId: context.companySearchId,
    sourceKey: isOsm ? `osm:${company.id}` : `prospeo:${company.id}`,
    name: company.name,
    domain: domainVal,
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
      rationale: isOsm
        ? `Scored ${totalScore}/100 from OpenStreetMap business attributes (${locationScore}/40 location, ${industryScore}/35 OSM category match, ${signalScore}/25 profile completeness).`
        : `Scored ${totalScore}/100 from company-level Prospeo signals (${locationScore}/40 location, ${industryScore}/35 industry match, ${signalScore}/25 profile completeness).`,
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
  headcount_fit: "Headcount / operating profile",
  domain_verified: "Company domain",
  digital_presence: "Public web / map profile",
};

export function summarizeAccountCohort(
  accounts: AccountCandidateDossier[],
  targetMarketName: string,
  targetIndustryName: string,
  providerTotalAvailable: number | null,
  providerKey: CompanyDiscoveryProvider = "prospeo",
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
  const sourceName = providerKey === "openstreetmap" ? "OpenStreetMap" : "Prospeo";

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
        ? `${sourceName} returned ${accounts.length} candidate${accounts.length === 1 ? "" : "s"} for ${targetMarketName} · ${targetIndustryName} (average fit ${averageFitScore}/100).`
        : `${sourceName} returned 0 companies for this approved query in ${targetMarketName}. Ano did not retry or relax filters automatically.`,
    separationNote: `Industry-level claims come from Phase C public sources and explain why this segment was selected. Company-level signals above reflect only observed ${sourceName}${providerKey === "openstreetmap" ? " / SearXNG" : ""} attributes for each candidate.`,
  });
}

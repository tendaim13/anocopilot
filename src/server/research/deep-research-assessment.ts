import "server-only";

import type { ResearchQuery, SourceEvidenceRole, SourceProvenance } from "@/lib/ano/evidence-research";

export const DEEP_RESEARCH_DIMENSIONS = [
  "problem_urgency",
  "market_density",
  "buyer_conditions",
  "market_access",
  "solution_fit",
  "counter_evidence",
] as const;

export type DeepResearchDimension = (typeof DEEP_RESEARCH_DIMENSIONS)[number];
export type SourceClass =
  | "official"
  | "academic"
  | "industry"
  | "company"
  | "vendor"
  | "independent"
  | "other";

export type SearchCandidate = {
  id: string;
  url: string;
  title: string;
  snippet: string | null;
  providerScore: number | null;
  publishedAt: string | null;
  query: Pick<ResearchQuery, "query" | "candidateMarket" | "comparisonDimension"> | null;
};

export type PriorAssessmentSource = {
  id?: string;
  url?: string;
  rootDomain?: string | null;
  sourceClass: SourceClass;
  title: string;
  excerpt: string;
};

export type SourceAssessment = {
  sourceClass: SourceClass;
  evidenceRole: SourceEvidenceRole;
  sourceProvenance: Exclude<SourceProvenance, "workspace_supplied">;
  rootDomain: string;
  sourceFamily: string;
  authorityScore: number;
  countryRelevanceScore: number;
  industryRelevanceScore: number;
  queryDirectnessScore: number;
  freshnessScore: number;
  diversityScore: number;
  extractabilityScore: number;
  redundancyPenalty: number;
  overallScore: number;
  decisionRelevant: boolean;
  isDuplicateOrSyndicated: boolean;
  duplicateOfSourceId: string | null;
  rationale: string[];
};

export type CoverageCell = {
  candidateMarket: string;
  dimension: DeepResearchDimension;
  qualifyingSources: number;
  sourceClasses: SourceClass[];
};

export type EpistemicEvidenceSummary = {
  directEvidenceCount: number;
  comparableEvidenceCount: number;
  contextualVendorCount: number;
  workspaceSuppliedCount: number;
  inferencesSupported: boolean;
  hypothesesRemaining: number;
  unknownGapsCount: number;
};

export type ResearchCoverage = {
  candidateMarkets: string[];
  cells: CoverageCell[];
  qualifyingSourceCount: number;
  sourceClassCount: number;
  directSourceCount?: number;
  comparableSourceCount?: number;
  vendorContextualCount?: number;
  workspaceSuppliedCount?: number;
  distinctRootDomains?: number;
  missingCells?: Array<{ candidateMarket: string; dimension: DeepResearchDimension }>;
  epistemicSummary?: EpistemicEvidenceSummary;
  comparisonReady: boolean;
  gaps: string[];
};

const AUTHORITY: Record<SourceClass, number> = {
  official: 100,
  academic: 92,
  industry: 82,
  company: 68,
  independent: 60,
  vendor: 28,
  other: 25,
};

const VENDOR_DOMAINS = [
  "hubspot.",
  "salesforce.",
  "microsoft.",
  "oracle.",
  "sap.",
  "zoho.",
  "pipedrive.",
  "zendesk.",
  "intercom.",
  "apollo.io",
  "outreach.io",
  "salesloft.",
  "gong.io",
  "clari.",
  "zoominfo.",
  "cognism.",
  "lusha.",
  "smartlead.",
  "instantly.ai",
  "lemlist.",
  "klaviyo.",
  "marketo.",
  "mailchimp.",
  "monday.com",
  "asana.com",
  "notion.so",
  "freshworks.",
  "servicenow.com",
];

const OFFICIAL_HOSTS = [
  "worldbank.org",
  "oecd.org",
  "europa.eu",
  "un.org",
  "ilo.org",
  "who.int",
  "imf.org",
  "bis.org",
  "data.gov",
  "census.gov",
  "bls.gov",
  "nih.gov",
  "ncbi.nlm.nih.gov",
  "ons.gov.uk",
  "frc.org.uk",
  "fca.org.uk",
  "ico.org.uk",
  "abs.gov.au",
  "statcan.gc.ca",
  "singstat.gov.sg",
  "dosm.gov.my",
  "destatis.de",
  "insee.fr",
];

const ACADEMIC_HOSTS = [
  "arxiv.org",
  "doi.org",
  "nature.com",
  "sciencedirect.com",
  "springer.com",
  "wiley.com",
  "tandfonline.com",
  "jamanetwork.com",
  "bmj.com",
  "thelancet.com",
  "nber.org",
  "ssrn.com",
  "researchgate.",
];

const PRESS_WIRE_HOSTS = new Set([
  "prnewswire.com",
  "businesswire.com",
  "globenewswire.com",
  "einpresswire.com",
  "accesswire.com",
  "newswire.com",
]);

const SELF_PUBLISHED_HOSTS = new Set([
  "medium.com",
  "substack.com",
  "wordpress.com",
  "blogspot.com",
]);

const SOCIAL_UGC_HOSTS = [
  "reddit.com",
  "quora.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "pinterest.",
  "youtube.com",
  "youtu.be",
];

const TWO_LEVEL_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "gov.uk",
  "ac.uk",
  "org.uk",
  "gov.au",
  "com.au",
  "org.au",
  "edu.au",
  "gov.my",
  "com.my",
  "gov.sg",
  "com.sg",
  "edu.sg",
  "gc.ca",
  "co.nz",
  "govt.nz",
  "co.za",
  "co.jp",
  "com.br",
]);

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
]);

const COUNTRY_ALIASES: Array<{ match: RegExp; cues: RegExp }> = [
  { match: /\b(united states|usa|u\.s\.|us market)\b/i, cues: /\b(united states|u\.s\.a?\.?|american|bls|census\.gov|federal)\b/i },
  { match: /\b(united kingdom|uk|britain|england)\b/i, cues: /\b(united kingdom|u\.k\.|british|england|ons\.gov\.uk|nhs|london)\b/i },
  { match: /\b(australia)\b/i, cues: /\b(australia|australian|abs\.gov\.au|sydney|melbourne|data\.gov\.au)\b/i },
  { match: /\b(malaysia)\b/i, cues: /\b(malaysia|malaysian|dosm\.gov\.my|kuala lumpur|putrajaya)\b/i },
  { match: /\b(singapore)\b/i, cues: /\b(singapore|singaporean|singstat\.gov\.sg)\b/i },
  { match: /\b(canada)\b/i, cues: /\b(canada|canadian|statcan\.gc\.ca|toronto|vancouver)\b/i },
  { match: /\b(germany|deutschland)\b/i, cues: /\b(germany|german|deutschland|destatis\.de|berlin|munich)\b/i },
  { match: /\b(united arab emirates|uae|dubai)\b/i, cues: /\b(united arab emirates|uae|dubai|abu dhabi)\b/i },
  { match: /\b(ireland)\b/i, cues: /\b(ireland|irish|dublin|cso\.ie)\b/i },
  { match: /\b(new zealand)\b/i, cues: /\b(new zealand|kiwi|auckland|stats\.govt\.nz)\b/i },
];

const QUERY_STOP_TOKENS = new Set([
  "what",
  "which",
  "where",
  "when",
  "with",
  "from",
  "into",
  "that",
  "this",
  "about",
  "over",
  "across",
  "market",
  "evidence",
  "statistics",
  "data",
  "report",
  "study",
  "research",
  "adoption",
  "analysis",
  "industry",
  "public",
  "official",
]);

function bounded(value: number, minimum = 0, maximum = 100) {
  return Math.round(Math.min(Math.max(value, minimum), maximum) * 100) / 100;
}

function tokens(value: string) {
  return new Set(value.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []);
}

function overlap(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.max(1, Math.min(a.size, b.size));
}

function shingles(value: string, width = 4): Set<string> {
  const words = value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  if (words.length < width) return new Set();
  const out = new Set<string>();
  for (let i = 0; i <= words.length - width; i += 1) {
    out.add(words.slice(i, i + width).join(" "));
  }
  return out;
}

function shingleJaccard(left: string, right: string): number {
  const a = shingles(left);
  const b = shingles(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeTitleKey(title: string): string {
  const stripped = title
    .replace(/\s+(?:\||-|—|–)\s+[^|\-—–]{2,50}$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped;
}

export function normalizeCanonicalResearchUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function extractRootDomain(value: string): string {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^(?:www|m|amp)\./, "");
    const parts = host.split(".").filter(Boolean);
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join(".");
    if (TWO_LEVEL_PUBLIC_SUFFIXES.has(lastTwo) && parts.length >= 3) {
      return parts.slice(-3).join(".");
    }
    return lastTwo;
  } catch {
    return "unknown";
  }
}

export function extractSourceFamily(value: string): string {
  const root = extractRootDomain(value);
  if (PRESS_WIRE_HOSTS.has(root)) return "press_wire_syndicate";
  if (SELF_PUBLISHED_HOSTS.has(root)) return "self_published_blog";
  return root;
}

function freshness(publishedAt: string | null, fallbackText = ""): number {
  if (publishedAt) {
    const date = new Date(publishedAt);
    if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000) return 15;
    const ageDays = Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
    if (ageDays <= 365) return 100;
    if (ageDays <= 730) return 82;
    if (ageDays <= 1_460) return 60;
    return 38;
  }

  const yearMatches = fallbackText.match(/\b(20(?:1\d|2\d))\b/g);
  if (yearMatches && yearMatches.length > 0) {
    const currentYear = new Date().getFullYear();
    const newestYear = Math.max(
      ...yearMatches.map(Number).filter((yr) => yr <= currentYear + 1),
    );
    if (Number.isFinite(newestYear) && newestYear > 0) {
      const diff = Math.max(0, currentYear - newestYear);
      if (diff <= 1) return 75;
      if (diff <= 2) return 62;
      if (diff <= 4) return 48;
      return 32;
    }
  }
  return 30;
}

function computeCountryRelevance(candidateMarket: string | null | undefined, haystack: string): number {
  if (!candidateMarket?.trim()) return 50;
  const target = candidateMarket.trim();
  const targetTokens = Array.from(tokens(target));
  const hayLower = haystack.toLowerCase();

  let matchedTarget = false;
  for (const entry of COUNTRY_ALIASES) {
    if (entry.match.test(target) && entry.cues.test(haystack)) {
      matchedTarget = true;
      break;
    }
  }
  if (!matchedTarget && hayLower.includes(target.toLowerCase())) {
    matchedTarget = true;
  }
  if (matchedTarget) return 100;

  if (targetTokens.length > 0 && targetTokens.some((tok) => hayLower.includes(tok))) {
    return 72;
  }

  // Detect if another distinct market/country dominates the text cleanly with zero target overlap.
  const matchedOtherCountry = COUNTRY_ALIASES.some(
    (entry) => !entry.match.test(target) && entry.cues.test(haystack),
  );
  if (matchedOtherCountry) {
    return 15;
  }
  return 45;
}

function computeIndustryRelevance(
  query: Pick<ResearchQuery, "query" | "candidateMarket"> | null,
  haystack: string,
): number {
  if (!query) return 45;
  const marketTokens = query.candidateMarket ? tokens(query.candidateMarket) : new Set<string>();
  const industryTokens = Array.from(tokens(query.query)).filter(
    (tok) => !QUERY_STOP_TOKENS.has(tok) && !marketTokens.has(tok),
  );
  if (industryTokens.length === 0) return 55;
  const hayTokens = tokens(haystack);
  const matched = industryTokens.filter((tok) => hayTokens.has(tok)).length;
  return bounded((matched / industryTokens.length) * 100);
}

function computePrimarySourceBonus(sourceClass: SourceClass, haystack: string): number {
  let bonus = 0;
  if (sourceClass === "official" || sourceClass === "academic") bonus += 6;
  if (
    /\b(?:census|survey|sample size|respondents|n\s*=\s*\d+|statist|methodology|annual report|10-k|filing|%\s+of|\d+(?:\.\d+)?%)\b/i.test(
      haystack,
    )
  ) {
    bonus += 6;
  }
  return Math.min(12, bonus);
}

export function classifySourceUrl(value: string, title = "", text = ""): SourceClass {
  let host = "";
  let pathname = "";
  try {
    const parsed = new URL(value);
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    pathname = parsed.pathname.toLowerCase();
  } catch {
    return "other";
  }

  const combined = `${title} ${text}`;

  if (
    host.endsWith(".gov") ||
    /\.gov\.[a-z]{2,3}$/.test(host) ||
    /\.gob\.[a-z]{2,3}$/.test(host) ||
    /\.gouv\.[a-z]{2,3}$/.test(host) ||
    /\.govt\.[a-z]{2,3}$/.test(host) ||
    host.endsWith(".europa.eu") ||
    host.endsWith(".int") ||
    OFFICIAL_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  ) {
    return "official";
  }

  if (
    host.endsWith(".edu") ||
    /\.edu\.[a-z]{2,3}$/.test(host) ||
    /\.ac\.[a-z]{2,3}$/.test(host) ||
    host.includes("journals.") ||
    host.includes("pubmed.") ||
    ACADEMIC_HOSTS.some((domain) => host === domain || host.includes(domain))
  ) {
    return "academic";
  }

  if (
    host.includes("investor") ||
    host.includes("annualreport") ||
    host.startsWith("ir.") ||
    host.includes("sec.gov")
  ) {
    return "company";
  }

  if (VENDOR_DOMAINS.some((domain) => host === domain.replace(/\.$/, "") || host.includes(domain))) {
    return "vendor";
  }
  if (
    /\/(?:blog|resources|solutions|pricing)(?:\/|$)/.test(pathname) &&
    /\b(?:book (?:a )?demo|free trial|request (?:a )?demo|schedule (?:a )?demo|pricing plans)\b/i.test(
      combined,
    )
  ) {
    return "vendor";
  }

  if (SOCIAL_UGC_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return "other";
  }

  if (/(association|chamber|council|institute|federation|society|alliance|foundation)/.test(host)) {
    return "industry";
  }

  if (
    host.endsWith(".org") &&
    /\b(?:association|institute|benchmark|survey|council|chamber|federation|report|statistics)\b/i.test(
      `${host} ${combined}`,
    )
  ) {
    return "industry";
  }

  if (host.endsWith(".org")) return "other";
  return "independent";
}

export function detectDuplicateOrSyndicatedSource(
  input: { url: string; title: string; text: string },
  priorSources: PriorAssessmentSource[],
): {
  isDuplicateOrSyndicated: boolean;
  reason: "exact_title" | "wire_syndication" | "near_duplicate_text" | null;
  similarity: number;
  duplicateOfSourceId: string | null;
} {
  const targetTitle = normalizeTitleKey(input.title);
  const targetCombined = `${input.title} ${input.text}`;
  const isWireArticle =
    extractSourceFamily(input.url) === "press_wire_syndicate" ||
    /\b(?:PR Newswire|Business Wire|GlobeNewswire|EIN Presswire|Originally published (?:on|at)|Syndicated from)\b/i.test(
      targetCombined,
    );

  let highestSimilarity = 0;
  let bestDuplicateId: string | null = null;
  let bestReason: "exact_title" | "wire_syndication" | "near_duplicate_text" | null = null;

  for (const prior of priorSources) {
    const priorCombined = `${prior.title} ${prior.excerpt}`;
    const priorTitle = normalizeTitleKey(prior.title);

    if (targetTitle.length >= 24 && priorTitle === targetTitle) {
      return {
        isDuplicateOrSyndicated: true,
        reason: isWireArticle ? "wire_syndication" : "exact_title",
        similarity: 1,
        duplicateOfSourceId: prior.id ?? null,
      };
    }

    const tokSim = overlap(targetCombined, priorCombined);
    const shSim = shingleJaccard(targetCombined, priorCombined);
    const sim = Math.max(tokSim, shSim);

    if (sim > highestSimilarity) {
      highestSimilarity = sim;
      bestDuplicateId = prior.id ?? null;
    }

    if (isWireArticle && (shSim >= 0.25 || tokSim >= 0.45)) {
      bestReason = "wire_syndication";
    } else if (shSim >= 0.5 || tokSim >= 0.8) {
      bestReason = "near_duplicate_text";
    }
  }

  return {
    isDuplicateOrSyndicated: bestReason !== null,
    reason: bestReason,
    similarity: Math.round(highestSimilarity * 1000) / 1000,
    duplicateOfSourceId: bestReason ? bestDuplicateId : null,
  };
}

export function scoreSearchCandidate(candidate: SearchCandidate) {
  const haystack = `${candidate.title} ${candidate.snippet ?? ""}`;
  const sourceClass = classifySourceUrl(candidate.url, candidate.title, candidate.snippet ?? "");
  const rootDomain = extractRootDomain(candidate.url);
  const sourceFamily = extractSourceFamily(candidate.url);
  const directness = candidate.query ? overlap(candidate.query.query, haystack) * 100 : 35;
  const countryRelevanceScore = computeCountryRelevance(candidate.query?.candidateMarket, haystack);
  const industryRelevanceScore = computeIndustryRelevance(candidate.query, haystack);
  const freshnessScore = freshness(candidate.publishedAt, haystack);
  const provider = candidate.providerScore === null ? 40 : bounded(candidate.providerScore * 100);
  const primaryBonus = computePrimarySourceBonus(sourceClass, haystack);

  let score =
    AUTHORITY[sourceClass] * 0.29 +
    directness * 0.22 +
    countryRelevanceScore * 0.15 +
    industryRelevanceScore * 0.13 +
    freshnessScore * 0.09 +
    provider * 0.05 +
    (primaryBonus * 7) / 12;

  if (sourceFamily === "press_wire_syndicate") {
    score -= 18;
  }
  if (sourceClass === "vendor" && candidate.query?.comparisonDimension !== "counter_evidence") {
    score = Math.min(score, 32);
  }

  return {
    sourceClass,
    rootDomain,
    sourceFamily,
    countryRelevanceScore,
    industryRelevanceScore,
    score: bounded(score),
  };
}

export function selectDiverseSearchCandidates<T extends SearchCandidate>(
  candidates: T[],
  options: {
    limit: number;
    maxPerRootDomainWave?: number;
    maxPerRootDomainRun?: number;
    maxPerFamilyRun?: number;
    maxVendorRun?: number;
    priorSources?: PriorAssessmentSource[];
  },
): Array<
  T & {
    candidateScore: number;
    rootDomain: string;
    sourceFamily: string;
    sourceClass: SourceClass;
  }
> {
  const maxPerRootWave = options.maxPerRootDomainWave ?? 2;
  const maxPerRootRun = options.maxPerRootDomainRun ?? 4;
  const maxPerFamilyRun = options.maxPerFamilyRun ?? 4;
  const maxVendorRun = options.maxVendorRun ?? 2;
  const prior = options.priorSources ?? [];

  const scored = candidates
    .map((candidate) => {
      const scoredMeta = scoreSearchCandidate(candidate);
      return {
        ...candidate,
        candidateScore: scoredMeta.score,
        rootDomain: scoredMeta.rootDomain,
        sourceFamily: scoredMeta.sourceFamily,
        sourceClass: scoredMeta.sourceClass,
      };
    })
    .sort((left, right) => right.candidateScore - left.candidateScore);

  const rootCountInRun = new Map<string, number>();
  const familyCountInRun = new Map<string, number>();
  let vendorCountInRun = 0;

  for (const item of prior) {
    const rd =
      item.rootDomain ??
      (item.url ? extractRootDomain(item.url) : "unknown");
    const fam = item.url ? extractSourceFamily(item.url) : rd;
    rootCountInRun.set(rd, (rootCountInRun.get(rd) ?? 0) + 1);
    familyCountInRun.set(fam, (familyCountInRun.get(fam) ?? 0) + 1);
    if (item.sourceClass === "vendor") vendorCountInRun += 1;
  }

  const rootCountInWave = new Map<string, number>();
  const seenUrls = new Set<string>(
    prior.map((item) => (item.url ? normalizeCanonicalResearchUrl(item.url) : "")).filter(Boolean),
  );
  const seenPriorAndSelected: PriorAssessmentSource[] = [...prior];

  const selected: Array<
    T & {
      candidateScore: number;
      rootDomain: string;
      sourceFamily: string;
      sourceClass: SourceClass;
    }
  > = [];

  for (const item of scored) {
    if (selected.length >= options.limit) break;

    const canonicalUrl = normalizeCanonicalResearchUrl(item.url);
    if (seenUrls.has(canonicalUrl)) continue;

    const dupCheck = detectDuplicateOrSyndicatedSource(
      { url: canonicalUrl, title: item.title, text: item.snippet ?? "" },
      seenPriorAndSelected,
    );
    if (dupCheck.isDuplicateOrSyndicated) continue;

    const waveCount = rootCountInWave.get(item.rootDomain) ?? 0;
    const runCount = rootCountInRun.get(item.rootDomain) ?? 0;
    const famCount = familyCountInRun.get(item.sourceFamily) ?? 0;
    const famLimit = item.sourceFamily === "press_wire_syndicate" ? 2 : maxPerFamilyRun;

    if (waveCount >= maxPerRootWave) continue;
    if (runCount >= maxPerRootRun) continue;
    if (famCount >= famLimit) continue;
    if (item.sourceClass === "vendor" && vendorCountInRun >= maxVendorRun) continue;

    seenUrls.add(canonicalUrl);
    rootCountInWave.set(item.rootDomain, waveCount + 1);
    rootCountInRun.set(item.rootDomain, runCount + 1);
    familyCountInRun.set(item.sourceFamily, famCount + 1);
    if (item.sourceClass === "vendor") vendorCountInRun += 1;

    seenPriorAndSelected.push({
      id: item.id,
      url: canonicalUrl,
      rootDomain: item.rootDomain,
      sourceClass: item.sourceClass,
      title: item.title,
      excerpt: item.snippet ?? "",
    });
    selected.push(item);
  }

  return selected;
}

export function assessFetchedSource(input: {
  url: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  query: Pick<ResearchQuery, "query" | "candidateMarket" | "comparisonDimension"> | null;
  priorSources: PriorAssessmentSource[];
}): SourceAssessment {
  const haystack = `${input.title} ${input.excerpt}`;
  const sourceClass = classifySourceUrl(input.url, input.title, input.excerpt);
  const rootDomain = extractRootDomain(input.url);
  const sourceFamily = extractSourceFamily(input.url);
  const authorityScore = AUTHORITY[sourceClass];
  const queryDirectnessScore = input.query
    ? bounded(overlap(input.query.query, haystack) * 100)
    : 30;
  const countryRelevanceScore = computeCountryRelevance(input.query?.candidateMarket, haystack);
  const industryRelevanceScore = computeIndustryRelevance(input.query, haystack);
  const freshnessScore = freshness(input.publishedAt, haystack);

  const sameClassCount = input.priorSources.filter((source) => source.sourceClass === sourceClass).length;
  const sameDomainCount = input.priorSources.filter((source) => {
    const priorDomain =
      source.rootDomain ?? (source.url ? extractRootDomain(source.url) : null);
    return priorDomain && priorDomain === rootDomain;
  }).length;
  const diversityScore = bounded(100 - sameClassCount * 16 - sameDomainCount * 22, 20);
  const extractabilityScore = bounded((input.excerpt.trim().length / 1_000) * 100, 15);
  const primaryBonus = computePrimarySourceBonus(sourceClass, haystack);

  const dup = detectDuplicateOrSyndicatedSource(
    { url: input.url, title: input.title, text: input.excerpt },
    input.priorSources,
  );
  const redundancyPenalty = bounded(
    dup.isDuplicateOrSyndicated ? Math.max(24, dup.similarity * 30) : dup.similarity * 25,
    0,
    30,
  );

  const rawScore =
    authorityScore * 0.25 +
    queryDirectnessScore * 0.2 +
    countryRelevanceScore * 0.14 +
    industryRelevanceScore * 0.14 +
    freshnessScore * 0.12 +
    diversityScore * 0.08 +
    extractabilityScore * 0.07 +
    primaryBonus -
    redundancyPenalty;

  const overallScore = bounded(rawScore);

  let evidenceRole: SourceEvidenceRole = "non_qualifying";
  let sourceProvenance: Exclude<SourceProvenance, "workspace_supplied"> = "public_web";
  let decisionRelevant = false;

  if (sourceClass === "vendor") {
    // Guardrail: vendor content is allowed solely as contextual or counter evidence,
    // never as direct positive proof of target-market demand.
    evidenceRole = "contextual_counter_only";
    decisionRelevant = false;
  } else if (dup.isDuplicateOrSyndicated) {
    evidenceRole = "non_qualifying";
    decisionRelevant = false;
  } else if (
    sourceClass !== "other" &&
    overallScore >= 60 &&
    queryDirectnessScore >= 45 &&
    (!input.query?.candidateMarket || countryRelevanceScore >= 35)
  ) {
    evidenceRole = "direct_evidence";
    sourceProvenance = "public_web";
    decisionRelevant = true;
  } else if (
    sourceClass !== "other" &&
    overallScore >= 52 &&
    (industryRelevanceScore >= 40 || queryDirectnessScore >= 40) &&
    Boolean(input.query?.candidateMarket) &&
    countryRelevanceScore < 35
  ) {
    evidenceRole = "comparable_evidence";
    sourceProvenance = "comparable_evidence";
    decisionRelevant = false;
  }

  const rationale = [
    `${sourceClass} source class (${rootDomain})`,
    evidenceRole === "contextual_counter_only"
      ? "vendor source restricted to contextual or counter evidence only"
      : evidenceRole === "comparable_evidence"
        ? "comparable evidence from another geography rather than direct target-market proof"
        : queryDirectnessScore >= 60
          ? "directly relevant to its assigned query"
          : "only partly aligned with its assigned query",
    freshnessScore >= 80
      ? "recent publication metadata"
      : input.publishedAt || freshnessScore >= 60
        ? "older publication metadata"
        : "no publication date",
    dup.isDuplicateOrSyndicated || redundancyPenalty >= 12
      ? "syndicated or similar to evidence already collected"
      : "adds a distinct evidence lead",
  ];

  return {
    sourceClass,
    evidenceRole,
    sourceProvenance,
    rootDomain,
    sourceFamily,
    authorityScore,
    countryRelevanceScore,
    industryRelevanceScore,
    queryDirectnessScore,
    freshnessScore,
    diversityScore,
    extractabilityScore,
    redundancyPenalty,
    overallScore,
    decisionRelevant,
    isDuplicateOrSyndicated: dup.isDuplicateOrSyndicated,
    duplicateOfSourceId: dup.duplicateOfSourceId,
    rationale,
  };
}

export function assessResearchCoverage(input: {
  candidateMarkets: string[];
  sources: Array<{
    sourceClass: SourceClass;
    sourceProvenance?: SourceProvenance;
    evidenceRole?: SourceEvidenceRole;
    rootDomain?: string | null;
    overallScore: number;
    decisionRelevant: boolean;
    query: Pick<ResearchQuery, "candidateMarket" | "comparisonDimension"> | null;
  }>;
}): ResearchCoverage {
  const candidateMarkets = Array.from(
    new Set(input.candidateMarkets.map((item) => item.trim()).filter(Boolean)),
  ).slice(0, 5);
  const dimensions = DEEP_RESEARCH_DIMENSIONS.filter(
    (dimension) => dimension !== "counter_evidence",
  );

  const isQualifyingDirect = (source: (typeof input.sources)[number]) => {
    const provenance = source.sourceProvenance ?? "public_web";
    const role =
      source.evidenceRole ??
      (source.sourceClass === "vendor" ? "contextual_counter_only" : "direct_evidence");
    return (
      provenance === "public_web" &&
      source.sourceClass !== "vendor" &&
      role === "direct_evidence" &&
      source.decisionRelevant &&
      source.overallScore >= 60
    );
  };

  const cells = candidateMarkets.flatMap((candidateMarket) =>
    dimensions.map((dimension) => {
      const cellSources = input.sources.filter(
        (source) =>
          isQualifyingDirect(source) &&
          source.query?.candidateMarket === candidateMarket &&
          source.query?.comparisonDimension === dimension,
      );
      return {
        candidateMarket,
        dimension,
        qualifyingSources: cellSources.length,
        sourceClasses: Array.from(new Set(cellSources.map((source) => source.sourceClass))),
      };
    }),
  );

  const qualifying = input.sources.filter(isQualifyingDirect);
  const sourceClassCount = new Set(qualifying.map((source) => source.sourceClass)).size;
  const domainValues = qualifying
    .map((source) => source.rootDomain?.trim())
    .filter((d): d is string => Boolean(d && d !== "unknown"));
  const hasDomainMetadata = domainValues.length > 0;
  const distinctRootDomains = new Set(domainValues).size;

  const missingCells = cells
    .filter((cell) => cell.qualifyingSources < 1 || cell.sourceClasses.length < 1)
    .map((cell) => ({ candidateMarket: cell.candidateMarket, dimension: cell.dimension }));

  const gaps = missingCells
    .map((cell) => `${cell.candidateMarket}: ${cell.dimension.replaceAll("_", " ")} needs direct evidence.`)
    .slice(0, 8);

  const comparableSourceCount = input.sources.filter(
    (source) =>
      source.sourceProvenance === "comparable_evidence" ||
      source.evidenceRole === "comparable_evidence",
  ).length;
  const vendorContextualCount = input.sources.filter(
    (source) =>
      source.sourceClass === "vendor" || source.evidenceRole === "contextual_counter_only",
  ).length;
  const workspaceSuppliedCount = input.sources.filter(
    (source) => source.sourceProvenance === "workspace_supplied",
  ).length;

  const fullyCoveredCandidates = candidateMarkets.filter((candidateMarket) =>
    cells
      .filter((cell) => cell.candidateMarket === candidateMarket)
      .every((cell) => cell.qualifyingSources >= 1),
  );

  const comparisonReady =
    candidateMarkets.length >= 2 &&
    fullyCoveredCandidates.length >= 2 &&
    sourceClassCount >= 2 &&
    qualifying.length >= 8 &&
    gaps.length === 0 &&
    (!hasDomainMetadata || distinctRootDomains >= 3);

  if (candidateMarkets.length < 2) {
    gaps.unshift(
      "Ano needs at least two candidate markets before it can make a comparative market recommendation.",
    );
  }
  if (sourceClassCount < 2) {
    gaps.push("The qualifying evidence lacks source-class diversity.");
  }
  if (hasDomainMetadata && distinctRootDomains < 3) {
    gaps.push("The qualifying evidence relies on too few independent root domains.");
  }
  if (qualifying.length < 8) {
    gaps.push(
      "Ano needs more than a handful of decision-relevant sources before ranking markets.",
    );
  }

  return {
    candidateMarkets,
    cells,
    qualifyingSourceCount: qualifying.length,
    sourceClassCount,
    directSourceCount: qualifying.length,
    comparableSourceCount,
    vendorContextualCount,
    workspaceSuppliedCount,
    distinctRootDomains,
    missingCells,
    epistemicSummary: {
      directEvidenceCount: qualifying.length,
      comparableEvidenceCount: comparableSourceCount,
      contextualVendorCount: vendorContextualCount,
      workspaceSuppliedCount,
      inferencesSupported: qualifying.length + comparableSourceCount >= 3,
      hypothesesRemaining: missingCells.length,
      unknownGapsCount: Array.from(new Set(gaps)).length,
    },
    comparisonReady,
    gaps: Array.from(new Set(gaps)).slice(0, 10),
  };
}

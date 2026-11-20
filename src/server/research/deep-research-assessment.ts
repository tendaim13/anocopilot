import "server-only";

import type { ResearchQuery } from "@/lib/ano/evidence-research";

export const DEEP_RESEARCH_DIMENSIONS = [
  "problem_urgency",
  "market_density",
  "buyer_conditions",
  "market_access",
  "solution_fit",
  "counter_evidence",
] as const;

export type DeepResearchDimension = (typeof DEEP_RESEARCH_DIMENSIONS)[number];
export type SourceClass = "official" | "academic" | "industry" | "company" | "vendor" | "independent" | "other";

export type SearchCandidate = {
  id: string;
  url: string;
  title: string;
  snippet: string | null;
  providerScore: number | null;
  publishedAt: string | null;
  query: Pick<ResearchQuery, "query" | "candidateMarket" | "comparisonDimension"> | null;
};

export type SourceAssessment = {
  sourceClass: SourceClass;
  authorityScore: number;
  queryDirectnessScore: number;
  freshnessScore: number;
  diversityScore: number;
  extractabilityScore: number;
  redundancyPenalty: number;
  overallScore: number;
  decisionRelevant: boolean;
  rationale: string[];
};

export type CoverageCell = {
  candidateMarket: string;
  dimension: DeepResearchDimension;
  qualifyingSources: number;
  sourceClasses: SourceClass[];
};

export type ResearchCoverage = {
  candidateMarkets: string[];
  cells: CoverageCell[];
  qualifyingSourceCount: number;
  sourceClassCount: number;
  comparisonReady: boolean;
  gaps: string[];
};

const AUTHORITY: Record<SourceClass, number> = {
  official: 100,
  academic: 90,
  industry: 78,
  company: 65,
  independent: 58,
  vendor: 35,
  other: 25,
};

const VENDOR_DOMAINS = ["hubspot.", "salesforce.", "microsoft.", "oracle.", "sap.", "zoho.", "pipedrive.", "zendesk.", "intercom."];
const OFFICIAL_HOSTS = ["worldbank.org", "oecd.org", "europa.eu", "un.org", "ilo.org", "imf.org", "data.gov"];

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

function freshness(publishedAt: string | null) {
  if (!publishedAt) return 35;
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000) return 15;
  const ageDays = Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
  if (ageDays <= 365) return 100;
  if (ageDays <= 730) return 80;
  if (ageDays <= 1_460) return 60;
  return 40;
}

export function classifySourceUrl(value: string): SourceClass {
  let host = "";
  try {
    host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "other";
  }
  if (host.endsWith(".gov") || host.endsWith(".gov.uk") || host.endsWith(".gov.au") || host.endsWith(".gov.my") || host.endsWith(".int") || OFFICIAL_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "official";
  if (host.endsWith(".edu") || host.endsWith(".ac.uk") || host.includes("journals.") || host.includes("researchgate.")) return "academic";
  if (host.includes("investor") || host.includes("annualreport") || host.includes("sec.gov")) return "company";
  if (VENDOR_DOMAINS.some((domain) => host === domain.slice(0, -1) || host.includes(domain))) return "vendor";
  if (/(association|chamber|council|institute|federation|society|alliance)/.test(host)) return "industry";
  if (host.endsWith(".org")) return "other";
  return "independent";
}

export function scoreSearchCandidate(candidate: SearchCandidate) {
  const sourceClass = classifySourceUrl(candidate.url);
  const directness = candidate.query ? overlap(candidate.query.query, `${candidate.title} ${candidate.snippet ?? ""}`) * 100 : 35;
  const provider = candidate.providerScore === null ? 40 : bounded(candidate.providerScore * 100);
  const score = bounded((AUTHORITY[sourceClass] * 0.45) + (directness * 0.35) + (freshness(candidate.publishedAt) * 0.1) + (provider * 0.1));
  return { sourceClass, score };
}

export function assessFetchedSource(input: {
  url: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  query: Pick<ResearchQuery, "query" | "candidateMarket" | "comparisonDimension"> | null;
  priorSources: Array<{ sourceClass: SourceClass; title: string; excerpt: string }>;
}): SourceAssessment {
  const sourceClass = classifySourceUrl(input.url);
  const authorityScore = AUTHORITY[sourceClass];
  const queryDirectnessScore = input.query ? bounded(overlap(input.query.query, `${input.title} ${input.excerpt}`) * 100) : 30;
  const freshnessScore = freshness(input.publishedAt);
  const sameClassCount = input.priorSources.filter((source) => source.sourceClass === sourceClass).length;
  const diversityScore = bounded(100 - (sameClassCount * 18), 25);
  const extractabilityScore = bounded((input.excerpt.trim().length / 1_000) * 100, 15);
  const highestSimilarity = input.priorSources.reduce((highest, source) => Math.max(highest, overlap(`${input.title} ${input.excerpt}`, `${source.title} ${source.excerpt}`)), 0);
  const redundancyPenalty = bounded(highestSimilarity * 30, 0, 30);
  const overallScore = bounded(
    (authorityScore * 0.3)
    + (queryDirectnessScore * 0.25)
    + (freshnessScore * 0.15)
    + (diversityScore * 0.15)
    + (extractabilityScore * 0.15)
    - redundancyPenalty,
  );
  const rationale = [
    `${sourceClass} source class`,
    queryDirectnessScore >= 60 ? "directly relevant to its assigned query" : "only partly aligned with its assigned query",
    freshnessScore >= 80 ? "recent publication metadata" : input.publishedAt ? "older publication metadata" : "no publication date",
    redundancyPenalty >= 12 ? "similar to evidence already collected" : "adds a distinct evidence lead",
  ];
  return {
    sourceClass,
    authorityScore,
    queryDirectnessScore,
    freshnessScore,
    diversityScore,
    extractabilityScore,
    redundancyPenalty,
    overallScore,
    decisionRelevant: overallScore >= 60 && queryDirectnessScore >= 45 && sourceClass !== "vendor" && sourceClass !== "other",
    rationale,
  };
}

export function assessResearchCoverage(input: {
  candidateMarkets: string[];
  sources: Array<{ sourceClass: SourceClass; overallScore: number; decisionRelevant: boolean; query: Pick<ResearchQuery, "candidateMarket" | "comparisonDimension"> | null }>;
}): ResearchCoverage {
  const candidateMarkets = Array.from(new Set(input.candidateMarkets.map((item) => item.trim()).filter(Boolean))).slice(0, 5);
  const dimensions = DEEP_RESEARCH_DIMENSIONS.filter((dimension) => dimension !== "counter_evidence");
  const cells = candidateMarkets.flatMap((candidateMarket) => dimensions.map((dimension) => {
    const qualifying = input.sources.filter((source) => source.decisionRelevant && source.overallScore >= 60 && source.query?.candidateMarket === candidateMarket && source.query?.comparisonDimension === dimension);
    return {
      candidateMarket,
      dimension,
      qualifyingSources: qualifying.length,
      sourceClasses: Array.from(new Set(qualifying.map((source) => source.sourceClass))),
    };
  }));
  const qualifying = input.sources.filter((source) => source.decisionRelevant && source.overallScore >= 60);
  const sourceClassCount = new Set(qualifying.map((source) => source.sourceClass)).size;
  const gaps = cells.filter((cell) => cell.qualifyingSources < 1 || cell.sourceClasses.length < 1).map((cell) => `${cell.candidateMarket}: ${cell.dimension.replaceAll("_", " ")} needs direct evidence.`).slice(0, 8);
  const fullyCoveredCandidates = candidateMarkets.filter((candidateMarket) => cells.filter((cell) => cell.candidateMarket === candidateMarket).every((cell) => cell.qualifyingSources >= 1));
  const comparisonReady = candidateMarkets.length >= 2 && fullyCoveredCandidates.length >= 2 && sourceClassCount >= 2 && qualifying.length >= 8 && gaps.length === 0;
  if (candidateMarkets.length < 2) gaps.unshift("Ano needs at least two candidate markets before it can make a comparative market recommendation.");
  if (sourceClassCount < 2) gaps.push("The qualifying evidence lacks source-class diversity.");
  if (qualifying.length < 8) gaps.push("Ano needs more than a handful of decision-relevant sources before ranking markets.");
  return { candidateMarkets, cells, qualifyingSourceCount: qualifying.length, sourceClassCount, comparisonReady, gaps: Array.from(new Set(gaps)).slice(0, 10) };
}

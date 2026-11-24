import { createHash } from "node:crypto";

import type { CompanyDiscoverySearch, MarketScope } from "@/lib/ano/market-discovery";

export class CompanyDiscoveryBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyDiscoveryBoundaryError";
  }
}

const COUNTRY_ALIASES: Record<string, string> = {
  uk: "United Kingdom",
  "u.k.": "United Kingdom",
  us: "United States",
  "u.s.": "United States",
  usa: "United States",
  "u.s.a.": "United States",
  uae: "United Arab Emirates",
  au: "Australia",
  aus: "Australia",
  nz: "New Zealand",
  sg: "Singapore",
  my: "Malaysia",
  ca: "Canada",
  de: "Germany",
  fr: "France",
};

const MARKET_DESCRIPTOR_SUFFIX_REGEX =
  /\s+(?:(?:national|domestic|regional|local|global|international|enterprise|mid[- ]market|smb|b2b|b2c|commercial|consumer|services|tech|technology|saas|ai|digital)\s+)*(?:market|markets|sector|economy|territory|territories|region|area|hub|ecosystem|landscape|corridor|zone)s?$/i;

const TRAILING_NATIONAL_REGEX = /\s+national$/i;

/**
 * Expands common country aliases and strips non-geographic market/sector suffixes
 * (for example "United States National Market" -> "United States").
 */
export function normalizeLocationQuery(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return collapsed;

  const aliasFirst = COUNTRY_ALIASES[collapsed.toLowerCase()];
  if (aliasFirst) return aliasFirst;

  let cleaned = collapsed.replace(/^the\s+/i, "").trim();
  const aliasWithoutThe = COUNTRY_ALIASES[cleaned.toLowerCase()];
  if (aliasWithoutThe) return aliasWithoutThe;

  for (let pass = 0; pass < 3; pass += 1) {
    const withoutMarket = cleaned.replace(MARKET_DESCRIPTOR_SUFFIX_REGEX, "").trim();
    const next =
      withoutMarket && withoutMarket !== cleaned
        ? withoutMarket
        : cleaned.replace(TRAILING_NATIONAL_REGEX, "").trim();
    if (!next || next === cleaned) break;
    cleaned = next;
  }

  cleaned = cleaned.replace(/[,;:\-—–]+$/, "").trim();
  if (!cleaned) return collapsed;

  return COUNTRY_ALIASES[cleaned.toLowerCase()] ?? cleaned;
}

/**
 * Produces an ordered, deduplicated list of progressively simpler geographic query
 * candidates for a location string.
 */
export function buildLocationQueryCandidates(raw: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (value: string | undefined) => {
    if (!value) return;
    const normalized = normalizeLocationQuery(value);
    if (!normalized) return;
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    candidates.push(normalized);
  };

  pushCandidate(raw);

  const rawNormalized = normalizeLocationQuery(raw);
  const parenMatch = rawNormalized.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    pushCandidate(parenMatch[1]);
    pushCandidate(parenMatch[2]);
  }

  const splitQualifiers = rawNormalized.split(/\s+[—–-]\s+|[:/]/);
  if (splitQualifiers.length > 1) {
    for (const part of splitQualifiers) {
      pushCandidate(part);
    }
  }

  const expandedBases = [...candidates];
  for (const base of expandedBases) {
    const metroMatch = base.match(/^(?:Greater|Metro(?:politan)?)\s+(.+)$/i);
    if (metroMatch?.[1]) {
      pushCandidate(metroMatch[1]);
    }

    if (base.includes(",")) {
      const commaParts = base
        .split(",")
        .map((part) => normalizeLocationQuery(part))
        .filter(Boolean);

      if (commaParts.length > 1) {
        pushCandidate(commaParts.join(", "));
        if (commaParts.length >= 3) {
          pushCandidate(commaParts.slice(0, commaParts.length - 1).join(", "));
        }
        for (let i = 1; i < commaParts.length; i += 1) {
          pushCandidate(commaParts.slice(i).join(", "));
        }
        if (commaParts.length >= 3) {
          for (let i = 1; i < commaParts.length - 1; i += 1) {
            pushCandidate(commaParts[i]);
          }
        }
      }
    }
  }

  return candidates;
}

export function selectCanonicalLocation(requested: string, suggestions: Array<{ name: string; type: string }>) {
  const normalisedRequested = normalizeLocationQuery(requested).trim().toLocaleLowerCase();
  const exact = suggestions.find((item) => item.name.trim().toLocaleLowerCase() === normalisedRequested);
  if (exact) return exact.name;
  const containsRequested = suggestions.find((item) => item.name.toLocaleLowerCase().includes(normalisedRequested));
  if (containsRequested) return containsRequested.name;
  return suggestions[0]?.name;
}

export function createProspeoCompanySearchPreview(
  searchId: string,
  scope: MarketScope,
  canonicalLocations: string[],
  requestedAt = new Date().toISOString(),
): CompanyDiscoverySearch {
  if (scope.state !== "awaiting_provider_approval" || scope.kind !== "location" || scope.locations.length === 0) {
    throw new CompanyDiscoveryBoundaryError("Lock a location scope before Ano can prepare a company-search preview.");
  }
  if (canonicalLocations.length !== scope.locations.length || canonicalLocations.some((item) => !item)) {
    throw new CompanyDiscoveryBoundaryError("Prospeo could not verify every selected location. Ano will not create a chargeable query with an ambiguous location.");
  }
  const providerFilters = { company_location_search: { include: canonicalLocations } };
  return {
    id: searchId,
    status: "awaiting_approval",
    requestedAt,
    scope: scope.locations,
    criteria: ["Company head office matches the locked location scope"],
    maximumResults: 25,
    estimatedMaximumCredits: 1,
    estimateDetail: "One first-page request can return up to 25 companies. Prospeo charges one credit only when it returns at least one company; an exact duplicate page can be free for 30 days.",
    providerFilters,
    canonicalLocations,
  };
}

export function stableSearchHash(scope: MarketScope, canonicalLocations: string[]) {
  return createHash("sha256").update(JSON.stringify({ provider: "prospeo", page: 1, scope: scope.locations, locations: canonicalLocations })).digest("hex");
}

import { createHash } from "node:crypto";

import type { CompanyDiscoverySearch, MarketScope } from "@/lib/ano/market-discovery";

export class CompanyDiscoveryBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyDiscoveryBoundaryError";
  }
}

export function selectCanonicalLocation(requested: string, suggestions: Array<{ name: string; type: string }>) {
  const normalisedRequested = requested.trim().toLocaleLowerCase();
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

import assert from "node:assert/strict";
import test from "node:test";

import type { MarketScope } from "../src/lib/ano/market-discovery";
import { searchProspeoCompanies, suggestProspeoLocations } from "../src/server/connectors/prospeo/prospeo-client";
import { CompanyDiscoveryBoundaryError, createProspeoCompanySearchPreview, selectCanonicalLocation } from "../src/server/domain/prospeo-company-discovery";

const scope: MarketScope = {
  state: "awaiting_provider_approval",
  kind: "location",
  locations: ["Malaysia"],
  source: "workspace_decision",
  summary: "Locked for test.",
};

test("the preview is local, bounded to one page, and discloses the maximum credit impact", () => {
  const preview = createProspeoCompanySearchPreview("search-1", scope, ["Malaysia"], "2026-10-22T00:00:00.000Z");
  assert.equal(preview.maximumResults, 25);
  assert.equal(preview.estimatedMaximumCredits, 1);
  assert.deepEqual(preview.providerFilters, { company_location_search: { include: ["Malaysia"] } });
  assert.match(preview.estimateDetail, /exact duplicate page can be free/i);
});

test("Ano refuses to prepare a chargeable query without a locked location scope", () => {
  assert.throws(
    () => createProspeoCompanySearchPreview("search-1", { ...scope, state: "awaiting_market_evidence", kind: "compare", locations: [] }, []),
    (error: unknown) => error instanceof CompanyDiscoveryBoundaryError,
  );
});

test("location canonicalization uses a Prospeo-returned value rather than composing one", () => {
  assert.equal(selectCanonicalLocation("Kuala Lumpur", [{ name: "Kuala Lumpur, Malaysia", type: "CITY" }]), "Kuala Lumpur, Malaysia");
});

test("free suggestions and the one-page company search use distinct provider requests", async () => {
  const originalKey = process.env.PROSPEO_KEY;
  process.env.PROSPEO_KEY = "test-key";
  const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    if (String(input).endsWith("/search-suggestions")) {
      return new Response(JSON.stringify({ error: false, location_suggestions: [{ name: "Malaysia", type: "COUNTRY" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: false, free: false, results: [{ company: { company_id: "company-1", name: "Acme", industry: "Software Development", employee_range: "11-20", location: { country: "Malaysia" } } }], pagination: { total_count: 1 } }), { status: 200 });
  };
  try {
    const suggestions = await suggestProspeoLocations("Malaysia", fetcher as typeof fetch);
    assert.equal(suggestions[0]?.name, "Malaysia");
    const companies = await searchProspeoCompanies({ company_location_search: { include: ["Malaysia"] } }, fetcher as typeof fetch);
    assert.equal(companies.companies[0]?.name, "Acme");
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.method, "POST");
    assert.match(requests[0]?.body ?? "", /location_search/);
    assert.equal(requests[1]?.method, "POST");
    assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), { page: 1, filters: { company_location_search: { include: ["Malaysia"] } } });
  } finally {
    if (originalKey === undefined) delete process.env.PROSPEO_KEY;
    else process.env.PROSPEO_KEY = originalKey;
  }
});

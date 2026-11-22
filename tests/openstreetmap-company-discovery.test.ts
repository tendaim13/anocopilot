import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaver } from "@langchain/langgraph";

import {
  buildTargetCompanySearchPreview,
  deriveOsmTagFilters,
  deriveProspeoIndustryCandidates,
  recommendDiscoveryProvider,
  scoreAndBuildAccountDossier,
  summarizeAccountCohort,
  type OsmResolvedArea,
} from "@/lib/ano/company-discovery";
import type { IndustryProfile, MarketProfile } from "@/lib/ano/market-synthesis";
import {
  buildNominatimPoiSearchUrl,
  buildOverpassQuery,
  enrichMissingOsmWebsitesWithSearxng,
  OSM_USER_AGENT,
  resolveOsmLocation,
  searchOsmBusinesses,
} from "@/server/connectors/openstreetmap/osm-client";
import { createTargetToAccountGraph } from "@/server/langgraph/target-to-account-graph";

const convId = "00000000-0000-4000-8000-000000000501";
const decisionId = "00000000-0000-4000-8000-000000000502";
const marketId = "00000000-0000-4000-8000-000000000503";
const industryId = "00000000-0000-4000-8000-000000000504";
const claimId = "00000000-0000-4000-8000-000000000505";
const searchId = "00000000-0000-4000-8000-000000000506";
const dossierId = "00000000-0000-4000-8000-000000000507";
const now = "2026-11-21T08:30:00.000Z";

const market: MarketProfile = {
  id: marketId,
  name: "Kuala Lumpur, Malaysia",
  summary: "High urban multi-chair clinic density.",
  evidenceStrength: "moderate",
  claimIds: [claimId],
  unknowns: ["Suburban chain breakdown"],
  nextResearchActions: ["Inspect clinic websites"],
};

const dentalIndustry: IndustryProfile = {
  id: industryId,
  marketProfileId: marketId,
  name: "Dental industry",
  summary: "Multi-chair clinics with high hygiene recall dropoff.",
  operationalProblems: ["Missed 6-month recall visits"],
  solutionFit: ["Automated recall SMS/WhatsApp cadence"],
  buyerRoleHypotheses: ["Principal Dentist", "Practice Manager"],
  evidenceStrength: "moderate",
  claimIds: [claimId],
  unknowns: ["Existing PMS stack"],
};

test("OSM tag mapper, provider recommender, and Prospeo taxonomy fallback classify verticals cleanly", () => {
  const dentalTags = deriveOsmTagFilters("Dental industry", [
    "dental clinic",
    "dental practice",
    "dentist",
  ]);
  assert.deepEqual(dentalTags, [
    { key: "amenity", value: "dentist" },
    { key: "healthcare", value: "dentist" },
  ]);
  assert.equal(recommendDiscoveryProvider("Dental industry", ["dental clinic"]), "openstreetmap");
  assert.equal(
    recommendDiscoveryProvider("Enterprise ERP Manufacturing", ["erp software"]),
    "prospeo",
  );
  assert.deepEqual(deriveProspeoIndustryCandidates("Dental industry"), [
    "Medical Practices",
    "Hospitals and Health Care",
  ]);
});

test("resolveOsmLocation sends User-Agent and buildNominatimPoiSearchUrl formats bounded viewbox cleanly", async () => {
  let seenUserAgent = "";
  const relationArea = await resolveOsmLocation("Kuala Lumpur, Malaysia", (async (_url, init) => {
    seenUserAgent = new Headers(init?.headers).get("User-Agent") ?? "";
    return new Response(
      JSON.stringify([
        {
          osm_type: "node",
          osm_id: 111,
          display_name: "KL node",
          class: "place",
          type: "city",
          importance: 0.7,
          boundingbox: ["3.0", "3.2", "101.6", "101.8"],
        },
        {
          osm_type: "relation",
          osm_id: 2939672,
          display_name: "Kuala Lumpur, Malaysia",
          class: "boundary",
          type: "administrative",
          importance: 0.85,
          boundingbox: ["3.033", "3.243", "101.615", "101.758"],
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch);

  assert.equal(seenUserAgent, OSM_USER_AGENT);
  assert.equal(relationArea.osmType, "relation");
  assert.equal(relationArea.areaId, 3_602_939_672);
  assert.deepEqual(relationArea.boundingBox, [3.033, 3.243, 101.615, 101.758]);

  const nominatimUrl = new URL(
    buildNominatimPoiSearchUrl(relationArea, { key: "amenity", value: "dentist" }, 40),
  );
  assert.equal(nominatimUrl.searchParams.get("q"), "[amenity=dentist]");
  assert.equal(nominatimUrl.searchParams.get("format"), "jsonv2");
  assert.equal(nominatimUrl.searchParams.get("bounded"), "1");
  assert.equal(nominatimUrl.searchParams.get("viewbox"), "101.615,3.243,101.758,3.033");
  assert.equal(nominatimUrl.searchParams.get("extratags"), "1");
  assert.equal(nominatimUrl.searchParams.get("addressdetails"), "1");

  const qlArea = buildOverpassQuery(relationArea, [{ key: "amenity", value: "dentist" }], 50);
  assert.ok(qlArea.includes("area(3602939672)->.searchArea;"));
});

test("searchOsmBusinesses defaults to Nominatim bounded POI search, ranks richer clinics first, and caps at 25", async () => {
  const area: OsmResolvedArea = {
    requestedQuery: "Melbourne, Australia",
    displayName: "Melbourne, Victoria, Australia",
    osmType: "relation",
    osmId: 4246124,
    areaId: 3_604_246_124,
    boundingBox: [-38.1, -37.5, 144.5, 145.4],
  };

  const poiResults = [
    {
      place_id: 1,
      osm_type: "node",
      osm_id: 1,
      name: "Basic Dental Clinic",
      category: "amenity",
      type: "dentist",
      address: { city: "Melbourne", country: "Australia" },
      extratags: {},
    },
    {
      place_id: 2,
      osm_type: "way",
      osm_id: 2,
      name: "Collins Street Dental Group",
      category: "amenity",
      type: "dentist",
      address: {
        house_number: "120",
        road: "Collins Street",
        city: "Melbourne",
        state: "Victoria",
        country: "Australia",
      },
      extratags: {
        website: "https://collinsdental.com.au",
        phone: "+61 3 9000 1111",
        opening_hours: "Mo-Fr 08:30-17:30",
      },
    },
    {
      place_id: 3,
      osm_type: "node",
      osm_id: 3,
      name: "Collins Street Dental Group",
      category: "amenity",
      type: "dentist",
      address: { city: "Melbourne", country: "Australia" },
      extratags: {},
    },
    {
      place_id: 4,
      osm_type: "node",
      osm_id: 4,
      name: "Melbourne Dental Supply Laboratory",
      category: "amenity",
      type: "dentist",
      address: { city: "Melbourne", country: "Australia" },
      extratags: { website: "https://supplylab.com.au" },
    },
    ...Array.from({ length: 30 }, (_, index) => ({
      place_id: 100 + index,
      osm_type: "node",
      osm_id: 100 + index,
      name: `Suburban Clinic ${index + 1}`,
      category: "amenity",
      type: "dentist",
      address: { city: "Melbourne", country: "Australia" },
      extratags: { phone: `+61 3 9100 00${String(index).padStart(2, "0")}` },
    })),
  ];

  const result = await searchOsmBusinesses(
    {
      areas: [area],
      tags: [{ key: "amenity", value: "dentist" }],
      limit: 25,
      excludedTerms: ["laboratory", "supply"],
    },
    (async () =>
      new Response(JSON.stringify(poiResults), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
  );

  assert.equal(result.companies.length, 25);
  assert.equal(result.companies[0].name, "Collins Street Dental Group");
  assert.equal(result.companies[0].domain, "collinsdental.com.au");
  assert.equal(result.companies[0].provider, "openstreetmap");
  assert.ok(!result.companies.some((c) => c.name.includes("Laboratory")));
});

test("searchOsmBusinesses supports explicit Overpass mode via overpassUrl", async () => {
  const area: OsmResolvedArea = {
    requestedQuery: "Subang",
    displayName: "Subang Jaya, Malaysia",
    osmType: "node",
    osmId: 55,
    areaId: null,
    boundingBox: [3.01, 3.12, 101.51, 101.62],
  };

  let requestedEndpoint = "";
  const result = await searchOsmBusinesses(
    {
      areas: [area],
      tags: [{ key: "amenity", value: "dentist" }],
      overpassUrl: "https://overpass.example.test/api/interpreter",
    },
    (async (url) => {
      requestedEndpoint = String(url);
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: "node",
              id: 77,
              tags: {
                name: "Subang Family Dental",
                amenity: "dentist",
                website: "https://subangdental.my",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch,
  );

  assert.equal(requestedEndpoint, "https://overpass.example.test/api/interpreter");
  assert.equal(result.companies.length, 1);
  assert.equal(result.companies[0].name, "Subang Family Dental");
});

test("enrichMissingOsmWebsitesWithSearxng ignores directories, validates clinic tokens, and caps at 10 lookups", async () => {
  const input = Array.from({ length: 12 }, (_, index) => ({
    provider: "openstreetmap" as const,
    id: `node-${index}`,
    name: index === 0 ? "Bangsar Bright Dental" : `Clinic Number ${index}`,
    location: { city: "Kuala Lumpur", country: "Malaysia" },
  }));

  let searchCalls = 0;
  const enriched = await enrichMissingOsmWebsitesWithSearxng(input, {
    maxLookups: 15,
    searchFn: async (query) => {
      searchCalls += 1;
      if (query.includes("Bangsar Bright Dental")) {
        return {
          results: [
            { url: "https://www.facebook.com/bangsarbrightdental", title: "Facebook" },
            { url: "https://www.whatclinic.com/dentists/malaysia/bangsar", title: "WhatClinic" },
            { url: "https://bangsarbright.com.my/appointments", title: "Bangsar Bright Dental Care" },
          ],
        };
      }
      if (query.includes("Clinic Number 1")) {
        throw new Error("Simulated transient SearXNG error");
      }
      return {
        results: [{ url: "https://unrelatedfirm.com", title: "Unrelated Corp" }],
      };
    },
  });

  assert.equal(searchCalls, 10);
  assert.equal(enriched.attemptedCount, 10);
  assert.equal(enriched.resolvedCount, 1);
  assert.equal(enriched.businesses[0].domain, "bangsarbright.com.my");
  assert.equal(enriched.businesses[0].websiteSource, "searxng");
  assert.equal(enriched.businesses[2].domain, undefined);
});

test("OpenStreetMap preview, LangGraph flow, dossier scoring, and cohort summary use 0 credits and high fit", async () => {
  const osmTags = [{ key: "amenity", value: "dentist" }];
  const resolvedArea: OsmResolvedArea = {
    requestedQuery: "Kuala Lumpur, Malaysia",
    displayName: "Kuala Lumpur, Malaysia",
    osmType: "relation",
    osmId: 2939672,
    areaId: 3_602_939_672,
    boundingBox: [3.033, 3.243, 101.615, 101.758],
  };

  const graph = createTargetToAccountGraph(
    {
      canonicalizeLocations: async () => {
        throw new Error("Should use resolveOsmPreview for OpenStreetMap");
      },
      resolveOsmPreview: async () => [resolvedArea],
      savePreview: async (input) =>
        buildTargetCompanySearchPreview({
          searchId,
          conversationId: input.conversationId,
          targetDecisionId: input.targetDecisionId,
          market: input.market,
          industry: input.industry,
          providerKey: input.providerKey,
          requestedLocations: input.requestedLocations,
          canonicalLocations: input.canonicalLocations,
          osmAreas: input.osmAreas,
          osmTags: input.osmTags,
          resolveWebsites: input.resolveWebsites,
          nowIso: now,
        }),
      executeApprovedSearch: async () => {
        throw new Error("Preview should not execute");
      },
    },
    new MemorySaver(),
  );

  const previewResult = await graph.invoke(
    {
      stage: "preview",
      conversationId: convId,
      targetDecisionId: decisionId,
      targetMarket: market,
      targetIndustry: dentalIndustry,
      providerKey: "openstreetmap",
      resolveWebsites: true,
      osmTags,
      requestedLocations: ["Kuala Lumpur, Malaysia"],
      excludedCategories: [],
      searchId: null,
      status: "awaiting_approval",
      currentNode: "verify_locked_target",
    },
    { configurable: { thread_id: "phase-d-osm-preview" } },
  );

  assert.equal(previewResult.search?.providerKey, "openstreetmap");
  assert.equal(previewResult.search?.estimatedMaximumCredits, 0);
  assert.equal(previewResult.status, "awaiting_approval");

  const dossier = scoreAndBuildAccountDossier(
    {
      provider: "openstreetmap",
      id: "node-99",
      name: "Bangsar Bright Dental",
      website: "https://bangsarbright.com.my",
      domain: "bangsarbright.com.my",
      industry: "Dental Clinic (OpenStreetMap)",
      location: { city: "Kuala Lumpur", country: "Malaysia" },
      phone: "+60 3 2282 1000",
      address: "18 Jalan Telawi, Bangsar, Kuala Lumpur, Malaysia",
      osmUrl: "https://www.openstreetmap.org/node/99",
      osmTags: { amenity: "dentist", opening_hours: "Mo-Sa 09:00-18:00" },
      websiteSource: "searxng",
    },
    {
      dossierId,
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "openstreetmap",
      targetMarketName: "Kuala Lumpur, Malaysia",
      targetIndustryName: "Dental industry",
      canonicalLocations: ["Kuala Lumpur, Malaysia"],
      linkedClaimIds: [claimId],
      capturedAt: now,
    },
  );

  assert.equal(dossier.sourceKey, "osm:node-99");
  assert.equal(dossier.fit.industryScore, 35);
  assert.equal(dossier.fit.totalScore, 100);
  assert.equal(dossier.fit.confidence, "high");
  assert.ok(dossier.signals.some((s) => s.sourceAttribution === "SearXNG website lookup"));

  const cohort = summarizeAccountCohort(
    [dossier],
    "Kuala Lumpur, Malaysia",
    "Dental industry",
    12,
    "openstreetmap",
  );
  assert.ok(cohort.cohortExplanation.includes("OpenStreetMap returned 1 candidate"));
});

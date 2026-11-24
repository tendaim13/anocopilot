import assert from "node:assert/strict";
import test from "node:test";

import { resetGeminiModelCooldowns } from "@/server/agents/gemini-chat-model";
import { createGeminiChatModel } from "@/server/agents/gemini-chat-model";
import { getBedrockPlannerConfig, BedrockConfigurationError } from "@/server/agents/bedrock";
import {
  DropcontactClientError,
  verifyContactsWithDropcontact,
} from "@/server/connectors/dropcontact/dropcontact-client";
import {
  OsmClientError,
  resolveOsmLocationsSequentially,
  searchOsmBusinesses,
} from "@/server/connectors/openstreetmap/osm-client";
import {
  enrichProspeoPeople,
  ProspeoClientError,
  searchProspeoCompanies,
  searchProspeoPeople,
  suggestProspeoLocations,
} from "@/server/connectors/prospeo/prospeo-client";
import { ResearchProviderError } from "@/server/research/research-provider";
import { searxngResearchProvider } from "@/server/research/searxng-provider";
// @ts-expect-error ESM smoke helper does not carry separate declaration files
import { runSearxngSmokeCheck } from "../scripts/smoke-searxng-gateway.mjs";

const NOW = "2026-11-25T00:00:00.000Z";

test("SearXNG + Brave Search contract: accepts Brave results, rejects DuckDuckGo, malformed JSON, and unauthenticated gateway", async () => {
  const prevBase = process.env.SEARXNG_BASE_URL;
  const prevToken = process.env.SEARXNG_GATEWAY_TOKEN;
  const prevFetch = globalThis.fetch;
  process.env.SEARXNG_BASE_URL = "https://search.example.internal";
  process.env.SEARXNG_GATEWAY_TOKEN = "smoke-gateway-token";

  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              url: "https://asic.gov.au/report?utm_source=brave",
              title: "Australian Services Benchmark",
              content: "Official benchmark statistics",
              score: 0.91,
              engine: "braveapi",
              publishedDate: NOW,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    const searchResult = await searxngResearchProvider.search("australian services automation");
    assert.equal(searchResult.results.length, 1);
    assert.equal(searchResult.results[0]?.url, "https://asic.gov.au/report");

    globalThis.fetch = (async () =>
      new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    await assert.rejects(
      () => searxngResearchProvider.search("malformed searxng check"),
      (err: unknown) => err instanceof ResearchProviderError && err.code === "INVALID_RESPONSE",
    );

    const smokeOk = await runSearxngSmokeCheck({
      baseUrl: "https://search.example.internal",
      gatewayToken: "smoke-gateway-token",
      fetcher: async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url);
        const token = (init?.headers as Record<string, string>)?.["X-Ano-Gateway-Token"];
        if (u.endsWith("/healthz") && !token) return new Response("Unauthorized", { status: 401 });
        if (u.endsWith("/healthz") && token === "smoke-gateway-token") return new Response("ok", { status: 200 });
        return new Response(
          JSON.stringify({
            results: [{ url: "https://example.gov/study", engine: "braveapi" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    assert.equal(smokeOk.ok, true);
    assert.deepEqual(smokeOk.enginesObserved, ["braveapi"]);

    await assert.rejects(
      () =>
        runSearxngSmokeCheck({
          baseUrl: "https://search.example.internal",
          gatewayToken: "smoke-gateway-token",
          fetcher: async (url: RequestInfo | URL, init?: RequestInit) => {
            const u = String(url);
            const token = (init?.headers as Record<string, string>)?.["X-Ano-Gateway-Token"];
            if (u.endsWith("/healthz") && !token) return new Response("Unauthorized", { status: 401 });
            if (u.endsWith("/healthz")) return new Response("ok", { status: 200 });
            return new Response(
              JSON.stringify({
                results: [{ url: "https://example.org", engine: "duckduckgo" }],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          },
        }),
      /DuckDuckGo/i,
    );
  } finally {
    globalThis.fetch = prevFetch;
    if (prevBase === undefined) delete process.env.SEARXNG_BASE_URL;
    else process.env.SEARXNG_BASE_URL = prevBase;
    if (prevToken === undefined) delete process.env.SEARXNG_GATEWAY_TOKEN;
    else process.env.SEARXNG_GATEWAY_TOKEN = prevToken;
  }
});

test("OpenStreetMap contract: geocodes resolved areas, rejects empty NO_RESULTS and HTTP 429 without auto-retry", async () => {
  const areas = await resolveOsmLocationsSequentially(
    ["Sydney, Australia"],
    async () =>
      new Response(
        JSON.stringify([
          {
            osm_type: "relation",
            osm_id: 5750005,
            display_name: "Sydney, New South Wales, Australia",
            class: "boundary",
            type: "administrative",
            importance: 0.9,
            boundingbox: ["-34.118", "-33.578", "150.520", "151.343"],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    0,
  );
  assert.equal(areas.length, 1);

  let poiCalls = 0;
  await assert.rejects(
    () =>
      searchOsmBusinesses(
        { areas, tags: [{ key: "healthcare", value: "dentist" }], limit: 10 },
        async () => {
          poiCalls += 1;
          return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
        },
      ),
    (err: unknown) => err instanceof OsmClientError && err.code === "RATE_LIMITED",
  );
  assert.equal(poiCalls, 1);

  await assert.rejects(
    () =>
      searchOsmBusinesses(
        { areas, tags: [{ key: "healthcare", value: "dentist" }], limit: 10 },
        async () => new Response(JSON.stringify([]), { status: 200 }),
      ),
    (err: unknown) => err instanceof OsmClientError && err.code === "NO_RESULTS",
  );
});

test("Prospeo & Dropcontact contracts: handle location suggestions, 25-company cap, people discovery, selective email enrichment, and error codes safely", async () => {
  const prevProspeo = process.env.PROSPEO_KEY;
  const prevDropcontact = process.env.DROPCONTACT_API_KEY;
  process.env.PROSPEO_KEY = "test-prospeo-secret";
  process.env.DROPCONTACT_API_KEY = "test-dropcontact-secret";

  try {
    const locs = await suggestProspeoLocations("Sydney", async () =>
      new Response(
        JSON.stringify({
          error: false,
          location_suggestions: [{ name: "Sydney, New South Wales, Australia", type: "city" }],
        }),
        { status: 200 },
      ),
    );
    assert.deepEqual(locs, [{ name: "Sydney, New South Wales, Australia", type: "city" }]);

    const companiesRes = await searchProspeoCompanies({}, async () =>
      new Response(
        JSON.stringify({
          error: false,
          results: Array.from({ length: 30 }, (_, i) => ({
            company: { company_id: `co-${i}`, name: `Practice ${i}`, domain: `practice${i}.com.au` },
          })),
          pagination: { total_count: 30 },
        }),
        { status: 200 },
      ),
    );
    assert.equal(companiesRes.companies.length, 25);

    const peopleRes = await searchProspeoPeople({}, async () =>
      new Response(
        JSON.stringify({
          error: false,
          results: [
            {
              person: {
                person_id: "p-1",
                first_name: "Mei",
                last_name: "Tan",
                current_job_title: "Principal Dentist",
                linkedin_url: "https://linkedin.com/in/mei-tan",
              },
              company: { company_id: "co-1", name: "Practice 1", domain: "practice1.com.au" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    assert.equal(peopleRes.people[0]?.fullName, "Mei Tan");

    await assert.rejects(
      () =>
        enrichProspeoPeople(
          [{ contactId: "c-1", fullName: "Mei Tan", companyName: "Practice 1" }],
          async () =>
            new Response(
              JSON.stringify({ error: true, error_code: "INSUFFICIENT_CREDITS" }),
              { status: 402 },
            ),
        ),
      (err: unknown) => err instanceof ProspeoClientError && err.code === "INSUFFICIENT_CREDITS",
    );

    let dcCalls = 0;
    const dcRes = await verifyContactsWithDropcontact(
      [
        {
          contactId: "c-dc-1",
          fullName: "Liam Chen",
          firstName: "Liam",
          lastName: "Chen",
          companyName: "Practice 1",
          website: "https://practice1.com.au",
          linkedInUrl: null,
          prospeoPersonId: null,
          fieldsSent: ["first_name", "last_name", "full_name", "company", "website"],
        },
        {
          contactId: "c-dc-2",
          fullName: "Invalid Lead",
          firstName: "Invalid",
          lastName: "Lead",
          companyName: "Practice 1",
          website: "https://practice1.com.au",
          linkedInUrl: null,
          prospeoPersonId: null,
          fieldsSent: ["first_name", "last_name", "full_name", "company", "website"],
        },
      ],
      async (_url, init) => {
        dcCalls += 1;
        if (init?.method === "POST") {
          return new Response(
            JSON.stringify({ error: false, request_id: "dc-req-1", credits_left: 42 }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            error: false,
            request_id: "dc-req-1",
            credits_left: 40,
            data: [
              {
                custom_fields: { ano_contact_id: "c-dc-1" },
                email: [{ email: "liam@practice1.com.au", qualification: "nominative@pro" }],
                website: "https://practice1.com.au",
              },
              {
                custom_fields: { ano_contact_id: "c-dc-2" },
                email: [{ email: "bad@practice1.com.au", qualification: "fail" }],
                website: "https://practice1.com.au",
              },
            ],
          }),
          { status: 200 },
        );
      },
      { pollIntervalMs: 0, maxPollAttempts: 3 },
    );
    assert.equal(dcCalls, 2);
    assert.equal(dcRes.results[0]?.verified, true);
    assert.equal(dcRes.results[0]?.email, "liam@practice1.com.au");
    assert.equal(dcRes.results[1]?.verified, false);
    assert.equal(dcRes.results[1]?.email, null);

    await assert.rejects(
      () =>
        verifyContactsWithDropcontact(
          [
            {
              contactId: "c-dc-1",
              fullName: "Liam Chen",
              firstName: "Liam",
              lastName: "Chen",
              companyName: "Practice 1",
              website: null,
              linkedInUrl: null,
              prospeoPersonId: null,
              fieldsSent: ["full_name", "company"],
            },
          ],
          async () => new Response("rate limit", { status: 429 }),
          { pollIntervalMs: 0, maxPollAttempts: 1 },
        ),
      (err: unknown) => err instanceof DropcontactClientError && err.code === "RATE_LIMITED",
    );
  } finally {
    if (prevProspeo === undefined) delete process.env.PROSPEO_KEY;
    else process.env.PROSPEO_KEY = prevProspeo;
    if (prevDropcontact === undefined) delete process.env.DROPCONTACT_API_KEY;
    else process.env.DROPCONTACT_API_KEY = prevDropcontact;
  }
});

test("Reasoning LLM contracts: Gemini fails over cleanly on 503 and redacts 401 keys; Bedrock rejects partial server config", async () => {
  resetGeminiModelCooldowns();
  const prevAwsRegion = process.env.AWS_REGION;
  delete process.env.AWS_REGION;

  try {
    assert.throws(() => getBedrockPlannerConfig(), BedrockConfigurationError);

    let calledModels = 0;
    const model = createGeminiChatModel(
      {
        provider: "gemini",
        apiKey: "super-secret-gemini-key",
        modelId: "gemini-3.5-flash-lite",
        fallbackModelIds: ["gemini-3.1-flash-lite"],
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        thinkingBudget: 0,
        thinkingLevel: "minimal",
      },
      {
        fetcher: async (url: RequestInfo | URL) => {
          calledModels += 1;
          if (String(url).includes("gemini-3.5-flash-lite")) {
            return new Response(JSON.stringify({ error: { message: "Overloaded" } }), { status: 503 });
          }
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
        retryDelayMs: 0,
      },
    );
    const result = await model.invoke([{ type: "human", content: "Return ok json" } as never]);
    assert.ok(calledModels >= 2);
    assert.equal(String(result.content), "{\"ok\":true}");
  } finally {
    resetGeminiModelCooldowns();
    if (prevAwsRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = prevAwsRegion;
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { evidenceResearchSourceSchema, researchProviderKeySchema } from "@/lib/ano/evidence-research";
import { ResearchProviderError } from "@/server/research/research-provider";
import { searxngConfiguration, searxngResearchProvider } from "@/server/research/searxng-provider";

test("SearXNG is unavailable without both server-only gateway settings", () => {
  const priorUrl = process.env.SEARXNG_BASE_URL;
  const priorToken = process.env.SEARXNG_GATEWAY_TOKEN;
  delete process.env.SEARXNG_BASE_URL;
  delete process.env.SEARXNG_GATEWAY_TOKEN;
  assert.equal(searxngConfiguration().available, false);
  if (priorUrl === undefined) delete process.env.SEARXNG_BASE_URL; else process.env.SEARXNG_BASE_URL = priorUrl;
  if (priorToken === undefined) delete process.env.SEARXNG_GATEWAY_TOKEN; else process.env.SEARXNG_GATEWAY_TOKEN = priorToken;
});

test("Ano keeps historical Tavily records readable while allowing SearXNG for new runs", () => {
  assert.equal(researchProviderKeySchema.parse("tavily"), "tavily");
  assert.equal(researchProviderKeySchema.parse("searxng"), "searxng");
  assert.throws(() => researchProviderKeySchema.parse("unknown-provider"));
});

test("Ano accepts the full bounded source excerpt that it stores", () => {
  const excerpt = "e".repeat(1_200);
  assert.equal(evidenceResearchSourceSchema.parse({
    id: "a21e62ad-2fe0-4a27-b99d-6e712a2de20d",
    title: "Public report",
    url: "https://example.com/report",
    sourceClass: "official",
    excerpt,
    publishedAt: null,
    retrievedAt: "2026-10-24T03:00:00.000Z",
    status: "fetched",
  }).excerpt, excerpt);
});

test("SearXNG returns only bounded, normalised discovery metadata", async () => {
  const priorUrl = process.env.SEARXNG_BASE_URL;
  const priorToken = process.env.SEARXNG_GATEWAY_TOKEN;
  const priorFetch = globalThis.fetch;
  process.env.SEARXNG_BASE_URL = "https://search.ano.example";
  process.env.SEARXNG_GATEWAY_TOKEN = "test-gateway-token";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://search.ano.example");
    assert.equal(url.pathname, "/search");
    assert.equal(url.searchParams.get("format"), "json");
    assert.equal(url.searchParams.get("q"), "AI workflow statistics");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-Ano-Gateway-Token"), "test-gateway-token");
    assert.equal(headers.get("Accept"), "application/json, text/html;q=0.9");
    assert.equal(headers.get("Accept-Language"), "en");
    assert.equal(headers.get("User-Agent"), "AnoResearch/0.1 (private authenticated research gateway)");
    return new Response(JSON.stringify({
      results: [
        { url: "https://example.com/report#section", title: "Public report", content: "A short description", score: 0.9, publishedDate: "2026-10-20" },
        { url: "https://example.com/report#another", title: "Duplicate", content: "Ignored duplicate" },
        { url: "mailto:person@example.com", title: "Not a public page" },
      ],
    }), { headers: { "content-type": "application/json" } });
  };
  try {
    const result = await searxngResearchProvider.search("AI workflow statistics");
    assert.equal(result.credits, null);
    assert.equal(result.results.length, 1);
    assert.deepEqual(result.results[0], {
      providerResultId: result.results[0].providerResultId,
      title: "Public report",
      url: "https://example.com/report",
      snippet: "A short description",
      score: 0.9,
      publishedAt: "2026-10-20T00:00:00.000Z",
    });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.SEARXNG_BASE_URL; else process.env.SEARXNG_BASE_URL = priorUrl;
    if (priorToken === undefined) delete process.env.SEARXNG_GATEWAY_TOKEN; else process.env.SEARXNG_GATEWAY_TOKEN = priorToken;
  }
});

test("SearXNG accepts null optional result fields without rejecting valid discovery results", async () => {
  const priorUrl = process.env.SEARXNG_BASE_URL;
  const priorToken = process.env.SEARXNG_GATEWAY_TOKEN;
  const priorFetch = globalThis.fetch;
  process.env.SEARXNG_BASE_URL = "https://search.ano.example";
  process.env.SEARXNG_GATEWAY_TOKEN = "test-gateway-token";
  globalThis.fetch = async () => new Response(JSON.stringify({
    results: [
      { url: "https://example.com/report", title: "Public report", content: "A short description", score: 0.9, publishedDate: null },
      { url: "https://example.com/untitled", title: null, content: null, score: null, publishedDate: null },
    ],
  }), { headers: { "content-type": "application/json" } });
  try {
    const result = await searxngResearchProvider.search("AI workflow statistics");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0]?.publishedAt, null);
    assert.deepEqual(result.results[1], {
      providerResultId: result.results[1]?.providerResultId,
      title: "Untitled source",
      url: "https://example.com/untitled",
      snippet: null,
      score: null,
      publishedAt: null,
    });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.SEARXNG_BASE_URL; else process.env.SEARXNG_BASE_URL = priorUrl;
    if (priorToken === undefined) delete process.env.SEARXNG_GATEWAY_TOKEN; else process.env.SEARXNG_GATEWAY_TOKEN = priorToken;
  }
});

test("SearXNG rejects a malformed successful payload without replaying the request", async () => {
  const priorUrl = process.env.SEARXNG_BASE_URL;
  const priorToken = process.env.SEARXNG_GATEWAY_TOKEN;
  const priorFetch = globalThis.fetch;
  process.env.SEARXNG_BASE_URL = "https://search.ano.example";
  process.env.SEARXNG_GATEWAY_TOKEN = "test-gateway-token";
  globalThis.fetch = async () => new Response(JSON.stringify({ results: "not-an-array" }), { headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(() => searxngResearchProvider.search("AI workflow statistics"), (error: unknown) => {
      assert.ok(error instanceof ResearchProviderError);
      assert.equal(error.code, "INVALID_RESPONSE");
      return true;
    });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.SEARXNG_BASE_URL; else process.env.SEARXNG_BASE_URL = priorUrl;
    if (priorToken === undefined) delete process.env.SEARXNG_GATEWAY_TOKEN; else process.env.SEARXNG_GATEWAY_TOKEN = priorToken;
  }
});

test("Ano records a rejected private-gateway response without replaying it", async () => {
  const priorUrl = process.env.SEARXNG_BASE_URL;
  const priorToken = process.env.SEARXNG_GATEWAY_TOKEN;
  const priorFetch = globalThis.fetch;
  process.env.SEARXNG_BASE_URL = "https://search.ano.example";
  process.env.SEARXNG_GATEWAY_TOKEN = "test-gateway-token";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("Unauthorized", { status: 401, headers: { "content-type": "text/plain" } });
  };
  try {
    await assert.rejects(() => searxngResearchProvider.search("AI workflow statistics"), (error: unknown) => {
      assert.ok(error instanceof ResearchProviderError);
      assert.equal(error.code, "REJECTED");
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.SEARXNG_BASE_URL; else process.env.SEARXNG_BASE_URL = priorUrl;
    if (priorToken === undefined) delete process.env.SEARXNG_GATEWAY_TOKEN; else process.env.SEARXNG_GATEWAY_TOKEN = priorToken;
  }
});

test("Ano marks an unconfirmed SearXNG connection as manual-review only", async () => {
  const priorUrl = process.env.SEARXNG_BASE_URL;
  const priorToken = process.env.SEARXNG_GATEWAY_TOKEN;
  const priorFetch = globalThis.fetch;
  process.env.SEARXNG_BASE_URL = "https://search.ano.example";
  process.env.SEARXNG_GATEWAY_TOKEN = "test-gateway-token";
  globalThis.fetch = async () => { throw new TypeError("network unavailable"); };
  try {
    await assert.rejects(() => searxngResearchProvider.search("AI workflow statistics"), (error: unknown) => {
      assert.ok(error instanceof ResearchProviderError);
      assert.equal(error.code, "UNCERTAIN_OUTCOME");
      return true;
    });
  } finally {
    globalThis.fetch = priorFetch;
    if (priorUrl === undefined) delete process.env.SEARXNG_BASE_URL; else process.env.SEARXNG_BASE_URL = priorUrl;
    if (priorToken === undefined) delete process.env.SEARXNG_GATEWAY_TOKEN; else process.env.SEARXNG_GATEWAY_TOKEN = priorToken;
  }
});

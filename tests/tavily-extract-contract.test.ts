import assert from "node:assert/strict";
import test from "node:test";

import { normaliseTavilyExtractPayload, ResearchProviderError } from "@/server/research/tavily-provider";

test("Tavily Extract keeps a valid partial batch when a source has null content or a chunk array", () => {
  const response = normaliseTavilyExtractPayload({
    request_id: "request-1",
    usage: { credits: 1 },
    results: [
      { url: "https://example.com/one", raw_content: null },
      { url: "https://example.com/two", raw_content: ["First chunk", "Second chunk"] },
    ],
    failed_results: null,
  });
  assert.equal(response.requestId, "request-1");
  assert.equal(response.credits, 1);
  assert.deepEqual(response.results, [
    { url: "https://example.com/one", content: "" },
    { url: "https://example.com/two", content: "First chunk\nSecond chunk" },
  ]);
  assert.deepEqual(response.failures, []);
});

test("Tavily Extract exposes only structural diagnostics for an invalid response", () => {
  assert.throws(() => normaliseTavilyExtractPayload({ results: "not-an-array" }), (error: unknown) => {
    assert.ok(error instanceof ResearchProviderError);
    assert.equal(error.code, "INVALID_RESPONSE");
    assert.deepEqual(error.diagnostic, {
      payloadType: "object",
      topLevelKeys: ["results"],
      resultsType: "string",
      failedResultsType: "undefined",
    });
    return true;
  });
});

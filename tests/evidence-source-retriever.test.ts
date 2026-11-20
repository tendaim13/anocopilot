import assert from "node:assert/strict";
import test from "node:test";

import { createEvidenceSourceRetriever } from "@/server/research/evidence-source-retriever";
import { ResearchProviderError } from "@/server/research/research-provider";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("Ano extracts a short readable excerpt but not page markup", async () => {
  const retriever = createEvidenceSourceRetriever({
    lookup: publicLookup,
    fetch: async () => new Response("<html><body><nav>Skip me</nav><main><h1>Evidence heading</h1><p>Useful public evidence.</p><script>secret()</script></main></body></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
  });
  const response = await retriever.fetchSavedResult({ id: "saved-result-1", canonicalUrl: "https://example.com/research#heading" });
  assert.equal(response.failures.length, 0);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0].url, "https://example.com/research");
  assert.equal(response.results[0].contentType, "text/html");
  assert.match(response.results[0].content, /Evidence heading/);
  assert.match(response.results[0].content, /Useful public evidence/);
  assert.doesNotMatch(response.results[0].content, /secret|Skip me/);
});

test("Ano records a safe failure before a private address can be fetched", async () => {
  let calls = 0;
  const retriever = createEvidenceSourceRetriever({
    lookup: async () => [{ address: "10.0.0.8", family: 4 }],
    fetch: async () => { calls += 1; return new Response("unexpected"); },
  });
  const response = await retriever.fetchSavedResult({ id: "saved-result-2", canonicalUrl: "https://untrusted.example/path" });
  assert.equal(calls, 0);
  assert.equal(response.results.length, 0);
  assert.equal(response.failures.length, 1);
  assert.equal(response.failures[0].status, "rejected");
  assert.match(response.failures[0].message, /private network/i);
});

test("Ano validates each redirect target before following it", async () => {
  let calls = 0;
  const retriever = createEvidenceSourceRetriever({
    lookup: publicLookup,
    fetch: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/internal" } });
    },
  });
  const response = await retriever.fetchSavedResult({ id: "saved-result-3", canonicalUrl: "https://example.com/redirect" });
  assert.equal(calls, 1);
  assert.equal(response.results.length, 0);
  assert.equal(response.failures.length, 1);
  assert.equal(response.failures[0].status, "rejected");
  assert.match(response.failures[0].message, /unsafe|local|private/i);
});

test("Ano records an unsupported source as a source-level safe failure", async () => {
  const retriever = createEvidenceSourceRetriever({
    lookup: publicLookup,
    fetch: async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
  });
  const response = await retriever.fetchSavedResult({ id: "saved-result-4", canonicalUrl: "https://example.com/report.pdf" });
  assert.equal(response.results.length, 0);
  assert.equal(response.failures.length, 1);
  assert.equal(response.failures[0].status, "rejected");
  assert.match(response.failures[0].message, /HTML or plain-text/i);
});

test("Ano surfaces an unconfirmed source request without retrying it", async () => {
  let calls = 0;
  const retriever = createEvidenceSourceRetriever({
    lookup: publicLookup,
    fetch: async () => {
      calls += 1;
      throw new Error("network interrupted");
    },
  });
  await assert.rejects(
    () => retriever.fetchSavedResult({ id: "saved-result-5", canonicalUrl: "https://example.com/uncertain" }),
    (error: unknown) => error instanceof ResearchProviderError && error.code === "UNCERTAIN_OUTCOME",
  );
  assert.equal(calls, 1);
});

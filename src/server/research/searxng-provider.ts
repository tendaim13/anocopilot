import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { ResearchProviderKey } from "@/lib/ano/evidence-research";
import {
  ResearchProviderError,
  type ProviderSearchResponse,
} from "@/server/research/research-provider";
import { recordInternalApiUsage } from "@/server/telemetry/internal-api-usage";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_RESULTS_PER_QUERY = 5;
const ANO_RESEARCH_USER_AGENT = "AnoResearch/0.1 (private authenticated research gateway)";

const searxngResponseSchema = z.object({
  results: z.array(z.object({
    url: z.string(),
    // SearXNG uses null for optional fields when an engine did not provide
    // them. Treat those as absent rather than rejecting the whole response.
    title: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    score: z.number().nullable().optional(),
    publishedDate: z.string().nullable().optional(),
  }).passthrough()).default([]),
}).passthrough();

function clipped(value: string | null | undefined, maximum: number) {
  const text = value?.replace(/\u0000/g, "").trim() ?? "";
  return text ? text.slice(0, maximum) : null;
}

function canonicalWebUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ResearchProviderError("Ano rejected a non-web search result before source retrieval.", "INVALID_RESPONSE");
  }
  if (url.username || url.password || !url.hostname) {
    throw new ResearchProviderError("Ano rejected an unsafe search-result URL before source retrieval.", "INVALID_RESPONSE");
  }
  url.hash = "";
  return url.toString();
}

function asIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function baseUrl() {
  const value = process.env.SEARXNG_BASE_URL?.trim() ?? "";
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
    url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return url;
  } catch {
    return null;
  }
}

function gatewayToken() {
  return process.env.SEARXNG_GATEWAY_TOKEN?.trim() ?? "";
}

function configurationError() {
  return new ResearchProviderError(
    "SearXNG is not configured. Add the private HTTPS gateway URL and gateway token to Ano’s server environment before preparing public research.",
    "NOT_CONFIGURED",
  );
}

export function searxngConfiguration() {
  return {
    provider: "searxng" as ResearchProviderKey,
    available: Boolean(baseUrl() && gatewayToken()),
    maximumSearches: 50,
    maximumFetches: 100,
    pricingNote: "SearXNG is Ano’s private search service. Ano will show the mission’s 50-search and 100-source maximum before approval; individual public websites may still reject retrieval.",
  };
}

async function readTextWithinLimit(response: Response, maximumBytes: number) {
  const headerLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(headerLength) && headerLength > maximumBytes) {
    throw new ResearchProviderError("SearXNG returned a response larger than Ano’s safe processing limit.", "INVALID_RESPONSE", { contentLength: headerLength, maximumBytes });
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResearchProviderError("SearXNG returned a response larger than Ano’s safe processing limit.", "INVALID_RESPONSE", { responseBytes: size, maximumBytes });
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function searchRequest(query: string): Promise<unknown> {
  const endpoint = baseUrl();
  const token = gatewayToken();
  if (!endpoint || !token) throw configurationError();
  const url = new URL("search", endpoint);
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("categories", "general");
  url.searchParams.set("language", "en");
  url.searchParams.set("safesearch", "1");
  url.searchParams.set("pageno", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        // Ano is an authenticated application client, not a browser. Include
        // text/html as an acceptable representation for SearXNG's standard
        // request classifier while retaining JSON as the requested response.
        Accept: "application/json, text/html;q=0.9",
        "Accept-Language": "en",
        "User-Agent": ANO_RESEARCH_USER_AGENT,
        "X-Ano-Gateway-Token": token,
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const text = await readTextWithinLimit(response, MAX_RESPONSE_BYTES);
    if (!response.ok) {
      if (response.status === 429) throw new ResearchProviderError("The private SearXNG service rate-limited this run. Ano stopped without retrying.", "RATE_LIMITED", { responseStatus: response.status });
      if (response.status >= 500) throw new ResearchProviderError("The private SearXNG service did not confirm a usable search response. Ano stopped for manual review and will not retry it automatically.", "UNCERTAIN_OUTCOME", { responseStatus: response.status });
      throw new ResearchProviderError("The private SearXNG gateway rejected this bounded research request. No retry was attempted.", "REJECTED", { responseStatus: response.status });
    }
    if (!contentType.includes("application/json")) {
      throw new ResearchProviderError("SearXNG returned a response Ano could not validate. No follow-up request was attempted.", "INVALID_RESPONSE", { contentType, responseBytes: text.length });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ResearchProviderError("SearXNG returned malformed JSON. No follow-up request was attempted.", "INVALID_RESPONSE", { contentType, responseBytes: text.length });
    }
  } catch (error) {
    if (error instanceof ResearchProviderError) throw error;
    if (controller.signal.aborted) {
      throw new ResearchProviderError("Ano could not confirm whether the private SearXNG search request completed. It stopped for manual review without retrying.", "UNCERTAIN_OUTCOME");
    }
    throw new ResearchProviderError("Ano could not confirm the private SearXNG search request outcome. It stopped for manual review without retrying.", "UNCERTAIN_OUTCOME");
  } finally {
    clearTimeout(timer);
  }
}

/** Server-only private-search adapter. It returns discovery metadata only. */
export const searxngResearchProvider = {
  key: "searxng" as ResearchProviderKey,

  async search(query: string): Promise<ProviderSearchResponse> {
    const value = query.trim();
    if (value.length < 3 || value.length > 380) {
      throw new ResearchProviderError("Ano rejected an invalid research query before contacting SearXNG.", "INVALID_RESPONSE");
    }
    const startedAt = Date.now();
    try {
      const payload = searxngResponseSchema.safeParse(await searchRequest(value));
      if (!payload.success) {
        throw new ResearchProviderError("SearXNG returned a search response Ano could not validate. No follow-up request was attempted.", "INVALID_RESPONSE", { issueCount: payload.error.issues.length });
      }
      const uniqueUrls = new Set<string>();
      const results = payload.data.results.flatMap((result, index) => {
        try {
          const url = canonicalWebUrl(result.url);
          if (uniqueUrls.has(url) || uniqueUrls.size >= MAX_RESULTS_PER_QUERY) return [];
          uniqueUrls.add(url);
          return [{
            providerResultId: createHash("sha256").update(`${url}:${index}`).digest("hex"),
            title: clipped(result.title, 500) ?? "Untitled source",
            url,
            snippet: clipped(result.content, 1_200),
            score: typeof result.score === "number" && Number.isFinite(result.score) ? result.score : null,
            publishedAt: asIsoDate(result.publishedDate),
          }];
        } catch {
          return [];
        }
      });
      recordInternalApiUsage({
        provider: "searxng",
        operation: "search",
        modelOrEndpoint: "/search",
        status: "success",
        httpStatus: 200,
        durationMs: Date.now() - startedAt,
        metadata: { resultCount: results.length },
      });
      return {
        requestId: createHash("sha256").update(`${value}:${results.map((result) => result.url).join("|")}`).digest("hex"),
        credits: null,
        results,
      };
    } catch (error) {
      const errCode = error instanceof ResearchProviderError ? error.code : "INVALID_RESPONSE";
      const responseStatus =
        error instanceof ResearchProviderError && typeof error.diagnostic.responseStatus === "number"
          ? error.diagnostic.responseStatus
          : null;
      recordInternalApiUsage({
        provider: "searxng",
        operation: "search",
        modelOrEndpoint: "/search",
        status:
          errCode === "RATE_LIMITED"
            ? "rate_limited"
            : errCode === "UNCERTAIN_OUTCOME"
              ? "timeout"
              : "error",
        httpStatus: responseStatus,
        durationMs: Date.now() - startedAt,
        metadata: { errorCode: errCode },
      });
      throw error;
    }
  },
};

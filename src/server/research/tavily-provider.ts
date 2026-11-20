import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type { ResearchProviderKey } from "@/lib/ano/evidence-research";
import {
  ResearchProviderError,
  type ProviderExtractResponse,
  type ProviderSearchResponse,
  type ProviderSearchResult,
} from "@/server/research/research-provider";

// Retain these exports for historic Tavily parsing/audit tests. New Phase B
// runs use SearXNG and Ano-owned source retrieval instead.
export { ResearchProviderError } from "@/server/research/research-provider";
export type {
  ProviderExtractResponse,
  ProviderSearchResponse,
  ProviderSearchResult,
} from "@/server/research/research-provider";

const TAVILY_API_URL = "https://api.tavily.com";
const REQUEST_TIMEOUT_MS = 20_000;

const tavilySearchResponseSchema = z.object({
  request_id: z.string().optional(),
  usage: z.object({ credits: z.number().nonnegative().optional() }).optional(),
  results: z.array(z.object({
    id: z.string().optional(),
    title: z.string().optional(),
    url: z.string().url(),
    content: z.string().optional(),
    score: z.number().optional(),
    published_date: z.string().optional(),
  })).default([]),
});

const tavilyExtractResponseSchema = z.object({
  request_id: z.string().optional(),
  usage: z.object({ credits: z.number().nonnegative().optional() }).optional(),
  results: z.array(z.object({
    // Extract can legitimately return a URL with no extractable content, or
    // represent source chunks as a list. These are per-source outcomes, not a
    // reason to discard the entire otherwise-valid batch response.
    url: z.string().optional().nullable(),
    raw_content: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  }).passthrough()).optional().nullable().transform((value) => value ?? []),
  failed_results: z.array(z.object({
    url: z.string().optional().nullable(),
    error: z.unknown().optional(),
  }).passthrough()).optional().nullable().transform((value) => value ?? []),
}).passthrough();

function secret() {
  return process.env.TAVILY_API_KEY?.trim() ?? "";
}

export function tavilyConfiguration() {
  return {
    provider: "tavily" as ResearchProviderKey,
    available: Boolean(secret()),
    maximumSearches: 50,
    maximumFetches: 100,
    pricingNote: "Tavily reports credits after each completed request. Ano will show the fixed maximum operations before approval and the reported usage afterwards.",
  };
}

function canonicalUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ResearchProviderError("Ano rejected a non-web source before it could be fetched.", "INVALID_RESPONSE");
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || /^127\./.test(hostname) || hostname === "::1") {
    throw new ResearchProviderError("Ano rejected a local or private source before it could be fetched.", "INVALID_RESPONSE");
  }
  url.hash = "";
  return url.toString();
}

function asIsoDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function clipped(value: string | undefined, maximum: number) {
  const text = value?.replace(/\u0000/g, "").trim() ?? "";
  return text ? text.slice(0, maximum) : null;
}

function structuralShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { payloadType: Array.isArray(value) ? "array" : typeof value };
  const record = value as Record<string, unknown>;
  return {
    payloadType: "object",
    topLevelKeys: Object.keys(record).sort().slice(0, 20),
    resultsType: Array.isArray(record.results) ? "array" : typeof record.results,
    failedResultsType: Array.isArray(record.failed_results) ? "array" : typeof record.failed_results,
  };
}

function canonicalOrNull(value: string | null | undefined) {
  if (!value) return null;
  try { return canonicalUrl(value); } catch { return null; }
}

function extractedContent(value: string | string[] | null | undefined) {
  const text = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("\n") : value;
  return clipped(text ?? undefined, 12_000) ?? "";
}

function extractFailureMessage(value: unknown) {
  return typeof value === "string" ? clipped(value, 500) ?? "Tavily could not retrieve this source." : "Tavily could not retrieve this source.";
}

/** Parses only the documented, content-minimising Extract response contract. */
export function normaliseTavilyExtractPayload(rawPayload: unknown): ProviderExtractResponse {
  const payload = tavilyExtractResponseSchema.safeParse(rawPayload);
  if (!payload.success) throw new ResearchProviderError("Tavily returned a source response Ano could not validate. No follow-up request was attempted.", "INVALID_RESPONSE", structuralShape(rawPayload));
  return {
    requestId: payload.data.request_id ?? null,
    credits: payload.data.usage?.credits ?? null,
    results: payload.data.results.flatMap((result) => {
      const url = canonicalOrNull(result.url);
      return url ? [{ url, content: extractedContent(result.raw_content) }] : [];
    }),
    failures: payload.data.failed_results.flatMap((result) => {
      const url = canonicalOrNull(result.url);
      return url ? [{ url, message: extractFailureMessage(result.error) }] : [];
    }),
  };
}

async function tavilyRequest(path: "/search" | "/extract", body: Record<string, unknown>) {
  const apiKey = secret();
  if (!apiKey) throw new ResearchProviderError("Tavily is not configured. Add TAVILY_API_KEY to Ano’s server environment before starting live research.", "NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${TAVILY_API_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 429) throw new ResearchProviderError("Tavily rate-limited this research run. Ano stopped without retrying because a duplicate request could consume credits.", "RATE_LIMITED");
      if (response.status >= 500 || controller.signal.aborted) throw new ResearchProviderError("Tavily did not confirm whether this request completed. Ano stopped for manual review and will not retry it automatically.", "UNCERTAIN_OUTCOME");
      throw new ResearchProviderError("Tavily rejected this bounded research request. No retry was attempted.", "REJECTED");
    }
    return payload;
  } catch (error) {
    if (error instanceof ResearchProviderError) throw error;
    if (controller.signal.aborted) throw new ResearchProviderError("Tavily did not confirm whether this request completed. Ano stopped for manual review and will not retry it automatically.", "UNCERTAIN_OUTCOME");
    throw new ResearchProviderError("Ano could not confirm the Tavily request outcome. It stopped for manual review without retrying.", "UNCERTAIN_OUTCOME");
  } finally {
    clearTimeout(timer);
  }
}

/** Server-only adapter. The model never receives this API key or direct HTTP access. */
export const tavilyResearchProvider = {
  key: "tavily" as ResearchProviderKey,

  async search(query: string): Promise<ProviderSearchResponse> {
    const value = query.trim();
    if (value.length < 3 || value.length > 380) throw new ResearchProviderError("Ano rejected an invalid research query before contacting Tavily.", "INVALID_RESPONSE");
    const payload = tavilySearchResponseSchema.safeParse(await tavilyRequest("/search", {
      query: value,
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_usage: true,
      safe_search: true,
      auto_parameters: false,
    }));
    if (!payload.success) throw new ResearchProviderError("Tavily returned a response Ano could not validate. No follow-up request was attempted.", "INVALID_RESPONSE");
    return {
      requestId: payload.data.request_id ?? null,
      credits: payload.data.usage?.credits ?? null,
      results: payload.data.results.map((result, index) => ({
        providerResultId: result.id ?? createHash("sha256").update(`${result.url}:${index}`).digest("hex"),
        title: clipped(result.title, 500) ?? "Untitled source",
        url: canonicalUrl(result.url),
        snippet: clipped(result.content, 1_200),
        score: typeof result.score === "number" ? result.score : null,
        publishedAt: asIsoDate(result.published_date),
      })),
    };
  },

  async extract(urls: string[]): Promise<ProviderExtractResponse> {
    const uniqueUrls = [...new Set(urls.map(canonicalUrl))];
    if (!uniqueUrls.length || uniqueUrls.length > 20) throw new ResearchProviderError("Ano rejected an invalid source-fetch batch before contacting Tavily.", "INVALID_RESPONSE");
    const rawPayload = await tavilyRequest("/extract", {
      urls: uniqueUrls,
      chunks_per_source: 3,
      extract_depth: "basic",
      include_images: false,
      include_usage: true,
      format: "markdown",
    });
    return normaliseTavilyExtractPayload(rawPayload);
  },
};


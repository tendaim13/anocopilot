import "server-only";

import { createHash } from "node:crypto";
import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { load } from "cheerio";

import {
  ResearchProviderError,
  type ProviderExtractResponse,
} from "@/server/research/research-provider";

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 12_000;
const MAX_REDIRECTS = 3;

type LookupAddress = { address: string; family: number };
type Lookup = (hostname: string) => Promise<LookupAddress[]>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type SavedSearchResultReference = { id: string; canonicalUrl: string };

function clipped(value: string, maximum: number) {
  const normalised = value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  return normalised ? normalised.slice(0, maximum) : "";
}

function isUnsafeIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0)
    || first >= 224;
}

function isUnsafeIpv6(address: string) {
  const lower = address.toLowerCase();
  return lower === "::"
    || lower === "::1"
    || lower.startsWith("::ffff:")
    || lower.startsWith("fc")
    || lower.startsWith("fd")
    || lower.startsWith("fe80:")
    || lower.startsWith("2001:db8:");
}

function canonicalRemoteUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ResearchProviderError("Ano rejected a non-web source before it could be fetched.", "INVALID_RESPONSE");
  }
  if (url.username || url.password || !url.hostname || isIP(url.hostname)) {
    throw new ResearchProviderError("Ano rejected an unsafe source URL before it could be fetched.", "INVALID_RESPONSE");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new ResearchProviderError("Ano rejected a local or private source before it could be fetched.", "INVALID_RESPONSE");
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "80" && port !== "443") {
    throw new ResearchProviderError("Ano rejected a source using a non-standard web port.", "INVALID_RESPONSE");
  }
  url.hash = "";
  return url;
}

async function assertPublicHost(url: URL, lookup: Lookup) {
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname);
  } catch {
    throw new ResearchProviderError("Ano could not safely resolve this public source before retrieval.", "INVALID_RESPONSE", { hostname: url.hostname });
  }
  if (!addresses.length || addresses.some((item) => item.family === 4 ? isUnsafeIpv4(item.address) : item.family === 6 ? isUnsafeIpv6(item.address) : true)) {
    throw new ResearchProviderError("Ano rejected a source that resolved to a local or private network.", "INVALID_RESPONSE", { hostname: url.hostname, addressCount: addresses.length });
  }
}

async function readTextWithinLimit(response: Response, maximumBytes: number) {
  const headerLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(headerLength) && headerLength > maximumBytes) return { text: "", overLimit: true, bytes: headerLength };
  if (!response.body) return { text: "", overLimit: false, bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return { text: "", overLimit: true, bytes };
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return { text: text + decoder.decode(), overLimit: false, bytes };
  } finally {
    reader.releaseLock();
  }
}

function extractText(contentType: string, body: string) {
  if (contentType.startsWith("text/plain")) return clipped(body, MAX_EXTRACTED_CHARACTERS);
  const $ = load(body);
  $("script, style, noscript, svg, canvas, iframe, form, nav, header, footer, aside, dialog, [aria-hidden='true']").remove();
  const scope = $("main, article, [role='main']").first();
  const candidates = (scope.length ? scope : $("body")).find("h1, h2, h3, p, li, blockquote, td, th").toArray();
  const text = candidates.map((element) => $(element).text()).join("\n");
  return clipped(text || $("body").text(), MAX_EXTRACTED_CHARACTERS);
}

function knownFailure(url: string, message: string, status: "failed_safe" | "rejected" = "failed_safe"): ProviderExtractResponse {
  return { requestId: null, credits: null, results: [], failures: [{ url, message, status }] };
}

/**
 * Fetches exactly one already-saved search result. It validates every redirect
 * target, accepts only short text/html or text/plain responses, and never
 * persists the page body itself.
 */
export function createEvidenceSourceRetriever(
  dependencies: { fetch?: FetchLike; lookup?: Lookup } = {},
) {
  const fetcher = dependencies.fetch ?? fetch;
  const lookup: Lookup = dependencies.lookup ?? (async (hostname) => {
    const result = await defaultLookup(hostname, { all: true, verbatim: true });
    return result.map((entry) => ({ address: entry.address, family: entry.family }));
  });

  return {
    async fetchSavedResult(savedResult: SavedSearchResultReference): Promise<ProviderExtractResponse> {
      const savedUrl = savedResult.canonicalUrl;
      let current: URL;
      try {
        current = canonicalRemoteUrl(savedUrl);
      } catch (error) {
        return knownFailure(savedUrl, error instanceof Error ? error.message : "Ano rejected this source before retrieval.", "rejected");
      }
      const storedUrl = current.toString();
      for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        try {
          await assertPublicHost(current, lookup);
        } catch (error) {
          return knownFailure(storedUrl, error instanceof Error ? error.message : "Ano rejected this source before retrieval.", "rejected");
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetcher(current, {
            headers: { Accept: "text/html, text/plain;q=0.9" },
            cache: "no-store",
            redirect: "manual",
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new ResearchProviderError("Ano could not confirm whether a source request completed. It stopped for manual review without retrying.", "UNCERTAIN_OUTCOME", { hostname: current.hostname });
          }
          throw new ResearchProviderError("Ano could not confirm the source retrieval outcome. It stopped for manual review without retrying.", "UNCERTAIN_OUTCOME", { hostname: current.hostname });
        } finally {
          clearTimeout(timer);
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) return knownFailure(current.toString(), "The source returned a redirect without a destination.");
          if (redirectCount === MAX_REDIRECTS) return knownFailure(current.toString(), "The source exceeded Ano’s safe redirect limit.");
          try {
            current = canonicalRemoteUrl(new URL(location, current).toString());
          } catch (error) {
            return knownFailure(storedUrl, error instanceof Error ? error.message : "Ano rejected this redirect before retrieval.", "rejected");
          }
          continue;
        }
        if (!response.ok) return knownFailure(current.toString(), `The source returned HTTP ${response.status}.`);
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (contentType !== "text/html" && contentType !== "text/plain") {
          return knownFailure(current.toString(), "Ano only keeps evidence from HTML or plain-text sources.", "rejected");
        }
        const body = await readTextWithinLimit(response, MAX_RESPONSE_BYTES);
        if (body.overLimit) return knownFailure(current.toString(), "The source exceeded Ano’s safe 2 MB retrieval limit.");
        const content = extractText(contentType, body.text);
        if (!content) return knownFailure(current.toString(), "Ano could not extract readable evidence from this source.");
        return {
          requestId: createHash("sha256").update(`${savedResult.id}:${current.toString()}`).digest("hex"),
          credits: null,
          results: [{ url: storedUrl, content, contentType }],
          failures: [],
        };
      }
      return knownFailure(savedUrl, "Ano could not safely complete source retrieval.");
    },
  };
}

export const evidenceSourceRetriever = createEvidenceSourceRetriever();

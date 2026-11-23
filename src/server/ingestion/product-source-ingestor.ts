import "server-only";

import { createHash } from "node:crypto";
import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { load } from "cheerio";

import type { ProductSourceType } from "@/lib/ano/research-conversation";
import { recordInternalApiUsage } from "@/server/telemetry/internal-api-usage";

const URL_TIMEOUT_MS = 10_000;
const MAX_URL_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_PRODUCT_PAGES = 3;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TXT_BYTES = 2 * 1024 * 1024;
export const MAX_PDF_PAGES = 25;
export const MAX_EXTRACTED_CHARS = 20_000;
const USER_AGENT = "AnoCopilot/1.0 (+https://anocopilot.local)";

const PRODUCT_LINK_REGEX =
  /\b(product|products|feature|features|solution|solutions|platform|pricing|about|services|how[- ]it[- ]works|overview|demo|platform)\b/i;

type LookupAddress = { address: string; family: number };
type Lookup = (hostname: string) => Promise<LookupAddress[]>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ProductIngestionErrorCode =
  | "UNSUPPORTED_FORMAT"
  | "FILE_TOO_LARGE"
  | "INVALID_FILE"
  | "EMPTY_CONTENT"
  | "UNSAFE_URL"
  | "FETCH_FAILED";

export class ProductIngestionError extends Error {
  constructor(
    message: string,
    readonly code: ProductIngestionErrorCode,
  ) {
    super(message);
    this.name = "ProductIngestionError";
  }
}

export type IngestedProductSource = {
  sourceType: ProductSourceType;
  label: string;
  sourceUrl: string | null;
  mimeType: string | null;
  byteSize: number;
  contentSha256: string;
  extractedText: string;
  summaryText: string;
};

type DomNodeLike = {
  type?: string;
  data?: string;
  children?: DomNodeLike[];
};

function isUnsafeIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0) ||
    first >= 224
  );
}

function isUnsafeIpv6(address: string) {
  const lower = address.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("::ffff:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80:") ||
    lower.startsWith("2001:db8:")
  );
}

function canonicalSafeUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ProductIngestionError("Enter a product website link first.", "UNSAFE_URL");
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ProductIngestionError("That website link is not a valid URL.", "UNSAFE_URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProductIngestionError("Only http and https product links are supported.", "UNSAFE_URL");
  }
  if (url.username || url.password || !url.hostname || isIP(url.hostname)) {
    throw new ProductIngestionError(
      "Direct IP addresses and credentialed URLs cannot be fetched.",
      "UNSAFE_URL",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".")
  ) {
    throw new ProductIngestionError(
      "Local or internal network URLs are blocked for security.",
      "UNSAFE_URL",
    );
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "80" && port !== "443") {
    throw new ProductIngestionError("Non-standard ports are not supported.", "UNSAFE_URL");
  }
  url.hash = "";
  return url;
}

async function assertPublicHost(url: URL, lookup: Lookup) {
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname);
  } catch {
    throw new ProductIngestionError(
      `Could not resolve host "${url.hostname}". Check the URL and try again.`,
      "FETCH_FAILED",
    );
  }
  if (
    !addresses.length ||
    addresses.some((item) =>
      item.family === 4
        ? isUnsafeIpv4(item.address)
        : item.family === 6
          ? isUnsafeIpv6(item.address)
          : true,
    )
  ) {
    throw new ProductIngestionError(
      `URL host "${url.hostname}" resolved to a private or non-public network address.`,
      "UNSAFE_URL",
    );
  }
}

async function readTextWithinLimit(response: Response, maxBytes: number): Promise<string> {
  const headerLen = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(headerLen) && headerLen > maxBytes) {
    throw new ProductIngestionError("The website response exceeded Ano’s 2 MB page limit.", "FETCH_FAILED");
  }
  if (!response.body) {
    return await response.text().catch(() => "");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ProductIngestionError(
          "The website response exceeded Ano’s 2 MB page limit.",
          "FETCH_FAILED",
        );
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function extractSpacedBodyText(html: string): { title: string; bodyText: string } {
  const $ = load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const metaDesc =
    $('meta[name="description"]').attr("content")?.replace(/\s+/g, " ").trim() ||
    $('meta[property="og:description"]').attr("content")?.replace(/\s+/g, " ").trim() ||
    "";

  $("script, style, noscript, svg, canvas, iframe").remove();

  const chunks: string[] = [];
  const visit = (node: DomNodeLike | undefined) => {
    if (!node) return;
    if (node.type === "text" && typeof node.data === "string") {
      const normalized = node.data.replace(/\s+/g, " ").trim();
      if (normalized) chunks.push(normalized);
      return;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };
  visit(($("body").get(0) ?? $.root().get(0)) as unknown as DomNodeLike | undefined);

  const visible = chunks.join(" ");
  const sections = [title ? `Title: ${title}` : "", metaDesc ? `Overview: ${metaDesc}` : "", visible]
    .filter(Boolean)
    .join("\n");
  return { title, bodyText: sections };
}

function discoverHighSignalProductLinks(html: string, baseUrl: string): string[] {
  const $ = load(html);
  const base = new URL(baseUrl);
  const baseRoot = base.hostname.replace(/^www\./i, "").toLowerCase();
  const scored = new Map<string, number>();

  $("a[href]").each((_idx, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(href)) return;
    let resolved: URL;
    try {
      resolved = canonicalSafeUrl(new URL(href, base).toString());
    } catch {
      return;
    }
    const linkRoot = resolved.hostname.replace(/^www\./i, "").toLowerCase();
    if (linkRoot !== baseRoot) return;
    if (resolved.toString() === base.toString()) return;
    if (/\.(pdf|jpg|jpeg|png|webp|svg|gif|zip|mp4|css|js)$/i.test(resolved.pathname)) return;

    const label = $(el).text().replace(/\s+/g, " ").trim();
    const combined = `${resolved.pathname} ${label}`;
    if (!PRODUCT_LINK_REGEX.test(combined)) return;

    const score =
      /\b(product|features|solutions|platform)\b/i.test(combined)
        ? 3
        : /\b(pricing|services|how-it-works)\b/i.test(combined)
          ? 2
          : 1;
    const prev = scored.get(resolved.toString()) ?? 0;
    if (score > prev) scored.set(resolved.toString(), score);
  });

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PRODUCT_PAGES - 1)
    .map(([url]) => url);
}

async function fetchSafePage(
  rawUrl: string,
  fetcher: FetchLike,
  lookup: Lookup,
): Promise<{ finalUrl: string; contentType: string; text: string }> {
  let current = canonicalSafeUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHost(current, lookup);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), URL_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetcher(current, {
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "User-Agent": USER_AGENT,
        },
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof ProductIngestionError) throw error;
      if (controller.signal.aborted) {
        throw new ProductIngestionError(
          `Timed out reading "${current.hostname}". Check the link or upload a PDF/Word file instead.`,
          "FETCH_FAILED",
        );
      }
      throw new ProductIngestionError(
        `Could not reach "${current.hostname}". Check the link or upload a product document instead.`,
        "FETCH_FAILED",
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get("location");
      if (!loc || redirectCount === MAX_REDIRECTS) {
        throw new ProductIngestionError("Product URL exceeded redirect limits.", "FETCH_FAILED");
      }
      current = canonicalSafeUrl(new URL(loc, current).toString());
      continue;
    }

    if (!response.ok) {
      throw new ProductIngestionError(
        `Website returned HTTP ${response.status} when reading "${current.hostname}".`,
        "FETCH_FAILED",
      );
    }

    const contentType =
      response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "text/html";
    if (contentType && !contentType.includes("html") && contentType !== "text/plain") {
      throw new ProductIngestionError(
        "That link does not return an HTML or plain-text product page. Upload the PDF or DOCX directly instead.",
        "UNSUPPORTED_FORMAT",
      );
    }

    const text = await readTextWithinLimit(response, MAX_URL_RESPONSE_BYTES);
    return { finalUrl: current.toString(), contentType, text };
  }

  throw new ProductIngestionError("Could not read that product URL.", "FETCH_FAILED");
}

function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

function buildProductSummaryText(extractedText: string): string {
  const singleLine = extractedText.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 420) return singleLine;
  const sliced = singleLine.slice(0, 420);
  const lastStop = Math.max(sliced.lastIndexOf(". "), sliced.lastIndexOf(" "));
  return `${(lastStop > 200 ? sliced.slice(0, lastStop) : sliced).trim()}…`;
}

export function detectUrlsInText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const seen = new Set<string>();
  const cleanUrls: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?)\]}]+$/, "");
    if (!cleaned || seen.has(cleaned.toLowerCase())) continue;
    try {
      const validated = canonicalSafeUrl(cleaned).toString();
      if (!seen.has(validated.toLowerCase())) {
        seen.add(validated.toLowerCase());
        cleanUrls.push(validated);
      }
    } catch {
      // Ignore unsafe/malformed URLs in free text.
    }
    if (cleanUrls.length >= 2) break;
  }
  return cleanUrls;
}

export async function ingestProductUrl(
  rawUrl: string,
  deps: { fetch?: FetchLike; lookup?: Lookup } = {},
): Promise<IngestedProductSource> {
  const startedAt = Date.now();
  const fetcher: FetchLike = deps.fetch ?? fetch;
  const lookup: Lookup =
    deps.lookup ??
    (async (hostname) => {
      const res = await defaultLookup(hostname, { all: true, verbatim: true });
      return res.map((entry) => ({ address: entry.address, family: entry.family }));
    });

  let hostLabel = "website";
  try {
    const validatedUrl = canonicalSafeUrl(rawUrl);
    hostLabel = validatedUrl.hostname.replace(/^www\./i, "");

    const mainPage = await fetchSafePage(validatedUrl.toString(), fetcher, lookup);
    const pageTexts: string[] = [];
    let pagesFetched = 1;
    let totalBytes = Buffer.byteLength(mainPage.text, "utf8");

    if (mainPage.contentType === "text/plain") {
      pageTexts.push(mainPage.text);
    } else {
      const parsedMain = extractSpacedBodyText(mainPage.text);
      if (parsedMain.bodyText) {
        pageTexts.push(parsedMain.bodyText);
      }
      const subLinks = discoverHighSignalProductLinks(mainPage.text, mainPage.finalUrl);
      for (const subUrl of subLinks) {
        try {
          const subPage = await fetchSafePage(subUrl, fetcher, lookup);
          pagesFetched += 1;
          totalBytes += Buffer.byteLength(subPage.text, "utf8");
          const parsedSub =
            subPage.contentType === "text/plain"
              ? { bodyText: subPage.text }
              : extractSpacedBodyText(subPage.text);
          if (parsedSub.bodyText) {
            pageTexts.push(`--- Page: ${subPage.finalUrl} ---\n${parsedSub.bodyText}`);
          }
        } catch {
          // Subpage failures stay non-fatal if main page succeeded.
        }
      }
    }

    const extractedText = normalizeExtractedText(pageTexts.join("\n\n"));
    if (extractedText.length < 20) {
      throw new ProductIngestionError(
        `The page at "${hostLabel}" had very little readable product copy. Paste a short description or upload a PDF/Word doc.`,
        "EMPTY_CONTENT",
      );
    }

    const contentSha256 = createHash("sha256").update(extractedText).digest("hex");
    recordInternalApiUsage({
      provider: "product_ingest",
      operation: "ingest_url",
      modelOrEndpoint: hostLabel,
      status: "success",
      requestCount: pagesFetched,
      creditsUsed: 0,
      durationMs: Date.now() - startedAt,
      metadata: { pagesFetched, charCount: extractedText.length },
    });

    return {
      sourceType: "website_url",
      label: hostLabel.slice(0, 200),
      sourceUrl: mainPage.finalUrl,
      mimeType: mainPage.contentType,
      byteSize: totalBytes,
      contentSha256,
      extractedText,
      summaryText: buildProductSummaryText(extractedText),
    };
  } catch (error) {
    recordInternalApiUsage({
      provider: "product_ingest",
      operation: "ingest_url",
      modelOrEndpoint: hostLabel,
      status: "error",
      creditsUsed: 0,
      durationMs: Date.now() - startedAt,
      metadata: {
        errorCode: error instanceof ProductIngestionError ? error.code : "FETCH_FAILED",
      },
    });
    if (error instanceof ProductIngestionError) throw error;
    throw new ProductIngestionError("Ano could not read that product website link.", "FETCH_FAILED");
  }
}

function resolveFileSourceType(
  fileName: string,
  mimeType?: string | null,
): "pdf" | "docx" | "txt" {
  const lowerName = fileName.trim().toLowerCase();
  const cleanMime = mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";

  if (lowerName.endsWith(".doc") || cleanMime === "application/msword") {
    throw new ProductIngestionError(
      "Legacy .doc files are not supported — save as .docx, .pdf, or .txt and upload again.",
      "UNSUPPORTED_FORMAT",
    );
  }
  if (lowerName.endsWith(".pdf") || cleanMime === "application/pdf") {
    return "pdf";
  }
  if (
    lowerName.endsWith(".docx") ||
    cleanMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    cleanMime === "text/plain" ||
    cleanMime === "text/markdown"
  ) {
    return "txt";
  }

  throw new ProductIngestionError(
    `Unsupported file format for "${fileName || "attachment"}". Upload a PDF (.pdf), Word doc (.docx), or text file (.txt / .md).`,
    "UNSUPPORTED_FORMAT",
  );
}

function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 32)).toString("latin1");
  return head.includes("%PDF-");
}

function hasZipMagicBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export async function ingestProductFile(input: {
  fileName: string;
  mimeType?: string | null;
  bytes: Uint8Array;
}): Promise<IngestedProductSource> {
  const startedAt = Date.now();
  const label = (input.fileName.trim() || "product-document").slice(0, 200);
  let sourceType: "pdf" | "docx" | "txt" = "txt";

  try {
    sourceType = resolveFileSourceType(label, input.mimeType);
    const byteSize = input.bytes.byteLength;
    if (byteSize === 0) {
      throw new ProductIngestionError(`"${label}" is empty.`, "EMPTY_CONTENT");
    }

    const maxBytes = sourceType === "txt" ? MAX_TXT_BYTES : MAX_FILE_BYTES;
    if (byteSize > maxBytes) {
      throw new ProductIngestionError(
        `"${label}" exceeds Ano’s ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`,
        "FILE_TOO_LARGE",
      );
    }

    let rawText = "";
    if (sourceType === "pdf") {
      if (!hasPdfMagicBytes(input.bytes)) {
        throw new ProductIngestionError(
          `"${label}" does not appear to be a valid PDF file.`,
          "INVALID_FILE",
        );
      }
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(input.bytes), { mergePages: false });
      const pages = Array.isArray(result.text)
        ? result.text.slice(0, MAX_PDF_PAGES)
        : [String(result.text ?? "")];
      rawText = pages.join("\n\n");
    } else if (sourceType === "docx") {
      if (!hasZipMagicBytes(input.bytes)) {
        throw new ProductIngestionError(
          `"${label}" does not appear to be a valid .docx Word document.`,
          "INVALID_FILE",
        );
      }
      const mammothMod = await import("mammoth");
      const extractRawText =
        mammothMod.extractRawText ??
        (mammothMod as unknown as { default?: typeof mammothMod }).default?.extractRawText;
      if (typeof extractRawText !== "function") {
        throw new Error("DOCX parser unavailable.");
      }
      const result = await extractRawText({ buffer: Buffer.from(input.bytes) });
      rawText = result.value ?? "";
    } else {
      if (input.bytes.some((b) => b === 0)) {
        throw new ProductIngestionError(
          `"${label}" contains binary data instead of UTF-8 text.`,
          "INVALID_FILE",
        );
      }
      try {
        rawText = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
      } catch {
        throw new ProductIngestionError(
          `"${label}" is not valid UTF-8 text.`,
          "INVALID_FILE",
        );
      }
    }

    const extractedText = normalizeExtractedText(rawText);
    if (extractedText.length < 20) {
      throw new ProductIngestionError(
        sourceType === "pdf"
          ? `Could not extract selectable text from "${label}". If it is a scanned image PDF, upload a text-based PDF, Word doc, or paste your product summary.`
          : `"${label}" contained too little readable text.`,
        "EMPTY_CONTENT",
      );
    }

    const contentSha256 = createHash("sha256").update(extractedText).digest("hex");
    recordInternalApiUsage({
      provider: "product_ingest",
      operation: "ingest_file",
      modelOrEndpoint: sourceType,
      status: "success",
      creditsUsed: 0,
      durationMs: Date.now() - startedAt,
      metadata: { byteSize, charCount: extractedText.length },
    });

    return {
      sourceType,
      label,
      sourceUrl: null,
      mimeType:
        input.mimeType ??
        (sourceType === "pdf"
          ? "application/pdf"
          : sourceType === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "text/plain"),
      byteSize,
      contentSha256,
      extractedText,
      summaryText: buildProductSummaryText(extractedText),
    };
  } catch (error) {
    recordInternalApiUsage({
      provider: "product_ingest",
      operation: "ingest_file",
      modelOrEndpoint: sourceType,
      status: "error",
      creditsUsed: 0,
      durationMs: Date.now() - startedAt,
      metadata: {
        errorCode: error instanceof ProductIngestionError ? error.code : "INVALID_FILE",
      },
    });
    if (error instanceof ProductIngestionError) throw error;
    throw new ProductIngestionError(
      `Could not extract text from "${label}". Try saving it as another .pdf, .docx, or .txt file.`,
      "INVALID_FILE",
    );
  }
}

export function formatProductSourcesForPrompt(
  sources: Array<{
    label: string;
    sourceType: string;
    summaryText?: string | null;
    extractedText: string;
  }>,
  maxTotalChars = 8_000,
): string {
  if (sources.length === 0) return "";
  const perSourceBudget = Math.max(1_000, Math.floor(maxTotalChars / sources.length));
  const parts: string[] = [];
  let used = 0;
  for (const src of sources) {
    if (used >= maxTotalChars) break;
    const excerpt = (src.extractedText || src.summaryText || "").trim().slice(0, perSourceBudget);
    if (!excerpt) continue;
    const block = `[Product source (${src.sourceType}): ${src.label}]\n${excerpt}`;
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n\n").slice(0, maxTotalChars);
}

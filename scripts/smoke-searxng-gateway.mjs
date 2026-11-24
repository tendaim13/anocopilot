import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SMOKE_QUERY = "b2b workflow software market research";

export function validateGatewayBaseUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) {
    throw new Error("SEARXNG_BASE_URL is required.");
  }
  const url = new URL(trimmed);
  if (url.protocol !== "https:") {
    throw new Error("SEARXNG_BASE_URL must use https://.");
  }
  if (url.username || url.password || !url.hostname) {
    throw new Error("SEARXNG_BASE_URL must not contain embedded credentials.");
  }
  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return url;
}

export async function runSearxngSmokeCheck({
  baseUrl,
  gatewayToken,
  query = DEFAULT_SMOKE_QUERY,
  fetcher = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const endpoint = validateGatewayBaseUrl(baseUrl);
  const token = String(gatewayToken ?? "").trim();
  if (!token) {
    throw new Error("SEARXNG_GATEWAY_TOKEN is required.");
  }
  const searchQuery = String(query ?? "").trim();
  if (searchQuery.length < 3) {
    throw new Error("Smoke search query must be at least 3 characters.");
  }

  const healthUrl = new URL("healthz", endpoint);
  const searchUrl = new URL("search", endpoint);
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("q", searchQuery);
  searchUrl.searchParams.set("categories", "general");
  searchUrl.searchParams.set("language", "en");
  searchUrl.searchParams.set("safesearch", "1");
  searchUrl.searchParams.set("pageno", "1");

  const withTimeout = async (url, headers) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetcher(url, {
        headers,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // 1. Verify unauthenticated access is rejected.
  const unauthRes = await withTimeout(healthUrl, { Accept: "text/plain" });
  if (unauthRes.status !== 401 && unauthRes.status !== 403) {
    throw new Error(
      `Expected unauthenticated /healthz to reject with 401 or 403, got HTTP ${unauthRes.status}.`,
    );
  }

  // 2. Verify authenticated /healthz returns 200 ok.
  const healthRes = await withTimeout(healthUrl, {
    Accept: "text/plain",
    "X-Ano-Gateway-Token": token,
  });
  const healthBody = (await healthRes.text()).trim();
  if (healthRes.status !== 200 || healthBody !== "ok") {
    throw new Error(
      `Expected authenticated /healthz to return HTTP 200 "ok", got HTTP ${healthRes.status} (${healthBody.slice(0, 80)}).`,
    );
  }

  // 3. Verify authenticated JSON search returns valid non-DuckDuckGo web results.
  const searchRes = await withTimeout(searchUrl, {
    Accept: "application/json, text/html;q=0.9",
    "Accept-Language": "en",
    "User-Agent": "AnoResearch/0.1 (private authenticated research gateway)",
    "X-Ano-Gateway-Token": token,
  });
  const contentType = (searchRes.headers.get("content-type") ?? "").toLowerCase();
  if (!searchRes.ok || !contentType.includes("application/json")) {
    throw new Error(
      `Authenticated /search failed with HTTP ${searchRes.status} (${contentType || "unknown content-type"}).`,
    );
  }

  const payload = await searchRes.json();
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.results)) {
    throw new Error("Authenticated /search returned invalid JSON payload without results array.");
  }

  const validResults = [];
  const enginesSet = new Set();

  for (const item of payload.results) {
    if (!item || typeof item !== "object" || typeof item.url !== "string") continue;
    let parsedUrl;
    try {
      parsedUrl = new URL(item.url);
    } catch {
      continue;
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") continue;

    const itemEngines = [];
    if (typeof item.engine === "string" && item.engine.trim()) {
      itemEngines.push(item.engine.trim().toLowerCase());
    }
    if (Array.isArray(item.engines)) {
      for (const eng of item.engines) {
        if (typeof eng === "string" && eng.trim()) {
          itemEngines.push(eng.trim().toLowerCase());
        }
      }
    }
    if (itemEngines.includes("duckduckgo")) {
      throw new Error("Smoke search observed unexpected DuckDuckGo result; ensure duckduckgo is removed from SearXNG settings.yml.");
    }
    for (const eng of itemEngines) enginesSet.add(eng);
    validResults.push(parsedUrl.toString());
  }

  if (validResults.length === 0) {
    throw new Error("Authenticated /search returned zero valid http(s) results.");
  }

  return {
    ok: true,
    endpointHost: endpoint.host,
    unauthHealthStatus: unauthRes.status,
    healthStatus: healthRes.status,
    resultCount: validResults.length,
    enginesObserved: Array.from(enginesSet).sort(),
  };
}

function parseQueryArg(argv) {
  const prefix = "--query=";
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : DEFAULT_SMOKE_QUERY;
}

const isEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  runSearxngSmokeCheck({
    baseUrl: process.env.SEARXNG_BASE_URL,
    gatewayToken: process.env.SEARXNG_GATEWAY_TOKEN,
    query: parseQueryArg(process.argv.slice(2)),
  })
    .then((summary) => {
      console.log(JSON.stringify(summary));
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "SearXNG smoke check failed.",
        }),
      );
      process.exit(1);
    });
}

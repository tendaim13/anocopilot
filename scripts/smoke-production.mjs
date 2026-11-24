import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { runSearxngSmokeCheck } from "./smoke-searxng-gateway.mjs";

const DEFAULT_TIMEOUT_MS = 15_000;
const LEAK_CHECK_PATTERN =
  /\b(?:PROSPEO_KEY|DROPCONTACT_API_KEY|SEARXNG_GATEWAY_TOKEN|GEMINI_API_KEY|SUPABASE_DB_URL|BRAVE_API_KEY|AWS_SECRET_ACCESS_KEY|Prospeo|Dropcontact|SearXNG|OpenStreetMap|Mercury|Google AI Studio)\b/;

export function validateBaseUrl(rawUrl) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) {
    throw new Error("ANO_SMOKE_BASE_URL is required.");
  }
  const url = new URL(trimmed);
  const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("ANO_SMOKE_BASE_URL must use https:// (or http:// for localhost).");
  }
  if (url.username || url.password || !url.hostname) {
    throw new Error("ANO_SMOKE_BASE_URL must not embed credentials.");
  }
  return new URL(url.toString().replace(/\/+$/, ""));
}

async function signInAndCollectCookies({
  supabaseUrl,
  supabasePublishableKey,
  authEmail,
  authPassword,
  authClientFactory,
  fetcher,
}) {
  const jar = new Map();
  const cookieApi = {
    getAll() {
      return Array.from(jar.entries()).map(([name, value]) => ({ name, value }));
    },
    setAll(cookiesToSet) {
      for (const item of cookiesToSet) {
        if (!item?.name) continue;
        if (!item.value) jar.delete(item.name);
        else jar.set(item.name, item.value);
      }
    },
  };

  const client = authClientFactory
    ? authClientFactory({ supabaseUrl, supabasePublishableKey, cookies: cookieApi, fetcher })
    : createServerClient(supabaseUrl, supabasePublishableKey, {
        cookies: cookieApi,
        global: fetcher ? { fetch: fetcher } : undefined,
      });

  const { data, error } = await client.auth.signInWithPassword({
    email: authEmail,
    password: authPassword,
  });
  // Allow onAuthStateChange microtask in @supabase/ssr to flush cookies cleanly.
  await Promise.resolve();

  if (error || !data?.session) {
    throw new Error("Authenticated smoke sign-in failed against Supabase.");
  }
  if (jar.size === 0) {
    throw new Error("Authenticated smoke sign-in produced no session cookies.");
  }
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/**
 * Executes an authenticated end-to-end HTTP smoke suite against a deployed Ano origin
 * without sending external emails, running paid enrichments, or writing user data.
 */
export async function runProductionSmokeCheck({
  baseUrl,
  supabaseUrl,
  supabasePublishableKey,
  authEmail,
  authPassword,
  bypassSecret = "",
  searxngBaseUrl = "",
  searxngGatewayToken = "",
  fetcher = fetch,
  authClientFactory,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const origin = validateBaseUrl(baseUrl).toString().replace(/\/+$/, "");
  const cleanSupabaseUrl = String(supabaseUrl ?? "").trim();
  const cleanSupabaseKey = String(supabasePublishableKey ?? "").trim();
  const cleanEmail = String(authEmail ?? "").trim();
  const cleanPassword = String(authPassword ?? "");

  if (!cleanSupabaseUrl || !cleanSupabaseKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required for authenticated smoke checks.");
  }
  if (!cleanEmail || !cleanPassword) {
    throw new Error("ANO_SMOKE_AUTH_EMAIL and ANO_SMOKE_AUTH_PASSWORD are required for authenticated smoke checks.");
  }

  const requestWithTimeout = async (pathName, extraHeaders = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = {
      ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
      ...extraHeaders,
    };
    try {
      return await fetcher(`${origin}${pathName}`, {
        method: "GET",
        headers,
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  // 1. Health endpoint
  const healthRes = await requestWithTimeout("/api/health");
  const healthText = await healthRes.text();
  if (healthRes.status !== 200) {
    throw new Error(`GET /api/health returned HTTP ${healthRes.status}.`);
  }
  if (LEAK_CHECK_PATTERN.test(healthText)) {
    throw new Error("GET /api/health leaked restricted secret or vendor text.");
  }
  const healthPayload = JSON.parse(healthText);
  if (healthPayload?.ok !== true || healthPayload?.supabaseConfigured !== true) {
    throw new Error("GET /api/health did not report ok=true and supabaseConfigured=true.");
  }

  // 2. Public homepage HTML check
  const homeRes = await requestWithTimeout("/");
  const homeText = await homeRes.text();
  if (homeRes.status !== 200 || !homeText.includes("Ano")) {
    throw new Error(`GET / failed homepage check (HTTP ${homeRes.status}).`);
  }

  // 3. Unauthenticated API must reject cleanly
  const unauthRes = await requestWithTimeout("/api/v1/conversations");
  if (unauthRes.status !== 401 && unauthRes.status !== 403) {
    throw new Error(`Expected unauthenticated GET /api/v1/conversations to return 401/403, got HTTP ${unauthRes.status}.`);
  }

  // 4. Real user authentication via Supabase SSR cookies
  const cookieHeader = await signInAndCollectCookies({
    supabaseUrl: cleanSupabaseUrl,
    supabasePublishableKey: cleanSupabaseKey,
    authEmail: cleanEmail,
    authPassword: cleanPassword,
    authClientFactory,
    fetcher,
  });

  // 5. Authenticated /api/v1/workspace
  const workspaceRes = await requestWithTimeout("/api/v1/workspace", {
    Cookie: cookieHeader,
  });
  const workspaceText = await workspaceRes.text();
  if (workspaceRes.status !== 200) {
    throw new Error(`Authenticated GET /api/v1/workspace failed with HTTP ${workspaceRes.status}.`);
  }
  if (LEAK_CHECK_PATTERN.test(workspaceText)) {
    throw new Error("Authenticated GET /api/v1/workspace leaked restricted secret or vendor names.");
  }
  const workspacePayload = JSON.parse(workspaceText);
  if (workspacePayload?.mode !== "supabase" || !workspacePayload?.workspace?.id) {
    throw new Error("Authenticated GET /api/v1/workspace did not resolve an active Supabase workspace.");
  }

  // 6. Authenticated /api/v1/conversations
  const convsRes = await requestWithTimeout("/api/v1/conversations?limit=5", {
    Cookie: cookieHeader,
  });
  const convsText = await convsRes.text();
  if (convsRes.status !== 200) {
    throw new Error(`Authenticated GET /api/v1/conversations failed with HTTP ${convsRes.status}.`);
  }
  if (LEAK_CHECK_PATTERN.test(convsText)) {
    throw new Error("Authenticated GET /api/v1/conversations leaked restricted secret or vendor names.");
  }
  const convsPayload = JSON.parse(convsText);
  if (!Array.isArray(convsPayload?.conversations)) {
    throw new Error("Authenticated GET /api/v1/conversations did not return a conversations array.");
  }

  // 7. Authenticated /api/v1/work-queue
  const queueRes = await requestWithTimeout("/api/v1/work-queue", {
    Cookie: cookieHeader,
  });
  const queueText = await queueRes.text();
  if (queueRes.status !== 200) {
    throw new Error(`Authenticated GET /api/v1/work-queue failed with HTTP ${queueRes.status}.`);
  }
  const queuePayload = JSON.parse(queueText);
  if (!queuePayload?.workQueue || typeof queuePayload.workQueue.needsReviewCount !== "number") {
    throw new Error("Authenticated GET /api/v1/work-queue returned an invalid work queue payload.");
  }

  // 8. Optional authenticated private SearXNG gateway smoke check when configured
  let searxngSummary = null;
  if (String(searxngBaseUrl).trim() && String(searxngGatewayToken).trim()) {
    searxngSummary = await runSearxngSmokeCheck({
      baseUrl: searxngBaseUrl,
      gatewayToken: searxngGatewayToken,
      fetcher,
      timeoutMs,
    });
  }

  return {
    ok: true,
    origin,
    healthStatus: healthRes.status,
    homeStatus: homeRes.status,
    unauthStatus: unauthRes.status,
    workspaceMode: workspacePayload.mode,
    workspaceId: String(workspacePayload.workspace.id),
    conversationCount: convsPayload.conversations.length,
    workQueueNeedsReview: queuePayload.workQueue.needsReviewCount,
    searxngChecked: Boolean(searxngSummary?.ok),
  };
}

const isEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  runProductionSmokeCheck({
    baseUrl: process.env.ANO_SMOKE_BASE_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    authEmail: process.env.ANO_SMOKE_AUTH_EMAIL,
    authPassword: process.env.ANO_SMOKE_AUTH_PASSWORD,
    bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "",
    searxngBaseUrl: process.env.SEARXNG_BASE_URL ?? "",
    searxngGatewayToken: process.env.SEARXNG_GATEWAY_TOKEN ?? "",
  })
    .then((summary) => {
      console.log(JSON.stringify(summary));
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          ok: false,
          error:
            error instanceof Error ? error.message : "Authenticated production smoke check failed.",
        }),
      );
      process.exit(1);
    });
}

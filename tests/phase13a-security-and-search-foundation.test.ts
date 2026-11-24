import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  checkInternalUsageBudget,
  validateProductionPaidProviderBudgetConfig,
} from "@/server/telemetry/internal-api-usage";

// @ts-expect-error ESM smoke helper does not carry separate declaration files
import { runSearxngSmokeCheck } from "../scripts/smoke-searxng-gateway.mjs";

const ROOT = process.cwd();

function parseSemver(version: string): [number, number, number] {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, `Invalid semver string: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(version: string, min: [number, number, number]): boolean {
  const [maj, minVer, patch] = parseSemver(version);
  if (maj !== min[0]) return maj > min[0];
  if (minVer !== min[1]) return minVer > min[1];
  return patch >= min[2];
}

async function collectFiles(dir: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full, extensions)));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

test("Next.js and Zod are upgraded to patched versions while keeping Turbopack-only build scripts", async () => {
  const [pkgRaw, nextPkgRaw, zodPkgRaw] = await Promise.all([
    readFile(path.join(ROOT, "package.json"), "utf8"),
    readFile(path.join(ROOT, "node_modules/next/package.json"), "utf8"),
    readFile(path.join(ROOT, "node_modules/zod/package.json"), "utf8"),
  ]);

  const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
  const nextPkg = JSON.parse(nextPkgRaw) as { version: string };
  const zodPkg = JSON.parse(zodPkgRaw) as { version: string };

  assert.equal(parseSemver(nextPkg.version)[0], 16);
  assert.equal(
    isAtLeast(nextPkg.version, [16, 4, 5]),
    true,
    `Expected next >= 16.4.5, found ${nextPkg.version}`,
  );
  assert.equal(
    isAtLeast(zodPkg.version, [4, 6, 6]),
    true,
    `Expected zod >= 4.6.6, found ${zodPkg.version}`,
  );

  assert.equal(pkg.scripts?.dev, "next dev --turbopack");
  assert.equal(pkg.scripts?.build, "next build --turbopack");
  assert.ok(pkg.scripts?.["smoke:searxng"]);
  assert.ok(pkg.scripts?.["smoke:searxng:ci"]);
});

test("private SearXNG deployment enables Brave Search API, removes DuckDuckGo, and keeps BRAVE_API_KEY server-only", async () => {
  const [settingsRaw, composeRaw, entrypointRaw, deployEnvRaw] = await Promise.all([
    readFile(path.join(ROOT, "deploy/searxng/searxng/settings.yml"), "utf8"),
    readFile(path.join(ROOT, "deploy/searxng/compose.yaml"), "utf8"),
    readFile(path.join(ROOT, "deploy/searxng/render-settings-entrypoint.sh"), "utf8"),
    readFile(path.join(ROOT, "deploy/searxng/.env.example"), "utf8"),
  ]);

  const settingsWithoutComments = settingsRaw.replace(/#.*$/gm, "");
  assert.match(settingsWithoutComments, /- braveapi/);
  assert.match(settingsWithoutComments, /api_key:\s*"__BRAVE_API_KEY__"/);
  assert.equal(
    /\bduckduckgo\b/i.test(settingsWithoutComments),
    false,
    "duckduckgo must be removed from settings.yml",
  );

  assert.match(composeRaw, /BRAVE_API_KEY:\s*\$\{BRAVE_API_KEY:\?/);
  assert.match(composeRaw, /\/tmp\/searxng:mode=0700/);
  assert.match(composeRaw, /render-settings-entrypoint\.sh/);

  const caddyBlock = composeRaw.slice(
    composeRaw.indexOf("  caddy:"),
    composeRaw.indexOf("  searxng:"),
  );
  assert.equal(/\benv_file\b/.test(caddyBlock), false, "caddy must not receive full .env file");
  assert.equal(/BRAVE_API_KEY/.test(caddyBlock), false, "caddy must never receive BRAVE_API_KEY");
  assert.equal(/SEARXNG_SECRET/.test(caddyBlock), false, "caddy must never receive SEARXNG_SECRET");

  assert.match(entrypointRaw, /BRAVE_API_KEY/);
  assert.match(entrypointRaw, /exit 1/);
  assert.match(entrypointRaw, /unset BRAVE_API_KEY/);
  assert.match(deployEnvRaw, /^BRAVE_API_KEY=/m);
});

test("authenticated SearXNG smoke check enforces auth rejection, health ok, non-DuckDuckGo results, and redaction", async () => {
  const secretToken = "super-secret-gateway-token-value";
  const happy = await runSearxngSmokeCheck({
    baseUrl: "https://search.example.com",
    gatewayToken: secretToken,
    query: "b2b workflow software",
    fetcher: async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const tokenHeader = headers.get("X-Ano-Gateway-Token");
      if (url.endsWith("/healthz")) {
        if (!tokenHeader) return new Response("Unauthorized", { status: 401 });
        assert.equal(tokenHeader, secretToken);
        return new Response("ok", { status: 200 });
      }
      assert.ok(url.includes("/search?"));
      assert.equal(tokenHeader, secretToken);
      return new Response(
        JSON.stringify({
          results: [
            { url: "https://oecd.org/report", title: "OECD Report", engine: "braveapi" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(happy.ok, true);
  assert.equal(happy.unauthHealthStatus, 401);
  assert.equal(happy.healthStatus, 200);
  assert.equal(happy.resultCount, 1);
  assert.deepEqual(happy.enginesObserved, ["braveapi"]);
  assert.equal(JSON.stringify(happy).includes(secretToken), false);

  await assert.rejects(
    () =>
      runSearxngSmokeCheck({
        baseUrl: "https://search.example.com",
        gatewayToken: secretToken,
        fetcher: async () => new Response("ok", { status: 200 }),
      }),
    /Expected unauthenticated \/healthz to reject/,
  );

  await assert.rejects(
    () =>
      runSearxngSmokeCheck({
        baseUrl: "https://search.example.com",
        gatewayToken: secretToken,
        fetcher: async (input: string | URL, init?: RequestInit) => {
          const url = String(input);
          const headers = new Headers(init?.headers);
          if (url.endsWith("/healthz")) {
            return headers.get("X-Ano-Gateway-Token")
              ? new Response("ok", { status: 200 })
              : new Response("Unauthorized", { status: 401 });
          }
          return new Response(
            JSON.stringify({
              results: [{ url: "https://example.com", engine: "duckduckgo" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      }),
    /DuckDuckGo/i,
  );
});

test("paid providers require daily limits in production and fail closed if the usage ledger is unavailable", async () => {
  assert.deepEqual(validateProductionPaidProviderBudgetConfig({ NODE_ENV: "production" }), {
    ok: false,
    missing: ["ANO_INTERNAL_DAILY_PROSPEO_LIMIT", "ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT"],
  });
  assert.deepEqual(
    validateProductionPaidProviderBudgetConfig({
      NODE_ENV: "production",
      ANO_INTERNAL_DAILY_PROSPEO_LIMIT: "100",
    }),
    {
      ok: false,
      missing: ["ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT"],
    },
  );
  assert.deepEqual(
    validateProductionPaidProviderBudgetConfig({
      NODE_ENV: "production",
      ANO_INTERNAL_DAILY_PROSPEO_LIMIT: "100",
      ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT: "50",
    }),
    {
      ok: true,
      missing: [],
    },
  );
  assert.deepEqual(validateProductionPaidProviderBudgetConfig({ NODE_ENV: "development" }), {
    ok: true,
    missing: [],
  });

  const makeSupabaseSession = (
    rpcImpl: (fn: string) => Promise<{ data: unknown; error: unknown }>,
  ): WorkspaceSession =>
    ({
      kind: "supabase",
      actorId: "11111111-1111-4111-8111-111111111111",
      actorEmail: "user@example.com",
      workspace: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Test Workspace",
        slug: "test-workspace",
        role: "owner",
      },
      client: {
        rpc: (fn: string) => rpcImpl(fn),
      },
    }) as unknown as WorkspaceSession;

  const prevProspeoLimit = process.env.ANO_INTERNAL_DAILY_PROSPEO_LIMIT;
  const prevDropcontactLimit = process.env.ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT;
  delete process.env.ANO_INTERNAL_DAILY_PROSPEO_LIMIT;
  delete process.env.ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT;

  let budgetRpcInvoked = false;
  try {
    const untouchedSession = makeSupabaseSession(async (fn) => {
      if (fn === "check_internal_usage_budget") {
        budgetRpcInvoked = true;
      }
      return { data: true, error: null };
    });
    assert.equal(
      await checkInternalUsageBudget(untouchedSession, "prospeo", { isProduction: true }),
      false,
    );
    assert.equal(
      await checkInternalUsageBudget(untouchedSession, "dropcontact", { isProduction: true }),
      false,
    );
    assert.equal(budgetRpcInvoked, false);
  } finally {
    if (prevProspeoLimit === undefined) delete process.env.ANO_INTERNAL_DAILY_PROSPEO_LIMIT;
    else process.env.ANO_INTERNAL_DAILY_PROSPEO_LIMIT = prevProspeoLimit;
    if (prevDropcontactLimit === undefined) delete process.env.ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT;
    else process.env.ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT = prevDropcontactLimit;
  }

  const errorSession = makeSupabaseSession(async () => ({
    data: null,
    error: { message: "ledger unavailable" },
  }));
  assert.equal(
    await checkInternalUsageBudget(errorSession, "prospeo", { dailyLimit: 100 }),
    false,
  );
  assert.equal(
    await checkInternalUsageBudget(errorSession, "dropcontact", { dailyLimit: 50 }),
    false,
  );
  assert.equal(
    await checkInternalUsageBudget(errorSession, "prospeo", { isProduction: false }),
    false,
  );

  const throwingSession = makeSupabaseSession(async () => {
    throw new Error("connection lost");
  });
  assert.equal(
    await checkInternalUsageBudget(throwingSession, "prospeo", { dailyLimit: 100 }),
    false,
  );
  assert.equal(
    await checkInternalUsageBudget(throwingSession, "dropcontact", { dailyLimit: 50 }),
    false,
  );

  const invalidTypeSession = makeSupabaseSession(async () => ({
    data: "not-a-boolean",
    error: null,
  }));
  assert.equal(
    await checkInternalUsageBudget(invalidTypeSession, "prospeo", { dailyLimit: 100 }),
    false,
  );

  const okSession = makeSupabaseSession(async () => ({ data: true, error: null }));
  assert.equal(
    await checkInternalUsageBudget(okSession, "prospeo", { dailyLimit: 100, isProduction: true }),
    true,
  );
  assert.equal(
    await checkInternalUsageBudget(okSession, "dropcontact", { dailyLimit: 50, isProduction: true }),
    true,
  );

  const cappedSession = makeSupabaseSession(async () => ({ data: false, error: null }));
  assert.equal(
    await checkInternalUsageBudget(cappedSession, "prospeo", { dailyLimit: 100, isProduction: true }),
    false,
  );

  // Non-paid search provider keeps existing permissive default when no limit is set
  assert.equal(
    await checkInternalUsageBudget(errorSession, "searxng", { isProduction: false }),
    true,
  );
});

test("zero server secrets can reach browser bundles, client components, or NEXT_PUBLIC_ config", async () => {
  const SERVER_ONLY_SECRETS = [
    "BRAVE_API_KEY",
    "SEARXNG_GATEWAY_TOKEN",
    "SEARXNG_BASE_URL",
    "SEARXNG_SECRET",
    "PROSPEO_KEY",
    "DROPCONTACT_API_KEY",
    "GEMINI_API_KEY",
    "SUPABASE_DB_URL",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SESSION_TOKEN",
    "TAVILY_API_KEY",
    "ANO_INTERNAL_DAILY_PROSPEO_LIMIT",
    "ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT",
  ];
  const secretPattern = new RegExp(`\\b(?:${SERVER_ONLY_SECRETS.join("|")})\\b`);
  const nextPublicSecretPattern = new RegExp(
    `NEXT_PUBLIC_(?:${SERVER_ONLY_SECRETS.join("|")})`,
  );

  const clientSafeRoots = [
    path.join(ROOT, "src/client"),
    path.join(ROOT, "src/components"),
    path.join(ROOT, "src/lib"),
  ];
  const appFiles = (await collectFiles(path.join(ROOT, "src/app"), [".ts", ".tsx"])).filter(
    (absPath) => {
      const rel = path.relative(path.join(ROOT, "src/app"), absPath);
      return !rel.startsWith(`api${path.sep}`) && !rel.startsWith(`auth${path.sep}`);
    },
  );
  const browserFiles = [
    ...(await Promise.all(clientSafeRoots.map((dir) => collectFiles(dir, [".ts", ".tsx"])))).flat(),
    ...appFiles,
  ];

  const ALLOWED_BROWSER_ENV_VARS = new Set([
    "NODE_ENV",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ]);

  for (const absPath of browserFiles) {
    const content = await readFile(absPath, "utf8");
    const relPath = path.relative(ROOT, absPath);

    for (const envMatch of content.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      const envName = envMatch[1] ?? "";
      assert.equal(
        ALLOWED_BROWSER_ENV_VARS.has(envName),
        true,
        `Unexpected process.env.${envName} in browser-reachable file ${relPath}`,
      );
    }

    // Outside maskVendorNamesForDisplay's redaction regex, never mention server secret names.
    if (relPath !== path.normalize("src/lib/ano/research-conversation.ts")) {
      const secretMatch = content.match(secretPattern);
      assert.equal(
        secretMatch,
        null,
        `Server secret ${secretMatch?.[0]} referenced in browser-reachable file ${relPath}`,
      );
    }
  }

  const allSrcFiles = await collectFiles(path.join(ROOT, "src"), [".ts", ".tsx"]);
  for (const absPath of allSrcFiles) {
    const content = await readFile(absPath, "utf8");
    const relPath = path.relative(ROOT, absPath);
    const trimmed = content.trimStart();
    if (trimmed.startsWith('"use client"') || trimmed.startsWith("'use client'")) {
      assert.equal(
        /from\s+["']@\/server\//.test(content),
        false,
        `Client component ${relPath} must never import from @/server/`,
      );
    }
    assert.equal(
      nextPublicSecretPattern.test(content),
      false,
      `Found NEXT_PUBLIC_ secret prefix in ${relPath}`,
    );
  }

  const [envExample, nextConfigRaw] = await Promise.all([
    readFile(path.join(ROOT, ".env.example"), "utf8"),
    readFile(path.join(ROOT, "next.config.ts"), "utf8"),
  ]);
  assert.equal(nextPublicSecretPattern.test(envExample), false);
  assert.equal(secretPattern.test(nextConfigRaw), false);
});

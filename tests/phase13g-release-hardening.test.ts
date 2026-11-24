import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// @ts-expect-error ESM deploy validation helper does not carry separate declaration files
import { validateProductionDeployEnv } from "../scripts/check-deploy-env.mjs";
// @ts-expect-error ESM production smoke helper does not carry separate declaration files
import { runProductionSmokeCheck } from "../scripts/smoke-production.mjs";

const ROOT = process.cwd();

test("Deployment validator fails hard when any required database, Vercel, Supabase public, or smoke credential is missing", () => {
  const validEnv = {
    SUPABASE_DB_URL: "postgresql://postgres:secret@db.ano-prod.supabase.co:5432/postgres",
    ANO_DATABASE_LABEL: "ano",
    VERCEL_TOKEN: "vercel_tok_123",
    VERCEL_ORG_ID: "team_ano_123",
    VERCEL_PROJECT_ID: "prj_ano_123",
    NEXT_PUBLIC_SUPABASE_URL: "https://anoprod.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_prod_123",
    ANO_SMOKE_AUTH_EMAIL: "smoke-tester@anocopilot.com",
    ANO_SMOKE_AUTH_PASSWORD: "StrongSmokePassword123!",
  };

  assert.deepEqual(validateProductionDeployEnv(validEnv), {
    ok: true,
    requiredCount: 9,
    missing: [],
    invalid: [],
  });

  for (const requiredKey of Object.keys(validEnv)) {
    const partial = { ...validEnv, [requiredKey]: "" };
    const res = validateProductionDeployEnv(partial);
    assert.equal(res.ok, false, `Expected failure when ${requiredKey} is empty`);
    assert.ok(res.missing.includes(requiredKey));
    assert.equal(JSON.stringify(res).includes("StrongSmokePassword123!"), false);
    assert.equal(JSON.stringify(res).includes("vercel_tok_123"), false);
  }

  const wrongLabel = validateProductionDeployEnv({ ...validEnv, ANO_DATABASE_LABEL: "mercury" });
  assert.equal(wrongLabel.ok, false);

  const placeholderHost = validateProductionDeployEnv({
    ...validEnv,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  });
  assert.equal(placeholderHost.ok, false);
});

test("Authenticated production smoke check verifies health, homepage, auth gating, SSR login, workspace, conversations, and queue cleanly", async () => {
  const requests: Array<{ url: string; cookie: string | null }> = [];
  const summary = await runProductionSmokeCheck({
    baseUrl: "https://app.anocopilot.com",
    supabaseUrl: "https://anoprod.supabase.co",
    supabasePublishableKey: "sb_publishable_prod_123",
    authEmail: "smoke-tester@anocopilot.com",
    authPassword: "StrongSmokePassword123!",
    searxngBaseUrl: "https://search.anocopilot.com",
    searxngGatewayToken: "gw-secret-token",
    authClientFactory: ({
      cookies,
    }: {
      cookies: { setAll: (items: Array<{ name: string; value: string }>) => void };
    }) => ({
      auth: {
        async signInWithPassword() {
          cookies.setAll([
            { name: "sb-anoprod-auth-token", value: "base64-eyJhY2Nlc3NfdG9rZW4iOiJzbW9rZSJ9" },
          ]);
          return { data: { session: { access_token: "smoke" } }, error: null };
        },
      },
    }),
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const cookie = headers.Cookie ?? null;
      requests.push({ url, cookie });

      if (url === "https://app.anocopilot.com/api/health") {
        return new Response(
          JSON.stringify({ ok: true, service: "ano-copilot", supabaseConfigured: true }),
          { status: 200 },
        );
      }
      if (url === "https://app.anocopilot.com/") {
        return new Response("<html><body><h1>Ano</h1></body></html>", { status: 200 });
      }
      if (url === "https://app.anocopilot.com/api/v1/conversations" && !cookie) {
        return new Response(JSON.stringify({ error: "Sign in" }), { status: 401 });
      }
      if (url === "https://app.anocopilot.com/api/v1/workspace" && cookie) {
        return new Response(
          JSON.stringify({
            mode: "supabase",
            workspace: { id: "00000000-0000-4000-8000-00000000aa01", name: "Smoke WS", slug: "smoke-ws", role: "owner" },
          }),
          { status: 200 },
        );
      }
      if (url === "https://app.anocopilot.com/api/v1/conversations?limit=5" && cookie) {
        return new Response(JSON.stringify({ conversations: [], nextCursor: null }), { status: 200 });
      }
      if (url === "https://app.anocopilot.com/api/v1/work-queue" && cookie) {
        return new Response(
          JSON.stringify({ workQueue: { needsReviewCount: 0, activeResearchCount: 0, items: [] } }),
          { status: 200 },
        );
      }
      if (url.startsWith("https://search.anocopilot.com/healthz")) {
        if (!headers["X-Ano-Gateway-Token"]) return new Response("Unauthorized", { status: 401 });
        return new Response("ok", { status: 200 });
      }
      if (url.startsWith("https://search.anocopilot.com/search")) {
        return new Response(
          JSON.stringify({ results: [{ url: "https://example.gov/market", engine: "braveapi" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    },
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.workspaceMode, "supabase");
  assert.equal(summary.searxngChecked, true);
  assert.ok(requests.some((r) => r.cookie && r.url.endsWith("/api/v1/workspace")));

  // Rejects if unauthenticated /api/v1/conversations leaks 200 instead of 401/403.
  await assert.rejects(
    () =>
      runProductionSmokeCheck({
        baseUrl: "https://app.anocopilot.com",
        supabaseUrl: "https://anoprod.supabase.co",
        supabasePublishableKey: "sb_publishable_prod_123",
        authEmail: "smoke@anocopilot.com",
        authPassword: "pw",
        authClientFactory: ({
          cookies,
        }: {
          cookies: { setAll: (items: Array<{ name: string; value: string }>) => void };
        }) => ({
          auth: {
            async signInWithPassword() {
              cookies.setAll([{ name: "sb-auth", value: "tok" }]);
              return { data: { session: { access_token: "tok" } }, error: null };
            },
          },
        }),
        fetcher: async (input: RequestInfo | URL) => {
          const u = String(input);
          if (u.endsWith("/api/health")) {
            return new Response(JSON.stringify({ ok: true, supabaseConfigured: true }), { status: 200 });
          }
          if (u.endsWith("/")) {
            return new Response("<html>Ano</html>", { status: 200 });
          }
          return new Response(JSON.stringify({ conversations: [] }), { status: 200 });
        },
      }),
    /401\/403/,
  );
});

test("GitHub workflows enforce strict deploy secrets, SQL migrations, authenticated smoke, and CI Playwright E2E", async () => {
  const [ciRaw, deployRaw] = await Promise.all([
    readFile(path.join(ROOT, ".github/workflows/ci.yml"), "utf8"),
    readFile(path.join(ROOT, ".github/workflows/deploy-production.yml"), "utf8"),
  ]);

  assert.match(deployRaw, /npm run check:deploy-env/);
  assert.match(deployRaw, /npm run db:apply:ci/);
  assert.match(deployRaw, /npm run db:status:ci/);
  assert.match(deployRaw, /npm run smoke:production/);
  assert.equal(/skipping DB migrations/i.test(deployRaw), false);
  assert.equal(/skipping Vercel deployment/i.test(deployRaw), false);

  assert.match(ciRaw, /npm run check:migrations/);
  assert.match(ciRaw, /npm run typecheck/);
  assert.match(ciRaw, /npm run test:phase4b/);
  assert.match(ciRaw, /npm test/);
  assert.match(ciRaw, /npm run build/);
  assert.match(ciRaw, /npm run test:e2e/);
});

test("docs/ARCHITECTURE.md serves as the unified current-state architecture guide without obsolete phase claims", async () => {
  const [archRaw, phase2Raw, implRaw, readmeRaw] = await Promise.all([
    readFile(path.join(ROOT, "docs/ARCHITECTURE.md"), "utf8"),
    readFile(path.join(ROOT, "docs/PHASE_2_SETUP.md"), "utf8"),
    readFile(path.join(ROOT, "IMPLEMENTATION.md"), "utf8"),
    readFile(path.join(ROOT, "README.md"), "utf8"),
  ]);

  assert.equal(/\bPhase\s+(?:[A-F]|9[BC]|10[A-E]|11[A-C]|12[A-D]|13[A-G])\b/.test(archRaw), false);
  assert.equal(/\b000028\b/.test(archRaw), false);
  assert.match(archRaw, /000031/);
  assert.match(archRaw, /53\/53|53 tables/i);
  assert.match(archRaw, /50 public searches/);
  assert.match(archRaw, /100 source fetches/);
  assert.match(archRaw, /25 company candidates/);
  assert.match(archRaw, /10 named contact enrichments/);
  assert.match(archRaw, /draft-only|never sends email/i);

  assert.match(phase2Raw, /ARCHITECTURE\.md/);
  assert.match(implRaw, /ARCHITECTURE\.md/);
  assert.match(readmeRaw, /000031/);
  assert.match(readmeRaw, /test:e2e/);
});

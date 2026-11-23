import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { HumanMessage } from "@langchain/core/messages";

import type { SupabaseWorkspaceSession } from "@/contracts/ano";
import { scoreAndBuildAccountDossier } from "@/lib/ano/company-discovery";
import { createGeminiChatModel } from "@/server/agents/gemini-chat-model";
import {
  DropcontactClientError,
  verifyContactsWithDropcontact,
} from "@/server/connectors/dropcontact/dropcontact-client";
import {
  enrichProspeoPeople,
  searchProspeoCompanies,
} from "@/server/connectors/prospeo/prospeo-client";
import { discoverPeopleFromCompanyWebsites } from "@/server/connectors/website-team/website-team-client";
import {
  checkInternalUsageBudget,
  estimateInternalApiCostUsd,
  runWithInternalUsageContext,
  sanitizeUsageMetadata,
  setInternalUsageTestSink,
  type InternalApiUsageRecord,
} from "@/server/telemetry/internal-api-usage";

const workspaceId = "00000000-0000-4000-8000-000000001001";
const conversationId = "00000000-0000-4000-8000-000000001002";

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

test("sanitizeUsageMetadata strips sensitive keys and estimateInternalApiCostUsd prices tokens and credits accurately", () => {
  const sanitized = sanitizeUsageMetadata({
    apiKey: "secret-key",
    token: "abc",
    email: "user@example.com",
    phone: "+6012345",
    html: "<p>hi</p>",
    prompt: "secret prompt",
    batchSize: 5,
    matchedCount: 3,
    modelHint: "ok",
    validFlag: true,
    badNumber: Number.NaN,
  });

  assert.deepEqual(sanitized, {
    batchSize: 5,
    matchedCount: 3,
    modelHint: "ok",
    validFlag: true,
  });

  assert.equal(
    estimateInternalApiCostUsd({
      provider: "gemini",
      modelOrEndpoint: "gemini-3.5-flash-lite",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
    0.5,
  );
  assert.equal(
    estimateInternalApiCostUsd({
      provider: "bedrock",
      modelOrEndpoint: "anthropic.claude",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
    4,
  );
  assert.equal(
    estimateInternalApiCostUsd({
      provider: "prospeo",
      creditsUsed: 2,
    }),
    0.03,
  );
  assert.equal(
    estimateInternalApiCostUsd({
      provider: "dropcontact",
      creditsUsed: 4,
    }),
    0.1,
  );
  assert.equal(
    estimateInternalApiCostUsd({
      provider: "website_team",
      creditsUsed: 10,
      inputTokens: 5000,
    }),
    0,
  );
});

test("provider calls capture token/credit/request telemetry inside runWithInternalUsageContext and forward via write-only RPC", async () => {
  const recorded: InternalApiUsageRecord[] = [];
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];

  const mockSession: SupabaseWorkspaceSession = {
    kind: "supabase",
    actorId: "00000000-0000-4000-8000-000000001003",
    actorEmail: "operator@example.com",
    workspace: {
      id: workspaceId,
      name: "Ano Telemetry Test",
      slug: "ano-telemetry-test",
      role: "owner",
    },
    client: {
      rpc: async (fn: string, params: Record<string, unknown>) => {
        rpcCalls.push({ fn, params });
        if (fn === "check_internal_usage_budget") {
          return { data: false, error: null };
        }
        return { data: null, error: null };
      },
    } as unknown as SupabaseWorkspaceSession["client"],
  };

  const prevProspeo = process.env.PROSPEO_KEY;
  const prevDropcontact = process.env.DROPCONTACT_API_KEY;
  process.env.PROSPEO_KEY = "test-prospeo";
  process.env.DROPCONTACT_API_KEY = "test-dropcontact";
  setInternalUsageTestSink((rec) => recorded.push(rec));

  try {
    await runWithInternalUsageContext({ session: mockSession, conversationId }, async () => {
      // 1. Gemini tokens
      const gemini = createGeminiChatModel(
        {
          provider: "gemini",
          apiKey: "test-gemini",
          modelId: "gemini-3.5-flash-lite",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        },
        {
          retryDelayMs: 0,
          fetcher: (async () =>
            new Response(
              JSON.stringify({
                candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] } }],
                usageMetadata: {
                  promptTokenCount: 1200,
                  candidatesTokenCount: 300,
                  thoughtsTokenCount: 50,
                },
              }),
              { status: 200 },
            )) as typeof fetch,
        },
      );
      await gemini.invoke([new HumanMessage("hi")]);

      // 2. Prospeo search (free: false -> 1 cr, free: true -> 0 cr) + bulk enrich (creditsCharged)
      await searchProspeoCompanies(
        { company_location: { include: ["Malaysia"] } },
        (async () =>
          new Response(
            JSON.stringify({
              error: false,
              free: false,
              results: [{ company: { company_id: "c1", name: "Klinik A" } }],
              pagination: { total_count: 1 },
            }),
            { status: 200 },
          )) as typeof fetch,
      );
      await searchProspeoCompanies(
        { company_location: { include: ["Malaysia"] } },
        (async () =>
          new Response(
            JSON.stringify({
              error: false,
              free: true,
              results: [{ company: { company_id: "c1", name: "Klinik A" } }],
            }),
            { status: 200 },
          )) as typeof fetch,
      );
      await enrichProspeoPeople(
        [{ contactId: "ct-1", fullName: "Dr Tan", companyName: "Klinik A" }],
        (async () =>
          new Response(
            JSON.stringify({
              error: false,
              matched: [
                {
                  identifier: "ct-1",
                  free_enrichment: false,
                  person: { email: { email: "tan@klinika.example", status: "VERIFIED" } },
                },
              ],
            }),
            { status: 200 },
          )) as typeof fetch,
      );

      // 3. Dropcontact async success & post-submit timeout preserves credits
      let dcPoll = 0;
      await verifyContactsWithDropcontact(
        [
          {
            contactId: "dc-1",
            fullName: "Dr Tan",
            firstName: "Dr",
            lastName: "Tan",
            companyName: "Klinik A",
            website: "https://klinika.example",
            fieldsSent: ["full_name", "company"],
          },
        ],
        (async (_url, init) => {
          if ((init?.method ?? "GET") === "POST") {
            return new Response(
              JSON.stringify({ success: true, error: false, request_id: "dc-r1", credits_left: 88 }),
              { status: 200 },
            );
          }
          dcPoll += 1;
          if (dcPoll === 1) {
            return new Response(
              JSON.stringify({ error: true, reason: "Your request is not ready yet" }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              success: true,
              error: false,
              request_id: "dc-r1",
              data: [
                {
                  email: [{ email: "tan@klinika.example", qualification: "nominative@pro" }],
                  custom_fields: { ano_contact_id: "dc-1" },
                },
              ],
            }),
            { status: 200 },
          );
        }) as typeof fetch,
        { pollIntervalMs: 0, maxPollAttempts: 3 },
      );

      await assert.rejects(
        () =>
          verifyContactsWithDropcontact(
            [
              {
                contactId: "dc-t",
                fullName: "Timeout Lead",
                firstName: null,
                lastName: null,
                companyName: "Klinik Timeout",
                website: null,
                fieldsSent: ["full_name", "company"],
              },
            ],
            (async (_url, init) => {
              if ((init?.method ?? "GET") === "POST") {
                return new Response(
                  JSON.stringify({ success: true, error: false, request_id: "dc-t1", credits_left: 87 }),
                  { status: 200 },
                );
              }
              return new Response(
                JSON.stringify({ error: true, reason: "Your request is not ready yet" }),
                { status: 200 },
              );
            }) as typeof fetch,
            { pollIntervalMs: 0, maxPollAttempts: 1 },
          ),
        (err: unknown) => err instanceof DropcontactClientError && err.code === "TIMEOUT_NO_RETRY",
      );

      // 4. Website team crawl telemetry ($0)
      const clinic = scoreAndBuildAccountDossier(
        {
          provider: "openstreetmap",
          id: "osm-1",
          name: "Smile Dental",
          website: "https://smiledental.example",
          domain: "smiledental.example",
          industry: "Dentist",
          location: { city: "KL", country: "Malaysia" },
        },
        {
          dossierId: "00000000-0000-4000-8000-000000001010",
          conversationId,
          targetDecisionId: "00000000-0000-4000-8000-000000001011",
          companySearchId: "00000000-0000-4000-8000-000000001012",
          providerKey: "openstreetmap",
          targetMarketName: "Malaysia",
          targetIndustryName: "Dental",
          canonicalLocations: ["Malaysia"],
          linkedClaimIds: ["00000000-0000-4000-8000-000000001013"],
          capturedAt: "2026-11-23T00:00:00.000Z",
          lifecycleState: "shortlisted",
        },
      );
      await discoverPeopleFromCompanyWebsites([clinic], undefined, {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetch: (async () =>
          new Response("<html><body><h1>Smile Dental</h1></body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          })) as typeof fetch,
      });

      // 5. Silent budget check returns false & records skipped_budget
      const allowed = await checkInternalUsageBudget(mockSession, "prospeo", {
        dailyLimit: 5,
        metric: "credits",
      });
      assert.equal(allowed, false);
    });
  } finally {
    setInternalUsageTestSink(null);
    if (prevProspeo === undefined) delete process.env.PROSPEO_KEY;
    else process.env.PROSPEO_KEY = prevProspeo;
    if (prevDropcontact === undefined) delete process.env.DROPCONTACT_API_KEY;
    else process.env.DROPCONTACT_API_KEY = prevDropcontact;
  }

  const geminiRec = recorded.find((r) => r.provider === "gemini");
  assert.ok(geminiRec);
  assert.equal(geminiRec.inputTokens, 1200);
  assert.equal(geminiRec.outputTokens, 350);
  assert.equal(geminiRec.conversationId, conversationId);

  const prospeoSearches = recorded.filter(
    (r) => r.provider === "prospeo" && r.operation === "search_company",
  );
  assert.equal(prospeoSearches[0]?.creditsUsed, 1);
  assert.equal(prospeoSearches[1]?.creditsUsed, 0);

  const prospeoEnrich = recorded.find(
    (r) => r.provider === "prospeo" && r.operation === "bulk_enrich_person",
  );
  assert.equal(prospeoEnrich?.creditsUsed, 1);

  const dcSuccess = recorded.find((r) => r.provider === "dropcontact" && r.status === "success");
  assert.equal(dcSuccess?.creditsUsed, 1);
  assert.equal(dcSuccess?.creditsRemaining, 88);
  assert.equal(dcSuccess?.requestCount, 3);

  const dcTimeout = recorded.find((r) => r.provider === "dropcontact" && r.status === "timeout");
  assert.equal(dcTimeout?.creditsUsed, 1);
  assert.equal(dcTimeout?.requestCount, 2);

  const siteRec = recorded.find((r) => r.provider === "website_team");
  assert.equal(siteRec?.creditsUsed, 0);
  assert.equal(siteRec?.requestCount, 3);

  const skippedBudget = recorded.find((r) => r.status === "skipped_budget");
  assert.equal(skippedBudget?.provider, "prospeo");

  const writeRpcCalls = rpcCalls.filter((c) => c.fn === "record_internal_api_usage");
  assert.equal(writeRpcCalls.length, recorded.length);
  const budgetRpcCalls = rpcCalls.filter((c) => c.fn === "check_internal_usage_budget");
  assert.equal(budgetRpcCalls.length, 1);
});

test("ano_internal telemetry schema is isolated and zero HTTP API routes expose internal usage data", async () => {
  const migrationSql = await readFile(
    path.join(process.cwd(), "supabase/migrations/20261124_000024_internal_api_usage_ledger.sql"),
    "utf8",
  );

  assert.match(migrationSql, /create schema if not exists ano_internal/i);
  assert.match(migrationSql, /revoke all on schema ano_internal from public,\s*anon,\s*authenticated/i);
  assert.match(
    migrationSql,
    /revoke all on table ano_internal\.api_usage_logs from public,\s*anon,\s*authenticated/i,
  );
  assert.match(migrationSql, /alter table ano_internal\.api_usage_logs enable row level security/i);
  assert.equal(/create policy/i.test(migrationSql), false);
  assert.match(migrationSql, /security definer\s+set search_path = ''/i);
  assert.match(migrationSql, /create or replace function public\.record_internal_api_usage/i);
  assert.match(migrationSql, /returns void/i);
  assert.match(migrationSql, /create or replace function public\.check_internal_usage_budget/i);

  const apiFiles = await collectFiles(path.join(process.cwd(), "src/app/api"));
  for (const file of apiFiles) {
    assert.equal(
      /usage/i.test(path.relative(path.join(process.cwd(), "src/app/api"), file)),
      false,
      `Unexpected usage HTTP route detected: ${file}`,
    );
    const content = await readFile(file, "utf8");
    assert.equal(
      content.includes("api_usage_logs"),
      false,
      `API route must not reference ano_internal.api_usage_logs: ${file}`,
    );
  }
});

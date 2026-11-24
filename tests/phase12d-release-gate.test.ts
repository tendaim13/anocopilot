import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { HumanMessage } from "@langchain/core/messages";

import {
  scoreAndBuildAccountDossier,
} from "@/lib/ano/company-discovery";
import { buildLeadsCsv } from "@/lib/ano/lead-export";
import {
  normalizeDiscoveredPersonCandidate,
  type ContactCandidateView,
} from "@/lib/ano/people-playbooks";
import {
  formatDisplayErrorMessage,
  maskVendorNamesForDisplay,
} from "@/lib/ano/research-conversation";
import { DEFAULT_GEMINI_BASE_URL } from "@/server/agents/bedrock";
import {
  createGeminiChatModel,
  GeminiApiError,
  isGeminiModelCoolingDown,
  resetGeminiModelCooldowns,
  sanitizeLlmErrorForUser,
  USER_HIGH_DEMAND_LLM_MESSAGE,
} from "@/server/agents/gemini-chat-model";

const ROOT = process.cwd();

const VENDOR_USER_COPY_PATTERN =
  /\b(?:Prospeo|Dropcontact|SearXNG|Tavily|OpenStreetMap|OSM|Nominatim|Overpass|Mercury|Google AI Studio|Gemini|Amazon Bedrock|Bedrock|Ollama|LangGraph|Supabase|PROSPEO_KEY|DROPCONTACT_API_KEY|SEARXNG_BASE_URL|SEARXNG_GATEWAY_TOKEN|GEMINI_API_KEY|ANO_AGENT_MODE|OVERPASS_API_URL)\b/;

const INTERNAL_NOISE_PATTERN =
  /\b(?:PHASE|Phase)\s+[A-F]\b|\b(?:PHASE|Phase)\s+9[BC]\b|\bSTAGE\s+[AB]\b|ARTIFACT\s*·|CONTEXT RAIL|\bDiagnostics\b|Graph node|\bCheckpoint\b|Provider budget|Planned ceiling|Search ceiling|Fetch ceiling|Result ceiling|Batch limit|RFC-4180|No automatic retry|Nothing has been sent|never triggers duplicate|remaining approved budget|Regenerate all \(Free\)|Approval-gated workspace|locked Phase C|\bin Phase [DE]\b/;

const AI_SLOP_PATTERN =
  /\b(?:AI-powered|agentic|supercharge|10x|revolutionize|hyper-personalized|seamlessly|effortlessly|cutting-edge|next-gen)\b|\bmagic\b|✨|🚀|🤖|🧠/i;

async function collectFiles(dir: string, extension: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, extension)));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }
  return files;
}

function extractUserFacingTextAndStrings(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "")
    .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");

  const snippets: string[] = [];

  for (const match of withoutComments.matchAll(/"([^"\n\\]*(?:\\.[^"\n\\]*)*)"/g)) {
    const value = match[1];
    if (!value) continue;
    if (/^[a-z0-9_.:/-]+$/.test(value)) continue;
    if (/^[A-Z0-9_]+$/.test(value)) continue;
    snippets.push(value);
  }
  for (const match of withoutComments.matchAll(/`([^`\\]*(?:\\.[^`\\]*)*)`/g)) {
    const value = match[1];
    if (!value) continue;
    snippets.push(value);
  }
  for (const match of withoutComments.matchAll(/>([^<>{}]+)</g)) {
    const trimmed = match[1]?.trim();
    if (trimmed) snippets.push(trimmed);
  }

  return snippets;
}

test("Gate 1: full TSX tree (landing, auth, and app pages/components) has zero vendor or internal noise copy", async () => {
  const roots = [path.join(ROOT, "src/app"), path.join(ROOT, "src/components")];
  const files = (await Promise.all(roots.map((dir) => collectFiles(dir, ".tsx")))).flat();
  assert.ok(files.length > 25);

  for (const absPath of files) {
    const raw = await readFile(absPath, "utf8");
    const relPath = path.relative(ROOT, absPath);
    const snippets = extractUserFacingTextAndStrings(raw);
    for (const snippet of snippets) {
      const vendorMatch = snippet.match(VENDOR_USER_COPY_PATTERN);
      assert.equal(
        vendorMatch,
        null,
        `Found leaked vendor copy (${vendorMatch?.[0]}) in ${relPath}: ${snippet.slice(0, 140)}`,
      );

      const noiseMatch = snippet.match(INTERNAL_NOISE_PATTERN);
      assert.equal(
        noiseMatch,
        null,
        `Found internal engineering copy (${noiseMatch?.[0]}) in ${relPath}: ${snippet.slice(0, 140)}`,
      );
    }
  }
});

test("Gate 2: server auth and /api/v1 error boundaries emit zero vendor or infrastructure names in user copy", async () => {
  const targetFiles = [
    path.join(ROOT, "src/server/auth/workspace-session.ts"),
    path.join(ROOT, "src/server/domain/workspace-invite-service.ts"),
    ...(await collectFiles(path.join(ROOT, "src/app/api/v1"), ".ts")),
  ];
  assert.ok(targetFiles.length > 10);

  for (const absPath of targetFiles) {
    const raw = await readFile(absPath, "utf8");
    const relPath = path.relative(ROOT, absPath);
    const snippets = extractUserFacingTextAndStrings(raw);
    for (const snippet of snippets) {
      // Skip technical URLs/env variable references inside server routes when not user prose
      if (snippet.startsWith("http://") || snippet.startsWith("https://")) continue;
      const match = snippet.match(VENDOR_USER_COPY_PATTERN);
      assert.equal(
        match,
        null,
        `Found user-facing vendor copy (${match?.[0]}) in ${relPath}: ${snippet.slice(0, 140)}`,
      );
    }
  }
});

test("Gate 3: CSV export provenance, message masking, and error sanitization remain white-labeled", () => {
  const now = "2026-11-24T00:00:00.000Z";
  const convId = "00000000-0000-4000-8000-0000000012d1";
  const decisionId = "00000000-0000-4000-8000-0000000012d2";
  const searchId = "00000000-0000-4000-8000-0000000012d3";
  const personSearchId = "00000000-0000-4000-8000-0000000012d4";

  const dossier = scoreAndBuildAccountDossier(
    {
      provider: "prospeo",
      id: "co-solar-1",
      name: "Klang Valley Cold Storage",
      domain: "kvcs.example.my",
      website: "https://kvcs.example.my",
      industry: "Cold Storage (OpenStreetMap)",
      location: { city: "Shah Alam", country: "Malaysia" },
    },
    {
      dossierId: "00000000-0000-4000-8000-0000000012d5",
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "prospeo",
      targetMarketName: "Malaysia",
      targetIndustryName: "Cold Storage",
      canonicalLocations: ["Shah Alam"],
      linkedClaimIds: [],
      capturedAt: now,
      lifecycleState: "shortlisted",
    },
  );

  const makeContact = (id: string, fullName: string): ContactCandidateView =>
    normalizeDiscoveredPersonCandidate(
      {
        id,
        providerKey: "prospeo",
        fullName,
        title: "Operations Director",
      },
      {
        candidateId: id,
        conversationId: convId,
        targetDecisionId: decisionId,
        personSearchId,
        account: dossier,
        roleRecommendations: [],
        providerKey: "prospeo",
        capturedAt: now,
      },
    );

  const prospeoVerified: ContactCandidateView = {
    ...makeContact("00000000-0000-4000-8000-0000000012d6", "Lim Wei Ming"),
    verificationStatus: "verified",
    verifiedDetails: {
      email: "weiming@kvcs.example.my",
      emailQualification: "VERIFIED",
      phone: null,
      verifiedDomain: "kvcs.example.my",
      provider: "prospeo",
      verifiedAt: now,
    },
  };

  const dropcontactVerified: ContactCandidateView = {
    ...makeContact("00000000-0000-4000-8000-0000000012d7", "Nurul Aina"),
    verificationStatus: "verified",
    verifiedDetails: {
      email: "aina@kvcs.example.my",
      emailQualification: "VERIFIED",
      phone: null,
      verifiedDomain: "kvcs.example.my",
      provider: "dropcontact",
      verifiedAt: now,
    },
  };

  const publicDirect: ContactCandidateView = {
    ...makeContact("00000000-0000-4000-8000-0000000012d8", "Rajesh Nair"),
    publicEmail: "rajesh@kvcs.example.my",
    publicEmailKind: "direct_public",
  };

  const exportResult = buildLeadsCsv(
    [prospeoVerified, dropcontactVerified, publicDirect],
    new Map([[dossier.id, dossier]]),
    "with_email",
  );
  assert.equal(exportResult.rowCount, 3);
  assert.equal(exportResult.verifiedCount, 2);
  assert.equal(exportResult.publicEmailCount, 1);
  assert.equal(VENDOR_USER_COPY_PATTERN.test(exportResult.csv), false);
  assert.equal(exportResult.csv.split(",verified,verified_work_email,").length - 1, 2);
  assert.equal(
    exportResult.csv.split(",unverified_public,public_website_direct,").length - 1,
    1,
  );

  const maskedMsg = maskVendorNamesForDisplay(
    "Found via OpenStreetMap and SearXNG; verified with Prospeo and Dropcontact; drafted via Gemini and Mercury.",
  );
  assert.equal(VENDOR_USER_COPY_PATTERN.test(maskedMsg), false);

  const rawProviderErr =
    'Google AI Studio model "gemini-3.5-flash-lite" returned HTTP 503 with GEMINI_API_KEY=secret123';
  const safeDisplay = formatDisplayErrorMessage(rawProviderErr);
  assert.equal(VENDOR_USER_COPY_PATTERN.test(safeDisplay), false);
  assert.equal(/503|gemini-3\.5|secret123/i.test(safeDisplay), false);
});

test("Gate 4: LLM runtime fails over cleanly across 503/429, honors cooldowns, and masks all-failed errors", async () => {
  resetGeminiModelCooldowns();
  try {
    let clock = 5_000_000;
    const calls: string[] = [];

    const model = createGeminiChatModel(
      {
        provider: "gemini",
        apiKey: "gate-test-key",
        modelId: "gemini-3.5-flash-lite",
        fallbackModelIds: ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite"],
        baseUrl: DEFAULT_GEMINI_BASE_URL,
      },
      {
        retryDelayMs: 0,
        cooldownMs: 60_000,
        now: () => clock,
        fetcher: async (input) => {
          const url = String(input);
          calls.push(url);
          if (url.includes("gemini-3.5-flash-lite")) {
            return new Response(JSON.stringify({ error: { code: 503, message: "Busy" } }), {
              status: 503,
            });
          }
          if (url.includes("gemini-3.1-flash-lite")) {
            return new Response(JSON.stringify({ error: { code: 429, message: "Rate limit" } }), {
              status: 429,
            });
          }
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: "{\"status\":\"ok\"}" }] } }],
            }),
            { status: 200 },
          );
        },
      },
    );

    const first = await model.invoke([new HumanMessage("hello")]);
    assert.equal(first.content, "{\"status\":\"ok\"}");
    assert.equal(isGeminiModelCoolingDown("gemini-3.5-flash-lite", clock), true);
    assert.equal(isGeminiModelCoolingDown("gemini-3.1-flash-lite", clock), true);

    clock += 5_000;
    const beforeSecondCount = calls.length;
    const second = await model.invoke([new HumanMessage("hello again")]);
    assert.equal(second.content, "{\"status\":\"ok\"}");
    assert.equal(calls.length, beforeSecondCount + 1);
    assert.ok(calls[calls.length - 1].includes("gemini-2.5-flash-lite"));

    const exhaustedModel = createGeminiChatModel(
      {
        provider: "gemini",
        apiKey: "gate-test-key",
        modelId: "gemini-2.5-flash-lite",
        fallbackModelIds: [],
        baseUrl: DEFAULT_GEMINI_BASE_URL,
      },
      {
        retryDelayMs: 0,
        fetcher: async () =>
          new Response(JSON.stringify({ error: { code: 503, message: "Overloaded" } }), {
            status: 503,
          }),
      },
    );

    await assert.rejects(
      () => exhaustedModel.invoke([new HumanMessage("fail")]),
      (err: unknown) => {
        if (!(err instanceof GeminiApiError)) return false;
        assert.equal(err.message, USER_HIGH_DEMAND_LLM_MESSAGE);
        assert.equal(VENDOR_USER_COPY_PATTERN.test(sanitizeLlmErrorForUser(err)), false);
        return true;
      },
    );
  } finally {
    resetGeminiModelCooldowns();
  }
});

test("Gate 5: full CSS & TSX codebase maintains pure Material Web 3 controls, tokens, and zero Tailwind", async () => {
  const pkg = await readFile(path.join(ROOT, "package.json"), "utf8");
  assert.equal(/tailwindcss/.test(pkg), false);

  const layout = await readFile(path.join(ROOT, "src/app/layout.tsx"), "utf8");
  assert.match(layout, /import\s+\{\s*Roboto\s*\}\s+from\s+["']next\/font\/google["']/);
  assert.match(layout, /@material\/web\/typography\/md-typescale-styles\.css/);
  assert.match(layout, /@\/styles\/home\.css/);

  const tsxRoots = [path.join(ROOT, "src/app"), path.join(ROOT, "src/components")];
  const tsxFiles = (await Promise.all(tsxRoots.map((dir) => collectFiles(dir, ".tsx")))).flat();
  for (const absPath of tsxFiles) {
    const relPath = path.relative(ROOT, absPath);
    const source = await readFile(absPath, "utf8");
    assert.equal(/<(?:button|select|textarea)\b/.test(source), false, `Raw HTML control in ${relPath}`);
    for (const match of source.matchAll(/<input\b[\s\S]*?>/g)) {
      assert.equal(relPath, path.normalize("src/components/conversation/conversation-composer.tsx"));
      assert.match(match[0], /type="file"/);
    }
  }

  const cssFiles = [
    ...(await collectFiles(path.join(ROOT, "src/styles"), ".css")),
    path.join(ROOT, "src/app/globals.css"),
  ];
  assert.ok(cssFiles.some((p) => path.basename(p) === "home.css"));

  for (const absPath of cssFiles) {
    const relPath = path.relative(ROOT, absPath);
    const css = await readFile(absPath, "utf8");
    assert.equal(/(?:@apply\b|@theme\b|tailwindcss)/.test(css), false, `Tailwind in ${relPath}`);
    assert.equal(/font-size:\s*\d+(?:\.\d+)?px/.test(css), false, `Pixel font-size in ${relPath}`);
    assert.equal(/box-shadow\s*:/.test(css), false, `Custom box-shadow in ${relPath}`);
    for (const match of css.matchAll(/font-family\s*:\s*([^;]+);/g)) {
      const value = match[1]?.trim() ?? "";
      assert.ok(
        value.includes("--md-ref-typeface-") || value.includes("--md-sys-typescale-") || value.includes("--font-roboto"),
        `Non-token font-family "${value}" in ${relPath}`,
      );
    }
  }
});

test("Gate 6: root homepage renders LandingHome with pure Material Web 3 and zero AI-slop", async () => {
  const pageSource = await readFile(path.join(ROOT, "src/app/page.tsx"), "utf8");
  assert.equal(/redirect\s*\(/.test(pageSource), false);
  assert.match(pageSource, /LandingHome/);

  const homeSource = await readFile(path.join(ROOT, "src/components/home/landing-home.tsx"), "utf8");
  assert.match(homeSource, /MaterialButton/);
  assert.match(homeSource, /MaterialIconButton/);
  assert.match(homeSource, /<md-tabs\b/);
  assert.match(homeSource, /<md-primary-tab\b/);
  assert.match(homeSource, /<md-divider\b/);
  assert.match(homeSource, /href="\/signup"/);
  assert.match(homeSource, /href="\/login"/);
  assert.match(homeSource, /href="\/research"/);

  const snippets = extractUserFacingTextAndStrings(homeSource);
  for (const snippet of snippets) {
    const slopMatch = snippet.match(AI_SLOP_PATTERN);
    assert.equal(
      slopMatch,
      null,
      `Found AI-slop phrasing (${slopMatch?.[0]}) in landing-home.tsx: ${snippet.slice(0, 120)}`,
    );
  }
});

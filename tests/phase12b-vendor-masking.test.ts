import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildTargetCompanySearchPreview,
  scoreAndBuildAccountDossier,
  summarizeAccountCohort,
} from "@/lib/ano/company-discovery";
import { buildLeadsCsv, resolveLeadEmailProvenance } from "@/lib/ano/lead-export";
import type { IndustryProfile, MarketProfile } from "@/lib/ano/market-synthesis";
import { evaluateContactEligibility } from "@/lib/ano/outreach-execution";
import {
  buildDropcontactVerificationPreview,
  buildPersonSearchPreview,
  compileFactualAccountPlaybook,
  deriveBuyerRoleRecommendations,
  formatContactForCohortTable,
  normalizeDiscoveredPersonCandidate,
  type ContactCandidateView,
} from "@/lib/ano/people-playbooks";
import {
  maskVendorNamesForDisplay,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import { classifyConversationWorkItem } from "@/lib/ano/work-queue";
import {
  buildConversationChatPrompt,
  replyInResearchConversation,
} from "@/server/agents/conversation-chat-model";

const ROOT = process.cwd();

const VENDOR_USER_COPY_PATTERN =
  /\b(?:Prospeo|Dropcontact|SearXNG|Tavily|OpenStreetMap|OSM|Nominatim|Overpass|Mercury|Google AI Studio|Gemini|Amazon Bedrock|Bedrock|Ollama|LangGraph|Supabase|PROSPEO_KEY|DROPCONTACT_API_KEY|SEARXNG_BASE_URL|SEARXNG_GATEWAY_TOKEN|GEMINI_API_KEY|ANO_AGENT_MODE|OVERPASS_API_URL)\b/;

async function collectTsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsxFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
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
    // Skip lowercase internal enum/key literals like "prospeo", "openstreetmap", "mercury_draft"
    if (/^[a-z0-9_.:/-]+$/.test(value)) continue;
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

test("rendered TSX pages and components contain zero backend vendor or env-var copy", async () => {
  const roots = [
    path.join(ROOT, "src/app/(app)"),
    path.join(ROOT, "src/components"),
  ];
  const files = (await Promise.all(roots.map((dir) => collectTsxFiles(dir)))).flat();
  assert.ok(files.length > 20);

  for (const absPath of files) {
    const raw = await readFile(absPath, "utf8");
    const snippets = extractUserFacingTextAndStrings(raw);
    for (const snippet of snippets) {
      const match = snippet.match(VENDOR_USER_COPY_PATTERN);
      assert.equal(
        match,
        null,
        `Found leaked vendor copy (${match?.[0]}) in ${path.relative(ROOT, absPath)}: ${snippet.slice(0, 120)}`,
      );
    }
  }
});

test("Settings provider card, Outreach Mercury button, and ContextRail Mercury/budget sections are removed", async () => {
  const [settingsRaw, outreachRaw, railRaw] = await Promise.all([
    readFile(path.join(ROOT, "src/app/(app)/settings/page.tsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/artifacts/outreach-draft-card.tsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/shell/context-rail.tsx"), "utf8"),
  ]);

  assert.doesNotMatch(settingsRaw, /Provider & safety boundaries/);
  assert.doesNotMatch(outreachRaw, /Propose Mercury draft/);
  assert.match(outreachRaw, /ApprovalCard/);
  assert.doesNotMatch(railRaw, /Outreach & Mercury/);
  assert.doesNotMatch(railRaw, /Provider budget/);
});

test("maskVendorNamesForDisplay scrubs legacy persisted vendor/engine copy while preserving normal prose", () => {
  const dirty =
    "OpenStreetMap Nominatim resolved Petaling Jaya via Private SearXNG; Prospeo or Dropcontact verified emails; Mercury CRM synced via Google AI Studio Gemini and LangGraph.";
  const masked = maskVendorNamesForDisplay(dirty);

  assert.equal(VENDOR_USER_COPY_PATTERN.test(masked), false, `Unmasked leak: ${masked}`);
  assert.match(masked, /Petaling Jaya/);
  assert.match(masked, /CRM/);
  assert.equal(
    maskVendorNamesForDisplay("Clean dental clinic cohort in Singapore."),
    "Clean dental clinic cohort in Singapore.",
  );
  assert.equal(maskVendorNamesForDisplay(null), "");
});

test("lead export, work queue, discovery, verification, and playbooks emit white-label provenance & copy", () => {
  const now = "2026-11-24T00:00:00.000Z";
  const convId = "00000000-0000-4000-8000-000000001201";
  const decisionId = "00000000-0000-4000-8000-000000001202";
  const searchId = "00000000-0000-4000-8000-000000001203";
  const personSearchId = "00000000-0000-4000-8000-000000001204";
  const claimId = "00000000-0000-4000-8000-000000001205";
  const marketId = "00000000-0000-4000-8000-000000001206";
  const industryId = "00000000-0000-4000-8000-000000001207";
  const dossierId = "00000000-0000-4000-8000-000000001208";
  const verificationRunId = "00000000-0000-4000-8000-000000001209";
  const playbookId = "00000000-0000-4000-8000-000000001210";

  const market: MarketProfile = {
    id: marketId,
    name: "Malaysia",
    summary: "Growing private dental demand in urban centers.",
    evidenceStrength: "high" as unknown as MarketProfile["evidenceStrength"],
    claimIds: [claimId],
    unknowns: ["Clinic staffing size"],
    nextResearchActions: ["Confirm PMS adoption"],
  };
  const industry: IndustryProfile = {
    id: industryId,
    marketProfileId: marketId,
    name: "Dental Clinic",
    summary: "Independent multi-chair dental practices.",
    operationalProblems: ["High patient no-show rates"],
    solutionFit: ["Automated recall scheduling"],
    buyerRoleHypotheses: ["Principal Dentist", "Practice Manager"],
    evidenceStrength: "high" as unknown as IndustryProfile["evidenceStrength"],
    claimIds: [claimId],
    unknowns: ["Current software stack"],
  };

  const preview = buildTargetCompanySearchPreview({
    searchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    market,
    industry,
    requestedLocations: ["Kuala Lumpur"],
    canonicalLocations: ["Kuala Lumpur"],
    nowIso: now,
  });
  assert.equal(VENDOR_USER_COPY_PATTERN.test(preview.estimateDetail), false);
  assert.equal(preview.criteria.some((c) => VENDOR_USER_COPY_PATTERN.test(c)), false);

  const dossier = scoreAndBuildAccountDossier(
    {
      provider: "prospeo",
      id: "co-1",
      name: "Bangsar Dental Studio",
      domain: "bangsardental.my",
      website: "https://bangsardental.my",
      industry: "Dental Clinic",
      employeeRange: "11-50",
      location: { city: "Kuala Lumpur", country: "Malaysia" },
      description: "Private cosmetic and general dentistry clinic.",
    },
    {
      dossierId,
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "prospeo",
      targetMarketName: "Malaysia",
      targetIndustryName: "Dental Clinic",
      canonicalLocations: ["Kuala Lumpur"],
      linkedClaimIds: [claimId],
      capturedAt: now,
      lifecycleState: "shortlisted",
    },
  );
  for (const sig of dossier.signals) {
    assert.equal(VENDOR_USER_COPY_PATTERN.test(sig.sourceAttribution), false);
    assert.equal(VENDOR_USER_COPY_PATTERN.test(sig.explanation), false);
  }
  assert.equal(dossier.unknowns.some((u) => VENDOR_USER_COPY_PATTERN.test(u)), false);

  const cohort = summarizeAccountCohort([dossier], "Malaysia", "Dental Clinic", 1, "prospeo");
  assert.equal(VENDOR_USER_COPY_PATTERN.test(cohort.cohortExplanation), false);
  assert.equal(VENDOR_USER_COPY_PATTERN.test(cohort.separationNote), false);

  const roleRecommendations = deriveBuyerRoleRecommendations(industry, null, ["Principal Dentist"]);
  const personPreview = buildPersonSearchPreview({
    personSearchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    shortlistedAccounts: [dossier],
    roleRecommendations,
    providerKey: "prospeo",
    nowIso: now,
  });
  assert.equal(VENDOR_USER_COPY_PATTERN.test(personPreview.estimateDetail), false);

  const candidate = normalizeDiscoveredPersonCandidate(
    {
      id: "p1",
      providerKey: "prospeo",
      fullName: "Dr. Mei Tan",
      firstName: "Mei",
      lastName: "Tan",
      title: "Principal Dentist",
      linkedInUrl: "https://linkedin.com/in/mei-tan",
    },
    {
      candidateId: "00000000-0000-4000-8000-000000001211",
      conversationId: convId,
      targetDecisionId: decisionId,
      personSearchId,
      account: dossier,
      roleRecommendations,
      providerKey: "prospeo",
      capturedAt: now,
    },
  );

  const verifiedContact: ContactCandidateView = {
    ...normalizeDiscoveredPersonCandidate(
      {
        id: "p2",
        providerKey: "website_team",
        fullName: "Dr. Mei Tan",
        firstName: "Mei",
        lastName: "Tan",
        title: "Principal Dentist",
      },
      {
        candidateId: "00000000-0000-4000-8000-000000001212",
        conversationId: convId,
        targetDecisionId: decisionId,
        personSearchId,
        account: dossier,
        roleRecommendations: [],
        providerKey: "website_team",
        capturedAt: now,
      },
    ),
    verificationStatus: "verified",
    verifiedDetails: {
      email: "mei@bangsardental.my",
      emailQualification: "VERIFIED",
      phone: "+60 3 2282 1000",
      verifiedDomain: "bangsardental.my",
      provider: "prospeo",
      verifiedAt: now,
    },
  };

  assert.equal(resolveLeadEmailProvenance(verifiedContact).emailSource, "verified_work_email");
  const csv = buildLeadsCsv([verifiedContact], new Map([[dossier.id, dossier]]), "all");
  assert.equal(VENDOR_USER_COPY_PATTERN.test(csv.csv), false);
  assert.match(csv.csv, /,verified,verified_work_email,/);

  const row = formatContactForCohortTable(verifiedContact);
  assert.equal(row.emailSourceLabel, "Verified work email");
  assert.equal(VENDOR_USER_COPY_PATTERN.test(candidate.roleRationale ?? ""), false);

  const dcPreview = buildDropcontactVerificationPreview({
    verificationRunId,
    conversationId: convId,
    personSearchId,
    selectedContacts: [candidate],
    providerKey: "prospeo",
    nowIso: now,
  });
  assert.equal(VENDOR_USER_COPY_PATTERN.test(dcPreview.estimateDetail), false);

  const elig = evaluateContactEligibility(verifiedContact, "email");
  assert.equal(elig.reasons.some((r) => VENDOR_USER_COPY_PATTERN.test(r)), false);

  const playbook = compileFactualAccountPlaybook({
    playbookId,
    conversationId: convId,
    targetDecisionId: decisionId,
    account: dossier,
    targetMarketName: "Malaysia",
    industry,
    claims: [],
    contacts: [verifiedContact],
    nowIso: now,
  });
  assert.equal(
    playbook.evidenceBackedPoints.some(
      (pt) => VENDOR_USER_COPY_PATTERN.test(pt.attribution) || VENDOR_USER_COPY_PATTERN.test(pt.statement),
    ),
    false,
  );
  assert.equal(playbook.validationQuestions.some((q) => VENDOR_USER_COPY_PATTERN.test(q)), false);

  const queueItem = classifyConversationWorkItem({
    conversation: {
      id: convId,
      title: "Malaysia Dental",
      status: "complete_without_research",
      createdAt: now,
      updatedAt: now,
    },
    targetDecision: { status: "locked", updatedAt: now },
    verificationRun: { status: "awaiting_approval", estimatedCredits: 1, updatedAt: now },
  });
  assert.ok(queueItem);
  assert.equal(VENDOR_USER_COPY_PATTERN.test(queueItem.label), false);
  assert.equal(VENDOR_USER_COPY_PATTERN.test(queueItem.detail), false);
});

test("chat prompt includes WHITE-LABEL OUTPUT RULE and replyInResearchConversation masks vendor names", async () => {
  const now = "2026-11-24T00:00:00.000Z";
  const conversationView: ResearchConversationView = {
    conversation: {
      id: "00000000-0000-4000-8000-000000001299",
      title: "Southeast Asia Dental",
      status: "complete_without_research",
      threadId: "thread-wl",
      createdAt: now,
      updatedAt: now,
    },
    brief: {
      offer: "Ano Dental — automated patient recall software",
      goal: "Find dental clinics in Malaysia",
      marketHints: ["Dental clinics"],
      locationHints: ["Malaysia"],
      buyerHints: ["Principal Dentist"],
      constraints: [],
      sourceMessageIds: [],
      unknowns: [],
    },
    pendingQuestion: null,
    plan: null,
    messages: [],
    events: [],
    run: {
      id: "00000000-0000-4000-8000-000000001298",
      status: "complete_without_research",
      graphVersion: "phase-a-v1",
      currentNode: "complete",
      checkpointRef: null,
      failureMessage: null,
    },
  };

  const { system } = buildConversationChatPrompt(
    {
      conversation: conversationView,
      research: null,
      synthesis: null,
    },
    "Which contacts have verified emails?",
  );
  assert.match(system, /WHITE-LABEL OUTPUT RULE/);

  const out = await replyInResearchConversation(
    {
      provider: "gemini",
      modelId: "gemini-2.5-flash",
      apiKey: "test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    },
    {
      conversation: conversationView,
      research: null,
      synthesis: null,
    },
    "Which contacts have verified emails?",
    {
      async invoke() {
        return {
          content: JSON.stringify({
            reply:
              "Prospeo and Dropcontact verified Mei Tan via SearXNG and OpenStreetMap; Mercury CRM is ready on Google AI Studio.",
            approveAction: null,
            filterUpdate: null,
            shortlistUpdate: null,
            peopleUpdate: null,
            verificationUpdate: null,
            templateUpdate: null,
            autopilotRerun: null,
          }),
        };
      },
    },
  );

  assert.equal(VENDOR_USER_COPY_PATTERN.test(out.reply), false, `Reply leaked vendor: ${out.reply}`);
  assert.match(out.reply, /Mei Tan/);
});

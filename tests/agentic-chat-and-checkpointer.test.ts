import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaver } from "@langchain/langgraph";

import {
  scoreAndBuildAccountDossier,
  type CompanySearchView,
} from "@/lib/ano/company-discovery";
import {
  buildPersonSearchPreview,
  deriveBuyerRoleRecommendations,
  deriveBuyingCommitteeCriteria,
  normalizeDiscoveredPersonCandidate,
  type PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import type { IndustryProfile } from "@/lib/ano/market-synthesis";
import type { ResearchConversationView } from "@/lib/ano/research-conversation";
import {
  applyDeterministicChatFailsafes,
  buildConversationChatPrompt,
  parseConversationChatResponse,
  replyInResearchConversation,
  userExplicitlyApprovedSpend,
  userRequestedAction,
} from "@/server/agents/conversation-chat-model";
import {
  discoverPeopleFromCompanyWebsites,
  matchWebsiteContactForPerson,
} from "@/server/connectors/website-team/website-team-client";
import {
  selectAccountsForChatShortlist,
  selectContactsForChatVerification,
} from "@/server/domain/research-conversation-service";
import {
  getResearchCheckpointer,
  hasPostgresCheckpointerConfig,
} from "@/server/langgraph/checkpointer";

const convId = "00000000-0000-4000-8000-000000001001";
const decisionId = "00000000-0000-4000-8000-000000001002";
const searchId = "00000000-0000-4000-8000-000000001003";
const personSearchId = "00000000-0000-4000-8000-000000001004";
const claimId = "00000000-0000-4000-8000-000000001005";
const now = "2026-11-23T11:00:00.000Z";

const dentalIndustry: IndustryProfile = {
  id: "00000000-0000-4000-8000-000000001010",
  marketProfileId: "00000000-0000-4000-8000-000000001011",
  name: "Multi-chair dental practices",
  summary: "Private multi-chair dental groups.",
  operationalProblems: ["Unbooked recall patients"],
  solutionFit: ["Automated recall scheduling"],
  buyerRoleHypotheses: ["Practice Manager", "Principal Dentist"],
  evidenceStrength: "moderate",
  claimIds: [claimId],
  unknowns: [],
};

test("getResearchCheckpointer uses MemorySaver when SUPABASE_DB_URL is absent (Vercel runtime) and enforces label guard when set", async () => {
  const prevUrl = process.env.SUPABASE_DB_URL;
  const prevLabel = process.env.ANO_DATABASE_LABEL;

  try {
    delete process.env.SUPABASE_DB_URL;
    delete process.env.ANO_DATABASE_LABEL;

    assert.equal(hasPostgresCheckpointerConfig(), false);
    const saver = await getResearchCheckpointer();
    assert.ok(saver instanceof MemorySaver);

    process.env.SUPABASE_DB_URL = "postgres://postgres:pw@db.example.supabase.co:5432/postgres";
    process.env.ANO_DATABASE_LABEL = "wrong_label";
    assert.equal(hasPostgresCheckpointerConfig(), false);

    await assert.rejects(
      () => getResearchCheckpointer(),
      /dedicated Ano database label is not set/i,
    );
  } finally {
    if (prevUrl === undefined) delete process.env.SUPABASE_DB_URL;
    else process.env.SUPABASE_DB_URL = prevUrl;

    if (prevLabel === undefined) delete process.env.ANO_DATABASE_LABEL;
    else process.env.ANO_DATABASE_LABEL = prevLabel;
  }
});

test("userRequestedAction and userExplicitlyApprovedSpend distinguish Q&A, action staging, and explicit credit approval", () => {
  // Explicit approvals -> allow both action handling and spend execution
  assert.equal(userRequestedAction("yes approved and proceed please"), true);
  assert.equal(userExplicitlyApprovedSpend("yes approved and proceed please"), true);

  assert.equal(userRequestedAction("go ahead and run the Prospeo search"), true);
  assert.equal(userExplicitlyApprovedSpend("go ahead and run the Prospeo search"), true);

  assert.equal(userRequestedAction("approved"), true);
  assert.equal(userExplicitlyApprovedSpend("approved"), true);

  // Action requests without explicit spend approval -> prepare preview / run $0 actions only
  const getListPrompt =
    "okay, can you now proceed to give the list of at least 10 contacts i can reach out to in malaysia?";
  assert.equal(userRequestedAction(getListPrompt), true);
  assert.equal(userExplicitlyApprovedSpend(getListPrompt), false);

  assert.equal(userRequestedAction("shortlist Qualitas Health Malaysia"), true);
  assert.equal(userExplicitlyApprovedSpend("shortlist Qualitas Health Malaysia"), false);

  assert.equal(userRequestedAction("verify emails via Prospeo"), true);
  assert.equal(userExplicitlyApprovedSpend("verify emails via Prospeo"), false);

  // Read-only / advisory questions -> suppress mutations and spend
  assert.equal(userRequestedAction("what hasn't been done though yet?"), false);
  assert.equal(userExplicitlyApprovedSpend("what hasn't been done though yet?"), false);

  assert.equal(
    userRequestedAction(
      "Okay what would you say are the next steps we want to use? and what market should we start with?",
    ),
    false,
  );
  assert.equal(
    userExplicitlyApprovedSpend("should we approve the Prospeo search or switch to OpenStreetMap?"),
    false,
  );
});

test("parseConversationChatResponse, buildConversationChatPrompt, and replyInResearchConversation handle agentic directives", async () => {
  const qualitas = scoreAndBuildAccountDossier(
    {
      provider: "prospeo",
      id: "co-my-1",
      name: "Qualitas Health Malaysia",
      domain: "qualitas.com.my",
      industry: "Medical Practices",
      location: { city: "Petaling Jaya", country: "Malaysia" },
    },
    {
      dossierId: "00000000-0000-4000-8000-000000001021",
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "prospeo",
      targetMarketName: "Malaysia",
      targetIndustryName: "Medical Practices",
      canonicalLocations: ["Malaysia"],
      linkedClaimIds: [claimId],
      capturedAt: now,
    },
  );

  const awaitingCompanySearch: CompanySearchView = {
    id: searchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    providerActionRequestId: null,
    providerKey: "prospeo",
    status: "awaiting_approval",
    targetMarketName: "Malaysia",
    targetIndustryName: "Medical Practices",
    requestedLocations: ["Malaysia"],
    canonicalLocations: ["Malaysia"],
    canonicalIndustries: ["Medical Practices"],
    industryKeywords: ["dental"],
    excludedCategories: [],
    linkedClaimIds: [claimId],
    criteria: ["Malaysia"],
    providerFilters: { company_location_search: { include: ["Malaysia"] } },
    maximumResults: 25,
    estimatedMaximumCredits: 1,
    estimateDetail: "1 page",
    resultCount: null,
    providerReceipt: {},
    failureMessage: null,
    cohort: null,
    accounts: [qualitas],
    approvedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const roles = deriveBuyerRoleRecommendations(dentalIndustry, null);
  const awaitingPeopleDiscovery: PeopleDiscoveryView = {
    shortlistedCount: 1,
    personSearch: buildPersonSearchPreview({
      personSearchId,
      conversationId: convId,
      targetDecisionId: decisionId,
      shortlistedAccounts: [qualitas],
      roleRecommendations: roles,
      providerKey: "prospeo",
      buyingCommittee: deriveBuyingCommitteeCriteria({
        industry: dentalIndustry,
        brief: null,
        shortlistedAccounts: [qualitas],
      }),
      nowIso: now,
    }),
    contacts: [],
    verificationRun: null,
    playbooks: [],
  };

  const conversation: ResearchConversationView = {
    conversation: {
      id: convId,
      title: "Malaysia dental clinics",
      status: "complete_without_research",
      threadId: `ano:ws:${convId}`,
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: "00000000-0000-4000-8000-000000001099",
      status: "complete_without_research",
      graphVersion: "phase-a-v1",
      currentNode: "complete",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [],
    brief: null,
    pendingQuestion: null,
    plan: null,
    events: [],
  };

  const { user, system } = buildConversationChatPrompt(
    {
      conversation,
      companySearch: awaitingCompanySearch,
      peopleDiscovery: awaitingPeopleDiscovery,
    },
    "yes approved and proceed please",
  );
  assert.ok(user.includes("Pending approvals ready to execute upon user confirmation:"));
  assert.ok(user.includes("- company_search (provider=prospeo"));
  assert.ok(user.includes("- person_search (provider=prospeo"));
  assert.ok(system.includes("approveAction"));
  assert.ok(system.includes("shortlistUpdate"));
  assert.ok(system.includes("verificationUpdate"));

  const parsed = parseConversationChatResponse(
    JSON.stringify({
      reply: "Running the approved Malaysia company search now.",
      approveAction: { apply: true, target: "company_search", reason: "User approved search" },
      shortlistUpdate: {
        apply: true,
        action: "shortlist",
        locationFilter: "Malaysia",
        topN: 5,
      },
      verificationUpdate: {
        apply: true,
        providerKey: "prospeo",
        topN: 10,
        executeIfApproved: true,
      },
    }),
  );
  assert.equal(parsed.approveAction?.apply, true);
  assert.equal(parsed.approveAction?.target, "company_search");
  assert.equal(parsed.shortlistUpdate?.locationFilter, "Malaysia");
  assert.equal(parsed.verificationUpdate?.providerKey, "prospeo");

  const config = {
    provider: "gemini" as const,
    apiKey: "test-key",
    modelId: "gemini-3.5-flash-lite",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  };

  // On affirmative approval turn, approveAction + filterUpdate remain active.
  const approvedReply = await replyInResearchConversation(
    config,
    { conversation, companySearch: awaitingCompanySearch },
    "yes approved and proceed please",
    {
      async invoke() {
        return {
          content: JSON.stringify({
            reply: "Executing the approved Malaysia search.",
            approveAction: { apply: true, target: "company_search" },
            filterUpdate: { apply: true, locations: ["Malaysia"], executeIfApproved: true },
          }),
        };
      },
    },
  );
  assert.equal(approvedReply.approveAction?.apply, true);
  assert.equal(approvedReply.filterUpdate?.apply, true);

  // On read-only question, all 6 directives must be suppressed to null.
  const qaReply = await replyInResearchConversation(
    config,
    { conversation, companySearch: awaitingCompanySearch },
    "what hasn't been done though yet?",
    {
      async invoke() {
        return {
          content: JSON.stringify({
            reply: "People discovery and verification remain unfinished.",
            approveAction: { apply: true, target: "any_pending" },
            filterUpdate: { apply: true, locations: ["Malaysia"] },
            shortlistUpdate: { apply: true, action: "shortlist", all: true },
            peopleUpdate: { apply: true, providerKey: "prospeo" },
            verificationUpdate: { apply: true, providerKey: "prospeo" },
            templateUpdate: { apply: true, tone: "warm_smb" },
          }),
        };
      },
    },
  );
  assert.equal(qaReply.approveAction, null);
  assert.equal(qaReply.filterUpdate, null);
  assert.equal(qaReply.shortlistUpdate, null);
  assert.equal(qaReply.peopleUpdate, null);
  assert.equal(qaReply.verificationUpdate, null);
  assert.equal(qaReply.templateUpdate, null);
});

test("selectAccountsForChatShortlist and selectContactsForChatVerification filter cleanly and enforce batch bounds", () => {
  const myHigh = scoreAndBuildAccountDossier(
    {
      provider: "prospeo",
      id: "co-1",
      name: "Qualitas Health Malaysia",
      website: "https://qualitas.com.my",
      domain: "qualitas.com.my",
      industry: "Medical Practices",
      location: { city: "Petaling Jaya", country: "Malaysia" },
    },
    {
      dossierId: "00000000-0000-4000-8000-000000002001",
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "prospeo",
      targetMarketName: "Malaysia",
      targetIndustryName: "Medical Practices",
      canonicalLocations: ["Malaysia"],
      linkedClaimIds: [claimId],
      capturedAt: now,
    },
  );

  const sgClinic = scoreAndBuildAccountDossier(
    {
      provider: "prospeo",
      id: "co-2",
      name: "Raffles Dental Singapore",
      website: "https://rafflesdental.com.sg",
      domain: "rafflesdental.com.sg",
      industry: "Medical Practices",
      location: { city: "Singapore", country: "Singapore" },
    },
    {
      dossierId: "00000000-0000-4000-8000-000000002002",
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "prospeo",
      targetMarketName: "Malaysia",
      targetIndustryName: "Medical Practices",
      canonicalLocations: ["Malaysia"],
      linkedClaimIds: [claimId],
      capturedAt: now,
    },
  );

  const selectedMy = selectAccountsForChatShortlist([sgClinic, myHigh], {
    apply: true,
    action: "shortlist",
    locationFilter: "Malaysia",
  });
  assert.deepEqual(
    selectedMy.map((a) => a.name),
    ["Qualitas Health Malaysia"],
  );

  const roles = deriveBuyerRoleRecommendations(dentalIndustry, null);
  const unverified = normalizeDiscoveredPersonCandidate(
    {
      id: "p-1",
      fullName: "Dr. Amina Noor",
      title: "Medical Director",
      companyName: "Qualitas Health Malaysia",
    },
    {
      candidateId: "00000000-0000-4000-8000-000000002011",
      conversationId: convId,
      targetDecisionId: decisionId,
      personSearchId,
      account: myHigh,
      roleRecommendations: roles,
      providerKey: "prospeo",
      capturedAt: now,
    },
  );
  const alreadyVerified = {
    ...normalizeDiscoveredPersonCandidate(
      {
        id: "p-2",
        fullName: "Farah Rahman",
        title: "Practice Manager",
        companyName: "Qualitas Health Malaysia",
      },
      {
        candidateId: "00000000-0000-4000-8000-000000002012",
        conversationId: convId,
        targetDecisionId: decisionId,
        personSearchId,
        account: myHigh,
        roleRecommendations: roles,
        providerKey: "prospeo",
        capturedAt: now,
      },
    ),
    verificationStatus: "verified" as const,
  };

  const toVerify = selectContactsForChatVerification([alreadyVerified, unverified], {
    apply: true,
    allUnverified: true,
  });
  assert.deepEqual(
    toVerify.map((c) => c.fullName),
    ["Dr. Amina Noor"],
  );
});

test("website fallback routes 'get emails from their websites' cleanly and extracts clinic desk contacts + backfills Prospeo leads", async () => {
  const userMsg =
    "can you try to get the emails from their websites as well?The onces from prospeo didnt work";
  assert.equal(userRequestedAction(userMsg), true);
  assert.equal(userExplicitlyApprovedSpend(userMsg), false);

  const account = scoreAndBuildAccountDossier(
    {
      provider: "prospeo",
      id: "co-my-smilebay",
      name: "SmileBay Dental",
      website: "https://smilebaydental.com",
      domain: "smilebaydental.com",
      industry: "Hospitals and Health Care",
      location: { city: "Bayan Lepas", country: "Malaysia" },
    },
    {
      dossierId: "00000000-0000-4000-8000-000000003001",
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "prospeo",
      targetMarketName: "Malaysia",
      targetIndustryName: "Hospitals and Health Care",
      canonicalLocations: ["Malaysia"],
      linkedClaimIds: [claimId],
      capturedAt: now,
      lifecycleState: "shortlisted",
    },
  );

  const companySearch: CompanySearchView = {
    id: searchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    providerActionRequestId: null,
    providerKey: "prospeo",
    status: "completed",
    targetMarketName: "Malaysia",
    targetIndustryName: "Hospitals and Health Care",
    requestedLocations: ["Malaysia"],
    canonicalLocations: ["Malaysia"],
    canonicalIndustries: ["Hospitals and Health Care"],
    industryKeywords: ["dental"],
    excludedCategories: [],
    linkedClaimIds: [claimId],
    criteria: ["Malaysia"],
    providerFilters: {},
    maximumResults: 25,
    estimatedMaximumCredits: 1,
    estimateDetail: "1 page",
    resultCount: 1,
    providerReceipt: {},
    failureMessage: null,
    cohort: null,
    accounts: [account],
    approvedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const conversation: ResearchConversationView = {
    conversation: {
      id: convId,
      title: "Malaysia dental clinics",
      status: "complete_without_research",
      threadId: `ano:ws:${convId}`,
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: "00000000-0000-4000-8000-000000003099",
      status: "complete_without_research",
      graphVersion: "phase-a-v1",
      currentNode: "complete",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [],
    brief: null,
    pendingQuestion: null,
    plan: null,
    events: [],
  };

  // Even if LLM forgets peopleUpdate or wrongly emits Prospeo verificationUpdate, deterministic failsafe fixes it.
  const routed = applyDeterministicChatFailsafes(
    userMsg,
    {
      reply: "Scanning shortlisted clinic websites ($0) for emails and contacts.",
      approveAction: null,
      filterUpdate: null,
      shortlistUpdate: null,
      peopleUpdate: null,
      verificationUpdate: { apply: true, providerKey: "prospeo", allUnverified: true },
      templateUpdate: null,
    },
    { conversation, companySearch },
  );
  assert.equal(routed.peopleUpdate?.apply, true);
  assert.equal(routed.peopleUpdate?.providerKey, "website_team");
  assert.equal(routed.verificationUpdate, null);

  // Crawl clinic with /contact email only (no named team bios) -> default omits desk row, failsafe includes it.
  const homeHtml = `<html><body><h1>SmileBay Dental</h1><a href="/contact">Contact Us</a></body></html>`;
  const contactHtml = `<html><body><p>Email <a href="mailto:care@smilebaydental.com">care@smilebaydental.com</a> or direct <a href="mailto:pengsan@smilebaydental.com">pengsan@smilebaydental.com</a></p><a href="tel:+6046431111">+60 4-643 1111</a></body></html>`;

  const defaultResult = await discoverPeopleFromCompanyWebsites([account], undefined, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetch: (async (input) =>
      String(input).includes("/contact")
        ? new Response(contactHtml, { status: 200, headers: { "content-type": "text/html" } })
        : new Response(homeHtml, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch,
  });
  assert.equal(defaultResult.people.length, 0);
  assert.equal(defaultResult.companyReports[0]?.publicEmails?.length, 2);
  assert.deepEqual(defaultResult.companyReports[0]?.publicPhones, ["+6046431111"]);

  // Backfilling an existing Prospeo contact picks personal direct email matching their name first.
  const backfilledDirect = matchWebsiteContactForPerson(
    { fullName: "Pengsan Yong", firstName: "Pengsan", lastName: "Yong" },
    defaultResult.companyReports[0]!,
  );
  assert.equal(backfilledDirect?.publicEmail, "pengsan@smilebaydental.com");
  assert.equal(backfilledDirect?.publicEmailKind, "direct_public");
  assert.equal(backfilledDirect?.publicPhone, "+6046431111");

  const deskResult = await discoverPeopleFromCompanyWebsites([account], undefined, {
    includePublicDeskFallback: true,
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetch: (async (input) =>
      String(input).includes("/contact")
        ? new Response(contactHtml, { status: 200, headers: { "content-type": "text/html" } })
        : new Response(homeHtml, { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch,
  });
  assert.equal(deskResult.people.length, 1);
  assert.equal(deskResult.people[0]?.fullName, "SmileBay Dental Team");
  assert.equal(deskResult.people[0]?.title, "Public Clinic Contact (Website)");
  assert.equal(deskResult.people[0]?.publicEmail, "care@smilebaydental.com");
  assert.equal(deskResult.people[0]?.publicEmailKind, "shared_inbox");
});

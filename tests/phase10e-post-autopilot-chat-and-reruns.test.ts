import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOPILOT_STAGES,
  buildAutopilotExecutiveSummaryMarkdown,
  computePartialRerunState,
  sanitizeAutopilotStageSummariesForChat,
  selectNextVerificationProvider,
  stagesForAutopilotRerunScope,
  type AutopilotRunView,
  type AutopilotStageSummary,
} from "@/lib/ano/autopilot";
import { scoreAndBuildAccountDossier, type CompanySearchView } from "@/lib/ano/company-discovery";
import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import { buildDeterministicFallbackTemplatePack } from "@/lib/ano/outreach-templates";
import {
  buildPersonSearchPreview,
  deriveBuyerRoleRecommendations,
  deriveBuyingCommitteeCriteria,
  normalizeDiscoveredPersonCandidate,
  type PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import type { ResearchConversationView } from "@/lib/ano/research-conversation";
import {
  applyDeterministicChatFailsafes,
  buildConversationChatPrompt,
  conversationChatOutputSchema,
  parseConversationChatResponse,
  replyInResearchConversation,
  userExplicitlyApprovedSpend,
  userRequestedAction,
  type ConversationChatContext,
} from "@/server/agents/conversation-chat-model";

const now = "2026-11-24T01:00:00.000Z";
const convId = "00000000-0000-4000-8000-000000005001";
const runId = "00000000-0000-4000-8000-000000005002";
const decisionId = "00000000-0000-4000-8000-000000005003";
const marketId = "00000000-0000-4000-8000-000000005004";
const industryId = "00000000-0000-4000-8000-000000005005";
const sourceId = "00000000-0000-4000-8000-000000005006";
const claimId = "00000000-0000-4000-8000-000000005007";
const searchId = "00000000-0000-4000-8000-000000005008";
const personSearchId = "00000000-0000-4000-8000-000000005009";

function createCompletedAutopilotFixture(): {
  context: ConversationChatContext;
  autopilotRun: AutopilotRunView;
} {
  const brief = {
    offer: "Automated patient-recall software for multi-chair private dental groups.",
    goal: "Book demos with growing dental groups losing recall revenue.",
    businessLocation: "Kuala Lumpur, Malaysia",
    targetMarkets: ["Malaysia"],
    intakeComplete: true,
    marketHints: ["Malaysia", "Singapore"],
    locationHints: ["Kuala Lumpur"],
    buyerHints: ["Managing Director", "Practice Manager"],
    constraints: [],
    unknowns: [],
    sourceMessageIds: ["00000000-0000-4000-8000-000000005010"],
  };

  const conversation: ResearchConversationView = {
    conversation: {
      id: convId,
      title: "Malaysia dental recall outreach",
      status: "complete_without_research",
      threadId: `ano:ws:${convId}`,
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: runId,
      status: "complete_without_research",
      graphVersion: "phase-a-v1",
      currentNode: "intake_complete_autopilot_ready",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [],
    productSources: [
      {
        id: "00000000-0000-4000-8000-000000005011",
        sourceType: "pdf",
        label: "recall-product-brief.pdf",
        sourceUrl: null,
        mimeType: "application/pdf",
        byteSize: 4200,
        charCount: 420,
        summaryText: "Automated SMS/WhatsApp recall follow-up for 4+ chair private dental groups.",
        extractionStatus: "ready",
        errorMessage: null,
        createdAt: now,
      },
    ],
    brief,
    pendingQuestion: null,
    plan: null,
    events: [],
  };

  const research: EvidenceResearchView = {
    run: {
      id: "00000000-0000-4000-8000-000000005012",
      conversationId: convId,
      threadId: `ano:research:${convId}`,
      attemptNumber: 1,
      provider: "searxng",
      status: "sources_ready",
      maximumSearches: 15,
      maximumFetches: 20,
      consumedSearches: 6,
      consumedFetches: 8,
      currentWave: 1,
      sourceCount: 1,
      failureMessage: null,
      createdAt: now,
      updatedAt: now,
    },
    actions: [],
    queries: [],
    sources: [
      {
        id: sourceId,
        title: "Malaysia Private Dental Chain Expansion Report 2026",
        url: "https://example.org/malaysia-dental-report",
        sourceClass: "industry",
        excerpt: "Private multi-chair dental groups in Kuala Lumpur and Penang face high recall drop-off.",
        publishedAt: now,
        retrievedAt: now,
        status: "fetched",
      },
    ],
  };

  const synthesis: MarketSynthesis = {
    id: "00000000-0000-4000-8000-000000005013",
    conversationId: convId,
    researchRunId: research.run.id,
    status: "ready_for_decision",
    recommendationMode: "directly_supported",
    assessment: {
      fetchedSourceCount: 1,
      sourceClassCount: 1,
      coverageStrength: "moderate",
      comparisonReady: true,
      contradictions: [],
      gaps: [],
      summary: "Strong multi-chair clinic density in Malaysia with active recall scheduling pain.",
    },
    claims: [
      {
        id: claimId,
        kind: "observation",
        statement:
          "Urban private dental groups in Malaysia report 30-40% unbooked hygiene recalls.",
        sourceIds: [sourceId],
        comparisonBasis: null,
        evidenceStrength: "moderate",
        citationStatus: "supported",
      },
    ],
    markets: [
      {
        id: marketId,
        name: "Malaysia",
        summary: "High urban concentration of private multi-chair dental clinics.",
        evidenceStrength: "strong",
        claimIds: [claimId],
        unknowns: [],
        nextResearchActions: [],
      },
    ],
    industries: [
      {
        id: industryId,
        marketProfileId: marketId,
        name: "Multi-chair dental practices",
        summary: "Growing private dental groups across Klang Valley and Penang.",
        operationalProblems: ["High hygiene recall drop-off between 6-month checkups"],
        solutionFit: ["Automated WhatsApp and SMS recall booking sequences"],
        buyerRoleHypotheses: ["Managing Director", "Practice Manager"],
        evidenceStrength: "moderate",
        claimIds: [claimId],
        unknowns: [],
      },
    ],
    decision: {
      id: decisionId,
      status: "locked",
      marketProfileId: marketId,
      industryProfileId: industryId,
      rationale:
        "Selected Malaysia and Multi-chair dental practices matching your requested target market.",
      selectedAt: now,
    },
    failureMessage: null,
    createdAt: now,
    updatedAt: now,
  };

  const smilebay = scoreAndBuildAccountDossier(
    {
      provider: "openstreetmap",
      id: "node-smilebay",
      name: "SmileBay Dental",
      website: "https://smilebaydental.com",
      domain: "smilebaydental.com",
      industry: "Dental Clinic",
      location: { city: "Bayan Lepas", country: "Malaysia" },
    },
    {
      dossierId: "00000000-0000-4000-8000-000000005014",
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "openstreetmap",
      targetMarketName: "Malaysia",
      targetIndustryName: "Multi-chair dental practices",
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
    providerKey: "openstreetmap",
    status: "completed",
    targetMarketName: "Malaysia",
    targetIndustryName: "Multi-chair dental practices",
    requestedLocations: ["Malaysia"],
    canonicalLocations: ["Malaysia"],
    canonicalIndustries: [],
    industryKeywords: ["dental clinic", "dentist"],
    excludedCategories: [],
    linkedClaimIds: [claimId],
    criteria: ["Malaysia clinics"],
    providerFilters: {},
    maximumResults: 25,
    estimatedMaximumCredits: 0,
    estimateDetail: "OSM search",
    resultCount: 1,
    providerReceipt: {},
    failureMessage: null,
    cohort: null,
    accounts: [smilebay],
    approvedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const roles = deriveBuyerRoleRecommendations(synthesis.industries[0]!, brief);
  const verifiedLead = {
    ...normalizeDiscoveredPersonCandidate(
      {
        id: "p-1",
        fullName: "Pengsan Yong",
        firstName: "Pengsan",
        lastName: "Yong",
        title: "Managing Director",
        companyName: "SmileBay Dental",
      },
      {
        candidateId: "00000000-0000-4000-8000-000000005015",
        conversationId: convId,
        targetDecisionId: decisionId,
        personSearchId,
        account: smilebay,
        roleRecommendations: roles,
        providerKey: "website_team",
        capturedAt: now,
      },
    ),
    publicEmail: "enquiry@smilebaydental.com",
    publicEmailKind: "shared_inbox" as const,
    publicPhone: "+6046431111",
    verificationStatus: "verified" as const,
    verifiedDetails: {
      provider: "prospeo" as const,
      email: "pengsan@smilebaydental.com",
      emailQualification: "verified",
      phone: "+6046431111",
      verifiedDomain: "smilebaydental.com",
      verifiedAt: now,
    },
  };

  const unverifiedLead = {
    ...normalizeDiscoveredPersonCandidate(
      {
        id: "p-2",
        fullName: "Dr Kan Chang Yu",
        firstName: "Chang Yu",
        lastName: "Kan",
        title: "Dentist",
        companyName: "SmileBay Dental",
      },
      {
        candidateId: "00000000-0000-4000-8000-000000005016",
        conversationId: convId,
        targetDecisionId: decisionId,
        personSearchId,
        account: smilebay,
        roleRecommendations: roles,
        providerKey: "website_team",
        capturedAt: now,
      },
    ),
    verificationStatus: "not_requested" as const,
    publicEmail: "enquiry@smilebaydental.com",
    publicEmailKind: "shared_inbox" as const,
  };

  const peopleDiscovery: PeopleDiscoveryView = {
    shortlistedCount: 1,
    personSearch: buildPersonSearchPreview({
      personSearchId,
      conversationId: convId,
      targetDecisionId: decisionId,
      shortlistedAccounts: [smilebay],
      roleRecommendations: roles,
      providerKey: "website_team",
      buyingCommittee: deriveBuyingCommitteeCriteria({
        industry: synthesis.industries[0]!,
        brief,
        shortlistedAccounts: [smilebay],
      }),
      nowIso: now,
    }),
    contacts: [verifiedLead, unverifiedLead],
    verificationRun: {
      id: "00000000-0000-4000-8000-000000005017",
      conversationId: convId,
      personSearchId,
      providerActionRequestId: null,
      providerKey: "prospeo",
      status: "completed",
      selectedContactIds: [verifiedLead.id],
      previewPairs: [],
      estimatedCredits: 1,
      estimateDetail: "Enriched contact",
      verifiedCount: 1,
      providerReceipt: {},
      failureMessage: null,
      approvedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    playbooks: [],
  };

  const templatePack = buildDeterministicFallbackTemplatePack({
    id: "00000000-0000-4000-8000-000000005018",
    conversationId: convId,
    targetDecisionId: decisionId,
    version: 1,
    tone: "peer_direct",
    ctaStyle: "easy_yes",
    entryOffer: "14-day recall reactivation audit",
    senderName: "Alex",
    brief,
    market: synthesis.markets[0]!,
    industry: synthesis.industries[0]!,
    claims: synthesis.claims,
    accounts: [smilebay],
    targetRoles: ["Managing Director", "Practice Manager"],
    nowIso: now,
  });

  const stageSummaries: Partial<Record<(typeof AUTOPILOT_STAGES)[number], AutopilotStageSummary>> = {
    brief_and_plan: {
      stage: "brief_and_plan",
      status: "completed",
      headline: "Product brief & plan v1 ready",
      detail: "Configured research plan for Kuala Lumpur, Malaysia targeting Malaysia.",
      metrics: { planVersion: 1, productSourcesCount: 1 },
      warnings: [],
      completedAt: now,
    },
    market_research: {
      stage: "market_research",
      status: "completed",
      headline: "Market research complete (1 public source)",
      detail: "Collected 1 public research excerpt across 1 wave.",
      metrics: { sourceCount: 1, consumedSearches: 6 },
      warnings: [],
      completedAt: now,
    },
    synthesis_and_lock: {
      stage: "synthesis_and_lock",
      status: "completed",
      headline: "Selected target route: Malaysia · Multi-chair dental practices",
      detail: "Selected Malaysia and Multi-chair dental practices.",
      metrics: { marketName: "Malaysia", industryName: "Multi-chair dental practices" },
      warnings: [],
      completedAt: now,
    },
    company_discovery: {
      stage: "company_discovery",
      status: "completed",
      headline: "Shortlisted top 1 of 1 companies",
      detail: "Matched 1 target account and shortlisted top 1 candidate.",
      metrics: { discoveredCount: 1, shortlistedCount: 1, creditsUsed: 99, estimatedCostUsd: 1.5 },
      warnings: [],
      completedAt: now,
    },
    people_and_emails: {
      stage: "people_and_emails",
      status: "completed",
      headline: "Found 2 decision-makers (2 with email)",
      detail: "Captured 1 verified work email and 1 public website email ($0.00 / 2 credits internal test scrub).",
      metrics: { contactsFound: 2, verifiedEmails: 1, inputTokens: 1200, creditsRemaining: 48 },
      warnings: [],
      completedAt: now,
    },
    outreach_templates: {
      stage: "outreach_templates",
      status: "completed",
      headline: "Email templates v1 ready (3/3 clean)",
      detail: "Prepared 3-step sequence and posted executive summary in chat.",
      metrics: { templateVersion: 1, passedLintCount: 3 },
      warnings: [],
      completedAt: now,
    },
  };

  const autopilotRun: AutopilotRunView = {
    id: "00000000-0000-4000-8000-000000005019",
    conversationId: convId,
    status: "completed",
    currentStage: "done",
    completedStages: [...AUTOPILOT_STAGES],
    stageSummaries,
    warnings: [],
    lastError: null,
    stageInFlight: false,
    heartbeatAt: now,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  return {
    autopilotRun,
    context: {
      conversation,
      autopilotRun,
      productSourceExcerpts: [
        {
          label: "recall-product-brief.pdf",
          sourceType: "pdf",
          summaryText: "Automated SMS/WhatsApp recall follow-up for private dental groups.",
          excerpt:
            "Ano Recall helps multi-chair clinics rebook overdue hygiene patients automatically via WhatsApp and SMS reminders.",
        },
      ],
      research,
      synthesis,
      companySearch,
      peopleDiscovery,
      emailSources: { prospeoAvailable: true, dropcontactAvailable: true },
      templatePack,
    },
  };
}

test("buildConversationChatPrompt grounds product excerpts, claims, contacts, and sanitized stage summaries without leaking telemetry", () => {
  const { context, autopilotRun } = createCompletedAutopilotFixture();

  const sanitizedSummaryBlock = sanitizeAutopilotStageSummariesForChat(autopilotRun);
  assert.ok(sanitizedSummaryBlock.includes("1. Analyzing product & location (completed)"));
  assert.ok(sanitizedSummaryBlock.includes("6. Drafting email templates (completed)"));
  assert.equal(/creditsUsed|estimatedCostUsd|inputTokens|creditsRemaining|\$0\.00|\b2 credits\b/i.test(sanitizedSummaryBlock), false);

  const { system, user } = buildConversationChatPrompt(
    context,
    "Why did you pick dental clinics in Malaysia?",
  );

  assert.ok(user.includes("Business location: Kuala Lumpur, Malaysia"));
  assert.ok(user.includes("Target selling markets: Malaysia"));
  assert.ok(user.includes("Attached product sources & excerpts:"));
  assert.ok(user.includes("rebook overdue hygiene patients automatically via WhatsApp"));
  assert.ok(user.includes("Malaysia Private Dental Chain Expansion Report 2026"));
  assert.ok(user.includes("Pengsan Yong | Managing Director"));
  assert.ok(user.includes("pengsan@smilebaydental.com verified"));
  assert.ok(user.includes("tel=+6046431111"));
  assert.ok(system.includes("POST-AUTOPILOT REFERENCE Q&A"));
  assert.ok(system.includes("autopilotRerun"));
  assert.equal(/creditsUsed|estimatedCostUsd|inputTokens|creditsRemaining|ano_internal|estMaxCredits|estCredits/i.test(user), false);

  // Confirm internal executive summary also stays free of billing numbers.
  const execSummary = buildAutopilotExecutiveSummaryMarkdown({
    businessLocation: "Kuala Lumpur, Malaysia",
    marketName: "Malaysia",
    industryName: "Multi-chair dental practices",
    topClaimStatement: "30-40% unbooked hygiene recalls.",
    discoveredCompanyCount: 1,
    shortlistedCompanyNames: ["SmileBay Dental"],
    totalContacts: 2,
    verifiedEmailCount: 1,
    publicEmailCount: 1,
    withPhoneCount: 1,
    templatePack: context.templatePack ?? null,
    warnings: [],
  });
  assert.equal(/\$\d|\bcredit/i.test(execSummary), false);
});

test("post-autopilot read-only reference Q&A questions suppress all 7 action directives including autopilotRerun", async () => {
  const { context } = createCompletedAutopilotFixture();
  const config = {
    provider: "gemini" as const,
    apiKey: "test-key",
    modelId: "gemini-3.5-flash-lite",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  };

  const questions = [
    "Why did you pick dental clinics in Malaysia?",
    "Show me the emails and phone numbers for SmileBay Dental",
    "Which 3 contacts should I prioritize first?",
  ];

  for (const question of questions) {
    assert.equal(
      userRequestedAction(question),
      false,
      `Expected read-only Q&A for: ${question}`,
    );

    const output = await replyInResearchConversation(config, context, question, {
      async invoke() {
        return {
          content: JSON.stringify({
            reply: "Here is the grounded answer from your saved research and contacts.",
            approveAction: { apply: true, target: "any_pending" },
            filterUpdate: { apply: true, locations: ["Singapore"] },
            shortlistUpdate: { apply: true, action: "shortlist", topN: 5 },
            peopleUpdate: { apply: true, providerKey: "prospeo" },
            verificationUpdate: { apply: true, allUnverified: true },
            templateUpdate: { apply: true, tone: "curious" },
            autopilotRerun: { apply: true, scope: "companies_people_templates" },
          }),
        };
      },
    });

    assert.equal(output.approveAction, null);
    assert.equal(output.filterUpdate, null);
    assert.equal(output.shortlistUpdate, null);
    assert.equal(output.peopleUpdate, null);
    assert.equal(output.verificationUpdate, null);
    assert.equal(output.templateUpdate, null);
    assert.equal(output.autopilotRerun, null);
  }
});

test("targeted post-autopilot directives infer exact downstream rerun scopes across geo, leads, roles, verification, and copy", () => {
  const { context } = createCompletedAutopilotFixture();

  // 1a. Append geography ("also include Singapore") -> locationMode="append" + Stages 4->5->6
  const addGeo = applyDeterministicChatFailsafes(
    "also include Singapore",
    parseConversationChatResponse(
      JSON.stringify({
        reply: "Expanding company discovery to include Singapore alongside Malaysia.",
        filterUpdate: { apply: true, locations: ["Singapore"] },
      }),
    ),
    context,
  );
  assert.equal(userRequestedAction("also include Singapore"), true);
  assert.equal(addGeo.filterUpdate?.locationMode, "append");
  assert.equal(addGeo.autopilotRerun?.apply, true);
  assert.equal(addGeo.autopilotRerun?.scope, "companies_people_templates");

  // 1b. Switch/try geography ("try Singapore", "switch to Selangor clinics only") -> Stages 4->5->6
  assert.equal(userRequestedAction("try Singapore"), true);
  const trySg = applyDeterministicChatFailsafes(
    "try Singapore",
    parseConversationChatResponse(
      JSON.stringify({
        reply: "Switching company discovery to Singapore.",
        filterUpdate: { apply: true, locations: ["Singapore"] },
      }),
    ),
    context,
  );
  assert.equal(trySg.autopilotRerun?.scope, "companies_people_templates");

  const selangor = applyDeterministicChatFailsafes(
    "switch to Selangor clinics only",
    parseConversationChatResponse(
      JSON.stringify({
        reply: "Narrowing company search to Selangor.",
        filterUpdate: { apply: true, locations: ["Selangor, Malaysia"] },
      }),
    ),
    context,
  );
  assert.equal(selangor.autopilotRerun?.scope, "companies_people_templates");

  // 2. More leads ("find 10 more companies") -> Stages 4->5 (keeps Stage 6 intact)
  const moreLeads = applyDeterministicChatFailsafes(
    "find 10 more companies",
    parseConversationChatResponse(
      JSON.stringify({
        reply: "Shortlisting 10 additional matching companies.",
        shortlistUpdate: { apply: true, action: "shortlist", topN: 10 },
      }),
    ),
    context,
  );
  assert.equal(moreLeads.autopilotRerun?.scope, "companies_and_people");

  // 3. Role shift ("target Practice Managers instead") -> Stage 5 only
  const roleShift = applyDeterministicChatFailsafes(
    "target Practice Managers instead",
    parseConversationChatResponse(
      JSON.stringify({
        reply: "Updating target buyer criteria to Practice Managers.",
        peopleUpdate: { apply: true, includeTitles: ["Practice Manager"] },
      }),
    ),
    context,
  );
  assert.equal(roleShift.autopilotRerun?.scope, "people_and_emails");

  // 4. Email enrichment boost ("run another verification pass on the unverified contacts") -> failsafe + Dropcontact escalation
  const verifyBoost = applyDeterministicChatFailsafes(
    "run another verification pass on the unverified contacts",
    parseConversationChatResponse(
      JSON.stringify({
        reply: "Running another verification pass on the remaining unverified contacts.",
      }),
    ),
    context,
  );
  assert.equal(verifyBoost.verificationUpdate?.apply, true);
  assert.equal(verifyBoost.verificationUpdate?.allUnverified, true);
  assert.equal(verifyBoost.autopilotRerun?.scope, "email_enrichment");
  assert.equal(
    selectNextVerificationProvider({
      lastRunProvider: context.peopleDiscovery?.verificationRun?.providerKey ?? null,
      prospeoAvailable: true,
      dropcontactAvailable: true,
    }),
    "dropcontact",
  );

  // 5. Email copy tweak ("make Email 1 shorter and use a soft question CTA") -> Stage 6 only
  const copyEdit = applyDeterministicChatFailsafes(
    "make Email 1 shorter and use a soft question CTA",
    parseConversationChatResponse(
      JSON.stringify({
        reply: "Shortening Email 1 with a soft question CTA.",
      }),
    ),
    context,
  );
  assert.equal(copyEdit.templateUpdate?.apply, true);
  assert.equal(copyEdit.templateUpdate?.ctaStyle, "direct_question");
  assert.equal(copyEdit.templateUpdate?.maxWords, 45);
  assert.equal(copyEdit.autopilotRerun?.scope, "templates_only");

  // Verify userExplicitlyApprovedSpend gate isn't broken for legacy non-autopilot flows.
  assert.equal(userExplicitlyApprovedSpend("run another verification pass on the unverified contacts"), false);
});

test("computePartialRerunState prunes only affected downstream stages and preserves completed upstream & unaffected stages", () => {
  const { autopilotRun } = createCompletedAutopilotFixture();

  // Case A: Geo change finished Stage 4 inline and queues Stages 5 & 6.
  const geoRerunStages = stagesForAutopilotRerunScope("companies_people_templates").filter(
    (s) => s !== "company_discovery",
  );
  assert.deepEqual(geoRerunStages, ["people_and_emails", "outreach_templates"]);

  const afterGeoStage4Update = computePartialRerunState(
    autopilotRun,
    geoRerunStages,
    {
      ...autopilotRun.stageSummaries.company_discovery!,
      headline: "Shortlisted top 10 of 18 companies",
    },
  );
  assert.deepEqual(afterGeoStage4Update.completedStages, [
    "brief_and_plan",
    "market_research",
    "synthesis_and_lock",
    "company_discovery",
  ]);
  assert.equal(afterGeoStage4Update.nextStage, "people_and_emails");
  assert.equal(afterGeoStage4Update.nextStatus, "running");

  // Case B: "find 10 more companies" updates Stage 4 inline and queues Stage 5 ONLY, keeping Stage 6 templates intact.
  const leadsOnlyStages = stagesForAutopilotRerunScope("companies_and_people").filter(
    (s) => s !== "company_discovery",
  );
  assert.deepEqual(leadsOnlyStages, ["people_and_emails"]);

  const afterMoreLeads = computePartialRerunState(
    autopilotRun,
    leadsOnlyStages,
    autopilotRun.stageSummaries.company_discovery!,
  );
  assert.deepEqual(afterMoreLeads.completedStages, [
    "brief_and_plan",
    "market_research",
    "synthesis_and_lock",
    "company_discovery",
    "outreach_templates",
  ]);
  assert.equal(afterMoreLeads.nextStage, "people_and_emails");
  assert.equal(afterMoreLeads.nextStatus, "running");
});

test("conversationChatOutputSchema contains zero outbound send or Mercury CRM mutation directives", () => {
  const keys = Object.keys(conversationChatOutputSchema.shape);
  for (const forbidden of [
    "sendOutreach",
    "sendEmail",
    "mercuryProposal",
    "pushToMercury",
    "executeOutbound",
  ]) {
    assert.equal(keys.includes(forbidden), false);
  }
});

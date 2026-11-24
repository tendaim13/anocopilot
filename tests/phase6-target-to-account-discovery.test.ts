import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaver } from "@langchain/langgraph";

import {
  buildTargetCompanySearchPreview,
  deriveProspeoIndustryCandidates,
  deriveRequestedLocations,
  deriveSearchKeywords,
  scoreAndBuildAccountDossier,
  summarizeAccountCohort,
  type CompanySearchView,
} from "@/lib/ano/company-discovery";
import type { IndustryProfile, MarketProfile, MarketSynthesis } from "@/lib/ano/market-synthesis";
import {
  buildConversationMessageParts,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import { classifyConversationWorkItem } from "@/lib/ano/work-queue";
import {
  createTargetToAccountGraph,
  type TargetToAccountExecutor,
} from "@/server/langgraph/target-to-account-graph";
import { normalizeLocationQuery } from "@/server/domain/prospeo-company-discovery";
import { selectAccountsForCompanySearchView } from "@/server/persistence/target-account-discovery-store";

const convId = "00000000-0000-4000-8000-000000000301";
const decisionId = "00000000-0000-4000-8000-000000000302";
const marketId = "00000000-0000-4000-8000-000000000303";
const industryId = "00000000-0000-4000-8000-000000000304";
const claimId = "00000000-0000-4000-8000-000000000305";
const sourceId = "00000000-0000-4000-8000-000000000306";
const searchId = "00000000-0000-4000-8000-000000000307";
const dossierId = "00000000-0000-4000-8000-000000000308";
const now = "2026-11-21T03:35:00.000Z";

const market: MarketProfile = {
  id: marketId,
  name: "Malaysia",
  summary: "High service-trade digitization momentum.",
  evidenceStrength: "moderate",
  claimIds: [claimId],
  unknowns: ["Regional density outside Klang Valley"],
  nextResearchActions: ["Verify Prospeo company density"],
};

const industry: IndustryProfile = {
  id: industryId,
  marketProfileId: marketId,
  name: "Commercial plumbing and HVAC services",
  summary: "High quote-to-job dropoff among multi-crew field teams.",
  operationalProblems: ["Delayed follow-up on field service quotes"],
  solutionFit: ["Automated quote follow-up workflows"],
  buyerRoleHypotheses: ["Managing Director", "Operations Manager"],
  evidenceStrength: "moderate",
  claimIds: [claimId],
  unknowns: ["Adoption readiness in smaller crews"],
};

function makePreview(): CompanySearchView {
  return buildTargetCompanySearchPreview({
    searchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    market,
    industry,
    requestedLocations: ["Malaysia"],
    canonicalLocations: ["Malaysia"],
    excludedCategories: ["Staffing"],
    nowIso: now,
  });
}

test("target-to-account graph refuses execution without a locked route or preview ID", async () => {
  const executor: TargetToAccountExecutor = {
    async canonicalizeLocations() {
      throw new Error("Should not canonicalize without target");
    },
    async savePreview() {
      throw new Error("Should not save preview without target");
    },
    async executeApprovedSearch() {
      throw new Error("Should not execute without preview ID");
    },
  };

  const graph = createTargetToAccountGraph(executor, new MemorySaver());

  await assert.rejects(
    () =>
      graph.invoke(
        {
          stage: "preview",
          conversationId: convId,
          targetDecisionId: "",
          targetMarket: null,
          targetIndustry: null,
          requestedLocations: ["Malaysia"],
          excludedCategories: [],
          searchId: null,
          status: "awaiting_approval",
          currentNode: "verify_locked_target",
        },
        { configurable: { thread_id: "phase-d-missing-target" } },
      ),
    /Lock a Phase C target route/,
  );

  await assert.rejects(
    () =>
      graph.invoke(
        {
          stage: "execute",
          conversationId: convId,
          targetDecisionId: decisionId,
          targetMarket: market,
          targetIndustry: industry,
          requestedLocations: [],
          excludedCategories: [],
          searchId: null,
          status: "running",
          currentNode: "verify_locked_target",
        },
        { configurable: { thread_id: "phase-d-missing-search-id" } },
      ),
    /saved Prospeo preview ID is required/,
  );
});

test("target-to-account graph preview stage stops at await_company_search_approval without spending credits", async () => {
  let executedCount = 0;
  const executor: TargetToAccountExecutor = {
    async canonicalizeLocations(locations) {
      assert.deepEqual(locations, ["Malaysia"]);
      return ["Malaysia"];
    },
    async savePreview(input) {
      return buildTargetCompanySearchPreview({
        searchId,
        conversationId: input.conversationId,
        targetDecisionId: input.targetDecisionId,
        market: input.market,
        industry: input.industry,
        requestedLocations: input.requestedLocations,
        canonicalLocations: input.canonicalLocations,
        excludedCategories: input.excludedCategories,
        nowIso: now,
      });
    },
    async executeApprovedSearch() {
      executedCount += 1;
      throw new Error("executeApprovedSearch must never run during preview stage");
    },
  };

  const graph = createTargetToAccountGraph(executor, new MemorySaver());
  const config = { configurable: { thread_id: "phase-d-preview" } };
  await graph.invoke(
    {
      stage: "preview",
      conversationId: convId,
      targetDecisionId: decisionId,
      targetMarket: market,
      targetIndustry: industry,
      requestedLocations: deriveRequestedLocations(market, null),
      excludedCategories: ["Staffing"],
      searchId: null,
      status: "awaiting_approval",
      currentNode: "verify_locked_target",
    },
    config,
  );

  const state = await graph.getState(config);
  assert.equal(executedCount, 0);
  assert.equal(state.values.status, "awaiting_approval");
  assert.equal(state.values.currentNode, "await_company_search_approval");
  assert.equal(state.values.search?.maximumResults, 25);
  assert.equal(state.values.search?.estimatedMaximumCredits, 1);
  assert.deepEqual(state.values.search?.linkedClaimIds, [claimId]);
});

test("target-to-account execute stage scores signals separately from claims and halts safely on error", async () => {
  const dossier = scoreAndBuildAccountDossier(
    {
      id: "prospeo-co-1",
      name: "Klang Valley HVAC Engineering Sdn Bhd",
      domain: "kvhvac.my",
      website: "https://kvhvac.my",
      industry: "Commercial HVAC & Mechanical Services",
      employeeRange: "11-50",
      location: { city: "Petaling Jaya", state: "Selangor", country: "Malaysia" },
      description: "Commercial HVAC and piping contractors.",
      linkedInUrl: "https://www.linkedin.com/company/kvhvac",
    },
    {
      dossierId,
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      targetMarketName: market.name,
      targetIndustryName: industry.name,
      canonicalLocations: ["Malaysia"],
      linkedClaimIds: [claimId],
      capturedAt: now,
      lifecycleState: "shortlisted",
    },
  );

  assert.equal(dossier.fit.totalScore, 100);
  assert.equal(dossier.fit.confidence, "high");
  assert.deepEqual(dossier.claimIds, [claimId]);
  assert.ok(dossier.signals.length >= 4);
  assert.ok(dossier.signals.every((s) => s.sourceAttribution === "B2B company directory"));
  assert.match(dossier.fit.industryHypothesisNote, /verified separately/i);

  const cohort = summarizeAccountCohort([dossier], market.name, industry.name, 42);
  assert.equal(cohort.shortlistedCount, 1);
  assert.equal(cohort.averageFitScore, 100);
  assert.match(cohort.separationNote, /Market insights explain/i);

  const completedView: CompanySearchView = {
    ...makePreview(),
    status: "completed",
    resultCount: 1,
    cohort,
    accounts: [dossier],
    approvedAt: now,
    completedAt: now,
  };

  const successGraph = createTargetToAccountGraph(
    {
      async canonicalizeLocations() {
        return ["Malaysia"];
      },
      async savePreview() {
        return makePreview();
      },
      async executeApprovedSearch() {
        return completedView;
      },
    },
    new MemorySaver(),
  );

  await successGraph.invoke(
    {
      stage: "execute",
      conversationId: convId,
      targetDecisionId: decisionId,
      targetMarket: market,
      targetIndustry: industry,
      requestedLocations: ["Malaysia"],
      excludedCategories: [],
      searchId,
      status: "running",
      currentNode: "verify_locked_target",
    },
    { configurable: { thread_id: "phase-d-exec-ok" } },
  );

  const okState = await successGraph.getState({ configurable: { thread_id: "phase-d-exec-ok" } });
  assert.equal(okState.values.status, "completed");
  assert.equal(okState.values.currentNode, "company_cohort_ready");

  const failedView: CompanySearchView = {
    ...makePreview(),
    status: "requires_manual_review",
    failureMessage: "Prospeo rate-limited this request. Ano did not retry automatically.",
  };

  const stoppedGraph = createTargetToAccountGraph(
    {
      async canonicalizeLocations() {
        return ["Malaysia"];
      },
      async savePreview() {
        return makePreview();
      },
      async executeApprovedSearch() {
        return failedView;
      },
    },
    new MemorySaver(),
  );

  await stoppedGraph.invoke(
    {
      stage: "execute",
      conversationId: convId,
      targetDecisionId: decisionId,
      targetMarket: market,
      targetIndustry: industry,
      requestedLocations: ["Malaysia"],
      excludedCategories: [],
      searchId,
      status: "running",
      currentNode: "verify_locked_target",
    },
    { configurable: { thread_id: "phase-d-exec-review" } },
  );

  const stoppedState = await stoppedGraph.getState({
    configurable: { thread_id: "phase-d-exec-review" },
  });
  assert.equal(stoppedState.values.status, "requires_manual_review");
  assert.equal(stoppedState.values.currentNode, "review_company_search");
});

test("Phase D message parts and work queue classify preview approval, completion, and review states", () => {
  const conversation: ResearchConversationView = {
    conversation: {
      id: convId,
      title: "Malaysia commercial trades",
      status: "complete_without_research",
      threadId: `ano:ws:${convId}`,
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: "00000000-0000-4000-8000-000000000310",
      status: "complete_without_research",
      graphVersion: "phase-a-v1",
      currentNode: "complete_without_research",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [],
    brief: null,
    pendingQuestion: null,
    plan: null,
    events: [],
  };

  const synthesis: MarketSynthesis = {
    id: "00000000-0000-4000-8000-000000000311",
    conversationId: convId,
    researchRunId: "00000000-0000-4000-8000-000000000312",
    status: "ready_for_decision",
    recommendationMode: "directly_supported",
    assessment: {
      fetchedSourceCount: 3,
      sourceClassCount: 2,
      coverageStrength: "moderate",
      comparisonReady: true,
      contradictions: [],
      gaps: [],
      summary: "Summary",
    },
    claims: [
      {
        id: claimId,
        kind: "observation",
        statement: "Industry digitization accelerates",
        sourceIds: [sourceId],
        comparisonBasis: null,
        evidenceStrength: "moderate",
        citationStatus: "supported",
      },
    ],
    markets: [market],
    industries: [industry],
    decision: {
      id: decisionId,
      status: "locked",
      marketProfileId: marketId,
      industryProfileId: industryId,
      rationale: null,
      selectedAt: now,
    },
    failureMessage: null,
    createdAt: now,
    updatedAt: now,
  };

  const preview = makePreview();
  const previewParts = buildConversationMessageParts(conversation, null, synthesis, preview);
  assert.ok(
    previewParts.some(
      (part) => part.type === "artifact" && part.artifactType === "company_search_preview",
    ),
  );
  assert.deepEqual(previewParts.at(-1), { type: "status", state: "awaiting_approval" });

  const dossier = scoreAndBuildAccountDossier(
    { id: "co-2", name: "Sunway Aircond", industry: "HVAC" },
    {
      dossierId,
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      targetMarketName: market.name,
      targetIndustryName: industry.name,
      canonicalLocations: ["Malaysia"],
      linkedClaimIds: [claimId],
      capturedAt: now,
    },
  );
  const completedSearch: CompanySearchView = {
    ...preview,
    status: "completed",
    resultCount: 1,
    cohort: summarizeAccountCohort([dossier], market.name, industry.name, 1),
    accounts: [dossier],
  };

  const completedParts = buildConversationMessageParts(
    conversation,
    null,
    synthesis,
    completedSearch,
  );
  assert.ok(
    completedParts.some(
      (part) => part.type === "artifact" && part.artifactType === "account_cohort",
    ),
  );
  assert.ok(
    completedParts.some(
      (part) => part.type === "artifact" && part.artifactType === "account_dossier",
    ),
  );
  assert.deepEqual(completedParts.at(-1), { type: "status", state: "completed" });

  const workQueueApproval = classifyConversationWorkItem({
    conversation: { id: convId, title: "Malaysia", status: "complete_without_research", createdAt: now, updatedAt: now },
    targetDecision: { status: "locked", updatedAt: now },
    companySearch: { status: "awaiting_approval", updatedAt: now },
  });
  assert.equal(workQueueApproval?.category, "provider_scope_approval_required");
  assert.equal(workQueueApproval?.label, "Approve company search");

  const workQueueDone = classifyConversationWorkItem({
    conversation: { id: convId, title: "Malaysia", status: "complete_without_research", createdAt: now, updatedAt: now },
    targetDecision: { status: "locked", updatedAt: now },
    companySearch: { status: "completed", updatedAt: now },
  });
  assert.equal(workQueueDone, null);
});

test("normalizeLocationQuery expands common country abbreviations for Prospeo lookup", () => {
  assert.equal(normalizeLocationQuery("UK"), "United Kingdom");
  assert.equal(normalizeLocationQuery("us"), "United States");
  assert.equal(normalizeLocationQuery("USA"), "United States");
  assert.equal(normalizeLocationQuery("au"), "Australia");
  assert.equal(normalizeLocationQuery("Malaysia"), "Malaysia");
});

test("buildTargetCompanySearchPreview emits keyword/industry filters and penalizes off-target companies", () => {
  const dentalIndustry: IndustryProfile = {
    ...industry,
    name: "Dental industry",
  };
  const derivedKeywords = deriveSearchKeywords(dentalIndustry, null);
  assert.deepEqual(derivedKeywords, ["dental clinic", "dental practice", "dentist", "dental"]);
  assert.deepEqual(deriveProspeoIndustryCandidates(dentalIndustry.name), [
    "Medical Practices",
    "Hospitals and Health Care",
  ]);

  const preview = buildTargetCompanySearchPreview({
    searchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    market: { ...market, name: "Australia" },
    industry: dentalIndustry,
    requestedLocations: ["Australia"],
    canonicalLocations: ["Australia"],
    canonicalIndustries: ["Medical Practices"],
    searchKeywords: ["dental", "dentist", "dental clinic"],
    excludedCategories: ["investment", "capital"],
    nowIso: now,
  });

  assert.deepEqual(preview.providerFilters, {
    company_location_search: { include: ["Australia"] },
    company_industry: { include: ["Medical Practices"] },
    company_keywords: {
      include: ["dental", "dentist", "dental clinic"],
      include_all: false,
      search_everywhere: false,
      sources: [
        "specialties",
        "social_media_description",
        "seo_description",
        "ai_description",
        "products_services",
      ],
      exclude: ["investment", "capital"],
    },
  });

  const offTarget = scoreAndBuildAccountDossier(
    {
      id: "off-target-1",
      name: "Prime Value Asset Management",
      domain: "primevalue.com.au",
      website: "https://primevalue.com.au",
      industry: "Investment Management",
      employeeRange: "21-50",
      location: { city: "Melbourne", state: "Victoria", country: "Australia" },
      linkedInUrl: "https://www.linkedin.com/company/prime-value",
    },
    {
      dossierId,
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      targetMarketName: "Australia",
      targetIndustryName: "Dental industry",
      canonicalLocations: ["Australia"],
      canonicalIndustries: ["Medical Practices"],
      targetKeywords: ["dental", "dentist", "dental clinic"],
      linkedClaimIds: [claimId],
      capturedAt: now,
    },
  );

  assert.equal(offTarget.fit.industryScore, 0);
  assert.ok(offTarget.fit.totalScore <= 35);
  assert.equal(offTarget.fit.confidence, "low");

  const onTarget = scoreAndBuildAccountDossier(
    {
      id: "on-target-1",
      name: "Bright Smile Dental Clinic",
      domain: "brightsmile.com.au",
      website: "https://brightsmile.com.au",
      industry: "Medical Practices",
      employeeRange: "11-50",
      location: { city: "Melbourne", state: "Victoria", country: "Australia" },
      description: "Multi-chair family dental clinic providing preventive hygiene and orthodontics.",
      linkedInUrl: "https://www.linkedin.com/company/bright-smile-dental",
    },
    {
      dossierId,
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      targetMarketName: "Australia",
      targetIndustryName: "Dental industry",
      canonicalLocations: ["Australia"],
      canonicalIndustries: ["Medical Practices"],
      targetKeywords: ["dental", "dentist", "dental clinic"],
      linkedClaimIds: [claimId],
      capturedAt: now,
    },
  );

  assert.equal(onTarget.fit.industryScore, 35);
  assert.equal(onTarget.fit.totalScore, 100);
  assert.equal(onTarget.fit.confidence, "high");
});

test("selectAccountsForCompanySearchView keeps latest run + shortlisted rows and bounds awaiting_approval revisions", () => {
  const run1Rows = Array.from({ length: 25 }, (_, index) => ({
    id: `run1-${index}`,
    provider_action_request_id: "action-run-1",
    lifecycle_state: index < 3 ? "shortlisted" : "discovered",
    retrieved_at: "2026-11-21T10:00:00.000Z",
    created_at: "2026-11-21T10:00:00.000Z",
  }));
  const run2Rows = Array.from({ length: 25 }, (_, index) => ({
    id: `run2-${index}`,
    provider_action_request_id: "action-run-2",
    lifecycle_state: "discovered",
    retrieved_at: "2026-11-21T11:00:00.000Z",
    created_at: "2026-11-21T11:00:00.000Z",
  }));

  const completedSelection = selectAccountsForCompanySearchView(
    "completed",
    "action-run-2",
    [...run2Rows, ...run1Rows],
  );
  assert.equal(completedSelection.length, 28);
  assert.ok(completedSelection.every((row) => String(row.provider_action_request_id) === "action-run-2" || String(row.lifecycle_state) === "shortlisted"));

  const unshortlistedRun1Rows = run1Rows.map((row) => ({ ...row, lifecycle_state: "discovered" }));
  const revisionSelection = selectAccountsForCompanySearchView(
    "awaiting_approval",
    "action-preview-3",
    [...unshortlistedRun1Rows, ...run2Rows],
  );
  assert.equal(revisionSelection.length, 25);
  assert.ok(revisionSelection.every((row) => String(row.provider_action_request_id) === "action-run-2"));
});

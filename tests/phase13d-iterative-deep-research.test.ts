import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { MemorySaver } from "@langchain/langgraph";

import {
  DEFAULT_ITERATIVE_MAX_FETCHES,
  DEFAULT_ITERATIVE_MAX_SEARCHES,
  evidenceResearchSourceSchema,
  formatSourceProvenanceLabel,
  MAX_ITERATIVE_RESEARCH_WAVES,
  researchQuerySchema,
  resolveSourceProvenance,
  sourceEvidenceRoleSchema,
  sourceProvenanceSchema,
} from "@/lib/ano/evidence-research";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import { normaliseSynthesisDraft, type SynthesisSource } from "@/server/agents/market-synthesis-model";
import {
  buildDeterministicGapClosingWave,
  buildDeterministicInitialWave,
  deriveCandidateMarketsFromBriefAndPlan,
  normalizeIterativeResearchWave,
} from "@/server/agents/iterative-research-planner";
import {
  createIterativeEvidenceResearchGraph,
  ITERATIVE_EVIDENCE_RESEARCH_RECURSION_LIMIT,
  MAX_WAVES,
  type IterativeResearchExecutor,
  type IterativeResearchPlanner,
} from "@/server/langgraph/iterative-evidence-research-graph";
import { assessSourceLedger, auditMarketSynthesisDraft } from "@/server/persistence/market-synthesis-store";
import {
  assessFetchedSource,
  assessResearchCoverage,
  classifySourceUrl,
  DEEP_RESEARCH_DIMENSIONS,
  detectDuplicateOrSyndicatedSource,
  extractRootDomain,
  normalizeCanonicalResearchUrl,
  scoreSearchCandidate,
  selectDiverseSearchCandidates,
  type PriorAssessmentSource,
  type SearchCandidate,
} from "@/server/research/deep-research-assessment";
import { createEvidenceSourceRetriever } from "@/server/research/evidence-source-retriever";

const ROOT = process.cwd();
const NOW = "2026-11-24T00:00:00.000Z";

function makeFixtureBrief(overrides: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    offer: "AI-native compliance and audit automation software for accounting firms",
    goal: "Identify the strongest English-speaking B2B expansion markets",
    businessLocation: "Wyoming, USA",
    targetMarkets: ["Recommend best market"],
    intakeComplete: true,
    marketHints: ["Mid-market accounting practices"],
    locationHints: ["United Kingdom", "Canada", "Australia"],
    buyerHints: ["Managing Partner", "Head of Audit"],
    constraints: [],
    unknowns: [],
    sourceMessageIds: ["00000000-0000-4000-8000-000000001301"],
    ...overrides,
  };
}

function makeFixturePlan(overrides: Partial<ResearchPlan> = {}): ResearchPlan {
  return {
    id: "00000000-0000-4000-8000-000000001302",
    version: 1,
    approvalStatus: "approved",
    createdAt: NOW,
    summary: "Compare B2B accounting software demand across candidate markets",
    researchQuestions: [
      "Where is audit automation demand highest among accounting firms?",
      "Which market has favorable regulatory deadlines and IT spend?",
    ],
    comparisonCriteria: ["Regulatory urgency", "Firm density", "Software adoption"],
    intendedSourceClasses: [
      "Government and official statistics",
      "Industry bodies and primary research",
    ],
    plannedScope: {
      markets: ["United Kingdom", "Canada"],
      industries: ["Accounting and tax services"],
      buyerRoles: ["Managing Partner"],
    },
    budget: {
      maximumSearches: 50,
      maximumFetches: 100,
      providerSpend: "not_available_in_phase_a",
    },
    uncertainties: ["Regional pricing sensitivity"],
    ...overrides,
  };
}

test("Phase 13D budget constants, wave limit, and honest source provenance labels", () => {
  assert.equal(MAX_ITERATIVE_RESEARCH_WAVES, 8);
  assert.equal(MAX_WAVES, 8);
  assert.equal(DEFAULT_ITERATIVE_MAX_SEARCHES, 50);
  assert.equal(DEFAULT_ITERATIVE_MAX_FETCHES, 100);

  assert.equal(sourceProvenanceSchema.parse("public_web"), "public_web");
  assert.equal(sourceProvenanceSchema.parse("comparable_evidence"), "comparable_evidence");
  assert.equal(sourceProvenanceSchema.parse("workspace_supplied"), "workspace_supplied");
  assert.equal(sourceProvenanceSchema.safeParse("internal_fabricated").success, false);

  assert.equal(sourceEvidenceRoleSchema.parse("direct_evidence"), "direct_evidence");
  assert.equal(sourceEvidenceRoleSchema.parse("comparable_evidence"), "comparable_evidence");
  assert.equal(sourceEvidenceRoleSchema.parse("contextual_counter_only"), "contextual_counter_only");

  assert.equal(
    resolveSourceProvenance({ url: "https://product-brief.ano.local/conv-1" }),
    "workspace_supplied",
  );
  assert.equal(
    resolveSourceProvenance({ url: "https://product-brief.ano.local/conv-1", sourceProvenance: "public_web" }),
    "workspace_supplied",
  );
  assert.equal(
    resolveSourceProvenance({ url: "autopilot-product-seed:doc-1" }),
    "workspace_supplied",
  );
  assert.equal(
    resolveSourceProvenance({ url: "https://www.ons.gov.uk/businessindustryandtrade", sourceProvenance: "comparable_evidence" }),
    "comparable_evidence",
  );
  assert.equal(
    resolveSourceProvenance({ url: "https://www.ons.gov.uk/businessindustryandtrade" }),
    "public_web",
  );

  assert.equal(formatSourceProvenanceLabel("public_web"), "Public web");
  assert.equal(formatSourceProvenanceLabel("comparable_evidence"), "Comparable evidence");
  assert.equal(formatSourceProvenanceLabel("workspace_supplied"), "Workspace supplied");

  const parsedSource = evidenceResearchSourceSchema.parse({
    id: "00000000-0000-4000-8000-000000001310",
    title: "ONS Business Insights",
    url: "https://www.ons.gov.uk/businessindustryandtrade",
    sourceClass: "official",
    sourceProvenance: "public_web",
    evidenceRole: "direct_evidence",
    rootDomain: "ons.gov.uk",
    isSyndicatedDuplicate: false,
    excerpt: "UK accounting services reported 42% uptake in automated workflow software.",
    publishedAt: NOW,
    retrievedAt: NOW,
    status: "fetched",
  });
  assert.equal(parsedSource.sourceProvenance, "public_web");
  assert.equal(parsedSource.evidenceRole, "direct_evidence");
});

test("deriveCandidateMarketsFromBriefAndPlan filters placeholders and keeps 2 to 5 real markets", () => {
  const brief = makeFixtureBrief({
    targetMarkets: ["Recommend best market", "Global", "United Kingdom"],
    locationHints: ["Canada", "Remote", "Germany", "Australia"],
  });
  const plan = makeFixturePlan({
    plannedScope: {
      markets: ["United States National Market", "United Kingdom", "TBD", "Australia"],
      industries: ["Accounting"],
      buyerRoles: ["Partner"],
    },
  });

  const derived = deriveCandidateMarketsFromBriefAndPlan(brief, plan);
  assert.ok(derived.length >= 2 && derived.length <= 5);
  for (const item of derived) {
    assert.doesNotMatch(item, /recommend best|global|remote|tbd/i);
  }
  assert.ok(derived.includes("United Kingdom"));
  assert.ok(derived.includes("Australia"));
});

test("evidenceSourceRetriever extracts HTML publication metadata and strips tracking query parameters", async () => {
  const retriever = createEvidenceSourceRetriever({
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetch: async () =>
      new Response(
        '<html><head><meta property="article:published_time" content="2026-06-20T10:00:00Z"></head><body><main><p>Official UK accounting firm automation survey data across 450 mid-market practices.</p></main></body></html>',
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      ),
  });

  const extracted = await retriever.fetchSavedResult({
    id: "sr-meta-1",
    canonicalUrl: "https://www.frc.org.uk/report?utm_source=newsletter&id=42",
  });

  assert.equal(extracted.failures.length, 0);
  assert.equal(extracted.results.length, 1);
  assert.equal(extracted.results[0]?.url, "https://www.frc.org.uk/report?id=42");
  assert.equal(extracted.results[0]?.publishedAt, "2026-06-20T10:00:00.000Z");
  assert.match(extracted.results[0]?.content ?? "", /450 mid-market practices/);
});

test("URL canonicalization strips tracking params while ranking rewards authority, directness, country, industry, and freshness", () => {
  assert.equal(
    normalizeCanonicalResearchUrl(
      "https://www.ons.gov.uk/business/accounting?page=2&utm_source=x&fbclid=abc#section",
    ),
    "https://www.ons.gov.uk/business/accounting?page=2",
  );
  assert.equal(extractRootDomain("https://reports.audit.ons.gov.uk/survey"), "ons.gov.uk");

  const query = researchQuerySchema.parse({
    id: "00000000-0000-4000-8000-000000001311",
    query: "United Kingdom accounting firm audit automation adoption statistics",
    reason: "Measure direct demand urgency and automation adoption in UK accounting",
    sourceClass: "Government and official statistics",
    candidateMarket: "United Kingdom",
    comparisonDimension: "problem_urgency",
    priority: 90,
    waveNumber: 1,
  });

  const freshOfficial: SearchCandidate = {
    id: "cand-fresh",
    url: "https://www.frc.org.uk/audit-automation-adoption-2026",
    title: "United Kingdom accounting firm audit automation adoption 2026 survey",
    snippet: "Official annual UK audit market survey covering firm automation demand and backlog.",
    providerScore: 0.7,
    publishedAt: "2026-06-15T00:00:00.000Z",
    query,
  };
  const staleOfficial: SearchCandidate = {
    ...freshOfficial,
    id: "cand-stale",
    url: "https://www.frc.org.uk/audit-automation-adoption-2017",
    title: "United Kingdom accounting firm audit automation adoption 2017 archive",
    publishedAt: "2017-01-10T00:00:00.000Z",
  };
  const foreignIndustry: SearchCandidate = {
    id: "cand-foreign",
    url: "https://www.statcan.gc.ca/dental-clinic-payroll-2026",
    title: "Canadian dental clinic payroll operations 2026",
    snippet: "Overview of retail dental clinic administration in Ontario.",
    providerScore: 0.7,
    publishedAt: "2026-06-15T00:00:00.000Z",
    query,
  };
  const vendorPromo: SearchCandidate = {
    id: "cand-vendor",
    url: "https://www.acmesoft.io/pricing/audit-demo",
    title: "Book a demo of Acme AI accounting software",
    snippet: "Start a free trial and see customer case studies.",
    providerScore: 0.95,
    publishedAt: "2026-08-01T00:00:00.000Z",
    query,
  };

  const sFresh = scoreSearchCandidate(freshOfficial);
  const sStale = scoreSearchCandidate(staleOfficial);
  const sForeign = scoreSearchCandidate(foreignIndustry);
  const sVendor = scoreSearchCandidate(vendorPromo);

  assert.equal(sFresh.sourceClass, "official");
  assert.equal(sVendor.sourceClass, "vendor");
  assert.ok(sFresh.score > sStale.score, "fresh authoritative source should outscore stale one");
  assert.ok(sFresh.score > sForeign.score, "target country & industry should outscore mismatched geography/sector");
  assert.ok(sVendor.score <= 32, "non-counter vendor promo should remain strictly capped");
});

test("selectDiverseSearchCandidates enforces root-domain wave/run caps and press-wire/vendor diversity caps", () => {
  const candidates: SearchCandidate[] = [
    { id: "cand-1", url: "https://www.ons.gov.uk/a", title: "UK audit market A", snippet: "Official UK figures", providerScore: 0.95, publishedAt: "2026-05-01T00:00:00Z", query: null },
    { id: "cand-2", url: "https://www.ons.gov.uk/b", title: "UK audit market B", snippet: "Official UK figures", providerScore: 0.94, publishedAt: "2026-05-01T00:00:00Z", query: null },
    { id: "cand-3", url: "https://www.ons.gov.uk/c", title: "UK audit market C", snippet: "Official UK figures", providerScore: 0.93, publishedAt: "2026-05-01T00:00:00Z", query: null },
    { id: "cand-4", url: "https://www.icaew.com/report", title: "ICAEW industry survey", snippet: "UK accounting benchmark", providerScore: 0.9, publishedAt: "2026-05-01T00:00:00Z", query: null },
    { id: "cand-5", url: "https://www.prnewswire.com/news/1", title: "Press wire 1", snippet: "PR Newswire release", providerScore: 0.85, publishedAt: "2026-05-01T00:00:00Z", query: null },
    { id: "cand-6", url: "https://www.businesswire.com/news/2", title: "Press wire 2", snippet: "Business Wire release", providerScore: 0.84, publishedAt: "2026-05-01T00:00:00Z", query: null },
    { id: "cand-7", url: "https://www.globenewswire.com/news/3", title: "Press wire 3", snippet: "GlobeNewswire release", providerScore: 0.83, publishedAt: "2026-05-01T00:00:00Z", query: null },
    { id: "cand-8", url: "https://www.ft.com/uk-audit-demand", title: "FT independent reporting", snippet: "Independent UK coverage", providerScore: 0.82, publishedAt: "2026-05-01T00:00:00Z", query: null },
  ];

  const selected = selectDiverseSearchCandidates(candidates, {
    limit: 6,
    maxPerRootDomainWave: 2,
    maxPerRootDomainRun: 4,
    maxPerFamilyRun: 2,
    priorSources: [
      {
        id: "prior-1",
        url: "https://www.ons.gov.uk/prior",
        rootDomain: "ons.gov.uk",
        sourceClass: "official",
        title: "Prior ONS report",
        excerpt: "Prior excerpt",
      },
    ],
  });

  const onsSelected = selected.filter((item) => item.rootDomain === "ons.gov.uk");
  assert.ok(onsSelected.length <= 2, "at most 2 candidates per root domain in one wave");
  const wireSelected = selected.filter((item) => item.sourceFamily === "press_wire_syndicate");
  assert.ok(wireSelected.length <= 2, "press-wire family should stay capped");
});

test("detectDuplicateOrSyndicatedSource catches exact titles, PR wire syndication, and near-duplicate shingling", () => {
  const prior: PriorAssessmentSource[] = [
    {
      id: "src-orig",
      url: "https://www.icaew.com/insights/2026/uk-audit-automation-report",
      rootDomain: "icaew.com",
      sourceClass: "industry",
      title: "UK Mid-Tier Accounting Firms Accelerate Audit Automation in 2026",
      excerpt:
        "According to the 2026 mid-tier practice survey across 420 UK accounting firms, manual audit sampling backlogs rose 31 percent year over year due to statutory filing bottlenecks and staffing shortages.",
    },
  ];

  const wireReprint = detectDuplicateOrSyndicatedSource(
    {
      url: "https://www.prnewswire.com/news-releases/uk-audit-automation-2026.html",
      title: "Press release: Mid-tier audit automation briefing",
      text: "PR Newswire — According to the 2026 mid-tier practice survey across 420 UK accounting firms, manual audit sampling backlogs rose 31 percent year over year due to statutory filing bottlenecks and staffing shortages.",
    },
    prior,
  );
  assert.equal(wireReprint.isDuplicateOrSyndicated, true);
  assert.equal(wireReprint.reason, "wire_syndication");
  assert.equal(wireReprint.duplicateOfSourceId, "src-orig");

  const nearDup = detectDuplicateOrSyndicatedSource(
    {
      url: "https://www.mirrorblog.example.com/uk-audit-summary",
      title: "Summary note on UK audit practices",
      text: "According to the 2026 mid-tier practice survey across 420 UK accounting firms, manual audit sampling backlogs rose 31 percent year over year due to statutory filing bottlenecks.",
    },
    prior,
  );
  assert.equal(nearDup.isDuplicateOrSyndicated, true);
  assert.equal(nearDup.reason, "near_duplicate_text");
});

test("vendor sources are contextual/counter-only and synthesis audit rejects vendor-only or workspace-only positive claims", () => {
  assert.equal(classifySourceUrl("https://vendor.io/pricing", "Book a demo", "Free trial software"), "vendor");

  const query = researchQuerySchema.parse({
    id: "00000000-0000-4000-8000-000000001312",
    query: "United Kingdom accounting firm audit automation demand statistics",
    reason: "Measure direct demand urgency",
    sourceClass: "Government and official statistics",
    candidateMarket: "United Kingdom",
    comparisonDimension: "problem_urgency",
    priority: 90,
    waveNumber: 1,
  });

  const vendorAssessment = assessFetchedSource({
    url: "https://www.acmesoft.io/pricing/demo",
    title: "Acme AI Pricing and Request Demo",
    excerpt: "United Kingdom accounting firm audit automation demand statistics show 99% ROI with our platform.",
    publishedAt: "2026-07-01T00:00:00Z",
    query,
    priorSources: [],
  });
  assert.equal(vendorAssessment.sourceClass, "vendor");
  assert.equal(vendorAssessment.evidenceRole, "contextual_counter_only");
  assert.equal(vendorAssessment.decisionRelevant, false);

  const foreignAssessment = assessFetchedSource({
    url: "https://www.statcan.gc.ca/en/accounting-automation-adoption-2026",
    title: "Canadian accounting firm audit automation demand statistics 2026",
    excerpt:
      "Official Canadian statistical analysis covering accounting firm audit automation adoption and compliance cycle times in Toronto and Montreal.",
    publishedAt: "2026-07-01T00:00:00Z",
    query,
    priorSources: [],
  });
  assert.equal(foreignAssessment.evidenceRole, "comparable_evidence");
  assert.equal(foreignAssessment.sourceProvenance, "comparable_evidence");
  assert.equal(foreignAssessment.decisionRelevant, false);

  const vendorId = "00000000-0000-4000-8000-000000001321";
  const workspaceId = "00000000-0000-4000-8000-000000001322";
  const sources: SynthesisSource[] = [
    {
      id: vendorId,
      title: "Acme Vendor Case Study",
      sourceClass: "vendor",
      sourceProvenance: "public_web",
      excerpt: "Vendor claims strong ROI.",
      publishedAt: NOW,
      evidenceScore: 55,
    },
    {
      id: workspaceId,
      title: "Uploaded user product deck",
      sourceClass: "company",
      sourceProvenance: "workspace_supplied",
      excerpt: "Our product targets UK accounting firms.",
      publishedAt: null,
      evidenceScore: 60,
    },
  ];

  const ledger = assessSourceLedger(sources);
  assert.equal(ledger.fetchedSourceCount, 2);
  assert.equal(ledger.sourceClassCount, 0);
  assert.equal(ledger.coverageStrength, "insufficient");
  assert.equal(ledger.comparisonReady, false);

  const coercedVendorObsDraft = normaliseSynthesisDraft(
    {
      claims: [
        {
          id: "claim-1",
          kind: "observation",
          statement: "UK accounting firms show strong urgent demand for automation.",
          sourceIds: [vendorId],
          evidenceStrength: "strong",
          citationStatus: "supported",
        },
      ],
      markets: [
        {
          id: "mkt-1",
          name: "United Kingdom",
          summary: "Vendor brochure suggests UK opportunity.",
          evidenceStrength: "strong",
          claimIds: ["claim-1"],
        },
      ],
      industries: [
        {
          id: "ind-1",
          marketProfileId: "mkt-1",
          name: "Accounting services",
          summary: "Accounting firms.",
          operationalProblems: ["Manual sampling"],
          solutionFit: ["Automation"],
          buyerRoleHypotheses: ["Partner"],
          evidenceStrength: "strong",
          claimIds: ["claim-1"],
        },
      ],
      summary: "Tentative summary",
    },
    sources,
  );
  assert.equal(coercedVendorObsDraft.claims[0]?.kind, "hypothesis");
  assert.equal(coercedVendorObsDraft.claims[0]?.evidenceStrength, "limited");
  assert.equal(coercedVendorObsDraft.markets[0]?.evidenceStrength, "limited");
  assert.equal(coercedVendorObsDraft.industries[0]?.evidenceStrength, "limited");

  const coercedWorkspaceObsDraft = normaliseSynthesisDraft(
    {
      claims: [
        {
          id: "claim-1",
          kind: "observation",
          statement: "Workspace brief proves direct public UK demand.",
          sourceIds: [workspaceId],
          evidenceStrength: "moderate",
          citationStatus: "supported",
        },
      ],
      markets: [
        {
          id: "mkt-1",
          name: "United Kingdom",
          summary: "Workspace brief suggests UK opportunity.",
          evidenceStrength: "moderate",
          claimIds: ["claim-1"],
        },
      ],
      industries: [
        {
          id: "ind-1",
          marketProfileId: "mkt-1",
          name: "Accounting services",
          summary: "Accounting firms.",
          operationalProblems: ["Manual sampling"],
          solutionFit: ["Automation"],
          buyerRoleHypotheses: ["Partner"],
          evidenceStrength: "moderate",
          claimIds: ["claim-1"],
        },
      ],
      summary: "Tentative summary",
    },
    sources,
  );
  assert.equal(coercedWorkspaceObsDraft.claims[0]?.kind, "hypothesis");
  assert.equal(coercedWorkspaceObsDraft.claims[0]?.evidenceStrength, "limited");
  assert.equal(coercedWorkspaceObsDraft.markets[0]?.evidenceStrength, "limited");
  assert.equal(coercedWorkspaceObsDraft.industries[0]?.evidenceStrength, "limited");

  const validHypothesisDraft = normaliseSynthesisDraft(
    {
      claims: [
        {
          id: "claim-1",
          kind: "hypothesis",
          statement: "Only vendor and workspace inputs exist; direct UK demand remains unverified.",
          sourceIds: [vendorId, workspaceId],
          evidenceStrength: "limited",
          citationStatus: "uncertain",
        },
      ],
      markets: [
        {
          id: "mkt-1",
          name: "United Kingdom",
          summary: "Hypothesis pending independent public evidence.",
          evidenceStrength: "limited",
          claimIds: ["claim-1"],
        },
      ],
      industries: [
        {
          id: "ind-1",
          marketProfileId: "mkt-1",
          name: "Accounting services",
          summary: "Hypothesis only.",
          operationalProblems: ["Unverified manual burden"],
          solutionFit: ["Potential workflow aid"],
          buyerRoleHypotheses: ["Managing Partner"],
          evidenceStrength: "limited",
          claimIds: ["claim-1"],
        },
      ],
      summary: "Insufficient independent evidence; framed as testable hypothesis.",
    },
    sources,
  );
  assert.doesNotThrow(() => auditMarketSynthesisDraft(validHypothesisDraft, sources));

  assert.throws(
    () =>
      auditMarketSynthesisDraft(
        {
          ...validHypothesisDraft,
          claims: [
            {
              ...validHypothesisDraft.claims[0]!,
              kind: "observation",
              evidenceStrength: "strong",
              sourceIds: [vendorId],
            },
          ],
        },
        sources,
      ),
    /vendor sources acting as direct demand proof/i,
  );

  assert.throws(
    () =>
      auditMarketSynthesisDraft(
        {
          ...validHypothesisDraft,
          claims: [
            {
              ...validHypothesisDraft.claims[0]!,
              kind: "observation",
              evidenceStrength: "moderate",
              sourceIds: [workspaceId],
            },
          ],
        },
        sources,
      ),
    /workspace-supplied context/i,
  );
});

test("assessResearchCoverage distinguishes epistemic counts and requires domain diversity + >= 8 direct sources", () => {
  const nonCounterDims = DEEP_RESEARCH_DIMENSIONS.filter((d) => d !== "counter_evidence");
  const baseSources = nonCounterDims.flatMap((dim, index) => [
    {
      sourceClass: (index % 2 === 0 ? "official" : "industry") as "official" | "industry",
      sourceProvenance: "public_web" as const,
      evidenceRole: "direct_evidence" as const,
      rootDomain: `uk-org-${index}.gov.uk`,
      overallScore: 78,
      decisionRelevant: true,
      query: { candidateMarket: "United Kingdom", comparisonDimension: dim },
    },
    {
      sourceClass: (index % 2 === 0 ? "academic" : "independent") as "academic" | "independent",
      sourceProvenance: "public_web" as const,
      evidenceRole: "direct_evidence" as const,
      rootDomain: `ca-src-${index}.gc.ca`,
      overallScore: 76,
      decisionRelevant: true,
      query: { candidateMarket: "Canada", comparisonDimension: dim },
    },
  ]);

  const narrowDomains = baseSources.map((item) => ({ ...item, rootDomain: "same-domain.org" }));
  const weakDomainCoverage = assessResearchCoverage({
    candidateMarkets: ["United Kingdom", "Canada"],
    sources: narrowDomains,
  });
  assert.equal(weakDomainCoverage.comparisonReady, false);
  assert.equal(weakDomainCoverage.distinctRootDomains, 1);

  const strongCoverage = assessResearchCoverage({
    candidateMarkets: ["United Kingdom", "Canada"],
    sources: [
      ...baseSources,
      {
        sourceClass: "vendor",
        sourceProvenance: "public_web",
        evidenceRole: "contextual_counter_only",
        rootDomain: "vendor.io",
        overallScore: 70,
        decisionRelevant: false,
        query: { candidateMarket: "United Kingdom", comparisonDimension: "problem_urgency" },
      },
      {
        sourceClass: "official",
        sourceProvenance: "comparable_evidence",
        evidenceRole: "comparable_evidence",
        rootDomain: "abs.gov.au",
        overallScore: 72,
        decisionRelevant: false,
        query: { candidateMarket: "United Kingdom", comparisonDimension: "problem_urgency" },
      },
      {
        sourceClass: "company",
        sourceProvenance: "workspace_supplied",
        evidenceRole: "non_qualifying",
        rootDomain: "product-brief.ano.local",
        overallScore: 60,
        decisionRelevant: false,
        query: null,
      },
    ],
  });
  assert.equal(strongCoverage.comparisonReady, true);
  assert.ok(strongCoverage.epistemicSummary);
  assert.equal(strongCoverage.epistemicSummary.directEvidenceCount, 10);
  assert.equal(strongCoverage.epistemicSummary.comparableEvidenceCount, 1);
  assert.equal(strongCoverage.epistemicSummary.contextualVendorCount, 1);
  assert.equal(strongCoverage.epistemicSummary.workspaceSuppliedCount, 1);
});

test("gap-closing planner filters near-duplicates/saturated cells and iterative graph stops early only when comparisonReady", async () => {
  const brief = makeFixtureBrief();
  const plan = makeFixturePlan();

  const wave1 = buildDeterministicInitialWave(brief, plan, 8);
  assert.ok(wave1.candidateMarkets.length >= 2 && wave1.candidateMarkets.length <= 5);
  assert.ok(wave1.queries.length >= 2);

  const partialCoverage = assessResearchCoverage({
    candidateMarkets: ["United Kingdom", "Canada"],
    sources: [
      {
        sourceClass: "official",
        sourceProvenance: "public_web",
        evidenceRole: "direct_evidence",
        rootDomain: "ons.gov.uk",
        overallScore: 80,
        decisionRelevant: true,
        query: { candidateMarket: "United Kingdom", comparisonDimension: "problem_urgency" },
      },
      {
        sourceClass: "industry",
        sourceProvenance: "public_web",
        evidenceRole: "direct_evidence",
        rootDomain: "icaew.com",
        overallScore: 79,
        decisionRelevant: true,
        query: { candidateMarket: "United Kingdom", comparisonDimension: "problem_urgency" },
      },
    ],
  });

  const normalizedFollowup = normalizeIterativeResearchWave(
    {
      objective: "Fill remaining evidence gaps",
      candidateMarkets: ["United Kingdom", "Canada"],
      queries: [
        {
          query: "United Kingdom accounting firm regulatory urgency problem",
          reason: "Redundant saturated cell query",
          sourceClass: "Industry bodies and primary research",
          candidateMarket: "United Kingdom",
          comparisonDimension: "problem_urgency",
          priority: 90,
        },
        {
          query: "Canada official accounting industry density stats",
          reason: "Fill uncovered Canada market_density cell",
          sourceClass: "Government and official statistics",
          candidateMarket: "Canada",
          comparisonDimension: "market_density",
          priority: 95,
        },
      ],
    },
    2,
    8,
    ["United Kingdom", "Canada"],
    ["Statistics Canada accounting software adoption study"],
    partialCoverage,
  );
  assert.equal(normalizedFollowup.queries.length, 1);
  assert.equal(normalizedFollowup.queries[0]?.comparisonDimension, "market_density");

  const gapWave = buildDeterministicGapClosingWave(brief, plan, partialCoverage, 2, 6, [
    wave1.queries[0]!.query,
  ]);
  assert.ok(gapWave.queries.length > 0);
  assert.ok(
    gapWave.queries.every(
      (q) => !(q.candidateMarket === "United Kingdom" && q.comparisonDimension === "problem_urgency"),
    ),
  );

  // Run 1: comparisonReady stays false across waves -> runs all 8 waves within 50/100 budget
  let observedWaves = 0;
  let searchCount = 0;
  let fetchCount = 0;
  let completedCalled = 0;

  const fullPlanner: IterativeResearchPlanner = {
    async planInitialWave(_brief, _plan, maximumQueries) {
      observedWaves += 1;
      return {
        objective: "Wave 1",
        candidateMarkets: ["United Kingdom", "Canada"],
        queries: [
          researchQuerySchema.parse({
            id: crypto.randomUUID(),
            query: `UK demand query ${observedWaves}`,
            reason: "Wave 1 query",
            sourceClass: "Government and official statistics",
            candidateMarket: "United Kingdom",
            comparisonDimension: "problem_urgency",
            priority: 90,
            waveNumber: 1,
          }),
        ].slice(0, maximumQueries),
      };
    },
    async planFollowUpWave(_brief, _plan, _coverage, waveNumber, maximumQueries) {
      observedWaves += 1;
      return {
        objective: `Wave ${waveNumber}`,
        candidateMarkets: ["United Kingdom", "Canada"],
        queries: [
          researchQuerySchema.parse({
            id: crypto.randomUUID(),
            query: `Canada gap query wave ${waveNumber}`,
            reason: `Close gap in wave ${waveNumber}`,
            sourceClass: "Industry bodies and primary research",
            candidateMarket: "Canada",
            comparisonDimension: "market_density",
            priority: 90,
            waveNumber,
          }),
        ].slice(0, maximumQueries),
      };
    },
  };

  const fullExecutor: IterativeResearchExecutor = {
    async persistWave(_runId, wave) {
      return { id: `wave-${wave.waveNumber}`, queries: wave.queries };
    },
    async executeSearch() {
      searchCount += 1;
    },
    async selectSourcesToFetch(_runId, fetchBudget) {
      return fetchBudget > 0 ? [`sr-${observedWaves}`] : [];
    },
    async executeFetch(_runId, ids) {
      fetchCount += ids.length;
    },
    async assessCoverage() {
      return assessResearchCoverage({
        candidateMarkets: ["United Kingdom", "Canada"],
        sources: [],
      });
    },
    async complete() {
      completedCalled += 1;
    },
  };

  const fullGraph = createIterativeEvidenceResearchGraph(fullPlanner, fullExecutor, new MemorySaver(), {
    maxWaves: 8,
  });
  await fullGraph.invoke(
    {
      researchRunId: "00000000-0000-4000-8000-000000001399",
      brief,
      plan,
      maximumSearches: 50,
      maximumFetches: 100,
      currentNode: "plan_wave",
    },
    {
      configurable: { thread_id: "phase13d-8-wave-check" },
      recursionLimit: ITERATIVE_EVIDENCE_RESEARCH_RECURSION_LIMIT,
    },
  );

  assert.equal(observedWaves, 8);
  assert.equal(searchCount, 8);
  assert.equal(fetchCount, 8);
  assert.equal(completedCalled, 1);

  // Run 2: comparisonReady becomes true on wave 2 -> stops early on wave 2 out of maxWaves: 8
  let earlyWaves = 0;
  let earlyCompleted = 0;
  const nonCounterDims = DEEP_RESEARCH_DIMENSIONS.filter((d) => d !== "counter_evidence");
  const strongSources = nonCounterDims.flatMap((dim, index) => [
    {
      sourceClass: "official" as const,
      sourceProvenance: "public_web" as const,
      evidenceRole: "direct_evidence" as const,
      rootDomain: `uk-early-${index}.gov.uk`,
      overallScore: 82,
      decisionRelevant: true,
      query: { candidateMarket: "United Kingdom", comparisonDimension: dim },
    },
    {
      sourceClass: "industry" as const,
      sourceProvenance: "public_web" as const,
      evidenceRole: "direct_evidence" as const,
      rootDomain: `ca-early-${index}.ca`,
      overallScore: 80,
      decisionRelevant: true,
      query: { candidateMarket: "Canada", comparisonDimension: dim },
    },
  ]);

  const earlyPlanner: IterativeResearchPlanner = {
    async planInitialWave(_brief, _plan, maximumQueries) {
      earlyWaves += 1;
      return {
        objective: "Early wave 1",
        candidateMarkets: ["United Kingdom", "Canada"],
        queries: [
          researchQuerySchema.parse({
            id: crypto.randomUUID(),
            query: "UK initial accounting audit stats",
            reason: "Wave 1",
            sourceClass: "Government and official statistics",
            candidateMarket: "United Kingdom",
            comparisonDimension: "problem_urgency",
            priority: 90,
            waveNumber: 1,
          }),
        ].slice(0, maximumQueries),
      };
    },
    async planFollowUpWave(_brief, _plan, _coverage, waveNumber, maximumQueries) {
      earlyWaves += 1;
      return {
        objective: `Early wave ${waveNumber}`,
        candidateMarkets: ["United Kingdom", "Canada"],
        queries: [
          researchQuerySchema.parse({
            id: crypto.randomUUID(),
            query: `Canada follow-up wave ${waveNumber}`,
            reason: "Wave 2 closes gap",
            sourceClass: "Industry bodies and primary research",
            candidateMarket: "Canada",
            comparisonDimension: "market_density",
            priority: 90,
            waveNumber,
          }),
        ].slice(0, maximumQueries),
      };
    },
  };

  const earlyExecutor: IterativeResearchExecutor = {
    async persistWave(_runId, wave) {
      return { id: `early-wave-${wave.waveNumber}`, queries: wave.queries };
    },
    async executeSearch() {},
    async selectSourcesToFetch(_runId, fetchBudget) {
      return fetchBudget > 0 ? [`early-sr-${earlyWaves}`] : [];
    },
    async executeFetch() {},
    async assessCoverage() {
      return assessResearchCoverage({
        candidateMarkets: ["United Kingdom", "Canada"],
        sources: earlyWaves >= 2 ? strongSources : [],
      });
    },
    async complete() {
      earlyCompleted += 1;
    },
  };

  const earlyGraph = createIterativeEvidenceResearchGraph(earlyPlanner, earlyExecutor, new MemorySaver(), {
    maxWaves: 8,
  });
  await earlyGraph.invoke(
    {
      researchRunId: "00000000-0000-4000-8000-000000001398",
      brief,
      plan,
      maximumSearches: 50,
      maximumFetches: 100,
      currentNode: "plan_wave",
    },
    {
      configurable: { thread_id: "phase13d-early-stop-check" },
      recursionLimit: ITERATIVE_EVIDENCE_RESEARCH_RECURSION_LIMIT,
    },
  );

  assert.equal(earlyWaves, 2);
  assert.equal(earlyCompleted, 1);
});

test("Autopilot Stage 2 uses MAX_ITERATIVE_RESEARCH_WAVES, UI renders provenance labels cleanly, and migration 000030 is registered", async () => {
  const [
    orchestratorText,
    evidenceCardText,
    progressMsgText,
    contextRailText,
    migrationSql,
    applyScript,
    statusScript,
  ] = await Promise.all([
    readFile(path.join(ROOT, "src/server/domain/autopilot-orchestrator-service.ts"), "utf8"),
    readFile(path.join(ROOT, "src/components/artifacts/evidence-card.tsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/artifacts/research-progress-message.tsx"), "utf8"),
    readFile(path.join(ROOT, "src/components/shell/context-rail.tsx"), "utf8"),
    readFile(
      path.join(ROOT, "supabase/migrations/20261124_000030_research_source_provenance.sql"),
      "utf8",
    ),
    readFile(path.join(ROOT, "scripts/apply-ano-schema.mjs"), "utf8"),
    readFile(path.join(ROOT, "scripts/check-ano-schema.mjs"), "utf8"),
  ]);

  assert.match(orchestratorText, /maxWaves:\s*MAX_ITERATIVE_RESEARCH_WAVES/);
  assert.doesNotMatch(orchestratorText, /maxWaves:\s*3\b/);
  assert.match(orchestratorText, /resolveSourceProvenance/);
  assert.doesNotMatch(
    orchestratorText,
    /Completed using \$\{.*\} saved product sources as initial research context/,
  );

  for (const uiText of [evidenceCardText, progressMsgText, contextRailText]) {
    assert.match(uiText, /formatSourceProvenanceLabel/);
    assert.match(uiText, /resolveSourceProvenance/);
  }

  assert.match(migrationSql, /source_provenance/);
  assert.match(migrationSql, /workspace_supplied/);
  assert.match(migrationSql, /public_web/);
  assert.match(migrationSql, /comparable_evidence/);
  assert.match(migrationSql, /root_domain/);
  assert.match(migrationSql, /duplicate_of_source_id/);

  assert.match(applyScript, /20261124_000030_research_source_provenance/);
  assert.match(statusScript, /20261124_000030_research_source_provenance/);
});

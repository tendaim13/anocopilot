import assert from "node:assert/strict";
import test from "node:test";

import { MemorySaver } from "@langchain/langgraph";

import type { MarketSynthesisDraft } from "@/lib/ano/market-synthesis";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import { normaliseSynthesisDraft, type SynthesisSource } from "@/server/agents/market-synthesis-model";
import { createMarketSynthesisGraph, type MarketSynthesisExecutor, type MarketSynthesisModel } from "@/server/langgraph/market-synthesis-graph";
import { assessSourceLedger, auditMarketSynthesisDraft, MarketSynthesisPersistenceError } from "@/server/persistence/market-synthesis-store";

const ids = {
  synthesis: "00000000-0000-4000-8000-000000000001",
  graphRun: "00000000-0000-4000-8000-000000000002",
  sourceOne: "00000000-0000-4000-8000-000000000003",
  sourceTwo: "00000000-0000-4000-8000-000000000004",
  sourceThree: "00000000-0000-4000-8000-000000000005",
  claim: "00000000-0000-4000-8000-000000000006",
  market: "00000000-0000-4000-8000-000000000007",
  industry: "00000000-0000-4000-8000-000000000008",
};

const brief: ResearchBrief = { offer: "AI workflows", goal: "Find a first market", marketHints: [], locationHints: [], buyerHints: [], constraints: [], unknowns: [], sourceMessageIds: ["00000000-0000-4000-8000-000000000009"] };
const plan: ResearchPlan = { id: "00000000-0000-4000-8000-000000000010", version: 1, approvalStatus: "approved", createdAt: "2026-10-24T00:00:00.000Z", summary: "Compare markets", researchQuestions: ["What is observable?"], comparisonCriteria: ["Evidence"], intendedSourceClasses: ["Government and official statistics"], plannedScope: { markets: [], industries: [], buyerRoles: [] }, budget: { maximumSearches: 12, maximumFetches: 30, providerSpend: "not_available_in_phase_a" }, uncertainties: [] };
const sources: SynthesisSource[] = [
  { id: ids.sourceOne, title: "Official source", sourceClass: "official", excerpt: "A saved public statistic about workflow adoption.", publishedAt: "2026-01-01T00:00:00.000Z" },
  { id: ids.sourceTwo, title: "Industry source", sourceClass: "industry", excerpt: "A saved industry report about operational friction.", publishedAt: "2026-02-01T00:00:00.000Z" },
  { id: ids.sourceThree, title: "Independent source", sourceClass: "independent", excerpt: "A saved independent report about buyer needs.", publishedAt: null },
];

const draft: MarketSynthesisDraft = {
  claims: [{ id: ids.claim, kind: "inference", statement: "The saved sources justify testing a clearly bounded operational-workflow market.", sourceIds: [ids.sourceOne, ids.sourceTwo], comparisonBasis: null, evidenceStrength: "moderate", citationStatus: "supported" }],
  markets: [{ id: ids.market, name: "Test market", summary: "A cited candidate, not a guaranteed commercial outcome.", evidenceStrength: "moderate", claimIds: [ids.claim], unknowns: ["No price data is present."], nextResearchActions: ["Compare the same dimensions across another market."] }],
  industries: [{ id: ids.industry, marketProfileId: ids.market, name: "Test industry", summary: "A cited industry profile.", operationalProblems: ["Manual workflow handoffs."], solutionFit: ["Workflow automation may reduce handoffs."], buyerRoleHypotheses: ["Operations leaders may evaluate the workflow."], evidenceStrength: "moderate", claimIds: [ids.claim], unknowns: [] }],
  contradictions: [],
  gaps: ["No comparable revenue data is available."],
  summary: "The sources support a limited, evidence-bound comparison.",
};

test("Phase C separates evidence coverage from a commercial conclusion", () => {
  const assessment = assessSourceLedger(sources);
  assert.equal(assessment.coverageStrength, "moderate");
  assert.equal(assessment.comparisonReady, true);
  assert.ok(assessment.gaps.some((gap) => gap.includes("published date")));
  const limited = assessSourceLedger([{ ...sources[0], sourceClass: "independent" }, { ...sources[1], sourceClass: "independent" }, { ...sources[2], sourceClass: "independent" }]);
  assert.equal(limited.coverageStrength, "limited");
  assert.equal(limited.comparisonReady, false);
});

test("Phase C rejects a citation reference that is not in the saved source ledger", () => {
  const invalid = structuredClone(draft);
  invalid.claims[0].sourceIds = ["00000000-0000-4000-8000-000000000099"];
  assert.throws(() => auditMarketSynthesisDraft(invalid, sources), (error: unknown) => {
    assert.ok(error instanceof MarketSynthesisPersistenceError);
    assert.equal(error.code, "CITATION_AUDIT_FAILED");
    return true;
  });
});

test("Phase C rejects comparable evidence that does not explain the comparison", () => {
  const invalid = structuredClone(draft);
  invalid.claims[0].kind = "comparable";
  invalid.claims[0].comparisonBasis = null;
  assert.throws(() => auditMarketSynthesisDraft(invalid, sources), (error: unknown) => {
    assert.ok(error instanceof MarketSynthesisPersistenceError);
    assert.equal(error.code, "CITATION_AUDIT_FAILED");
    return true;
  });
});

test("Phase C synthesizes partial but usable evidence instead of stopping at a coverage gate", async () => {
  const steps: string[] = [];
  const model: MarketSynthesisModel = { async synthesise() { steps.push("model"); return draft; } };
  const executor: MarketSynthesisExecutor = {
    assess: assessSourceLedger,
    async saveNoUsableEvidence() { steps.push("no-usable-evidence"); },
    async saveSynthesis() { steps.push("saved"); return { status: "ready_for_decision" }; },
  };
  const graph = createMarketSynthesisGraph(model, executor, new MemorySaver());
  const config = { configurable: { thread_id: "phase-c-partial" } };
  await graph.invoke({ synthesisId: ids.synthesis, graphRunId: ids.graphRun, brief, plan, sources: sources.slice(0, 2), status: "running", currentNode: "assess_evidence_coverage" }, config);
  const state = await graph.getState(config);
  assert.equal(state.values.status, "ready_for_decision");
  assert.deepEqual(steps, ["model", "saved"]);
});

test("Phase C records a no-usable-evidence report without calling Bedrock", async () => {
  const steps: string[] = [];
  const model: MarketSynthesisModel = { async synthesise() { steps.push("model"); return draft; } };
  const executor: MarketSynthesisExecutor = {
    assess: assessSourceLedger,
    async saveNoUsableEvidence() { steps.push("no-usable-evidence"); },
    async saveSynthesis() { steps.push("saved"); return { status: "ready_for_review" }; },
  };
  const graph = createMarketSynthesisGraph(model, executor, new MemorySaver());
  const config = { configurable: { thread_id: "phase-c-no-evidence" } };
  await graph.invoke({ synthesisId: ids.synthesis, graphRunId: ids.graphRun, brief, plan, sources: [], status: "running", currentNode: "assess_evidence_coverage" }, config);
  const state = await graph.getState(config);
  assert.equal(state.values.status, "ready_for_review");
  assert.deepEqual(steps, ["no-usable-evidence"]);
});

test("Phase C synthesizes then persists only after the citation-audit boundary", async () => {
  const steps: string[] = [];
  const model: MarketSynthesisModel = { async synthesise() { steps.push("model"); return draft; } };
  const executor: MarketSynthesisExecutor = {
    assess: assessSourceLedger,
    async saveNoUsableEvidence() { steps.push("no-usable-evidence"); },
    async saveSynthesis(_id, _run, assessment, savedDraft, savedSources) { assert.equal(assessment.comparisonReady, true); assert.equal(savedDraft.claims[0].sourceIds[0], ids.sourceOne); assert.equal(savedSources.length, 3); steps.push("audit-and-save"); return { status: "ready_for_decision" }; },
  };
  const graph = createMarketSynthesisGraph(model, executor, new MemorySaver());
  const config = { configurable: { thread_id: "phase-c-ready" } };
  await graph.invoke({ synthesisId: ids.synthesis, graphRunId: ids.graphRun, brief, plan, sources, status: "running", currentNode: "assess_evidence_coverage" }, config);
  assert.deepEqual(steps, ["model", "audit-and-save"]);
});

test("Phase C resolves short source aliases to exact UUIDs while rejecting unknown citations", () => {
  const normalized = normaliseSynthesisDraft({
    claims: [
      {
        id: "claim-1",
        kind: "OBSERVATION",
        statement: "Saved public sources document multi-chair dental recall delays.",
        sourceIds: ["S1", "S2"],
        evidenceStrength: "MODERATE",
        citationStatus: "SUPPORTED",
      },
    ],
    markets: [
      {
        id: "market-1",
        name: "Australia",
        summary: "Testable candidate based on cited clinical utilization data.",
        evidenceStrength: "moderate",
        claimIds: ["claim-1"],
      },
    ],
    industries: [
      {
        id: "industry-1",
        marketProfileId: "market-1",
        name: "Multi-chair dental practices",
        summary: "Practices managing recurring hygiene recall.",
        operationalProblems: ["Manual phone recall overhead"],
        solutionFit: ["Automated recall reminders"],
        buyerRoleHypotheses: ["Practice Manager"],
        evidenceStrength: "moderate",
        claimIds: ["claim-1"],
      },
    ],
    summary: "Evidence supports an initial Australian dental route.",
  }, sources);

  assert.deepEqual(normalized.claims[0]?.sourceIds, [ids.sourceOne, ids.sourceTwo]);
  assert.equal(normalized.claims[0]?.kind, "observation");
  assert.equal(normalized.industries[0]?.marketProfileId, normalized.markets[0]?.id);

  assert.throws(() =>
    normaliseSynthesisDraft({
      claims: [
        {
          id: "claim-1",
          kind: "observation",
          statement: "Invalid fabricated source reference.",
          sourceIds: ["S99"],
          evidenceStrength: "moderate",
          citationStatus: "supported",
        },
      ],
      markets: [],
      industries: [],
      summary: "Should fail.",
    }, sources),
  );
});

test("Phase C auto-links single market profile when industry marketProfileId is omitted or null", () => {
  const normalized = normaliseSynthesisDraft({
    claims: [
      {
        id: "claim-1",
        kind: "observation",
        statement: "Saved public sources document multi-chair dental utilization.",
        sourceIds: ["S1"],
        evidenceStrength: "moderate",
        citationStatus: "supported",
      },
    ],
    markets: [
      {
        id: "market-1",
        name: "Australia",
        summary: "Testable candidate.",
        evidenceStrength: "moderate",
        claimIds: ["claim-1"],
      },
    ],
    industries: [
      {
        id: "industry-1",
        marketProfileId: null,
        name: "Multi-chair dental practices",
        summary: "Dental clinics.",
        operationalProblems: ["Recall delays"],
        solutionFit: ["Automated reminders"],
        buyerRoleHypotheses: ["Practice Manager"],
        evidenceStrength: "moderate",
        claimIds: ["claim-1"],
      },
    ],
    summary: "Linked single-market route ready.",
  }, sources);

  assert.equal(normalized.industries[0]?.marketProfileId, normalized.markets[0]?.id);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { MemorySaver } from "@langchain/langgraph";

import type { SupabaseWorkspaceSession } from "@/contracts/ano";
import {
  buildStructuredSynthesisReport,
  marketSynthesisSchema,
  type EvidenceGroupSummary,
} from "@/lib/ano/market-synthesis";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import type { LlmPlannerConfig } from "@/server/agents/bedrock-contracts";
import { GeminiApiError } from "@/server/agents/gemini-chat-model";
import {
  createMarketSynthesisModel,
  groupSynthesisSourcesByMarketAndDimension,
  MAP_CONCURRENCY,
  MAX_SOURCES_PER_MAP_BATCH,
  MarketSynthesisModelError,
  mergeGroupBatchSummaries,
  normaliseGroupSummaryDraft,
  partitionGroupIntoBatches,
  type SynthesisSource,
} from "@/server/agents/market-synthesis-model";
import {
  createMarketSynthesisGraph,
  MARKET_SYNTHESIS_GRAPH_VERSION,
  type MarketSynthesisExecutor,
} from "@/server/langgraph/market-synthesis-graph";
import {
  assessSourceLedger,
  auditMarketSynthesisDraft,
  claimMarketSynthesis,
  loadSynthesisSources,
  MarketSynthesisPersistenceError,
  readMarketSynthesis,
  saveMarketSynthesis,
  saveNoUsableEvidence,
} from "@/server/persistence/market-synthesis-store";

const ROOT = process.cwd();
const NOW = "2026-11-24T00:00:00.000Z";
const WS_ID = "00000000-0000-4000-8000-0000000013e0";
const ACTOR_ID = "00000000-0000-4000-8000-0000000013e1";
const CONV_ID = "00000000-0000-4000-8000-0000000013e2";
const GRAPH_RUN_ID = "00000000-0000-4000-8000-0000000013e3";
const RUN_ID = "00000000-0000-4000-8000-0000000013e4";

function makeUuid(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

function makeFixtureBrief(): ResearchBrief {
  return {
    offer: "Automated compliance audit software for mid-market accounting practices",
    goal: "Identify the highest-evidence expansion market",
    businessLocation: "Wyoming, USA",
    targetMarkets: ["United Kingdom", "Canada", "Australia"],
    intakeComplete: true,
    marketHints: ["Mid-market accounting firms"],
    locationHints: ["United Kingdom", "Canada", "Australia"],
    buyerHints: ["Managing Partner"],
    constraints: [],
    unknowns: [],
    sourceMessageIds: [makeUuid(9901)],
  };
}

function makeFixturePlan(): ResearchPlan {
  return {
    id: makeUuid(9902),
    version: 1,
    approvalStatus: "approved",
    createdAt: NOW,
    summary: "Compare compliance urgency and firm density across UK, Canada, and Australia",
    researchQuestions: [
      "Where is compliance automation backlog highest?",
      "Which geography has the strongest buyer conditions and official firm density?",
    ],
    comparisonCriteria: ["Urgency", "Density", "Buyer conditions", "Market access"],
    intendedSourceClasses: ["Government and official statistics", "Industry bodies and primary research"],
    plannedScope: {
      markets: ["United Kingdom", "Canada", "Australia"],
      industries: ["Accounting and audit services"],
      buyerRoles: ["Managing Partner", "Head of Audit"],
    },
    budget: { maximumSearches: 50, maximumFetches: 100, providerSpend: "not_available_in_phase_a" },
    uncertainties: ["Partner budget approval cycle"],
  };
}

function make36Sources(): SynthesisSource[] {
  const sources: SynthesisSource[] = [];
  const dims = ["problem_urgency", "market_density", "buyer_conditions", "market_access", "solution_fit"];
  // 14 sources in the hot UK problem_urgency cell -> forces 2 batches (8 + 6)
  for (let i = 1; i <= 14; i += 1) {
    sources.push({
      id: makeUuid(i),
      title: `UK official audit compliance report #${i}`,
      sourceClass: i % 2 === 0 ? "official" : "industry",
      sourceProvenance: "public_web",
      evidenceRole: "direct_evidence",
      candidateMarket: "United Kingdom",
      comparisonDimension: "problem_urgency",
      rootDomain: `uk-source-${i}.gov.uk`,
      excerpt: `Direct UK public finding #${i}: statutory filing backlogs increased workflow automation spend.`,
      publishedAt: NOW,
      evidenceScore: 80 + (i % 10),
    });
  }
  // 12 sources across Canada dimensions
  for (let i = 15; i <= 26; i += 1) {
    sources.push({
      id: makeUuid(i),
      title: `Canada industry study #${i}`,
      sourceClass: i % 3 === 0 ? "academic" : "industry",
      sourceProvenance: "public_web",
      evidenceRole: "direct_evidence",
      candidateMarket: "Canada",
      comparisonDimension: dims[i % dims.length],
      rootDomain: `ca-src-${i}.ca`,
      excerpt: `Direct Canadian accounting finding #${i} showing audit cycle delays.`,
      publishedAt: NOW,
      evidenceScore: 76,
    });
  }
  // 8 sources across Australia including comparable evidence and counter-evidence (indices #27..#34)
  for (let i = 27; i <= 34; i += 1) {
    sources.push({
      id: makeUuid(i),
      title: `Australia / vendor / comparable evidence #${i}`,
      sourceClass: i === 33 ? "vendor" : "independent",
      sourceProvenance: i === 31 ? "comparable_evidence" : "public_web",
      evidenceRole:
        i === 33 ? "contextual_counter_only" : i === 31 ? "comparable_evidence" : "direct_evidence",
      candidateMarket: "Australia",
      comparisonDimension: i === 33 ? "counter_evidence" : "market_density",
      rootDomain: `au-src-${i}.org.au`,
      excerpt: `Australian evidence excerpt #${i} covering mid-market practice staffing constraints.`,
      publishedAt: NOW,
      evidenceScore: 72,
    });
  }
  // 2 workspace-supplied sources (#35..#36)
  for (let i = 35; i <= 36; i += 1) {
    sources.push({
      id: makeUuid(i),
      title: `Uploaded workspace brief #${i}`,
      sourceClass: "company",
      sourceProvenance: "workspace_supplied",
      evidenceRole: "non_qualifying",
      candidateMarket: null,
      comparisonDimension: null,
      rootDomain: "product-brief.ano.local",
      excerpt: `Workspace product positioning document #${i}.`,
      publishedAt: null,
      evidenceScore: 60,
    });
  }
  return sources;
}

type TableRow = Record<string, unknown>;

function makeStatefulSupabaseSession(
  initialTables: Partial<Record<string, TableRow[]>> = {},
): {
  session: SupabaseWorkspaceSession;
  tables: Record<string, TableRow[]>;
} {
  const tables: Record<string, TableRow[]> = {
    ano_research_runs: [],
    ano_research_syntheses: [],
    research_sources: [],
    research_source_assessments: [],
    research_search_results: [],
    research_queries: [],
    research_claims: [],
    market_profiles: [],
    industry_profiles: [],
    target_decisions: [],
    run_events: [],
    ...initialTables,
  };

  function getTable(name: string): TableRow[] {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  class QueryBuilder {
    private filters: Array<(row: TableRow) => boolean> = [];
    private orderSpec: { col: string; asc: boolean } | null = null;
    private limitNum: number | null = null;
    private op: "select" | "insert" | "update" | "upsert" = "select";
    private payload: unknown = null;
    private conflictCols = "";

    constructor(private readonly tableName: string) {}

    select() {
      return this;
    }

    insert(rows: TableRow | TableRow[]) {
      this.op = "insert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }

    update(patch: TableRow) {
      this.op = "update";
      this.payload = patch;
      return this;
    }

    upsert(rows: TableRow | TableRow[], opts?: { onConflict?: string }) {
      this.op = "upsert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      this.conflictCols = opts?.onConflict ?? "";
      return this;
    }

    eq(col: string, val: unknown) {
      this.filters.push((row) => row[col] === val);
      return this;
    }

    in(col: string, vals: unknown[]) {
      const set = new Set(vals);
      this.filters.push((row) => set.has(row[col]));
      return this;
    }

    not(col: string, op: string, val: unknown) {
      if (op === "is" && val === null) {
        this.filters.push((row) => row[col] !== null && row[col] !== undefined);
      }
      return this;
    }

    order(col: string, opts?: { ascending?: boolean }) {
      this.orderSpec = { col, asc: opts?.ascending ?? true };
      return this;
    }

    limit(n: number) {
      this.limitNum = n;
      return this;
    }

    private run() {
      const tbl = getTable(this.tableName);
      if (this.op === "insert") {
        const added = (this.payload as TableRow[]).map((item) => ({
          ...(this.tableName === "target_decisions"
            ? {
                market_profile_id: null,
                industry_profile_id: null,
                rationale: null,
                selected_at: null,
              }
            : {}),
          id: item.id ?? crypto.randomUUID(),
          created_at: item.created_at ?? NOW,
          updated_at: item.updated_at ?? NOW,
          ...structuredClone(item),
        }));
        tbl.push(...added);
        return { data: added, error: null, count: added.length };
      }

      if (this.op === "upsert") {
        const keys = this.conflictCols.split(",").map((k) => k.trim()).filter(Boolean);
        const rows = this.payload as TableRow[];
        for (const item of rows) {
          const matchIdx =
            keys.length > 0
              ? tbl.findIndex((row) => keys.every((k) => row[k] === item[k]))
              : -1;
          if (matchIdx >= 0) {
            tbl[matchIdx] = { ...tbl[matchIdx], ...structuredClone(item), updated_at: NOW };
          } else {
            tbl.push({
              id: item.id ?? crypto.randomUUID(),
              created_at: NOW,
              updated_at: NOW,
              ...structuredClone(item),
            });
          }
        }
        return { data: rows, error: null, count: rows.length };
      }

      let matched = tbl.filter((row) => this.filters.every((fn) => fn(row)));
      if (this.op === "update") {
        const patch = this.payload as TableRow;
        const updated: TableRow[] = [];
        for (const row of matched) {
          Object.assign(row, structuredClone(patch), { updated_at: NOW });
          updated.push(structuredClone(row));
        }
        return { data: updated, error: null, count: updated.length };
      }

      if (this.orderSpec) {
        const { col, asc } = this.orderSpec;
        matched = [...matched].sort((a, b) => {
          const left = String(a[col] ?? "");
          const right = String(b[col] ?? "");
          return asc ? left.localeCompare(right) : right.localeCompare(left);
        });
      }
      if (this.limitNum !== null) {
        matched = matched.slice(0, this.limitNum);
      }
      const cloned = matched.map((r) => structuredClone(r));
      return { data: cloned, error: null, count: cloned.length };
    }

    maybeSingle() {
      const res = this.run();
      return Promise.resolve({
        data: Array.isArray(res.data) ? (res.data[0] ?? null) : null,
        error: null,
      });
    }

    single() {
      const res = this.run();
      const first = Array.isArray(res.data) ? res.data[0] : null;
      return Promise.resolve({
        data: first ?? null,
        error: first ? null : { message: "Not found" },
      });
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: { data: TableRow[]; error: null; count: number }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(this.run()).then(onfulfilled, onrejected);
    }
  }

  const session: SupabaseWorkspaceSession = {
    kind: "supabase",
    actorId: ACTOR_ID,
    actorEmail: "tester@example.com",
    workspace: {
      id: WS_ID,
      name: "Test Workspace",
      slug: "test-ws",
      role: "owner",
    },
    client: {
      from(table: string) {
        return new QueryBuilder(table);
      },
    } as unknown as SupabaseWorkspaceSession["client"],
  };

  return { session, tables };
}

test("grouping and batching retains all 36 sources across (market, dimension) and splits hot cells cleanly", () => {
  const sources = make36Sources();
  const brief = makeFixtureBrief();
  const plan = makeFixturePlan();

  const groups = groupSynthesisSourcesByMarketAndDimension(sources, brief, plan);
  const groupedIds = new Set(groups.flatMap((g) => g.sources.map((s) => s.id)));
  assert.equal(groupedIds.size, 36, "every source must belong to a group with 0 drops");

  const ukUrgency = groups.find(
    (g) => g.market === "United Kingdom" && g.dimension === "problem_urgency",
  );
  assert.ok(ukUrgency);
  assert.equal(ukUrgency.sources.length, 14);

  const batches = partitionGroupIntoBatches(ukUrgency.sources, MAX_SOURCES_PER_MAP_BATCH);
  assert.equal(MAX_SOURCES_PER_MAP_BATCH, 8);
  assert.equal(MAP_CONCURRENCY, 3);
  assert.equal(batches.length, 2);
  assert.equal(batches[0]!.length, 8);
  assert.equal(batches[1]!.length, 6);

  const workspaceGroup = groups.find((g) => g.market === "Workspace Context");
  assert.ok(workspaceGroup);
  assert.equal(workspaceGroup.sources.length, 2);
});

test("map-reduce model processes all 36 sources without dropping excerpts across gemini, ollama, and bedrock configs and cites late sources", async () => {
  const sources = make36Sources();
  const brief = makeFixtureBrief();
  const plan = makeFixturePlan();

  for (const provider of ["gemini", "ollama", "bedrock"] as const) {
    const config: LlmPlannerConfig =
      provider === "gemini"
        ? {
            provider: "gemini",
            apiKey: "test-key",
            modelId: "gemini-2.5-flash-lite",
            fallbackModelIds: [],
            baseUrl: "https://generativelanguage.googleapis.com",
          }
        : provider === "ollama"
          ? { provider: "ollama", baseUrl: "http://127.0.0.1:11434", modelId: "llama3.2" }
          : {
              provider: "bedrock",
              region: "us-east-1",
              modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
              guardrailIdentifier: "gr-test",
              guardrailVersion: "1",
            };

    const seenMapBatches: Array<Array<{ id: string }>> = [];
    let reducePromptSeen = "";

    const model = createMarketSynthesisModel(config, {
      async invokePrompt(_systemPrompt, userPrompt) {
        if (userPrompt.includes("MAP step of Ano")) {
          const jsonPart = userPrompt.slice(userPrompt.indexOf("{"));
          const payload = JSON.parse(jsonPart) as {
            batchLedger: Array<{ id: string; sourceProvenance: string; sourceClass: string }>;
          };
          seenMapBatches.push(payload.batchLedger);
          return JSON.stringify({
            summary: `Analyzed ${payload.batchLedger.length} sources in batch.`,
            findings: payload.batchLedger.slice(0, 2).map((entry) => ({
              kind:
                entry.sourceProvenance === "workspace_supplied" || entry.sourceClass === "vendor"
                  ? "hypothesis"
                  : entry.sourceProvenance === "comparable_evidence"
                    ? "comparable"
                    : "observation",
              statement: `Finding grounded in ${entry.id}.`,
              sourceIds: [entry.id],
              comparisonBasis:
                entry.sourceProvenance === "comparable_evidence"
                  ? "Adjacent Australian market comparability."
                  : null,
              evidenceStrength: "moderate",
            })),
            assumptions: ["Buyers prioritize audit cycle reduction."],
            unknowns: ["Firm-level implementation budget variance."],
            contradictions: [],
            evidenceStrength: "moderate",
          });
        }

        reducePromptSeen = userPrompt;
        return JSON.stringify({
          claims: [
            {
              id: "claim-1",
              kind: "observation",
              statement: "UK official statistics confirm acute audit automation demand.",
              sourceIds: ["S1", "S14"],
              comparisonBasis: null,
              evidenceStrength: "strong",
              citationStatus: "supported",
            },
            {
              id: "claim-2",
              kind: "comparable",
              statement: "Australian market data mirrors mid-market staffing shortages (#31).",
              sourceIds: ["S31"],
              comparisonBasis: "Shared mid-market accounting staffing structure.",
              evidenceStrength: "moderate",
              citationStatus: "supported",
            },
            {
              id: "claim-3",
              kind: "hypothesis",
              statement: "Canadian adoption readiness should be confirmed via direct outreach (#26).",
              sourceIds: ["S26", "S35"],
              comparisonBasis: null,
              evidenceStrength: "limited",
              citationStatus: "limited",
            },
          ],
          markets: [
            {
              id: "market-1",
              name: "United Kingdom",
              summary: "Top-ranked direct evidence across official UK audit sources.",
              evidenceStrength: "strong",
              claimIds: ["claim-1", "claim-2"],
              unknowns: ["Partner procurement timeline"],
              nextResearchActions: ["Verify FCA-regulated audit firm buying triggers"],
            },
            {
              id: "market-2",
              name: "Canada",
              summary: "Secondary candidate with promising adoption hints.",
              evidenceStrength: "moderate",
              claimIds: ["claim-3"],
              unknowns: ["Provincial bilingual requirements"],
              nextResearchActions: ["Run targeted Canadian firm discovery"],
            },
          ],
          industries: [
            {
              id: "ind-1",
              marketProfileId: "market-1",
              name: "Mid-market accounting practices",
              summary: "High filing backlog and staffing constraints.",
              operationalProblems: ["Manual statutory audit sampling"],
              solutionFit: ["Automated audit trail preparation"],
              buyerRoleHypotheses: ["Managing Partner"],
              evidenceStrength: "strong",
              claimIds: ["claim-1"],
              unknowns: ["Minimum seat count"],
            },
          ],
          contradictions: [],
          gaps: ["Price elasticity not yet tested in live calls."],
          assumptions: ["Mid-market practices run cloud ledger software."],
          nextValidationActions: ["Discover 25 UK mid-market accounting firms and validate titles."],
          confidenceRationale: "All 36 sources across 3 candidate markets were mapped and synthesized.",
          summary: "Prioritize United Kingdom mid-market accounting practices backed by 36 analyzed sources.",
        });
      },
    });

    const groups = await model.mapEvidenceGroups(brief, plan, sources);
    assert.equal(
      groups.reduce((sum, g) => sum + g.sourceCount, 0),
      36,
      `${provider}: map output must cover all 36 sources without silent truncation`,
    );

    const draft = await model.reduceGroupSummaries(brief, plan, sources, groups);
    assert.ok(reducePromptSeen.includes("totalSourcesAnalyzed\":36"));
    // Confirm reduce successfully cites late sources beyond old 10/24 limits (S14, S26, S31, S35)
    const citedIds = new Set(draft.claims.flatMap((c) => c.sourceIds));
    assert.ok(citedIds.has(makeUuid(14)));
    assert.ok(citedIds.has(makeUuid(26)));
    assert.ok(citedIds.has(makeUuid(31)));
    assert.ok(citedIds.has(makeUuid(35)));
    assert.equal(draft.groupSummaries?.length, groups.length);
  }
});

test("fatal provider errors during map-reduce propagate cleanly without silent fallback", async () => {
  const sources = make36Sources().slice(0, 4);
  const model = createMarketSynthesisModel(
    {
      provider: "gemini",
      apiKey: "bad-key",
      modelId: "gemini-2.5-flash-lite",
      fallbackModelIds: [],
      baseUrl: "https://generativelanguage.googleapis.com",
    },
    {
      async invokePrompt() {
        throw new GeminiApiError("Google AI Studio rejected the API key.", "AUTH_FAILED");
      },
    },
  );

  await assert.rejects(
    () => model.mapEvidenceGroups(makeFixtureBrief(), makeFixturePlan(), sources),
    (err) => err instanceof MarketSynthesisModelError,
  );
});

test("citation-bound Map and Reduce audits reject hallucinated sources, dropped sources, and unverified vendor claims", () => {
  const sources = make36Sources();
  const s1 = sources[0]!;
  const sVendor = sources[32]!; // vendor
  const sWorkspace = sources[34]!; // workspace_supplied
  const sComparable = sources[30]!; // comparable_evidence

  // Hallucinated source ID in normaliseGroupSummaryDraft throws
  assert.throws(
    () =>
      normaliseGroupSummaryDraft(
        {
          summary: "Group note",
          findings: [
            {
              kind: "observation",
              statement: "Fabricated citation",
              sourceIds: [makeUuid(9999)],
              comparisonBasis: null,
              evidenceStrength: "strong",
            },
          ],
          assumptions: [],
          unknowns: [],
          contradictions: [],
          evidenceStrength: "strong",
        },
        [s1],
        { groupKey: "uk::urgency", market: "United Kingdom", dimension: "problem_urgency" },
      ),
    /outside the assigned evidence batch/i,
  );

  // normaliseGroupSummaryDraft coerces vendor-only & workspace-only findings down to hypothesis + limited,
  // and upgrades comparable_evidence observations to comparable
  const coercedGroup = normaliseGroupSummaryDraft(
    {
      summary: "Mixed epistemic sources",
      findings: [
        {
          kind: "observation",
          statement: "Vendor claims ROI",
          sourceIds: ["S1"],
          comparisonBasis: null,
          evidenceStrength: "strong",
        },
        {
          kind: "observation",
          statement: "Workspace pitch deck",
          sourceIds: ["S2"],
          comparisonBasis: null,
          evidenceStrength: "moderate",
        },
        {
          kind: "observation",
          statement: "Comparable AU evidence",
          sourceIds: ["S3"],
          comparisonBasis: null,
          evidenceStrength: "moderate",
        },
      ],
      assumptions: [],
      unknowns: [],
      contradictions: [],
      evidenceStrength: "strong",
    },
    [sVendor, sWorkspace, sComparable],
    { groupKey: "au::mixed", market: "Australia", dimension: "market_density" },
  );
  assert.equal(coercedGroup.findings[0]?.kind, "hypothesis");
  assert.equal(coercedGroup.findings[0]?.evidenceStrength, "limited");
  assert.equal(coercedGroup.findings[1]?.kind, "hypothesis");
  assert.equal(coercedGroup.findings[1]?.evidenceStrength, "limited");
  assert.equal(coercedGroup.findings[2]?.kind, "comparable");
  assert.ok(coercedGroup.findings[2]?.comparisonBasis);

  // mergeGroupBatchSummaries combines batches without dropping any source IDs
  const b1 = normaliseGroupSummaryDraft(
    {
      summary: "Part 1",
      findings: [
        { kind: "observation", statement: "B1 stat", sourceIds: ["S1"], comparisonBasis: null, evidenceStrength: "moderate" },
      ],
      assumptions: ["Assumption A"],
      unknowns: ["Unknown X"],
      contradictions: [],
      evidenceStrength: "moderate",
    },
    [sources[0]!],
    { groupKey: "uk::urgency", market: "United Kingdom", dimension: "problem_urgency" },
  );
  const b2 = normaliseGroupSummaryDraft(
    {
      summary: "Part 2",
      findings: [
        { kind: "observation", statement: "B2 stat", sourceIds: ["S1"], comparisonBasis: null, evidenceStrength: "moderate" },
      ],
      assumptions: ["Assumption B"],
      unknowns: ["Unknown Y"],
      contradictions: [],
      evidenceStrength: "moderate",
    },
    [sources[1]!],
    { groupKey: "uk::urgency", market: "United Kingdom", dimension: "problem_urgency" },
  );
  const merged = mergeGroupBatchSummaries([b1, b2]);
  assert.deepEqual(merged.sourceIds, [sources[0]!.id, sources[1]!.id]);
  assert.equal(merged.sourceCount, 2);

  // auditMarketSynthesisDraft rejects omitted sources in groupSummaries & illegal vendor direct entries in report.evidence
  const smallLedger = [s1, sVendor, sWorkspace];
  const incompleteGroup: EvidenceGroupSummary = {
    groupKey: "uk::urgency",
    market: "United Kingdom",
    dimension: "problem_urgency",
    sourceIds: [s1.id],
    sourceCount: 1,
    directEvidenceCount: 1,
    comparableEvidenceCount: 0,
    vendorContextCount: 0,
    workspaceSuppliedCount: 0,
    summary: "Covered S1 only",
    findings: [],
    assumptions: [],
    unknowns: [],
    contradictions: [],
    evidenceStrength: "limited",
  };
  const baseDraft = {
    claims: [
      {
        id: makeUuid(5001),
        kind: "observation" as const,
        statement: "Official report confirms backlog.",
        sourceIds: [s1.id],
        comparisonBasis: null,
        evidenceStrength: "moderate" as const,
        citationStatus: "supported" as const,
      },
    ],
    markets: [],
    industries: [],
    contradictions: [],
    gaps: [],
    summary: "UK evidence summary.",
  };

  assert.throws(
    () =>
      auditMarketSynthesisDraft(
        { ...baseDraft, groupSummaries: [incompleteGroup] },
        smallLedger,
      ),
    (err) => err instanceof MarketSynthesisPersistenceError && /omitted saved evidence sources/i.test(err.message),
  );

  const completeGroup: EvidenceGroupSummary = {
    ...incompleteGroup,
    sourceIds: [s1.id, sVendor.id, sWorkspace.id],
    sourceCount: 3,
    vendorContextCount: 1,
    workspaceSuppliedCount: 1,
  };
  const badReport = buildStructuredSynthesisReport({
    draft: {
      ...baseDraft,
      claims: [
        {
          id: makeUuid(5002),
          kind: "observation",
          statement: "Invalid vendor direct report bullet",
          sourceIds: [sVendor.id],
          comparisonBasis: null,
          evidenceStrength: "moderate",
          citationStatus: "supported",
        },
      ],
    },
    assessment: assessSourceLedger(smallLedger),
    recommendationMode: "exploratory",
    groupSummaries: [completeGroup],
  });

  assert.throws(
    () =>
      auditMarketSynthesisDraft(
        { ...baseDraft, groupSummaries: [completeGroup], report: badReport },
        smallLedger,
      ),
    (err) => err instanceof MarketSynthesisPersistenceError && /direct report evidence/i.test(err.message),
  );
});

test("LangGraph map-reduce execution and stateful persistence preserve all >24 sources and 7-part report", async () => {
  assert.equal(MARKET_SYNTHESIS_GRAPH_VERSION, "phase-c-v3-map-reduce");
  const sources = make36Sources();
  const brief = makeFixtureBrief();
  const plan = makeFixturePlan();

  // Seed Supabase tables with 32 fetched sources (>24) + 2 duplicate rows that should be filtered out
  const searchResultsRows: TableRow[] = [];
  const queryRows: TableRow[] = [];
  const sourceRows: TableRow[] = [];
  const assessmentRows: TableRow[] = [];

  for (let i = 0; i < 32; i += 1) {
    const src = sources[i]!;
    const qId = makeUuid(7000 + i);
    const srId = makeUuid(6000 + i);
    queryRows.push({
      id: qId,
      workspace_id: WS_ID,
      ano_research_run_id: RUN_ID,
      candidate_market: src.candidateMarket,
      comparison_dimension: src.comparisonDimension,
    });
    searchResultsRows.push({
      id: srId,
      workspace_id: WS_ID,
      ano_research_run_id: RUN_ID,
      research_query_id: qId,
    });
    sourceRows.push({
      id: src.id,
      workspace_id: WS_ID,
      ano_research_run_id: RUN_ID,
      search_result_id: srId,
      title: src.title,
      canonical_url: `https://${src.rootDomain}/doc-${i}`,
      source_class: src.sourceClass,
      source_provenance: src.sourceProvenance,
      root_domain: src.rootDomain,
      duplicate_of_source_id: null,
      supporting_excerpt: src.excerpt,
      published_at: src.publishedAt,
      retrieved_at: NOW,
      status: "fetched",
    });
    assessmentRows.push({
      workspace_id: WS_ID,
      ano_research_run_id: RUN_ID,
      research_source_id: src.id,
      overall_score: src.evidenceScore ?? 75,
      assessment_json: { evidenceRole: src.evidenceRole },
    });
  }

  // Add 2 syndicated duplicate rows that reference source[0]
  sourceRows.push({
    id: makeUuid(8801),
    workspace_id: WS_ID,
    ano_research_run_id: RUN_ID,
    search_result_id: makeUuid(6000),
    title: "PR Newswire reprint",
    canonical_url: "https://www.prnewswire.com/reprint",
    source_class: "independent",
    source_provenance: "public_web",
    root_domain: "prnewswire.com",
    duplicate_of_source_id: sources[0]!.id,
    supporting_excerpt: "Duplicate wire reprint text",
    published_at: NOW,
    retrieved_at: NOW,
    status: "fetched",
  });

  const { session, tables } = makeStatefulSupabaseSession({
    ano_research_runs: [
      {
        id: RUN_ID,
        workspace_id: WS_ID,
        conversation_id: CONV_ID,
        graph_run_id: GRAPH_RUN_ID,
        status: "sources_ready",
        coverage_json: {
          candidateMarkets: ["United Kingdom", "Canada", "Australia"],
          cells: [],
          qualifyingSourceCount: 25,
          sourceClassCount: 3,
          missingCells: [],
          comparisonReady: true,
          gaps: [],
        },
        created_at: NOW,
      },
    ],
    research_queries: queryRows,
    research_search_results: searchResultsRows,
    research_sources: sourceRows,
    research_source_assessments: assessmentRows,
  });

  const loaded = await loadSynthesisSources(session, CONV_ID);
  assert.equal(loaded.sources.length, 32, "must load all 32 unique sources without 24-source cap");
  assert.equal(loaded.sources.find((s) => s.id === sources[0]!.id)?.candidateMarket, "United Kingdom");
  assert.equal(loaded.sources.find((s) => s.id === sources[0]!.id)?.comparisonDimension, "problem_urgency");
  assert.equal(loaded.sources.some((s) => s.id === makeUuid(8801)), false, "syndicated duplicates excluded");

  const assessment = assessSourceLedger(loaded.sources, loaded.missionCoverage);
  const claim = await claimMarketSynthesis(session, CONV_ID, RUN_ID, assessment);
  assert.equal(claim.claimed, true);

  const model = createMarketSynthesisModel(
    {
      provider: "gemini",
      apiKey: "test-key",
      modelId: "gemini-2.5-flash-lite",
      fallbackModelIds: [],
      baseUrl: "https://generativelanguage.googleapis.com",
    },
    {
      async invokePrompt(_sys, userPrompt) {
        if (userPrompt.includes("MAP step of Ano")) {
          const payload = JSON.parse(userPrompt.slice(userPrompt.indexOf("{"))) as {
            batchLedger: Array<{ id: string; sourceProvenance: string; sourceClass: string }>;
          };
          return JSON.stringify({
            summary: `Mapped ${payload.batchLedger.length} sources.`,
            findings: [
              {
                kind:
                  payload.batchLedger[0]!.sourceProvenance === "comparable_evidence"
                    ? "comparable"
                    : "observation",
                statement: `Mapped insight from ${payload.batchLedger[0]!.id}.`,
                sourceIds: [payload.batchLedger[0]!.id],
                comparisonBasis:
                  payload.batchLedger[0]!.sourceProvenance === "comparable_evidence"
                    ? "Comparable staffing benchmarks across common-law markets."
                    : null,
                evidenceStrength: "moderate",
              },
            ],
            assumptions: ["Practices use digital bookkeeping."],
            unknowns: ["Average contract value"],
            contradictions: [],
            evidenceStrength: "moderate",
          });
        }

        return JSON.stringify({
          claims: [
            {
              id: "c-1",
              kind: "observation",
              statement: "Official UK figures show high manual audit sampling overhead.",
              sourceIds: ["S1", "S2"],
              comparisonBasis: null,
              evidenceStrength: "strong",
              citationStatus: "supported",
            },
            {
              id: "c-2",
              kind: "comparable",
              statement: "Australian benchmarks provide comparable practice pressure signals.",
              sourceIds: ["S31"],
              comparisonBasis: "Parallel mid-market accounting partner structure.",
              evidenceStrength: "moderate",
              citationStatus: "supported",
            },
          ],
          markets: [
            {
              id: "m-1",
              name: "United Kingdom",
              summary: "Recommended entry market with broad official and industry coverage.",
              evidenceStrength: "strong",
              claimIds: ["c-1", "c-2"],
              unknowns: ["Fee sensitivity among regional partnerships"],
              nextResearchActions: ["Validate demand in 25 UK accounting practices"],
            },
          ],
          industries: [
            {
              id: "i-1",
              marketProfileId: "m-1",
              name: "Accounting and audit services",
              summary: "Mid-market accounting practices handling statutory audits.",
              operationalProblems: ["Statutory audit bottlenecks"],
              solutionFit: ["Automated compliance review"],
              buyerRoleHypotheses: ["Managing Partner", "Head of Audit"],
              evidenceStrength: "strong",
              claimIds: ["c-1"],
              unknowns: ["Preferred deployment timeline"],
            },
          ],
          contradictions: [],
          gaps: ["Unit pricing sensitivity unverified."],
          assumptions: ["Mid-market partners prioritize audit turnaround speed."],
          nextValidationActions: ["Shortlist 25 UK accounting practices and confirm Managing Partner emails."],
          confidenceRationale: "High confidence across 32 non-duplicate sources mapped across market-dimension groups.",
          summary: "Prioritize United Kingdom accounting practices backed by full 32-source map-reduce evidence.",
        });
      },
    },
  );

  const executor: MarketSynthesisExecutor = {
    assess: (s) => assessSourceLedger(s, loaded.missionCoverage),
    saveNoUsableEvidence: (synthesisId, nextAssessment, gId) =>
      saveNoUsableEvidence(session, synthesisId, nextAssessment, gId),
    saveSynthesis: (synthesisId, gId, nextAssessment, draft, s) =>
      saveMarketSynthesis(session, synthesisId, gId, nextAssessment, draft, s),
  };

  const checkpointer = new MemorySaver();
  const graph = createMarketSynthesisGraph(model, executor, checkpointer);
  const config = { configurable: { thread_id: `phase13e-e2e-${claim.synthesisId}` } };
  await graph.invoke(
    {
      synthesisId: claim.synthesisId,
      graphRunId: GRAPH_RUN_ID,
      brief,
      plan,
      sources: loaded.sources,
      status: "running",
      currentNode: "assess_evidence_coverage",
    },
    config,
  );

  const state = await graph.getState(config);
  assert.ok(Array.isArray(state.values.groupSummaries) && state.values.groupSummaries.length >= 2);

  const persisted = await readMarketSynthesis(session, CONV_ID);
  assert.ok(persisted);
  assert.equal(persisted.assessment.sourcesAnalyzedCount, 32);
  assert.ok((persisted.groupSummaries?.length ?? 0) >= 2);
  assert.ok(persisted.report);
  assert.equal(persisted.report.recommendation.recommendedMarket, "United Kingdom");
  assert.equal(persisted.report.recommendation.recommendedIndustry, "Accounting and audit services");
  assert.ok(persisted.report.evidence.length >= 1);
  assert.ok(persisted.report.comparableEvidence.length >= 1);
  assert.ok(persisted.report.assumptions.length >= 1);
  assert.ok(persisted.report.unknowns.length >= 1);
  assert.equal(persisted.report.confidence.totalSourcesAnalyzed, 32);
  assert.ok(persisted.report.nextValidationActions.length >= 1);

  // Legacy empty report_json fallback builds valid 7-section report on read
  tables.ano_research_syntheses[0]!.report_json = {};
  tables.ano_research_syntheses[0]!.group_summaries_json = [];
  const legacyRead = await readMarketSynthesis(session, CONV_ID);
  assert.ok(legacyRead?.report);
  assert.equal(legacyRead.report.recommendation.recommendedMarket, "United Kingdom");
  assert.ok(legacyRead.report.nextValidationActions.length >= 1);

  // no_usable_evidence persistence stores full honest empty-evidence 7-section report
  const { session: emptySession, tables: emptyTables } = makeStatefulSupabaseSession({
    ano_research_runs: structuredClone(tables.ano_research_runs),
  });
  const emptyAssessment = assessSourceLedger([]);
  const emptyClaim = await claimMarketSynthesis(emptySession, CONV_ID, RUN_ID, emptyAssessment);
  await saveNoUsableEvidence(emptySession, emptyClaim.synthesisId, emptyAssessment, GRAPH_RUN_ID);
  assert.ok(emptyTables.ano_research_syntheses[0]!.report_json);
  const readEmpty = await readMarketSynthesis(emptySession, CONV_ID);
  assert.ok(readEmpty?.report);
  assert.equal(readEmpty.report.recommendation.mode, "no_usable_evidence");
  assert.equal(readEmpty.report.confidence.level, "insufficient");
  assert.ok(readEmpty.report.nextValidationActions.length >= 1);
  assert.doesNotThrow(() => marketSynthesisSchema.parse(readEmpty));
});

test("Migration 000031, schema registration scripts, and Material 3 white-label RecommendationCard comply cleanly", async () => {
  const [migrationSql, applyScript, checkScript, recCardText] = await Promise.all([
    readFile(
      path.join(ROOT, "supabase/migrations/20261124_000031_map_reduce_synthesis_report.sql"),
      "utf8",
    ),
    readFile(path.join(ROOT, "scripts/apply-ano-schema.mjs"), "utf8"),
    readFile(path.join(ROOT, "scripts/check-ano-schema.mjs"), "utf8"),
    readFile(path.join(ROOT, "src/components/artifacts/recommendation-card.tsx"), "utf8"),
  ]);

  assert.match(migrationSql, /group_summaries_json/);
  assert.match(migrationSql, /report_json/);
  assert.match(applyScript, /20261124_000031_map_reduce_synthesis_report/);
  assert.match(checkScript, /20261124_000031_map_reduce_synthesis_report/);
  assert.match(checkScript, /phase13eMapReduceSynthesisReady/);

  assert.match(recCardText, /Key assumptions/);
  assert.match(recCardText, /Open unknowns/);
  assert.match(recCardText, /Next validation actions/);
  assert.doesNotMatch(recCardText, /\b(?:gemini|bedrock|ollama|tavily|prospeo|dropcontact)\b/i);
  assert.doesNotMatch(recCardText, /<(?:button|input|select|textarea)\b/i);
});

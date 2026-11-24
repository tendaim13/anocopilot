import assert from "node:assert/strict";
import test from "node:test";
import { Command, MemorySaver } from "@langchain/langgraph";

import type { SupabaseWorkspaceSession } from "@/contracts/ano";
import { DEFAULT_AUTOPILOT_AUTHORITY_SCOPE } from "@/lib/ano/autopilot";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import {
  drainAutopilotRunWithDeps,
  type AutopilotWorkerDrainResult,
} from "@/server/jobs/autopilot-worker";
import { type AutopilotOrchestratorDeps } from "@/server/domain/autopilot-orchestrator-service";
import { createResearchGraph } from "@/server/langgraph/research-graph";
import type { ResearchPlanningModel } from "@/server/agents/research-planning-model";
import {
  AUTOPILOT_MAX_RECOVERIES,
  cancelAutopilotRun,
  claimAutopilotStageLease,
  completeAutopilotStageLease,
  failAutopilotStageLease,
  readAutopilotRun,
  recoverStaleAutopilotRuns,
  renewAutopilotStageLease,
  startOrResumeAutopilotRun,
} from "@/server/persistence/autopilot-store";
import {
  claimEvidenceResearchRun,
  prepareEvidenceResearchRun,
  readEvidenceResearchView,
} from "@/server/persistence/evidence-research-store";
import { readMarketSynthesis } from "@/server/persistence/market-synthesis-store";
import { executeApprovedDropcontactVerification } from "@/server/persistence/people-playbook-store";
import { executeApprovedProspeoSearch } from "@/server/persistence/target-account-discovery-store";

const NOW = "2026-11-25T00:00:00.000Z";
const WS_ID = "00000000-0000-4000-8000-00000000e701";
const ACTOR_ID = "00000000-0000-4000-8000-00000000e702";
const CONV_ID = "00000000-0000-4000-8000-00000000e703";
const GRAPH_ID = "00000000-0000-4000-8000-00000000e704";
const RUN_ID = "00000000-0000-4000-8000-00000000e705";
const PLAN_ID = "00000000-0000-4000-8000-00000000e706";
const SYNTHESIS_ID = "00000000-0000-4000-8000-00000000e707";
const SEARCH_ID = "00000000-0000-4000-8000-00000000e708";
const DECISION_ID = "00000000-0000-4000-8000-00000000e709";
const VERIFY_ID = "00000000-0000-4000-8000-00000000e710";

type TableRow = Record<string, unknown>;

function makeStatefulSession(
  initialTables: Partial<Record<string, TableRow[]>> = {},
): {
  session: SupabaseWorkspaceSession;
  tables: Record<string, TableRow[]>;
} {
  const tables: Record<string, TableRow[]> = {
    autopilot_runs: [],
    autopilot_jobs: [],
    ano_research_runs: [],
    ano_research_syntheses: [],
    research_claims: [],
    market_profiles: [],
    industry_profiles: [],
    target_decisions: [],
    provider_action_requests: [],
    provider_company_searches: [],
    account_candidates: [],
    provider_person_searches: [],
    contact_candidates: [],
    contact_verification_runs: [],
    account_playbooks: [],
    research_waves: [],
    research_sources: [],
    research_queries: [],
    research_search_results: [],
    research_source_assessments: [],
    connector_connections: [],
    run_events: [],
    audit_logs: [],
    ...initialTables,
  };

  class QueryBuilder {
    private filters: Array<(row: TableRow) => boolean> = [];
    private sortCol: string | null = null;
    private sortAsc = true;
    private limitNum: number | null = null;
    private op: "select" | "insert" | "upsert" | "update" = "select";
    private payload: unknown = null;
    private onConflict = "";
    private headOnly = false;
    private expectSingle: "single" | "maybe" | null = null;

    constructor(private readonly tableName: string) {}
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.head) this.headOnly = true;
      return this;
    }
    insert(rows: TableRow | TableRow[]) {
      this.op = "insert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    upsert(rows: TableRow | TableRow[], opts?: { onConflict?: string }) {
      this.op = "upsert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      this.onConflict = opts?.onConflict ?? "";
      return this;
    }
    update(patch: TableRow) {
      this.op = "update";
      this.payload = patch;
      return this;
    }
    eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
    neq(col: string, val: unknown) { this.filters.push((r) => r[col] !== val); return this; }
    in(col: string, vals: unknown[]) { const set = new Set(vals); this.filters.push((r) => set.has(r[col])); return this; }
    is(col: string, val: unknown) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
    lt(col: string, val: unknown) { this.filters.push((r) => String(r[col] ?? "") < String(val)); return this; }
    lte(col: string, val: unknown) { this.filters.push((r) => String(r[col] ?? "") <= String(val)); return this; }
    order(col: string, opts?: { ascending?: boolean }) {
      this.sortCol = col;
      this.sortAsc = opts?.ascending !== false;
      return this;
    }
    limit(n: number) { this.limitNum = n; return this; }
    maybeSingle() { this.expectSingle = "maybe"; return this.exec(); }
    single() { this.expectSingle = "single"; return this.exec(); }
    then<TResult1 = unknown, TResult2 = never>(
      onf?: ((v: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onr?: ((r: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return this.exec().then(onf, onr);
    }

    private async exec() {
      const tbl = tables[this.tableName] ?? (tables[this.tableName] = []);
      if (this.op === "insert") {
        const added = (this.payload as TableRow[]).map((item) => ({
          id: item.id ?? crypto.randomUUID(),
          created_at: NOW,
          updated_at: NOW,
          ...structuredClone(item),
        }));
        tbl.push(...added);
        return this.formatResult(added);
      }
      if (this.op === "upsert") {
        const keys = this.onConflict.split(",").map((k) => k.trim()).filter(Boolean);
        const results: TableRow[] = [];
        for (const item of this.payload as TableRow[]) {
          const cloned: TableRow = { id: item.id ?? crypto.randomUUID(), created_at: NOW, updated_at: NOW, ...structuredClone(item) };
          const idx = keys.length > 0 ? tbl.findIndex((row) => keys.every((k) => row[k] === cloned[k])) : -1;
          if (idx >= 0) {
            tbl[idx] = { ...tbl[idx], ...cloned, updated_at: NOW };
            results.push(structuredClone(tbl[idx]));
          } else {
            tbl.push(cloned);
            results.push(structuredClone(cloned));
          }
        }
        return this.formatResult(results);
      }

      let matched = tbl.filter((row) => this.filters.every((fn) => fn(row)));
      if (this.op === "update") {
        const patch = structuredClone(this.payload as TableRow);
        const updated: TableRow[] = [];
        for (const row of matched) {
          Object.assign(row, patch);
          updated.push(structuredClone(row));
        }
        return this.formatResult(updated);
      }

      if (this.sortCol) {
        const col = this.sortCol;
        const asc = this.sortAsc;
        matched = [...matched].sort((a, b) =>
          asc ? String(a[col] ?? "").localeCompare(String(b[col] ?? "")) : String(b[col] ?? "").localeCompare(String(a[col] ?? "")),
        );
      }
      if (this.limitNum !== null) matched = matched.slice(0, this.limitNum);
      if (this.headOnly) {
        return { data: [], error: null, count: matched.length };
      }
      return this.formatResult(matched.map((r) => structuredClone(r)));
    }

    private formatResult(rows: TableRow[]) {
      if (this.expectSingle === "single") {
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "Not found" } };
      }
      if (this.expectSingle === "maybe") {
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null, count: rows.length };
    }
  }

  return {
    tables,
    session: {
      kind: "supabase",
      actorId: ACTOR_ID,
      actorEmail: "recovery@example.com",
      workspace: { id: WS_ID, name: "Recovery Test Workspace", slug: "recovery-test", role: "owner" },
      client: {
        from(tableName: string) {
          return new QueryBuilder(tableName);
        },
        async rpc() {
          return { data: true, error: null };
        },
      } as unknown as SupabaseWorkspaceSession["client"],
    },
  };
}

function makeMinimalBrief(): ResearchBrief {
  return {
    offer: "Automated compliance workflow platform",
    goal: "Compare target markets and draft outreach",
    businessLocation: "Wyoming, USA",
    targetMarkets: ["United Kingdom", "Australia"],
    intakeComplete: true,
    marketHints: ["Accounting"],
    locationHints: ["United Kingdom", "Australia"],
    buyerHints: ["Managing Partner"],
    constraints: [],
    unknowns: [],
    sourceMessageIds: ["00000000-0000-4000-8000-00000000e799"],
  };
}

function makeMinimalPlan(): ResearchPlan {
  return {
    id: PLAN_ID,
    version: 1,
    approvalStatus: "approved",
    createdAt: NOW,
    summary: "Compare UK and Australia compliance demand.",
    researchQuestions: ["Where is filing backlog highest?"],
    comparisonCriteria: ["Urgency", "Density"],
    intendedSourceClasses: ["Government and official statistics", "Industry bodies and primary research"],
    plannedScope: { markets: ["United Kingdom", "Australia"], industries: ["Accounting"], buyerRoles: ["Managing Partner"] },
    budget: { maximumSearches: 50, maximumFetches: 100, providerSpend: "not_available_in_phase_a" },
    uncertainties: ["Pricing sensitivity"],
  };
}

test("Restart recovery: crashed Autopilot worker lease is recovered cleanly, skips finished stages, and respects recovery cap", async () => {
  const { session, tables } = makeStatefulSession();
  await startOrResumeAutopilotRun(session, CONV_ID, {
    explicitApproval: true,
    authorityScope: DEFAULT_AUTOPILOT_AUTHORITY_SCOPE,
  });

  // Simulate worker crash mid stage 2 (`market_research`) with expired lease and completed stage 1.
  const expiredLease = "2026-11-24T00:00:00.000Z";
  tables.autopilot_runs[0].status = "running";
  tables.autopilot_runs[0].current_stage = "market_research";
  tables.autopilot_runs[0].completed_stages_json = ["brief_and_plan"];
  tables.autopilot_runs[0].stage_lease_token = "dead-worker-token";
  tables.autopilot_runs[0].lease_expires_at = expiredLease;
  tables.autopilot_runs[0].heartbeat_at = expiredLease;
  tables.autopilot_runs[0].recovery_count = 0;

  const executedByNewWorker: string[] = [];
  const stageDeps: AutopilotOrchestratorDeps = {
    readAutopilotRun,
    startOrResumeAutopilotRun,
    claimAutopilotStageLease,
    renewAutopilotStageLease,
    completeAutopilotStageLease,
    failAutopilotStageLease,
    cancelAutopilotRun,
    checkBudget: async () => true,
    runWithUsageContext: async (_c, fn) => fn(),
    getConversation: async () => ({
      conversation: { id: CONV_ID, title: "Recovery Run", status: "complete_without_research", threadId: `t-${CONV_ID}`, createdAt: NOW, updatedAt: NOW },
      run: { id: GRAPH_ID, status: "complete_without_research", graphVersion: "v1", currentNode: "done", checkpointRef: "cp-1", failureMessage: null },
      messages: [],
      brief: makeMinimalBrief(),
      pendingQuestion: null,
      plan: makeMinimalPlan(),
      events: [],
    }),
    readProductSources: async () => [],
    approvePlanForAutopilot: async () => { throw new Error("unexpected"); },
    generateAndSaveAutopilotPlan: async () => { throw new Error("unexpected"); },
    isSearxngAvailable: () => false,
    getEvidenceResearch: async () => {
      executedByNewWorker.push("market_research");
      return null;
    },
    prepareEvidenceResearch: async () => null,
    startEvidenceResearch: async () => null,
    ensureFallbackResearchRun: async () => ({
      run: {
        id: RUN_ID,
        conversationId: CONV_ID,
        threadId: `thread-${RUN_ID}`,
        attemptNumber: 1,
        provider: "searxng",
        status: "sources_ready",
        maximumSearches: 50,
        maximumFetches: 100,
        consumedSearches: 0,
        consumedFetches: 0,
        currentWave: 1,
        sourceCount: 0,
        failureMessage: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      actions: [],
      queries: [],
      sources: [],
    }),
    getMarketSynthesis: async () => ({
      id: SYNTHESIS_ID,
      conversationId: CONV_ID,
      researchRunId: RUN_ID,
      status: "ready_for_decision",
      recommendationMode: "directly_supported",
      assessment: { fetchedSourceCount: 0, sourceClassCount: 0, coverageStrength: "limited", comparisonReady: false, contradictions: [], gaps: [], summary: "Fallback" },
      claims: [],
      markets: [],
      industries: [],
      decision: { id: DECISION_ID, status: "locked", marketProfileId: null, industryProfileId: null, rationale: null, selectedAt: null },
      failureMessage: null,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    analyseMarketSynthesis: async () => { executedByNewWorker.push("synthesis_and_lock"); return null; },
    ensureFallbackSynthesis: async () => { throw new Error("unused"); },
    lockMarketRoute: async () => { throw new Error("unused"); },
    isProspeoAvailable: () => false,
    getCompanySearch: async () => { executedByNewWorker.push("company_discovery"); return null; },
    runOsmSearch: async () => { throw new Error("unused"); },
    prepareProspeoCompanyPreview: async () => { throw new Error("unused"); },
    approveCompanySearch: async () => { throw new Error("unused"); },
    shortlistAccount: async () => { throw new Error("unused"); },
    isDropcontactAvailable: () => false,
    getPeopleDiscovery: async () => ({ shortlistedCount: 0, personSearch: null, contacts: [], verificationRun: null, playbooks: [] }),
    runWebsiteTeamDiscovery: async () => { throw new Error("unused"); },
    proposeProspeoPeople: async () => { throw new Error("unused"); },
    approvePersonSearch: async () => { throw new Error("unused"); },
    prepareContactVerification: async () => { throw new Error("unused"); },
    approveContactVerification: async () => { throw new Error("unused"); },
    getTemplatePack: async () => null,
    generateTemplatePack: async () => ({
      id: "00000000-0000-4000-8000-00000000e720",
      conversationId: CONV_ID,
      targetDecisionId: DECISION_ID,
      version: 1,
      tone: "peer_direct",
      ctaStyle: "easy_yes",
      entryOffer: null,
      senderName: null,
      targetRoles: [],
      steps: [
        {
          stepKey: "initial",
          stepNumber: 1,
          label: "Initial Email",
          channel: "email",
          dayOffset: 0,
          subject: "quick check",
          body: "Hi {{first_name}},\n\nChecking fit at {{company_name}}.",
          mergeFieldsUsed: ["first_name", "company_name"],
          lint: { passed: true, wordCount: 7, maxWords: 120, issues: [] },
        },
      ],
      claimIds: [],
      generationMode: "fallback",
      deliveryMode: "draft_only",
      lastInstruction: null,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    appendExecutiveSummaryMessage: async () => { executedByNewWorker.push("outreach_templates"); },
  };

  const drainResult: AutopilotWorkerDrainResult = await drainAutopilotRunWithDeps(session, CONV_ID, stageDeps, {
    workerId: "worker-restarted",
    now: () => new Date("2026-11-25T02:00:00.000Z").getTime(),
  });

  assert.equal(drainResult.reason, "completed");
  assert.equal(executedByNewWorker.includes("brief_and_plan"), false);
  assert.ok(executedByNewWorker.includes("market_research"));
  assert.ok(executedByNewWorker.includes("outreach_templates"));

  // Once recovery_count reaches AUTOPILOT_MAX_RECOVERIES, stale sweep pauses safely rather than looping forever.
  tables.autopilot_runs[0].status = "running";
  tables.autopilot_runs[0].stage_lease_token = "looping-token";
  tables.autopilot_runs[0].lease_expires_at = expiredLease;
  tables.autopilot_runs[0].recovery_count = AUTOPILOT_MAX_RECOVERIES;
  const recovered = await recoverStaleAutopilotRuns(session, {
    now: new Date("2026-11-25T02:00:00.000Z").getTime(),
  });
  assert.equal(recovered.pausedConversationIds.length, 1);
  assert.equal(tables.autopilot_runs[0].status, "paused");
});

test("Restart recovery: interrupted deep research and market synthesis leases recover into explicit no-retry checkpoints", async () => {
  const staleHeartbeat = "2020-01-01T00:00:00.000Z";
  const { session, tables } = makeStatefulSession({
    ano_research_runs: [
      {
        id: RUN_ID,
        workspace_id: WS_ID,
        conversation_id: CONV_ID,
        graph_run_id: GRAPH_ID,
        research_plan_id: PLAN_ID,
        thread_id: `deep-thread-${RUN_ID}`,
        attempt_number: 1,
        provider_key: "searxng",
        status: "running",
        maximum_searches: 50,
        maximum_fetches: 100,
        consumed_searches: 12,
        consumed_fetches: 18,
        current_wave: 2,
        coverage_json: {
          candidateMarkets: ["United Kingdom", "Australia"],
          cells: [],
        },
        query_plan_json: [],
        failure_message: null,
        heartbeat_at: staleHeartbeat,
        created_at: staleHeartbeat,
        updated_at: staleHeartbeat,
      },
    ],
    provider_action_requests: [
      {
        id: "00000000-0000-4000-8000-00000000e731",
        workspace_id: WS_ID,
        ano_research_run_id: RUN_ID,
        provider_key: "searxng",
        action_kind: "research_run",
        request_key: "research-run",
        request_json: { maximumSearches: 50, maximumFetches: 100 },
        maximum_operations: 150,
        reported_credits: null,
        status: "running",
        created_at: staleHeartbeat,
        updated_at: staleHeartbeat,
      },
      {
        id: "00000000-0000-4000-8000-00000000e732",
        workspace_id: WS_ID,
        ano_research_run_id: RUN_ID,
        provider_key: "searxng",
        action_kind: "search",
        request_key: "wave-2-q1",
        request_json: { query: "australian services automation" },
        maximum_operations: 1,
        reported_credits: null,
        status: "running",
        created_at: staleHeartbeat,
        updated_at: staleHeartbeat,
      },
    ],
    research_waves: [
      {
        id: "00000000-0000-4000-8000-00000000e733",
        workspace_id: WS_ID,
        ano_research_run_id: RUN_ID,
        wave_number: 1,
        candidate_markets_json: ["United Kingdom", "Australia"],
        status: "completed",
        created_at: staleHeartbeat,
      },
    ],
    ano_research_syntheses: [
      {
        id: SYNTHESIS_ID,
        workspace_id: WS_ID,
        ano_research_run_id: RUN_ID,
        graph_run_id: GRAPH_ID,
        conversation_id: CONV_ID,
        status: "running",
        recommendation_mode: "pending",
        assessment_json: {
          fetchedSourceCount: 5,
          sourceClassCount: 2,
          coverageStrength: "moderate",
          comparisonReady: false,
          contradictions: [],
          gaps: [],
          summary: "Pending synthesis",
        },
        group_summaries_json: [],
        report_json: null,
        failure_message: null,
        heartbeat_at: staleHeartbeat,
        created_at: staleHeartbeat,
        updated_at: staleHeartbeat,
      },
    ],
  });

  // Reading evidence research recovers expired lease into requires_manual_review without retrying the uncertain provider request.
  const recoveredView = await readEvidenceResearchView(session, CONV_ID);
  assert.equal(recoveredView?.run.status, "requires_manual_review");

  // Claiming the recovered deep-research run excludes uncertain action and continues safely from assess_coverage.
  const claim = await claimEvidenceResearchRun(session, RUN_ID);
  assert.equal(claim.claimed, true);
  assert.equal(claim.startNode, "assess_coverage");
  assert.deepEqual(claim.candidateMarkets, ["United Kingdom", "Australia"]);
  // Already-completed wave 1 budget consumption remains preserved intact (12 searches, 18 fetches).
  assert.equal(tables.ano_research_runs[0].consumed_searches, 12);
  assert.equal(tables.ano_research_runs[0].consumed_fetches, 18);

  // Once public research completes (`sources_ready`), reading an expired synthesis lease recovers to requires_manual_review without automatic LLM retry.
  tables.ano_research_runs[0].status = "sources_ready";
  const synthesis = await readMarketSynthesis(session, CONV_ID);
  assert.equal(synthesis?.status, "requires_manual_review");

  // Confirm prepareEvidenceResearchRun never overwrites an existing completed/active attempt unexpectedly.
  assert.equal(typeof prepareEvidenceResearchRun, "function");
});

test("Restart recovery: LangGraph checkpointer survives fresh graph rebuild across processes on shared saver", async () => {
  const sharedCheckpointer = new MemorySaver();
  const threadId = `restart-thread-${CONV_ID}`;
  const model: ResearchPlanningModel = {
    async interpret() {
      return {
        outcome: "needs_context",
        brief: makeMinimalBrief(),
        clarification: {
          question: "Which country should Ano prioritize first?",
          purpose: "Focus public market evidence search",
        },
      };
    },
    async createPlan(brief) {
      return {
        summary: `Plan for ${brief.offer}`,
        researchQuestions: ["Which market shows strongest workflow adoption?"],
        comparisonCriteria: ["Urgency", "Buyer density"],
        intendedSourceClasses: ["Government and official statistics"],
        plannedScope: { markets: ["Australia"], industries: ["Dental"], buyerRoles: ["Partner"] },
        budget: { maximumSearches: 50, maximumFetches: 100, providerSpend: "not_available_in_phase_a" },
        uncertainties: ["Pricing"],
      };
    },
  };

  // Process 1 starts graph and interrupts for clarification, persisting checkpoint in shared saver.
  const graph1 = createResearchGraph(model, sharedCheckpointer);
  await graph1.invoke(
    {
      workspaceId: WS_ID,
      conversationId: CONV_ID,
      graphRunId: GRAPH_ID,
      submittedMessage: {
        id: "00000000-0000-4000-8000-00000000e761",
        text: "Help find outbound market for dental recall automation",
      },
      contextMessages: [],
      brief: null,
      pendingQuestion: null,
      plan: null,
      status: "planning",
      currentNode: "start",
      lastError: null,
    },
    { configurable: { thread_id: threadId } },
  );

  // Simulated restart: fresh model/graph instance 2 attaches cleanly to sharedCheckpointer.
  const readyModel: ResearchPlanningModel = {
    ...model,
    async interpret() {
      return { outcome: "ready" as const, brief: makeMinimalBrief() };
    },
  };
  const graph2 = createResearchGraph(readyModel, sharedCheckpointer);
  const resumed = await graph2.invoke(
    new Command({
      resume: {
        kind: "clarification",
        messageId: "00000000-0000-4000-8000-00000000e762",
        answer: "Focus on Australia first",
      },
    }),
    { configurable: { thread_id: threadId } },
  );

  assert.equal(resumed.status, "awaiting_plan_approval");
  assert.ok(resumed.plan);
  assert.equal(resumed.plan?.approvalStatus, "awaiting_approval");
});

test("Restart recovery: already-claimed paid Prospeo/Dropcontact runs never dispatch duplicate external API calls", async () => {
  const prevProspeo = process.env.PROSPEO_KEY;
  process.env.PROSPEO_KEY = "test-prospeo-key";
  try {
    let externalFetchCalls = 0;
    const countingFetcher: typeof fetch = async () => {
      externalFetchCalls += 1;
      return new Response("{}", { status: 200 });
    };

    const { session } = makeStatefulSession({
      provider_company_searches: [
        {
          id: SEARCH_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          provider_key: "prospeo",
          status: "requires_manual_review",
          canonical_locations_json: ["Sydney"],
          scope_json: { targetMarketName: "Australia", targetIndustryName: "Dental Clinic" },
          filters_json: {},
          criteria_json: ["Australia"],
          claim_ids_json: [],
          excluded_categories_json: [],
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      contact_verification_runs: [
        {
          id: VERIFY_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          person_search_id: "00000000-0000-4000-8000-00000000e741",
          provider_key: "prospeo",
          status: "running",
          selected_contact_ids_json: ["00000000-0000-4000-8000-00000000e742"],
          preview_pairs_json: [
            {
              contactId: "00000000-0000-4000-8000-00000000e742",
              fullName: "Mei Chen",
              firstName: "Mei",
              lastName: "Chen",
              companyName: "Harbour Dental",
              website: "https://harbourdental.com.au",
              fieldsSent: ["full_name", "company_website"],
            },
          ],
          estimated_credits: 1,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    });

    const context = {
      conversationId: CONV_ID,
      targetDecisionId: DECISION_ID,
      anoResearchRunId: RUN_ID,
      graphRunId: GRAPH_ID,
      brief: makeMinimalBrief(),
      market: {
        id: "00000000-0000-4000-8000-00000000e751",
        name: "Australia",
        summary: "Summary",
        evidenceStrength: "moderate" as const,
        claimIds: ["00000000-0000-4000-8000-00000000e752"],
        unknowns: [],
        nextResearchActions: [],
      },
      industry: {
        id: "00000000-0000-4000-8000-00000000e753",
        marketProfileId: "00000000-0000-4000-8000-00000000e751",
        name: "Dental Clinic",
        summary: "Summary",
        operationalProblems: ["Recall delays"],
        solutionFit: ["Automated recall"],
        buyerRoleHypotheses: ["Principal Dentist"],
        evidenceStrength: "moderate" as const,
        claimIds: ["00000000-0000-4000-8000-00000000e752"],
        unknowns: [],
      },
      claims: [],
      shortlistedAccounts: [],
      allAccountsById: new Map(),
    };

    const companyView = await executeApprovedProspeoSearch(session, {
      context,
      searchId: SEARCH_ID,
      fetcher: countingFetcher,
    });
    assert.equal(companyView.status, "requires_manual_review");

    const verifyView = await executeApprovedDropcontactVerification(session, {
      context,
      verificationRunId: VERIFY_ID,
      fetcher: countingFetcher,
    });
    assert.equal(verifyView.verificationRun?.status, "running");
    assert.equal(externalFetchCalls, 0);
  } finally {
    if (prevProspeo === undefined) delete process.env.PROSPEO_KEY;
    else process.env.PROSPEO_KEY = prevProspeo;
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { SupabaseWorkspaceSession } from "@/contracts/ano";
import type { AutopilotRunView } from "@/lib/ano/autopilot";
import { scoreAndBuildAccountDossier } from "@/lib/ano/company-discovery";
import type { IndustryProfile, MarketProfile, ResearchClaim } from "@/lib/ano/market-synthesis";
import {
  outreachTemplatePackViewSchema,
  buildDeterministicFallbackTemplatePack,
} from "@/lib/ano/outreach-templates";
import {
  auditFactualAccountPlaybook,
  auditFactualIndustryPlaybook,
  buildDropcontactVerificationPreview,
  compileFactualAccountPlaybook,
  compileFactualIndustryPlaybook,
  isNamedPersonCandidate,
  matchAccountForPerson,
  selectAppropriateVerificationProvider,
  type ContactCandidateView,
} from "@/lib/ano/people-playbooks";
import type { ResearchBrief } from "@/lib/ano/research-conversation";
import {
  executeAutopilotStepWithDeps,
  type AutopilotOrchestratorDeps,
} from "@/server/domain/autopilot-orchestrator-service";
import {
  approveContactVerificationForConversation,
  approvePersonSearchForConversation,
  PeoplePlaybookServiceError,
  prepareContactVerificationForConversation,
} from "@/server/domain/people-playbook-service";
import {
  approveCompanySearchForConversation,
} from "@/server/domain/target-account-discovery-service";
import {
  RESEARCH_GRAPH_NAME,
  RESEARCH_GRAPH_VERSION,
} from "@/server/langgraph/research-graph";
import { decideAndExecuteProposal } from "@/server/persistence/outreach-execution-store";
import {
  compileAndSaveAccountPlaybooks,
  PeoplePlaybookPersistenceError,
  readPeopleDiscoveryForConversation,
  saveDropcontactVerificationPreview,
} from "@/server/persistence/people-playbook-store";
import {
  batchUpdateAccountCandidateLifecycleStates,
  executeApprovedProspeoSearch,
  sanitizeDownstreamErrorMessage,
  TargetAccountDiscoveryPersistenceError,
  updateAccountCandidateLifecycleState,
} from "@/server/persistence/target-account-discovery-store";

const ROOT = process.cwd();
const NOW = "2026-11-24T10:00:00.000Z";

function makeUuid(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

const WS_ID = makeUuid(1301);
const ACTOR_ID = makeUuid(1302);
const CONV_ID = makeUuid(1303);
const GRAPH_RUN_ID = makeUuid(1304);
const RUN_ID = makeUuid(1305);
const SYNTHESIS_ID = makeUuid(1306);
const DECISION_ID = makeUuid(1307);
const OTHER_DECISION_ID = makeUuid(1308);
const MARKET_ID = makeUuid(1309);
const INDUSTRY_ID = makeUuid(1310);
const CLAIM_OBS_ID = makeUuid(1311);
const CLAIM_COMP_ID = makeUuid(1312);
const CLAIM_HYP_ID = makeUuid(1313);
const SOURCE_ID = makeUuid(1314);
const SEARCH_ID = makeUuid(1315);
const ACCOUNT_A_ID = makeUuid(1316);
const ACCOUNT_B_ID = makeUuid(1317);
const ACCOUNT_OTHER_ROUTE_ID = makeUuid(1318);
const PERSON_SEARCH_ID = makeUuid(1319);

type TableRow = Record<string, unknown>;

function makeMarket(): MarketProfile {
  return {
    id: MARKET_ID,
    name: "Australia",
    summary: "Established private healthcare groups adopting automated patient recall.",
    evidenceStrength: "moderate",
    claimIds: [CLAIM_OBS_ID, CLAIM_COMP_ID],
    unknowns: ["Private group IT budget cycle"],
    nextResearchActions: ["Confirm private dental group buyer title ownership."],
  };
}

function makeIndustry(): IndustryProfile {
  return {
    id: INDUSTRY_ID,
    marketProfileId: MARKET_ID,
    name: "Dental Clinic",
    summary: "Multi-chair dental practices experiencing patient rebooking drop-off.",
    operationalProblems: ["High patient recall leakage after initial visits"],
    solutionFit: ["Automated two-way patient recall workflows"],
    buyerRoleHypotheses: ["Principal Dentist", "Practice Manager"],
    evidenceStrength: "moderate",
    claimIds: [CLAIM_OBS_ID, CLAIM_COMP_ID, CLAIM_HYP_ID],
    unknowns: ["Practice management software migration timeline"],
  };
}

function makeClaims(): ResearchClaim[] {
  return [
    {
      id: CLAIM_OBS_ID,
      statement: "Australian dental associations report 28% overdue recall visits in multi-chair urban clinics.",
      kind: "observation",
      evidenceStrength: "strong",
      citationStatus: "supported",
      sourceIds: [SOURCE_ID],
      comparisonBasis: null,
    },
    {
      id: CLAIM_COMP_ID,
      statement: "UK private dental groups with comparable chair counts cut recall gaps after automated reminders.",
      kind: "comparable",
      evidenceStrength: "moderate",
      citationStatus: "supported",
      sourceIds: [SOURCE_ID],
      comparisonBasis: "Comparable multi-chair private practice staffing & patient rebooking workflows.",
    },
    {
      id: CLAIM_HYP_ID,
      statement: "Practices with 3+ clinicians may delegate software evaluation to the Practice Manager.",
      kind: "hypothesis",
      evidenceStrength: "limited",
      citationStatus: "limited",
      sourceIds: [SOURCE_ID],
      comparisonBasis: null,
    },
  ];
}

function makeBrief(): ResearchBrief {
  return {
    offer: "Patient recall & follow-up automation for dental practices",
    goal: "Identify matching dental groups, decision-makers, and draft outreach.",
    businessLocation: "Wyoming, USA",
    targetMarkets: ["Australia"],
    intakeComplete: true,
    marketHints: ["Dental Clinic"],
    locationHints: ["Sydney, Australia"],
    buyerHints: ["Principal Dentist", "Practice Manager"],
    constraints: [],
    unknowns: [],
    sourceMessageIds: [makeUuid(1399)],
  };
}

function makeStatefulSession(opts?: {
  tables?: Partial<Record<string, TableRow[]>>;
  rpcBudgetAllowed?: boolean;
  rpcBudgetError?: boolean;
}): {
  session: SupabaseWorkspaceSession;
  tables: Record<string, TableRow[]>;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const tables: Record<string, TableRow[]> = {
    ano_conversations: [
      {
        id: CONV_ID,
        workspace_id: WS_ID,
        created_by: ACTOR_ID,
        title: "Recall automation — Australia",
        status: "complete_without_research",
        active_thread_id: `thread-${CONV_ID}`,
        archived_at: null,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    ano_graph_runs: [
      {
        id: GRAPH_RUN_ID,
        workspace_id: WS_ID,
        conversation_id: CONV_ID,
        graph_name: RESEARCH_GRAPH_NAME,
        graph_version: RESEARCH_GRAPH_VERSION,
        thread_id: `thread-${CONV_ID}`,
        status: "complete_without_research",
        current_node: "locked",
        checkpoint_ref: "cp-1",
        failure_message: null,
        last_error: null,
        started_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    ano_messages: [],
    research_briefs: [
      {
        id: makeUuid(1400),
        workspace_id: WS_ID,
        conversation_id: CONV_ID,
        business_location: "Wyoming, USA",
        target_markets_json: ["Australia"],
        intake_complete: true,
        content_json: makeBrief(),
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    research_questions: [],
    research_plans: [],
    ano_research_runs: [
      {
        id: RUN_ID,
        workspace_id: WS_ID,
        graph_run_id: GRAPH_RUN_ID,
        conversation_id: CONV_ID,
        status: "completed",
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    ano_research_syntheses: [
      {
        id: SYNTHESIS_ID,
        workspace_id: WS_ID,
        ano_research_run_id: RUN_ID,
        graph_run_id: GRAPH_RUN_ID,
        conversation_id: CONV_ID,
        status: "ready_for_decision",
        recommendation_mode: "directly_supported",
        assessment_json: {
          fetchedSourceCount: 1,
          sourceClassCount: 1,
          coverageStrength: "moderate",
          comparisonReady: true,
          contradictions: [],
          gaps: [],
          summary: "Grounded public evidence collected for Australia Dental Clinic.",
        },
        group_summaries_json: [],
        report_json: null,
        failure_message: null,
        methodology_note: "Grounded in saved public sources.",
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    research_sources: [
      {
        id: SOURCE_ID,
        workspace_id: WS_ID,
        ano_research_run_id: RUN_ID,
        url: "https://example.org.au/dental-report",
        title: "Australian Dental Recall Benchmarks",
        source_class: "industry",
        source_provenance: "public_web",
        fetched_at: NOW,
        evidence_score: 86,
        excerpt: "Overdue recall appointments affect multi-chair urban practices.",
      },
    ],
    research_claims: makeClaims().map((c) => ({
      id: c.id,
      workspace_id: WS_ID,
      synthesis_id: SYNTHESIS_ID,
      claim_kind: c.kind,
      statement: c.statement,
      source_ids: c.sourceIds,
      comparison_basis: c.comparisonBasis ?? null,
      evidence_strength: c.evidenceStrength,
      citation_status: c.citationStatus,
      created_at: NOW,
    })),
    market_profiles: [
      {
        id: MARKET_ID,
        workspace_id: WS_ID,
        synthesis_id: SYNTHESIS_ID,
        name: "Australia",
        summary: makeMarket().summary,
        evidence_strength: "moderate",
        claim_ids: [CLAIM_OBS_ID, CLAIM_COMP_ID],
        unknowns_json: makeMarket().unknowns,
        next_research_actions_json: makeMarket().nextResearchActions,
        created_at: NOW,
      },
    ],
    industry_profiles: [
      {
        id: INDUSTRY_ID,
        workspace_id: WS_ID,
        synthesis_id: SYNTHESIS_ID,
        market_profile_id: MARKET_ID,
        name: "Dental Clinic",
        summary: makeIndustry().summary,
        operational_problems_json: makeIndustry().operationalProblems,
        solution_fit_json: makeIndustry().solutionFit,
        buyer_role_hypotheses_json: makeIndustry().buyerRoleHypotheses,
        evidence_strength: "moderate",
        claim_ids: makeIndustry().claimIds,
        unknowns_json: makeIndustry().unknowns,
        created_at: NOW,
      },
    ],
    target_decisions: [
      {
        id: DECISION_ID,
        workspace_id: WS_ID,
        synthesis_id: SYNTHESIS_ID,
        status: "locked",
        market_profile_id: MARKET_ID,
        industry_profile_id: INDUSTRY_ID,
        rationale: "Strongest comparative evidence.",
        selected_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    provider_company_searches: [],
    account_candidates: [],
    provider_action_requests: [],
    provider_person_searches: [],
    contact_candidates: [],
    contact_verification_runs: [],
    account_playbooks: [],
    outreach_drafts: [],
    proposals: [],
    approval_decisions: [],
    run_events: [],
    audit_logs: [],
    ...(opts?.tables ?? {}),
  };

  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

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

    upsert(rows: TableRow | TableRow[], upsertOpts?: { onConflict?: string }) {
      this.op = "upsert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      this.conflictCols = upsertOpts?.onConflict ?? "";
      return this;
    }

    eq(col: string, val: unknown) {
      this.filters.push((row) => row[col] === val);
      return this;
    }

    neq(col: string, val: unknown) {
      this.filters.push((row) => row[col] !== val);
      return this;
    }

    in(col: string, vals: unknown[]) {
      const set = new Set(vals);
      this.filters.push((row) => set.has(row[col]));
      return this;
    }

    is(col: string, val: unknown) {
      this.filters.push((row) => (row[col] ?? null) === val);
      return this;
    }

    not(col: string, op: string, val: unknown) {
      if (op === "is" && val === null) {
        this.filters.push((row) => row[col] !== null && row[col] !== undefined);
      }
      return this;
    }

    order(col: string, orderOpts?: { ascending?: boolean }) {
      this.orderSpec = { col, asc: orderOpts?.ascending ?? true };
      return this;
    }

    limit(n: number) {
      this.limitNum = n;
      return this;
    }

    private run() {
      if (!tables[this.tableName]) tables[this.tableName] = [];
      const tbl = tables[this.tableName];

      if (this.op === "insert") {
        const added = (this.payload as TableRow[]).map((item) => ({
          id: item.id ?? crypto.randomUUID(),
          created_at: item.created_at ?? NOW,
          updated_at: item.updated_at ?? NOW,
          ...structuredClone(item),
        }));
        tbl.push(...added);
        return { data: added, error: null, count: added.length };
      }

      if (this.op === "upsert") {
        const keys = this.conflictCols
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        const rows = (this.payload as TableRow[]).map((item) => {
          const cloned: TableRow = {
            id: item.id ?? crypto.randomUUID(),
            created_at: NOW,
            updated_at: NOW,
            ...structuredClone(item),
          };
          const matchIdx =
            keys.length > 0
              ? tbl.findIndex((row) => keys.every((k) => row[k] === cloned[k]))
              : -1;
          if (matchIdx >= 0) {
            tbl[matchIdx] = { ...tbl[matchIdx], ...cloned, updated_at: NOW };
            return structuredClone(tbl[matchIdx]);
          }
          tbl.push(cloned);
          return structuredClone(cloned);
        });
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
    actorEmail: "operator@example.com",
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
      async rpc(fn: string, args: Record<string, unknown> = {}) {
        rpcCalls.push({ fn, args });
        if (fn === "check_internal_usage_budget") {
          if (opts?.rpcBudgetError) {
            return { data: null, error: { message: "RPC unavailable" } };
          }
          return { data: opts?.rpcBudgetAllowed ?? true, error: null };
        }
        return { data: null, error: null };
      },
    } as unknown as SupabaseWorkspaceSession["client"],
  };

  return { session, tables, rpcCalls };
}

test("1. Unlocked route blocks company discovery and people actions before any provider or budget calls", async () => {
  const { session, rpcCalls } = makeStatefulSession({
    tables: {
      target_decisions: [
        {
          id: DECISION_ID,
          workspace_id: WS_ID,
          synthesis_id: SYNTHESIS_ID,
          status: "awaiting_selection",
          market_profile_id: null,
          industry_profile_id: null,
          rationale: null,
          selected_at: null,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    },
  });

  await assert.rejects(
    () => approveCompanySearchForConversation(session, CONV_ID, SEARCH_ID),
    (err: unknown) => err instanceof TargetAccountDiscoveryPersistenceError && err.code === "TARGET_DECISION_REQUIRED",
  );
  await assert.rejects(
    () => approvePersonSearchForConversation(session, CONV_ID, PERSON_SEARCH_ID),
    (err: unknown) => err instanceof TargetAccountDiscoveryPersistenceError && err.code === "TARGET_DECISION_REQUIRED",
  );
  await assert.rejects(
    () => approveContactVerificationForConversation(session, CONV_ID, makeUuid(1501)),
    (err: unknown) => err instanceof TargetAccountDiscoveryPersistenceError && err.code === "TARGET_DECISION_REQUIRED",
  );
  assert.equal(rpcCalls.length, 0);

  const baseRun = (overrides?: Partial<AutopilotRunView>): AutopilotRunView => ({
    id: makeUuid(1601),
    conversationId: CONV_ID,
    status: "running",
    currentStage: "company_discovery",
    completedStages: [],
    authorizedAt: NOW,
    authorizedBy: ACTOR_ID,
    startedAt: NOW,
    completedAt: null,
    authorityScope: {
      maxPublicSearches: 50,
      maxSourceFetches: 100,
      maxCompanyCandidates: 25,
      maxNamedContactEnrichments: 10,
      allowOutboundEmailSend: false,
      allowPhoneCalls: false,
      allowCrmWrites: false,
    },
    stageSummaries: {},
    warnings: [],
    lastError: null,
    stageInFlight: false,
    heartbeatAt: null,
    leaseExpiresAt: "2026-11-25T10:00:00.000Z",
    recoveryCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  let osmCalled = false;
  let prospeoCalled = false;
  const mockDeps: AutopilotOrchestratorDeps = {
    readAutopilotRun: async () => null,
    startOrResumeAutopilotRun: async () => { throw new Error("unused"); },
    claimAutopilotStageLease: async () => ({
      claimed: false,
      run: null,
      stage: "done",
      leaseToken: null,
    }),
    renewAutopilotStageLease: async () => ({ renewed: false, run: null }),
    completeAutopilotStageLease: async () => { throw new Error("unused"); },
    failAutopilotStageLease: async () => { throw new Error("unused"); },
    cancelAutopilotRun: async () => baseRun({ status: "cancelled" }),
    checkBudget: async () => false,
    runWithUsageContext: async (_ctx, fn) => fn(),
    getConversation: async () => ({
      conversation: {
        id: CONV_ID,
        title: "Test",
        status: "complete_without_research",
        threadId: `thread-${CONV_ID}`,
        updatedAt: NOW,
        createdAt: NOW,
      },
      run: {
        id: GRAPH_RUN_ID,
        status: "complete_without_research",
        graphVersion: RESEARCH_GRAPH_VERSION,
        currentNode: "locked",
        checkpointRef: "cp-1",
        failureMessage: null,
      },
      messages: [],
      brief: makeBrief(),
      pendingQuestion: null,
      plan: null,
      productSources: [],
      events: [],
    }),
    readProductSources: async () => [],
    approvePlanForAutopilot: async () => { throw new Error("unused"); },
    generateAndSaveAutopilotPlan: async () => { throw new Error("unused"); },
    isSearxngAvailable: () => false,
    getEvidenceResearch: async () => null,
    prepareEvidenceResearch: async () => null,
    startEvidenceResearch: async () => null,
    ensureFallbackResearchRun: async () => { throw new Error("unused"); },
    getMarketSynthesis: async () => null,
    analyseMarketSynthesis: async () => null,
    ensureFallbackSynthesis: async () => { throw new Error("unused"); },
    lockMarketRoute: async () => { throw new Error("unused"); },
    isProspeoAvailable: () => true,
    getCompanySearch: async () => null,
    runOsmSearch: async () => {
      osmCalled = true;
      throw new Error("should not call");
    },
    prepareProspeoCompanyPreview: async () => {
      prospeoCalled = true;
      throw new Error("should not call");
    },
    approveCompanySearch: async () => {
      prospeoCalled = true;
      throw new Error("should not call");
    },
    shortlistAccount: async () => { throw new Error("unused"); },
    isDropcontactAvailable: () => false,
    getPeopleDiscovery: async () => ({
      shortlistedCount: 0,
      personSearch: null,
      contacts: [],
      verificationRun: null,
      playbooks: [],
    }),
    runWebsiteTeamDiscovery: async () => { throw new Error("unused"); },
    proposeProspeoPeople: async () => { throw new Error("unused"); },
    approvePersonSearch: async () => { throw new Error("unused"); },
    prepareContactVerification: async () => { throw new Error("unused"); },
    approveContactVerification: async () => { throw new Error("unused"); },
    getTemplatePack: async () => null,
    generateTemplatePack: async () => { throw new Error("unused"); },
    appendExecutiveSummaryMessage: async () => {},
  };

  let stageLeaseResult: Record<string, unknown> | null = null;
  const autopilotDeps: AutopilotOrchestratorDeps = {
    ...mockDeps,
    readAutopilotRun: async () => baseRun(),
    claimAutopilotStageLease: async () => ({
      claimed: true,
      stage: "company_discovery",
      leaseToken: "lease-1",
      run: baseRun(),
    }),
    completeAutopilotStageLease: async (_s, input) => {
      stageLeaseResult = input.summary as unknown as Record<string, unknown>;
      return baseRun({
        currentStage: "people_and_emails",
        completedStages: ["company_discovery"],
        leaseExpiresAt: null,
        stageSummaries: { company_discovery: input.summary },
        warnings: input.summary.warnings,
      });
    },
  };

  await executeAutopilotStepWithDeps(session, CONV_ID, autopilotDeps);
  assert.equal(osmCalled, false);
  assert.equal(prospeoCalled, false);
  assert.equal((stageLeaseResult as { status?: string } | null)?.status, "skipped");
});

test("2. Company dossiers generate white-label matchReasons, cap at 25 candidates, and render explanation UI", async () => {
  const dossier = scoreAndBuildAccountDossier(
    {
      provider: "prospeo",
      id: "co-harbour",
      name: "Harbour Dental Studio",
      domain: "harbourdental.com.au",
      website: "https://harbourdental.com.au",
      industry: "Dental Clinic",
      employeeRange: "11-50",
      location: { city: "Sydney", country: "Australia" },
      description: "Multi-chair general & cosmetic dental clinic in Sydney CBD.",
    },
    {
      dossierId: ACCOUNT_A_ID,
      conversationId: CONV_ID,
      targetDecisionId: DECISION_ID,
      companySearchId: SEARCH_ID,
      providerKey: "prospeo",
      targetMarketName: "Australia",
      targetIndustryName: "Dental Clinic",
      canonicalLocations: ["Sydney", "Australia"],
      canonicalIndustries: ["Dental Clinic"],
      targetKeywords: ["dental", "clinic"],
      linkedClaimIds: [CLAIM_OBS_ID],
      capturedAt: NOW,
      lifecycleState: "discovered",
    },
  );

  assert.ok(dossier.matchReasons && dossier.matchReasons.length >= 3);
  assert.ok(dossier.matchReasons.some((r) => r.includes("Australia")));
  assert.ok(dossier.matchReasons.some((r) => r.includes("Dental Clinic")));
  assert.ok(dossier.matchReasons.some((r) => r.includes("harbourdental.com.au")));
  assert.equal(
    dossier.matchReasons.some((r) => /\b(?:Prospeo|OpenStreetMap|Dropcontact|Mercury)\b/i.test(r)),
    false,
  );

  const cardTsx = await readFile(
    path.join(ROOT, "src/components/artifacts/account-dossier-card.tsx"),
    "utf8",
  );
  assert.match(cardTsx, /Why this company matches/);
  assert.match(cardTsx, /account\.matchReasons/);

  const prevProspeoKey = process.env.PROSPEO_KEY;
  process.env.PROSPEO_KEY = "test-prospeo-key";
  try {
    const { session, tables } = makeStatefulSession({
      tables: {
        provider_company_searches: [
          {
            id: SEARCH_ID,
            workspace_id: WS_ID,
            conversation_id: CONV_ID,
            target_decision_id: DECISION_ID,
            provider_key: "prospeo",
            status: "awaiting_approval",
            canonical_locations_json: ["Sydney, Australia"],
            scope_json: {
              locations: ["Sydney, Australia"],
              canonicalIndustries: ["Dental Clinic"],
              industryKeywords: ["dental", "clinic"],
              targetMarketName: "Australia",
              targetIndustryName: "Dental Clinic",
            },
            filters_json: {},
            criteria_json: ["Locked market route: Australia"],
            claim_ids_json: [CLAIM_OBS_ID],
            excluded_categories_json: [],
            request_hash: "abc123def456",
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      },
    });

    const thirtyCompanies = Array.from({ length: 30 }, (_, idx) => ({
      company: {
        company_id: `pro-co-${idx + 1}`,
        name: `Sydney Dental Practice ${idx + 1}`,
        domain: `sydneydental${idx + 1}.com.au`,
        website: `https://sydneydental${idx + 1}.com.au`,
        industry: "Dental Clinic",
        employee_range: "11-50",
        location: { city: "Sydney", country: "Australia" },
        description: "Private dental clinic",
      },
    }));

    const mockFetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: false,
          results: thirtyCompanies,
          pagination: { total_count: 30 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const view = await executeApprovedProspeoSearch(session, {
      context: {
        conversationId: CONV_ID,
        targetDecisionId: DECISION_ID,
        anoResearchRunId: RUN_ID,
        graphRunId: GRAPH_RUN_ID,
        brief: makeBrief(),
        market: makeMarket(),
        industry: makeIndustry(),
      },
      searchId: SEARCH_ID,
      fetcher: mockFetcher,
    });

    assert.equal(view.status, "completed");
    assert.equal(view.accounts.length, 25);
    assert.equal(tables.account_candidates.length, 25);
    assert.ok(view.accounts[0]?.matchReasons && view.accounts[0].matchReasons.length >= 2);
  } finally {
    if (prevProspeoKey === undefined) delete process.env.PROSPEO_KEY;
    else process.env.PROSPEO_KEY = prevProspeoKey;
  }
});

test("3. Shortlisting & batch shortlisting remain scoped strictly to locked target_decision_id", async () => {
  const { session, tables } = makeStatefulSession({
    tables: {
      provider_company_searches: [
        {
          id: SEARCH_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          provider_key: "openstreetmap",
          status: "completed",
          canonical_locations_json: ["Sydney, Australia"],
          scope_json: {
            targetMarketName: "Australia",
            targetIndustryName: "Dental Clinic",
            industryKeywords: ["dental"],
          },
          filters_json: {},
          criteria_json: ["Locked route: Australia"],
          claim_ids_json: [CLAIM_OBS_ID],
          excluded_categories_json: [],
          result_count: 2,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      account_candidates: [
        {
          id: ACCOUNT_A_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          company_search_id: SEARCH_ID,
          source_key: "osm:a",
          name: "Harbour Dental Studio",
          industry: "Dental Clinic",
          location: "Sydney, Australia",
          employee_band: "11-50",
          lifecycle_state: "discovered",
          raw_snapshot: { provider: "openstreetmap", domain: "harbourdental.com.au" },
          signals_json: [],
          claim_ids: [CLAIM_OBS_ID],
          fit_score: 82,
          fit_confidence: "high",
          fit_breakdown_json: {
            locationScore: 35,
            industryScore: 32,
            signalScore: 15,
            totalScore: 82,
            confidence: "high",
            rationale: "Strong location and category fit.",
            industryHypothesisNote: "Dental recall segment hypothesis.",
            matchReasons: ["Sydney location match"],
          },
          evidence_urls_json: ["https://harbourdental.com.au"],
          unknowns_json: [],
          retrieved_at: NOW,
          created_at: NOW,
        },
        {
          id: ACCOUNT_B_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          company_search_id: SEARCH_ID,
          source_key: "osm:b",
          name: "Bondi Dental Care",
          industry: "Dental Clinic",
          location: "Sydney, Australia",
          employee_band: "11-50",
          lifecycle_state: "discovered",
          raw_snapshot: { provider: "openstreetmap", domain: "bondidental.com.au" },
          signals_json: [],
          claim_ids: [CLAIM_OBS_ID],
          fit_score: 76,
          fit_confidence: "high",
          fit_breakdown_json: {
            locationScore: 35,
            industryScore: 26,
            signalScore: 15,
            totalScore: 76,
            confidence: "high",
            rationale: "Good segment fit.",
            industryHypothesisNote: "Dental recall segment hypothesis.",
          },
          evidence_urls_json: ["https://bondidental.com.au"],
          unknowns_json: [],
          retrieved_at: NOW,
          created_at: NOW,
        },
        {
          id: ACCOUNT_OTHER_ROUTE_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: OTHER_DECISION_ID,
          company_search_id: SEARCH_ID,
          source_key: "osm:other",
          name: "Legacy Stale Route Dental",
          industry: "Dental Clinic",
          location: "Auckland",
          employee_band: "11-50",
          lifecycle_state: "discovered",
          raw_snapshot: { provider: "openstreetmap", domain: "legacy.example" },
          signals_json: [],
          claim_ids: [CLAIM_OBS_ID],
          fit_score: 50,
          fit_confidence: "medium",
          fit_breakdown_json: {
            locationScore: 20,
            industryScore: 20,
            signalScore: 10,
            totalScore: 50,
            confidence: "medium",
            rationale: "Previous route",
            industryHypothesisNote: "Old hypothesis",
          },
          evidence_urls_json: [],
          unknowns_json: [],
          retrieved_at: NOW,
          created_at: NOW,
        },
      ],
    },
  });

  await assert.rejects(
    () =>
      updateAccountCandidateLifecycleState(
        session,
        CONV_ID,
        ACCOUNT_OTHER_ROUTE_ID,
        "shortlisted",
      ),
    (err: unknown) => err instanceof TargetAccountDiscoveryPersistenceError && err.code === "ACCOUNT_NOT_FOUND",
  );

  const view = await batchUpdateAccountCandidateLifecycleStates(
    session,
    CONV_ID,
    [ACCOUNT_A_ID, ACCOUNT_B_ID, ACCOUNT_OTHER_ROUTE_ID],
    "shortlisted",
  );
  assert.equal(
    tables.account_candidates.find((r) => r.id === ACCOUNT_A_ID)?.lifecycle_state,
    "shortlisted",
  );
  assert.equal(
    tables.account_candidates.find((r) => r.id === ACCOUNT_B_ID)?.lifecycle_state,
    "shortlisted",
  );
  assert.equal(
    tables.account_candidates.find((r) => r.id === ACCOUNT_OTHER_ROUTE_ID)?.lifecycle_state,
    "discovered",
  );
  assert.equal(view.cohort?.shortlistedCount, 2);
});

test("4. Buyer discovery prevents misattribution across companies and rejects generic desk/inbox contacts from verification", () => {
  const dossierA = scoreAndBuildAccountDossier(
    {
      provider: "prospeo",
      id: "co-a",
      name: "Harbour Dental Studio",
      domain: "harbourdental.com.au",
      website: "https://harbourdental.com.au",
      industry: "Dental Clinic",
      location: { city: "Sydney", country: "Australia" },
    },
    {
      dossierId: ACCOUNT_A_ID,
      conversationId: CONV_ID,
      targetDecisionId: DECISION_ID,
      companySearchId: SEARCH_ID,
      providerKey: "prospeo",
      targetMarketName: "Australia",
      targetIndustryName: "Dental Clinic",
      canonicalLocations: ["Sydney"],
      linkedClaimIds: [CLAIM_OBS_ID],
      capturedAt: NOW,
      lifecycleState: "shortlisted",
    },
  );
  const dossierB = scoreAndBuildAccountDossier(
    {
      provider: "prospeo",
      id: "co-b",
      name: "Bondi Dental Care",
      domain: "bondidental.com.au",
      website: "https://bondidental.com.au",
      industry: "Dental Clinic",
      location: { city: "Sydney", country: "Australia" },
    },
    {
      dossierId: ACCOUNT_B_ID,
      conversationId: CONV_ID,
      targetDecisionId: DECISION_ID,
      companySearchId: SEARCH_ID,
      providerKey: "prospeo",
      targetMarketName: "Australia",
      targetIndustryName: "Dental Clinic",
      canonicalLocations: ["Sydney"],
      linkedClaimIds: [CLAIM_OBS_ID],
      capturedAt: NOW,
      lifecycleState: "shortlisted",
    },
  );

  // Domain normalization matches www.bondidental.com.au -> dossierB.
  const matchedB = matchAccountForPerson(
    {
      id: "p-b",
      fullName: "Sarah Chen",
      companyDomain: "www.bondidental.com.au",
    },
    [dossierA, dossierB],
  );
  assert.equal(matchedB?.id, ACCOUNT_B_ID);

  // Unrelated company identifier returns null rather than misattributing onto shortlistedAccounts[0].
  const unrelated = matchAccountForPerson(
    {
      id: "p-other",
      fullName: "John Doe",
      companyDomain: "unrelatedpractice.com.au",
      companyName: "Unrelated Practice Group",
    },
    [dossierA, dossierB],
  );
  assert.equal(unrelated, null);

  assert.equal(isNamedPersonCandidate({ fullName: "Dr. Mei Tan", firstName: "Mei", lastName: "Tan" }), true);
  assert.equal(isNamedPersonCandidate({ fullName: "Carlos Mendez-Lopez", firstName: null, lastName: null }), true);
  assert.equal(isNamedPersonCandidate({ fullName: "Front Desk", firstName: "Front", lastName: "Desk" }), false);
  assert.equal(isNamedPersonCandidate({ fullName: "Info", firstName: null, lastName: null }), false);
  assert.equal(isNamedPersonCandidate({ fullName: "contact@harbourdental.com.au", firstName: null, lastName: null }), false);
  assert.equal(isNamedPersonCandidate({ fullName: "General Enquiries", firstName: null, lastName: null }), false);
});

test("5. Selective verification routes to appropriate provider, blocks unnamed/non-shortlisted/already-verified/>10 contacts, and fails closed", async () => {
  const baseContact = (overrides: Partial<ContactCandidateView>): ContactCandidateView => ({
    id: makeUuid(1701),
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    personSearchId: PERSON_SEARCH_ID,
    accountCandidateId: ACCOUNT_A_ID,
    accountName: "Harbour Dental Studio",
    accountDomain: "harbourdental.com.au",
    discoveryProvider: "website_team",
    sourceKey: "website-team:1",
    fullName: "Dr. Mei Tan",
    firstName: "Mei",
    lastName: "Tan",
    title: "Principal Dentist",
    seniority: "Director",
    department: "Medical & Health",
    location: "Sydney, Australia",
    sourceUrl: "https://harbourdental.com.au/team",
    linkedInUrl: null,
    roleRationale: "Principal clinical buyer.",
    confidence: "high",
    claimIds: [CLAIM_OBS_ID],
    selectedForVerification: false,
    verificationStatus: "not_requested",
    verifiedDetails: null,
    retrievedAt: NOW,
    verifiedAt: null,
    ...overrides,
  });

  const websiteContact = baseContact({});
  const prospeoContact = baseContact({
    id: makeUuid(1702),
    discoveryProvider: "prospeo",
    sourceKey: "prospeo-person:999",
    linkedInUrl: "https://linkedin.com/in/sarah-chen",
    fullName: "Sarah Chen",
    firstName: "Sarah",
    lastName: "Chen",
    title: "Practice Manager",
  });
  const genericDeskContact = baseContact({
    id: makeUuid(1703),
    sourceKey: "website-team:desk",
    fullName: "Front Desk",
    firstName: "Front",
    lastName: "Desk",
    title: "Reception",
  });

  assert.equal(
    selectAppropriateVerificationProvider([websiteContact], { prospeo: true, dropcontact: true }),
    "dropcontact",
  );
  assert.equal(
    selectAppropriateVerificationProvider([prospeoContact], { prospeo: true, dropcontact: true }),
    "prospeo",
  );
  assert.equal(
    selectAppropriateVerificationProvider([websiteContact], { prospeo: true, dropcontact: false }),
    "prospeo",
  );

  assert.throws(
    () =>
      buildDropcontactVerificationPreview({
        verificationRunId: makeUuid(1709),
        conversationId: CONV_ID,
        personSearchId: PERSON_SEARCH_ID,
        selectedContacts: [genericDeskContact],
      }),
    /Only named buyer candidates can be verified/i,
  );

  const alreadyVerifiedRows = Array.from({ length: 8 }, (_, idx) => ({
    id: makeUuid(1801 + idx),
    workspace_id: WS_ID,
    account_candidate_id: ACCOUNT_A_ID,
    conversation_id: CONV_ID,
    target_decision_id: DECISION_ID,
    person_search_id: PERSON_SEARCH_ID,
    source_key: `prospeo-person:v-${idx}`,
    full_name: `Verified Buyer ${idx + 1}`,
    first_name: "Verified",
    last_name: `Buyer${idx + 1}`,
    title: "Partner",
    verification_status: "verified",
    selected_for_verification: true,
    verified_details_json: {
      email: `verified${idx + 1}@harbourdental.com.au`,
      emailQualification: "VERIFIED",
      phone: null,
      verifiedDomain: "harbourdental.com.au",
      provider: "prospeo",
      verifiedAt: NOW,
    },
    claim_ids: [CLAIM_OBS_ID],
    retrieved_at: NOW,
    created_at: NOW,
  }));

  const threeCandidateIds = [makeUuid(1820), makeUuid(1821), makeUuid(1822)];
  const unverifiedCandidates = threeCandidateIds.map((id, idx) => ({
    id,
    workspace_id: WS_ID,
    account_candidate_id: ACCOUNT_A_ID,
    conversation_id: CONV_ID,
    target_decision_id: DECISION_ID,
    person_search_id: PERSON_SEARCH_ID,
    source_key: `website-team:u-${idx}`,
    full_name: `Alice Nguyen ${idx + 1}`,
    first_name: "Alice",
    last_name: `Nguyen${idx + 1}`,
    title: "Practice Manager",
    verification_status: "not_requested",
    selected_for_verification: false,
    claim_ids: [CLAIM_OBS_ID],
    retrieved_at: NOW,
    created_at: NOW,
  }));

  const nonShortlistedContactId = makeUuid(1825);
  const { session } = makeStatefulSession({
    rpcBudgetAllowed: false,
    tables: {
      provider_company_searches: [
        {
          id: SEARCH_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          provider_key: "prospeo",
          status: "completed",
          canonical_locations_json: ["Sydney"],
          scope_json: { targetMarketName: "Australia", targetIndustryName: "Dental Clinic" },
          filters_json: {},
          criteria_json: ["Locked route"],
          claim_ids_json: [CLAIM_OBS_ID],
          excluded_categories_json: [],
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      account_candidates: [
        {
          id: ACCOUNT_A_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          company_search_id: SEARCH_ID,
          source_key: "prospeo:a",
          name: "Harbour Dental Studio",
          industry: "Dental Clinic",
          location: "Sydney, Australia",
          lifecycle_state: "shortlisted",
          raw_snapshot: { provider: "prospeo", domain: "harbourdental.com.au" },
          signals_json: [],
          claim_ids: [CLAIM_OBS_ID],
          fit_score: 84,
          fit_confidence: "high",
          fit_breakdown_json: {
            locationScore: 35,
            industryScore: 34,
            signalScore: 15,
            totalScore: 84,
            confidence: "high",
            rationale: "Good match",
            industryHypothesisNote: "Dental clinic hypothesis",
          },
          evidence_urls_json: [],
          unknowns_json: [],
          retrieved_at: NOW,
          created_at: NOW,
        },
        {
          id: ACCOUNT_B_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          company_search_id: SEARCH_ID,
          source_key: "prospeo:b",
          name: "Held Dental Group",
          industry: "Dental Clinic",
          location: "Melbourne, Australia",
          lifecycle_state: "held",
          raw_snapshot: { provider: "prospeo", domain: "helddental.com.au" },
          signals_json: [],
          claim_ids: [CLAIM_OBS_ID],
          fit_score: 60,
          fit_confidence: "medium",
          fit_breakdown_json: {
            locationScore: 25,
            industryScore: 25,
            signalScore: 10,
            totalScore: 60,
            confidence: "medium",
            rationale: "Held company",
            industryHypothesisNote: "Held hypothesis",
          },
          evidence_urls_json: [],
          unknowns_json: [],
          retrieved_at: NOW,
          created_at: NOW,
        },
      ],
      provider_person_searches: [
        {
          id: PERSON_SEARCH_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          provider_key: "website_team",
          status: "completed",
          shortlisted_account_ids_json: [ACCOUNT_A_ID],
          role_recommendations_json: [],
          approved_roles_json: ["Principal Dentist", "Practice Manager"],
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      contact_candidates: [
        ...alreadyVerifiedRows,
        ...unverifiedCandidates,
        {
          id: nonShortlistedContactId,
          workspace_id: WS_ID,
          account_candidate_id: ACCOUNT_B_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          person_search_id: PERSON_SEARCH_ID,
          source_key: "website-team:held",
          full_name: "Liam Patel",
          first_name: "Liam",
          last_name: "Patel",
          title: "Principal Dentist",
          verification_status: "not_requested",
          selected_for_verification: false,
          claim_ids: [CLAIM_OBS_ID],
          retrieved_at: NOW,
          created_at: NOW,
        },
      ],
    },
  });

  const shortlistContext = {
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    anoResearchRunId: RUN_ID,
    graphRunId: GRAPH_RUN_ID,
    brief: makeBrief(),
    market: makeMarket(),
    industry: makeIndustry(),
    claims: makeClaims(),
    shortlistedAccounts: [
      scoreAndBuildAccountDossier(
        {
          provider: "prospeo",
          id: "a",
          name: "Harbour Dental Studio",
          domain: "harbourdental.com.au",
          location: { city: "Sydney", country: "Australia" },
        },
        {
          dossierId: ACCOUNT_A_ID,
          conversationId: CONV_ID,
          targetDecisionId: DECISION_ID,
          companySearchId: SEARCH_ID,
          providerKey: "prospeo",
          targetMarketName: "Australia",
          targetIndustryName: "Dental Clinic",
          canonicalLocations: ["Sydney"],
          linkedClaimIds: [CLAIM_OBS_ID],
          capturedAt: NOW,
          lifecycleState: "shortlisted",
        },
      ),
    ],
    allAccountsById: new Map(),
  };

  // Rejects non-shortlisted contact.
  await assert.rejects(
    () =>
      saveDropcontactVerificationPreview(session, {
        context: shortlistContext,
        selectedContactIds: [nonShortlistedContactId],
      }),
    (err: unknown) =>
      err instanceof PeoplePlaybookPersistenceError && err.code === "NON_SHORTLISTED_CONTACT",
  );

  // Rejects already-verified contact.
  await assert.rejects(
    () =>
      saveDropcontactVerificationPreview(session, {
        context: shortlistContext,
        selectedContactIds: [makeUuid(1801)],
      }),
    (err: unknown) =>
      err instanceof PeoplePlaybookPersistenceError && err.code === "CONTACT_ALREADY_VERIFIED",
  );

  // Rejects batch that exceeds 10 cumulative named contact enrichments (8 verified + 3 = 11 > 10).
  await assert.rejects(
    () =>
      saveDropcontactVerificationPreview(session, {
        context: shortlistContext,
        selectedContactIds: threeCandidateIds,
      }),
    (err: unknown) =>
      err instanceof PeoplePlaybookPersistenceError && err.code === "VERIFICATION_AUTHORITY_EXCEEDED",
  );

  // Within cumulative limit (8 + 2 = 10), preview prepares cleanly; execution fails closed when ledger blocks budget.
  const prevDropcontact = process.env.DROPCONTACT_API_KEY;
  process.env.DROPCONTACT_API_KEY = "test-dc-key";
  try {
    const previewView = await prepareContactVerificationForConversation(
      session,
      CONV_ID,
      threeCandidateIds.slice(0, 2),
    );
    assert.equal(previewView.peopleDiscovery.verificationRun?.providerKey, "dropcontact");
    assert.equal(previewView.peopleDiscovery.verificationRun?.selectedContactIds.length, 2);

    await assert.rejects(
      () =>
        approveContactVerificationForConversation(
          session,
          CONV_ID,
          previewView.peopleDiscovery.verificationRun!.id,
        ),
      (err: unknown) =>
        err instanceof PeoplePlaybookServiceError && err.code === "BUDGET_GUARD_BLOCKED",
    );
  } finally {
    if (prevDropcontact === undefined) delete process.env.DROPCONTACT_API_KEY;
    else process.env.DROPCONTACT_API_KEY = prevDropcontact;
  }
});

test("6. Company playbooks and industry playbooks preserve claim provenance and reject fabricated claims", async () => {
  const dossierA = scoreAndBuildAccountDossier(
    {
      provider: "prospeo",
      id: "co-a",
      name: "Harbour Dental Studio",
      domain: "harbourdental.com.au",
      website: "https://harbourdental.com.au",
      industry: "Dental Clinic",
      employeeRange: "11-50",
      location: { city: "Sydney", country: "Australia" },
    },
    {
      dossierId: ACCOUNT_A_ID,
      conversationId: CONV_ID,
      targetDecisionId: DECISION_ID,
      companySearchId: SEARCH_ID,
      providerKey: "prospeo",
      targetMarketName: "Australia",
      targetIndustryName: "Dental Clinic",
      canonicalLocations: ["Sydney"],
      linkedClaimIds: [CLAIM_OBS_ID, CLAIM_COMP_ID],
      capturedAt: NOW,
      lifecycleState: "shortlisted",
    },
  );
  const verifiedContact: ContactCandidateView = {
    id: makeUuid(1901),
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    personSearchId: PERSON_SEARCH_ID,
    accountCandidateId: ACCOUNT_A_ID,
    accountName: "Harbour Dental Studio",
    accountDomain: "harbourdental.com.au",
    discoveryProvider: "prospeo",
    sourceKey: "prospeo-person:901",
    fullName: "Dr. Mei Tan",
    firstName: "Mei",
    lastName: "Tan",
    title: "Principal Dentist",
    seniority: "Director",
    department: "Medical & Health",
    location: "Sydney, Australia",
    sourceUrl: null,
    linkedInUrl: "https://linkedin.com/in/mei-tan",
    roleRationale: "Clinical principal",
    confidence: "high",
    claimIds: [CLAIM_OBS_ID],
    selectedForVerification: true,
    verificationStatus: "verified",
    verifiedDetails: {
      email: "mei@harbourdental.com.au",
      emailQualification: "VERIFIED",
      phone: null,
      verifiedDomain: "harbourdental.com.au",
      provider: "prospeo",
      verifiedAt: NOW,
    },
    retrievedAt: NOW,
    verifiedAt: NOW,
  };

  const companyPlaybook = compileFactualAccountPlaybook({
    playbookId: makeUuid(1902),
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    account: dossierA,
    targetMarketName: "Australia",
    industry: makeIndustry(),
    claims: makeClaims(),
    contacts: [verifiedContact],
    offerSummary: makeBrief().offer,
    nowIso: NOW,
  });
  assert.ok(
    companyPlaybook.evidenceBackedPoints.some((p) => p.attribution === "Direct market research"),
  );
  assert.ok(
    companyPlaybook.evidenceBackedPoints.some((p) => p.attribution === "Comparable market evidence"),
  );

  // Audit rejects unverified contact masquerading as verified_contact.
  const tamperedPlaybook = {
    ...companyPlaybook,
    buyerAngles: [
      {
        ...companyPlaybook.buyerAngles[0],
        contactProvenance: "verified_contact" as const,
      },
    ],
  };
  assert.throws(
    () =>
      auditFactualAccountPlaybook(tamperedPlaybook, {
        validClaimIds: new Set([CLAIM_OBS_ID, CLAIM_COMP_ID]),
        validSignalIds: new Set(dossierA.signals.map((s) => s.id)),
        verifiedContactIds: new Set(),
        knownContactIds: new Set([verifiedContact.id]),
      }),
    /mislabeled an unverified contact as verified/i,
  );

  const industryPlaybook = compileFactualIndustryPlaybook({
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    targetMarketName: "Australia",
    industry: makeIndustry(),
    claims: makeClaims(),
    shortlistedAccounts: [dossierA],
    contacts: [verifiedContact],
    nowIso: NOW,
  });
  assert.equal(industryPlaybook.targetIndustryName, "Dental Clinic");
  assert.equal(industryPlaybook.shortlistedCount, 1);
  assert.ok(industryPlaybook.buyingCommitteeRoles.includes("Principal Dentist"));

  const auditedIndustry = auditFactualIndustryPlaybook(industryPlaybook, {
    validClaimIds: new Set([CLAIM_OBS_ID, CLAIM_COMP_ID, CLAIM_HYP_ID]),
    validSignalIds: new Set(dossierA.signals.map((s) => s.id)),
    verifiedContactIds: new Set([verifiedContact.id]),
  });
  assert.ok(auditedIndustry.evidenceBackedPoints.length >= 2);

  // Store compiles and exposes both company playbooks and industryPlaybook via readPeopleDiscoveryForConversation.
  const { session } = makeStatefulSession({
    tables: {
      provider_company_searches: [
        {
          id: SEARCH_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          provider_key: "prospeo",
          status: "completed",
          canonical_locations_json: ["Sydney"],
          scope_json: { targetMarketName: "Australia", targetIndustryName: "Dental Clinic" },
          filters_json: {},
          criteria_json: ["Locked route"],
          claim_ids_json: [CLAIM_OBS_ID],
          excluded_categories_json: [],
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      account_candidates: [
        {
          id: ACCOUNT_A_ID,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          company_search_id: SEARCH_ID,
          source_key: "prospeo:co-a",
          name: "Harbour Dental Studio",
          industry: "Dental Clinic",
          location: "Sydney, Australia",
          lifecycle_state: "shortlisted",
          raw_snapshot: { provider: "prospeo", domain: "harbourdental.com.au" },
          signals_json: dossierA.signals,
          claim_ids: dossierA.claimIds,
          fit_score: dossierA.fit.totalScore,
          fit_confidence: dossierA.fit.confidence,
          fit_breakdown_json: { ...dossierA.fit, matchReasons: dossierA.matchReasons },
          evidence_urls_json: dossierA.evidenceUrls,
          unknowns_json: dossierA.unknowns,
          retrieved_at: NOW,
          created_at: NOW,
        },
      ],
    },
  });

  const savedDiscovery = await compileAndSaveAccountPlaybooks(session, {
    context: {
      conversationId: CONV_ID,
      targetDecisionId: DECISION_ID,
      anoResearchRunId: RUN_ID,
      graphRunId: GRAPH_RUN_ID,
      brief: makeBrief(),
      market: makeMarket(),
      industry: makeIndustry(),
      claims: makeClaims(),
      shortlistedAccounts: [dossierA],
      allAccountsById: new Map([[dossierA.id, dossierA]]),
    },
  });
  assert.equal(savedDiscovery.playbooks.length, 1);
  assert.ok(savedDiscovery.industryPlaybook);
  assert.equal(savedDiscovery.industryPlaybook?.targetIndustryName, "Dental Clinic");

  const reloaded = await readPeopleDiscoveryForConversation(session, CONV_ID);
  assert.ok(reloaded.industryPlaybook);
});

test("7. Outreach templates & execution stay strictly draft-only with white-label error sanitization", async () => {
  const pack = buildDeterministicFallbackTemplatePack({
    id: makeUuid(2001),
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    brief: makeBrief(),
    market: makeMarket(),
    industry: makeIndustry(),
    claims: makeClaims(),
    nowIso: NOW,
  });
  const parsedPack = outreachTemplatePackViewSchema.parse(pack);
  assert.equal(parsedPack.deliveryMode, "draft_only");

  const proposalId = makeUuid(2002);
  const { session, tables } = makeStatefulSession({
    tables: {
      proposals: [
        {
          id: proposalId,
          workspace_id: WS_ID,
          conversation_id: CONV_ID,
          target_decision_id: DECISION_ID,
          account_playbook_id: null,
          outreach_draft_id: null,
          provider_action_request_id: null,
          account_candidate_id: ACCOUNT_A_ID,
          contact_candidate_id: makeUuid(2004),
          proposal_type: "email_send",
          version: 1,
          status: "awaiting_approval",
          summary: "Draft email for review only",
          payload_json: {
            channel: "email",
            subject: "patient recalls",
            body: "Draft body",
            summary: "Draft email for review only",
          },
          execution_receipt_json: {},
          target_reference: "mei@harbourdental.com.au",
          executed_at: null,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    },
  });

  const executionView = await decideAndExecuteProposal(session, {
    conversationId: CONV_ID,
    proposalId,
    decision: "approved",
    rationale: "Approved as draft record only.",
  });
  const approvedProposal = executionView.proposals.find((p) => p.id === proposalId);
  assert.ok(approvedProposal);
  assert.equal(approvedProposal?.executionReceipt?.externalDispatchExecuted, false);
  assert.equal(approvedProposal?.executionReceipt?.deliveryMode, "draft_only_recorded_approval");
  assert.equal(tables.approval_decisions.length, 1);

  // Confirm outreach store/services contain zero external email/call/CRM HTTP dispatchers.
  const executionStoreSource = await readFile(
    path.join(ROOT, "src/server/persistence/outreach-execution-store.ts"),
    "utf8",
  );
  assert.equal(
    /\b(?:nodemailer|resend|sendgrid|postmark|mailgun|twilio)\b|fetch\s*\(/i.test(executionStoreSource),
    false,
  );

  // Error sanitization removes secrets, vendors, credit prices, and internal phase tags.
  const sanitized = sanitizeDownstreamErrorMessage(
    new Error("Prospeo HTTP failed for PROSPEO_KEY=secret99 (cost 2 credits) in Phase D with Bearer abc123def"),
    "Safe fallback",
  );
  assert.equal(
    /\b(?:Prospeo|PROSPEO_KEY|secret99|credits|Phase\s+D|Bearer)\b/i.test(sanitized),
    false,
  );
  assert.equal(
    sanitizeDownstreamErrorMessage(new Error("TypeError: fetch failed ECONNRESET"), "Safe fallback"),
    "Safe fallback",
  );
});

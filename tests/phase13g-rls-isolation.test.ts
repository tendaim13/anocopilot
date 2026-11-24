import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { SupabaseWorkspaceSession } from "@/contracts/ano";
import { selectActiveWorkspace } from "@/lib/ano/workspace-auth";
import type { IndustryProfile, MarketProfile, ResearchClaim } from "@/lib/ano/market-synthesis";
import type { ResearchBrief } from "@/lib/ano/research-conversation";
import { decideAndExecuteProposal, OutreachExecutionPersistenceError } from "@/server/persistence/outreach-execution-store";
import { compileAndSaveAccountPlaybooks, readPeopleDiscoveryForConversation } from "@/server/persistence/people-playbook-store";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";
import {
  readCompanySearchForConversation,
  TargetAccountDiscoveryPersistenceError,
  updateAccountCandidateLifecycleState,
} from "@/server/persistence/target-account-discovery-store";
import { RESEARCH_GRAPH_NAME, RESEARCH_GRAPH_VERSION } from "@/server/langgraph/research-graph";

const ROOT = process.cwd();
const NOW = "2026-11-25T00:00:00.000Z";

function makeUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

const WS_A = makeUuid(13001);
const WS_B = makeUuid(13002);
const USER_A = makeUuid(13011);
const USER_B = makeUuid(13012);
const CONV_A = makeUuid(13021);
const GRAPH_A = makeUuid(13031);
const RUN_A = makeUuid(13041);
const SYNTHESIS_A = makeUuid(13051);
const DECISION_A = makeUuid(13061);
const MARKET_A = makeUuid(13071);
const INDUSTRY_A = makeUuid(13081);
const CLAIM_A = makeUuid(13091);
const SOURCE_A = makeUuid(13101);
const SEARCH_A = makeUuid(13111);
const ACCOUNT_A = makeUuid(13121);
const PROPOSAL_A = makeUuid(13131);

type TableRow = Record<string, unknown>;

/**
 * Simulates Supabase Postgres RLS enforcement across two workspaces on a shared database store:
 * every query checks membership for `activeWorkspaceId` (mirroring `is_ano_workspace_member` /
 * `can_write_ano_workspace`) in addition to SQL WHERE clauses, ensuring cross-workspace requests
 * never return or mutate another tenant's rows even if an application filter were omitted.
 */
function createSharedTwoWorkspaceRlsBackend() {
  const claim: ResearchClaim = {
    id: CLAIM_A,
    statement: "Independent accounting firms in Singapore adopt workflow tools at 61% annually.",
    kind: "observation",
    evidenceStrength: "strong",
    citationStatus: "supported",
    sourceIds: [SOURCE_A],
    comparisonBasis: null,
  };
  const market: MarketProfile = {
    id: MARKET_A,
    name: "Singapore",
    summary: "Compact corporate services hub with strong compliance demand.",
    evidenceStrength: "moderate",
    claimIds: [CLAIM_A],
    unknowns: ["Partner renewal cycle"],
    nextResearchActions: ["Validate mid-market buyer ownership"],
  };
  const industry: IndustryProfile = {
    id: INDUSTRY_A,
    marketProfileId: MARKET_A,
    name: "Corporate Accounting",
    summary: "Mid-market statutory accounting practices.",
    operationalProblems: ["Manual client document chasing"],
    solutionFit: ["Automated client workflow reminders"],
    buyerRoleHypotheses: ["Managing Partner", "Operations Director"],
    evidenceStrength: "moderate",
    claimIds: [CLAIM_A],
    unknowns: ["Current practice stack"],
  };
  const brief: ResearchBrief = {
    offer: "Workflow automation for accounting teams",
    goal: "Find matching Singapore firms and draft outreach",
    businessLocation: "Wyoming, USA",
    targetMarkets: ["Singapore"],
    intakeComplete: true,
    marketHints: ["Corporate Accounting"],
    locationHints: ["Singapore"],
    buyerHints: ["Managing Partner"],
    constraints: [],
    unknowns: [],
    sourceMessageIds: [makeUuid(13999)],
  };

  const memberships = new Map<string, Set<string>>([
    [USER_A, new Set([WS_A])],
    [USER_B, new Set([WS_B])],
  ]);

  const tables: Record<string, TableRow[]> = {
    workspaces: [
      { id: WS_A, name: "Tenant Alpha", slug: "tenant-alpha", created_by: USER_A },
      { id: WS_B, name: "Tenant Beta", slug: "tenant-beta", created_by: USER_B },
    ],
    ano_conversations: [
      {
        id: CONV_A,
        workspace_id: WS_A,
        created_by: USER_A,
        title: "Tenant Alpha Private Research",
        status: "complete_without_research",
        active_thread_id: `thread-${CONV_A}`,
        archived_at: null,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    ano_graph_runs: [
      {
        id: GRAPH_A,
        workspace_id: WS_A,
        conversation_id: CONV_A,
        graph_name: RESEARCH_GRAPH_NAME,
        graph_version: RESEARCH_GRAPH_VERSION,
        thread_id: `thread-${CONV_A}`,
        status: "complete_without_research",
        current_node: "locked",
        checkpoint_ref: "cp-rls-1",
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
        id: makeUuid(13201),
        workspace_id: WS_A,
        conversation_id: CONV_A,
        business_location: "Wyoming, USA",
        target_markets_json: ["Singapore"],
        intake_complete: true,
        content_json: brief,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    research_questions: [],
    research_plans: [],
    ano_research_runs: [
      {
        id: RUN_A,
        workspace_id: WS_A,
        graph_run_id: GRAPH_A,
        conversation_id: CONV_A,
        status: "completed",
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    ano_research_syntheses: [
      {
        id: SYNTHESIS_A,
        workspace_id: WS_A,
        ano_research_run_id: RUN_A,
        graph_run_id: GRAPH_A,
        conversation_id: CONV_A,
        status: "ready_for_decision",
        recommendation_mode: "directly_supported",
        assessment_json: {
          fetchedSourceCount: 1,
          sourceClassCount: 1,
          coverageStrength: "moderate",
          comparisonReady: true,
          contradictions: [],
          gaps: [],
          summary: "Singapore public evidence summary",
        },
        group_summaries_json: [],
        report_json: null,
        failure_message: null,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    research_claims: [
      {
        id: CLAIM_A,
        workspace_id: WS_A,
        synthesis_id: SYNTHESIS_A,
        claim_kind: claim.kind,
        statement: claim.statement,
        source_ids: claim.sourceIds,
        comparison_basis: null,
        evidence_strength: claim.evidenceStrength,
        citation_status: claim.citationStatus,
        created_at: NOW,
      },
    ],
    market_profiles: [
      {
        id: MARKET_A,
        workspace_id: WS_A,
        synthesis_id: SYNTHESIS_A,
        name: market.name,
        summary: market.summary,
        evidence_strength: market.evidenceStrength,
        claim_ids: market.claimIds,
        unknowns_json: market.unknowns,
        next_research_actions_json: market.nextResearchActions,
        created_at: NOW,
      },
    ],
    industry_profiles: [
      {
        id: INDUSTRY_A,
        workspace_id: WS_A,
        synthesis_id: SYNTHESIS_A,
        market_profile_id: MARKET_A,
        name: industry.name,
        summary: industry.summary,
        operational_problems_json: industry.operationalProblems,
        solution_fit_json: industry.solutionFit,
        buyer_role_hypotheses_json: industry.buyerRoleHypotheses,
        evidence_strength: industry.evidenceStrength,
        claim_ids: industry.claimIds,
        unknowns_json: industry.unknowns,
        created_at: NOW,
      },
    ],
    target_decisions: [
      {
        id: DECISION_A,
        workspace_id: WS_A,
        synthesis_id: SYNTHESIS_A,
        status: "locked",
        market_profile_id: MARKET_A,
        industry_profile_id: INDUSTRY_A,
        rationale: "Locked Tenant A route",
        selected_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    provider_company_searches: [
      {
        id: SEARCH_A,
        workspace_id: WS_A,
        conversation_id: CONV_A,
        target_decision_id: DECISION_A,
        provider_key: "openstreetmap",
        status: "completed",
        canonical_locations_json: ["Singapore"],
        scope_json: {
          locations: ["Singapore"],
          targetMarketName: "Singapore",
          targetIndustryName: "Corporate Accounting",
          industryKeywords: ["accounting"],
        },
        filters_json: {},
        criteria_json: ["Locked market route: Singapore"],
        claim_ids_json: [CLAIM_A],
        excluded_categories_json: [],
        result_count: 1,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    account_candidates: [
      {
        id: ACCOUNT_A,
        workspace_id: WS_A,
        conversation_id: CONV_A,
        target_decision_id: DECISION_A,
        company_search_id: SEARCH_A,
        source_key: "osm:sg-1",
        name: "Raffles Audit Partners LLP",
        industry: "Corporate Accounting",
        location: "Singapore",
        employee_band: "11-50",
        lifecycle_state: "shortlisted",
        raw_snapshot: { provider: "openstreetmap", domain: "rafflesaudit.example.sg" },
        signals_json: [],
        claim_ids: [CLAIM_A],
        fit_score: 86,
        fit_confidence: "high",
        fit_breakdown_json: {
          locationScore: 36,
          industryScore: 35,
          signalScore: 15,
          totalScore: 86,
          confidence: "high",
          rationale: "Strong Singapore accounting fit",
          industryHypothesisNote: "Statutory audit practice focus",
          matchReasons: ["Location matches locked Singapore market."],
        },
        evidence_urls_json: [],
        unknowns_json: [],
        retrieved_at: NOW,
        created_at: NOW,
      },
    ],
    provider_person_searches: [],
    contact_candidates: [],
    contact_verification_runs: [],
    account_playbooks: [],
    outreach_drafts: [],
    proposals: [
      {
        id: PROPOSAL_A,
        workspace_id: WS_A,
        conversation_id: CONV_A,
        target_decision_id: DECISION_A,
        account_playbook_id: null,
        outreach_draft_id: null,
        provider_action_request_id: null,
        account_candidate_id: ACCOUNT_A,
        contact_candidate_id: null,
        proposal_type: "email_send",
        version: 1,
        status: "awaiting_approval",
        summary: "Tenant A Draft Proposal",
        payload_json: { summary: "Tenant A Draft Proposal" },
        execution_receipt_json: {},
        target_reference: "partner@rafflesaudit.example.sg",
        executed_at: null,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    approval_decisions: [],
    run_events: [],
    audit_logs: [],
  };

  function sessionFor(userId: string, workspaceId: string, email: string): SupabaseWorkspaceSession {
    const allowed = memberships.get(userId) ?? new Set<string>();
    const canSeeRow = (tableName: string, row: TableRow): boolean => {
      if (tableName === "workspaces") return allowed.has(String(row.id));
      if ("workspace_id" in row) return allowed.has(String(row.workspace_id));
      return true;
    };

    class RlsQueryBuilder {
      private filters: Array<(row: TableRow) => boolean> = [];
      private orderSpec: { col: string; asc: boolean } | null = null;
      private limitNum: number | null = null;
      private op: "select" | "insert" | "update" | "upsert" = "select";
      private payload: unknown = null;

      constructor(private readonly tableName: string) {}
      select() { return this; }
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
      upsert(rows: TableRow | TableRow[]) {
        this.op = "upsert";
        this.payload = Array.isArray(rows) ? rows : [rows];
        return this;
      }
      eq(col: string, val: unknown) { this.filters.push((row) => row[col] === val); return this; }
      neq(col: string, val: unknown) { this.filters.push((row) => row[col] !== val); return this; }
      in(col: string, vals: unknown[]) { const set = new Set(vals); this.filters.push((row) => set.has(row[col])); return this; }
      is(col: string, val: unknown) { this.filters.push((row) => (row[col] ?? null) === val); return this; }
      not(col: string, op: string, val: unknown) {
        if (op === "is" && val === null) this.filters.push((row) => row[col] !== null && row[col] !== undefined);
        return this;
      }
      order(col: string, opts?: { ascending?: boolean }) { this.orderSpec = { col, asc: opts?.ascending ?? true }; return this; }
      limit(n: number) { this.limitNum = n; return this; }

      private execute() {
        const tbl = tables[this.tableName] ?? (tables[this.tableName] = []);
        if (this.op === "insert" || this.op === "upsert") {
          const incoming = this.payload as TableRow[];
          for (const row of incoming) {
            const targetWs = String(row.workspace_id ?? "");
            if (targetWs && !allowed.has(targetWs)) {
              return { data: null, error: { code: "42501", message: "new row violates row-level security policy" }, count: 0 };
            }
          }
          const written = incoming.map((row) => ({ id: row.id ?? crypto.randomUUID(), created_at: NOW, updated_at: NOW, ...structuredClone(row) }));
          tbl.push(...written);
          return { data: written, error: null, count: written.length };
        }

        let matched = tbl.filter((row) => canSeeRow(this.tableName, row) && this.filters.every((fn) => fn(row)));
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
          matched = [...matched].sort((a, b) => asc ? String(a[col] ?? "").localeCompare(String(b[col] ?? "")) : String(b[col] ?? "").localeCompare(String(a[col] ?? "")));
        }
        if (this.limitNum !== null) matched = matched.slice(0, this.limitNum);
        return { data: matched.map((r) => structuredClone(r)), error: null, count: matched.length };
      }

      maybeSingle() {
        const res = this.execute();
        return Promise.resolve({ data: res.data ? (res.data[0] ?? null) : null, error: res.error });
      }
      single() {
        const res = this.execute();
        const first = res.data?.[0] ?? null;
        return Promise.resolve({ data: first, error: res.error ?? (first ? null : { message: "Not found" }) });
      }
      then<T1 = unknown, T2 = never>(
        onf?: ((v: ReturnType<RlsQueryBuilder["execute"]>) => T1 | PromiseLike<T1>) | null,
        onr?: ((e: unknown) => T2 | PromiseLike<T2>) | null,
      ) {
        return Promise.resolve(this.execute()).then(onf, onr);
      }
    }

    return {
      kind: "supabase",
      actorId: userId,
      actorEmail: email,
      workspace: {
        id: workspaceId,
        name: workspaceId === WS_A ? "Tenant Alpha" : "Tenant Beta",
        slug: workspaceId === WS_A ? "tenant-alpha" : "tenant-beta",
        role: "owner",
      },
      client: {
        from(tableName: string) {
          return new RlsQueryBuilder(tableName);
        },
        async rpc() {
          return { data: null, error: { code: "42501", message: "permission denied" } };
        },
      } as unknown as SupabaseWorkspaceSession["client"],
    };
  }

  return {
    tables,
    sessionA: sessionFor(USER_A, WS_A, "alice@alpha.example"),
    sessionB: sessionFor(USER_B, WS_B, "bob@beta.example"),
    claim,
    market,
    industry,
    brief,
  };
}

test("SQL RLS static audit: every table enables RLS, tenant policies stay scoped, audit_logs stay immutable, and ano_internal stays private", async () => {
  const migDir = path.join(ROOT, "supabase/migrations");
  const files = (await readdir(migDir)).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(files.length >= 31);

  const createdTables = new Set<string>();
  const rlsEnabledTables = new Set<string>();
  const policiesByTable = new Map<string, Array<{ name: string; body: string }>>();

  for (const file of files) {
    const sql = await readFile(path.join(migDir, file), "utf8");
    for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+\.[a-z0-9_]+)/gi)) {
      createdTables.add(match[1].toLowerCase());
    }
    for (const match of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([a-z0-9_]+\.[a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi)) {
      rlsEnabledTables.add(match[1].toLowerCase());
    }
    for (const match of sql.matchAll(/create\s+policy\s+([a-z0-9_"]+)\s+on\s+([a-z0-9_]+\.[a-z0-9_]+)([^;]+);/gi)) {
      const table = match[2].toLowerCase();
      const list = policiesByTable.get(table) ?? [];
      list.push({ name: match[1].toLowerCase(), body: match[3].toLowerCase() });
      policiesByTable.set(table, list);
    }
  }

  assert.equal(createdTables.size >= 53, true);
  for (const table of createdTables) {
    assert.equal(
      rlsEnabledTables.has(table),
      true,
      `Expected ENABLE ROW LEVEL SECURITY on ${table}`,
    );
  }

  // `ano_internal.api_usage_logs` must remain completely inaccessible to client sessions (0 client policies).
  assert.equal(policiesByTable.get("ano_internal.api_usage_logs")?.length ?? 0, 0);

  // `audit_logs` must never permit UPDATE or DELETE policies under client roles.
  const auditPolicies = policiesByTable.get("public.audit_logs") ?? [];
  assert.ok(auditPolicies.length >= 2);
  for (const pol of auditPolicies) {
    assert.equal(/\bfor\s+(?:update|delete)\b/i.test(pol.body), false);
  }

  // Tenant tables must never contain permissive USING (true) / WITH CHECK (true) policies.
  for (const [table, pols] of policiesByTable.entries()) {
    assert.ok(pols.length > 0, `Missing policies on ${table}`);
    for (const pol of pols) {
      assert.equal(
        /\b(?:using|with\s+check)\s*\(\s*true\s*\)/i.test(pol.body),
        false,
        `Forbidden permissive policy ${pol.name} on ${table}`,
      );
    }
  }
});

test("Two-workspace isolation: Workspace B cannot read or mutate Workspace A company, people, playbook, or proposal records", async () => {
  const { sessionA, sessionB, claim, market, industry, brief } =
    createSharedTwoWorkspaceRlsBackend();

  // Workspace A reads its own company search and compiles a factual playbook.
  const aCompany = await readCompanySearchForConversation(sessionA, CONV_A);
  assert.equal(aCompany?.accounts.length, 1);
  assert.equal(aCompany?.accounts[0]?.id, ACCOUNT_A);

  const aPeople = await compileAndSaveAccountPlaybooks(sessionA, {
    context: {
      conversationId: CONV_A,
      targetDecisionId: DECISION_A,
      anoResearchRunId: RUN_A,
      graphRunId: GRAPH_A,
      brief,
      market,
      industry,
      claims: [claim],
      shortlistedAccounts: aCompany!.accounts,
      allAccountsById: new Map([[aCompany!.accounts[0].id, aCompany!.accounts[0]]]),
    },
  });
  assert.equal(aPeople.playbooks.length, 1);

  // Workspace B session attempts cross-tenant reads & mutations against Workspace A IDs.
  const bCompany = await readCompanySearchForConversation(sessionB, CONV_A);
  assert.equal(bCompany, null);

  const bPeople = await readPeopleDiscoveryForConversation(sessionB, CONV_A);
  assert.equal(bPeople.playbooks.length, 0);
  assert.equal(bPeople.contacts.length, 0);
  assert.equal(bPeople.shortlistedCount, 0);

  await assert.rejects(
    () => updateAccountCandidateLifecycleState(sessionB, CONV_A, ACCOUNT_A, "dismissed"),
    (err: unknown) =>
      err instanceof ResearchConversationPersistenceError ||
      err instanceof TargetAccountDiscoveryPersistenceError,
  );

  await assert.rejects(
    () =>
      decideAndExecuteProposal(sessionB, {
        conversationId: CONV_A,
        proposalId: PROPOSAL_A,
        decision: "approved",
        rationale: "Attempted cross-tenant approval",
      }),
    (err: unknown) =>
      err instanceof ResearchConversationPersistenceError ||
      err instanceof OutreachExecutionPersistenceError,
  );

  // Even after Workspace B probe attempts, Workspace A data stays untouched.
  const aStillShortlisted = await readCompanySearchForConversation(sessionA, CONV_A);
  assert.equal(aStillShortlisted?.accounts[0]?.lifecycleState, "shortlisted");

  // Multi-workspace switcher cannot select a workspace outside a user's allowed memberships.
  const userAMemberships = [{ id: WS_A, name: "Tenant Alpha", slug: "tenant-alpha", role: "owner" as const }];
  const selected = selectActiveWorkspace(userAMemberships, WS_B);
  assert.equal(selected?.id, WS_A);
});

test("Live RLS isolation script enforces ANO_DATABASE_LABEL and SUPABASE_DB_URL guards", async () => {
  // @ts-expect-error ESM live RLS script does not carry separate declaration files
  const { runLiveTwoWorkspaceRlsCheck } = await import("../scripts/verify-rls-isolation.mjs");
  await assert.rejects(
    () =>
      runLiveTwoWorkspaceRlsCheck({
        databaseUrl: "postgres://localhost:5432/mercury",
        databaseLabel: "mercury",
      }),
    /ANO_DATABASE_LABEL=ano/i,
  );
  await assert.rejects(
    () =>
      runLiveTwoWorkspaceRlsCheck({
        databaseUrl: "",
        databaseLabel: "ano",
      }),
    /SUPABASE_DB_URL is required/i,
  );
});

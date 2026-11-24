import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { SupabaseWorkspaceSession } from "@/contracts/ano";
import {
  AUTOPILOT_STAGES,
  DEFAULT_AUTOPILOT_AUTHORITY_SCOPE,
  describeAutopilotStageProgress,
  formatAutopilotOutcomeMessage,
  type AutopilotExecutableStage,
  type AutopilotRunView,
} from "@/lib/ano/autopilot";
import type { AccountCandidateDossier, CompanySearchView } from "@/lib/ano/company-discovery";
import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type { OutreachTemplatePackView } from "@/lib/ano/outreach-templates";
import type { ContactCandidateView, PeopleDiscoveryView } from "@/lib/ano/people-playbooks";
import type {
  ResearchBrief,
  ResearchConversationView,
  ResearchPlan,
} from "@/lib/ano/research-conversation";
import { GET as internalWorkerGet, POST as internalWorkerPost } from "@/app/api/internal/jobs/autopilot/route";
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
} from "@/server/persistence/evidence-research-store";
import { type AutopilotOrchestratorDeps } from "@/server/domain/autopilot-orchestrator-service";
import { drainAutopilotRunWithDeps } from "@/server/jobs/autopilot-worker";

const ROOT = process.cwd();
const NOW = "2026-11-24T00:00:00.000Z";
const WS_ID = "00000000-0000-4000-8000-0000000013c0";
const ACTOR_ID = "00000000-0000-4000-8000-0000000013c9";
const CONV_ID = "00000000-0000-4000-8000-0000000013c1";
const GRAPH_RUN_ID = "00000000-0000-4000-8000-0000000013c2";
const PLAN_ID = "00000000-0000-4000-8000-0000000013c3";
const CLAIM_ID = "00000000-0000-4000-8000-0000000013c4";
const MARKET_ID = "00000000-0000-4000-8000-0000000013c5";
const INDUSTRY_ID = "00000000-0000-4000-8000-0000000013c6";
const DECISION_ID = "00000000-0000-4000-8000-0000000013c7";
const SEARCH_ID = "00000000-0000-4000-8000-0000000013c8";
const PERSON_SEARCH_ID = "00000000-0000-4000-8000-0000000013ca";
const RESEARCH_RUN_ID = "00000000-0000-4000-8000-0000000013cb";

type TableRow = Record<string, unknown>;

function makeStatefulSupabaseSession(
  initialTables: Partial<Record<string, TableRow[]>> = {},
): {
  session: SupabaseWorkspaceSession;
  tables: Record<string, TableRow[]>;
} {
  const tables: Record<string, TableRow[]> = {
    autopilot_runs: [],
    autopilot_jobs: [],
    audit_logs: [],
    connector_connections: [],
    ano_research_runs: [],
    provider_action_requests: [],
    research_waves: [],
    research_sources: [],
    run_events: [],
    ...initialTables,
  };

  function getTable(name: string): TableRow[] {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function clone<T>(val: T): T {
    return structuredClone(val);
  }

  class QueryBuilder {
    private filters: Array<(row: TableRow) => boolean> = [];
    private sortCol: string | null = null;
    private sortAsc = true;
    private limitNum: number | null = null;
    private mode: "select" | "insert" | "upsert" | "update" = "select";
    private payload: unknown = null;
    private onConflict = "";
    private wantsSelect = false;
    private headOnly = false;
    private expectSingle: "single" | "maybe" | null = null;

    constructor(private readonly tableName: string) {}

    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      this.wantsSelect = true;
      if (opts?.head) this.headOnly = true;
      return this;
    }

    insert(rows: TableRow | TableRow[]) {
      this.mode = "insert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }

    upsert(rows: TableRow | TableRow[], opts?: { onConflict?: string }) {
      this.mode = "upsert";
      this.payload = Array.isArray(rows) ? rows : [rows];
      this.onConflict = opts?.onConflict ?? "";
      return this;
    }

    update(patch: TableRow) {
      this.mode = "update";
      this.payload = patch;
      return this;
    }

    eq(col: string, val: unknown) {
      this.filters.push((row) => row[col] === val);
      return this;
    }

    in(col: string, vals: unknown[]) {
      this.filters.push((row) => vals.includes(row[col]));
      return this;
    }

    is(col: string, val: unknown) {
      this.filters.push((row) => (val === null ? row[col] === null || row[col] === undefined : row[col] === val));
      return this;
    }

    lt(col: string, val: unknown) {
      this.filters.push((row) => String(row[col] ?? "") < String(val));
      return this;
    }

    order(col: string, opts?: { ascending?: boolean }) {
      this.sortCol = col;
      this.sortAsc = opts?.ascending !== false;
      return this;
    }

    limit(n: number) {
      this.limitNum = n;
      return this;
    }

    maybeSingle() {
      this.expectSingle = "maybe";
      return this.execute();
    }

    single() {
      this.expectSingle = "single";
      return this.execute();
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return this.execute().then(onfulfilled, onrejected);
    }

    private async execute(): Promise<{ data: unknown; error: unknown; count?: number }> {
      const table = getTable(this.tableName);
      const nowIso = new Date().toISOString();

      if (this.mode === "insert") {
        const rowsToInsert: TableRow[] = (this.payload as TableRow[]).map((raw): TableRow => ({
          id: raw.id ?? crypto.randomUUID(),
          created_at: raw.created_at ?? nowIso,
          updated_at: raw.updated_at ?? nowIso,
          ...clone(raw),
        }));

        if (this.tableName === "autopilot_jobs") {
          for (const candidate of rowsToInsert) {
            if (candidate.status === "queued" || candidate.status === "leased") {
              const conflict = table.some(
                (existing) =>
                  existing.workspace_id === candidate.workspace_id &&
                  existing.conversation_id === candidate.conversation_id &&
                  (existing.status === "queued" || existing.status === "leased"),
              );
              if (conflict) {
                return { data: null, error: { code: "23505", message: "duplicate active job" } };
              }
            }
          }
        }

        table.push(...rowsToInsert);
        return this.formatResult(rowsToInsert);
      }

      if (this.mode === "upsert") {
        const conflictCols = this.onConflict
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const upserted: TableRow[] = [];

        for (const raw of this.payload as TableRow[]) {
          const idx =
            conflictCols.length > 0
              ? table.findIndex((existing) => conflictCols.every((c) => existing[c] === raw[c]))
              : -1;
          if (idx >= 0) {
            table[idx] = { ...table[idx], ...clone(raw), updated_at: raw.updated_at ?? nowIso };
            upserted.push(table[idx]);
          } else {
            const inserted = {
              id: raw.id ?? crypto.randomUUID(),
              created_at: raw.created_at ?? nowIso,
              updated_at: raw.updated_at ?? nowIso,
              ...clone(raw),
            };
            table.push(inserted);
            upserted.push(inserted);
          }
        }
        return this.formatResult(upserted);
      }

      if (this.mode === "update") {
        const patch = clone(this.payload as TableRow);
        const matched: TableRow[] = [];
        for (let i = 0; i < table.length; i += 1) {
          if (this.filters.every((fn) => fn(table[i]))) {
            table[i] = { ...table[i], ...patch, updated_at: patch.updated_at ?? nowIso };
            matched.push(table[i]);
          }
        }
        return this.formatResult(matched);
      }

      // select
      let matched = table.filter((row) => this.filters.every((fn) => fn(row)));
      if (this.sortCol) {
        const col = this.sortCol;
        const dir = this.sortAsc ? 1 : -1;
        matched = [...matched].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
        });
      }
      if (this.limitNum !== null) {
        matched = matched.slice(0, this.limitNum);
      }
      if (this.headOnly) {
        return { data: null, error: null, count: matched.length };
      }
      return this.formatResult(matched);
    }

    private formatResult(rows: TableRow[]) {
      const copied = rows.map((r) => clone(r));
      if (this.expectSingle === "single") {
        if (copied.length === 0) {
          return { data: null, error: { message: "Row not found" } };
        }
        return { data: copied[0], error: null };
      }
      if (this.expectSingle === "maybe") {
        return { data: copied[0] ?? null, error: null };
      }
      return {
        data: this.wantsSelect ? copied : null,
        error: null,
        count: copied.length,
      };
    }
  }

  const client = {
    from(tableName: string) {
      return new QueryBuilder(tableName);
    },
    auth: {
      async getSession() {
        return { data: { session: null }, error: null };
      },
    },
  };

  const session: SupabaseWorkspaceSession = {
    kind: "supabase",
    actorId: ACTOR_ID,
    actorEmail: "founder@example.com",
    workspace: {
      id: WS_ID,
      name: "Phase 13C Test Workspace",
      slug: "phase-13c-test",
      role: "owner",
    },
    workspaces: [
      {
        id: WS_ID,
        name: "Phase 13C Test Workspace",
        slug: "phase-13c-test",
        role: "owner",
      },
    ],
    client: client as unknown as SupabaseWorkspaceSession["client"],
  };

  return { session, tables };
}

function makeFixtureData() {
  const brief: ResearchBrief = {
    offer: "Recall software",
    goal: "Book dental demos",
    businessLocation: "Malaysia",
    targetMarkets: ["Malaysia"],
    intakeComplete: true,
    marketHints: ["Dental"],
    locationHints: ["Malaysia"],
    buyerHints: ["Principal Dentist"],
    constraints: [],
    sourceMessageIds: [],
    unknowns: [],
  };

  const plan: ResearchPlan = {
    id: PLAN_ID,
    version: 1,
    approvalStatus: "approved",
    createdAt: NOW,
    summary: "Evaluate Malaysian multi-chair clinics",
    researchQuestions: ["What drives recall drop-off?", "Where is clinic concentration highest?"],
    comparisonCriteria: ["Clinic density", "Software readiness"],
    intendedSourceClasses: ["Industry bodies and primary research"],
    plannedScope: {
      markets: ["Malaysia"],
      industries: ["Dental Clinics"],
      buyerRoles: ["Principal Dentist"],
    },
    budget: {
      maximumSearches: 50,
      maximumFetches: 100,
      providerSpend: "not_available_in_phase_a",
    },
    uncertainties: [],
  };

  const conversation: ResearchConversationView = {
    conversation: {
      id: CONV_ID,
      title: "Recall software — Malaysia",
      status: "complete_without_research",
      threadId: "ano:thread:13c",
      createdAt: NOW,
      updatedAt: NOW,
    },
    run: {
      id: GRAPH_RUN_ID,
      status: "complete_without_research",
      graphVersion: "1",
      currentNode: "complete",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [],
    brief,
    pendingQuestion: null,
    plan,
    events: [],
  };

  const research: EvidenceResearchView = {
    run: {
      id: RESEARCH_RUN_ID,
      conversationId: CONV_ID,
      threadId: `ano:${WS_ID}:${CONV_ID}:evidence:${RESEARCH_RUN_ID}`,
      attemptNumber: 1,
      provider: "searxng",
      status: "sources_ready",
      maximumSearches: 50,
      maximumFetches: 100,
      consumedSearches: 6,
      consumedFetches: 8,
      currentWave: 2,
      sourceCount: 4,
      failureMessage: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    actions: [],
    queries: [],
    sources: [
      {
        id: CLAIM_ID,
        title: "Malaysia Dental Utilization Report",
        url: "https://moh.example.my/report",
        sourceClass: "official",
        excerpt: "Multi-chair private clinics grew 14% YoY.",
        publishedAt: NOW,
        retrievedAt: NOW,
        status: "fetched",
      },
    ],
  };

  const synthesis: MarketSynthesis = {
    id: "00000000-0000-4000-8000-0000000013cc",
    conversationId: CONV_ID,
    researchRunId: RESEARCH_RUN_ID,
    status: "ready_for_decision",
    recommendationMode: "directly_supported",
    assessment: {
      fetchedSourceCount: 4,
      sourceClassCount: 2,
      coverageStrength: "strong",
      comparisonReady: true,
      contradictions: [],
      gaps: [],
      summary: "Locked route ready",
    },
    claims: [
      {
        id: CLAIM_ID,
        kind: "observation",
        statement: "Demand confirmed across multi-chair dental groups.",
        sourceIds: [CLAIM_ID],
        comparisonBasis: null,
        evidenceStrength: "strong",
        citationStatus: "supported",
      },
    ],
    markets: [
      {
        id: MARKET_ID,
        name: "Malaysia",
        summary: "Urban private dental groups",
        evidenceStrength: "strong",
        claimIds: [CLAIM_ID],
        unknowns: [],
        nextResearchActions: [],
      },
    ],
    industries: [
      {
        id: INDUSTRY_ID,
        marketProfileId: MARKET_ID,
        name: "Dental Clinics",
        summary: "Multi-chair clinics",
        operationalProblems: ["Missed checkups"],
        solutionFit: ["Automated recalls"],
        buyerRoleHypotheses: ["Principal Dentist"],
        evidenceStrength: "strong",
        claimIds: [CLAIM_ID],
        unknowns: [],
      },
    ],
    decision: {
      id: DECISION_ID,
      status: "locked",
      marketProfileId: MARKET_ID,
      industryProfileId: INDUSTRY_ID,
      rationale: "Locked",
      selectedAt: NOW,
    },
    failureMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const account: AccountCandidateDossier = {
    id: "00000000-0000-4000-8000-000000020001",
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    companySearchId: SEARCH_ID,
    sourceKey: "prospeo:co-1",
    name: "SmileBay Dental",
    domain: "smilebay.example.my",
    website: "https://smilebay.example.my",
    linkedInUrl: null,
    industry: "Dental Clinics",
    location: "Malaysia",
    employeeBand: "11-50",
    employeeCount: 24,
    description: null,
    lifecycleState: "shortlisted",
    fit: {
      locationScore: 35,
      industryScore: 30,
      signalScore: 20,
      totalScore: 85,
      confidence: "high",
      rationale: "Strong fit.",
      industryHypothesisNote: "Matches confirmed dental buyer pattern.",
    },
    signals: [],
    claimIds: [CLAIM_ID],
    evidenceUrls: ["https://smilebay.example.my"],
    unknowns: [],
    retrievedAt: NOW,
  };

  const companySearch: CompanySearchView = {
    id: SEARCH_ID,
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    providerActionRequestId: null,
    providerKey: "prospeo",
    status: "completed",
    targetMarketName: "Malaysia",
    targetIndustryName: "Dental Clinics",
    requestedLocations: ["Malaysia"],
    canonicalLocations: ["Malaysia"],
    canonicalIndustries: ["Dental"],
    industryKeywords: ["dental"],
    excludedCategories: [],
    linkedClaimIds: [CLAIM_ID],
    criteria: ["Malaysia"],
    providerFilters: {},
    maximumResults: 25,
    estimatedMaximumCredits: 1,
    estimateDetail: "Bounded",
    resultCount: 1,
    providerReceipt: {},
    failureMessage: null,
    cohort: null,
    accounts: [account],
    approvedAt: NOW,
    completedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };

  const contact: ContactCandidateView = {
    id: "00000000-0000-4000-8000-000000030001",
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    personSearchId: PERSON_SEARCH_ID,
    accountCandidateId: account.id,
    accountName: account.name,
    accountDomain: account.domain,
    sourceKey: "prospeo:p-1",
    fullName: "Dr. Aina Lim",
    firstName: "Aina",
    lastName: "Lim",
    title: "Principal Dentist",
    department: null,
    seniority: null,
    linkedInUrl: null,
    location: "Malaysia",
    confidence: "high",
    roleRationale: "Primary decision-maker",
    selectedForVerification: false,
    verificationStatus: "verified",
    verifiedDetails: {
      email: "aina@smilebay.example.my",
      emailQualification: "valid",
      phone: null,
      verifiedDomain: "smilebay.example.my",
      provider: "prospeo",
      verifiedAt: NOW,
    },
    publicEmail: null,
    publicEmailKind: null,
    publicPhone: null,
    sourceUrl: "https://smilebay.example.my/team",
    claimIds: [CLAIM_ID],
    retrievedAt: NOW,
    verifiedAt: NOW,
  };

  const peopleView: PeopleDiscoveryView = {
    shortlistedCount: 1,
    personSearch: null,
    contacts: [contact],
    verificationRun: null,
    playbooks: [],
  };

  const templatePack: OutreachTemplatePackView = {
    id: "00000000-0000-4000-8000-000000040001",
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    version: 1,
    tone: "peer_direct",
    ctaStyle: "direct_question",
    entryOffer: null,
    senderName: null,
    targetRoles: ["Principal Dentist"],
    claimIds: [CLAIM_ID],
    generationMode: "fallback",
    lastInstruction: null,
    steps: [
      {
        stepKey: "initial",
        stepNumber: 1,
        label: "Initial outreach",
        channel: "email",
        dayOffset: 0,
        subject: "patient checkup reminders",
        body: "Hi {{first_name}}, quick note about recalls at {{company_name}}.",
        mergeFieldsUsed: ["{{first_name}}", "{{company_name}}"],
        lint: { passed: true, wordCount: 11, maxWords: 60, issues: [] },
      },
      {
        stepKey: "follow_up_1",
        stepNumber: 2,
        label: "Follow up 1",
        channel: "email",
        dayOffset: 3,
        subject: "following up on recalls",
        body: "Hi {{first_name}}, checking whether {{company_name}} handles six month recall reminders manually.",
        mergeFieldsUsed: ["{{first_name}}", "{{company_name}}"],
        lint: { passed: true, wordCount: 14, maxWords: 50, issues: [] },
      },
      {
        stepKey: "follow_up_2",
        stepNumber: 3,
        label: "Follow up 2",
        channel: "email",
        dayOffset: 7,
        subject: "closing the loop",
        body: "Hi {{first_name}}, happy to share a short workflow overview if helpful.",
        mergeFieldsUsed: ["{{first_name}}"],
        lint: { passed: true, wordCount: 12, maxWords: 30, issues: [] },
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };

  return { brief, plan, conversation, research, synthesis, companySearch, peopleView, templatePack };
}

function makeOrchestratorDeps(
  session: SupabaseWorkspaceSession,
  executedStagesLog: AutopilotExecutableStage[],
  options?: {
    onStage?: (stage: AutopilotExecutableStage) => Promise<void> | void;
    summariesPosted?: string[];
  },
): AutopilotOrchestratorDeps {
  const fx = makeFixtureData();

  return {
    readAutopilotRun,
    startOrResumeAutopilotRun,
    claimAutopilotStageLease,
    renewAutopilotStageLease,
    completeAutopilotStageLease: async (s, input) => {
      executedStagesLog.push(input.stage);
      return completeAutopilotStageLease(s, input);
    },
    failAutopilotStageLease,
    cancelAutopilotRun,
    checkBudget: async () => true,
    runWithUsageContext: async (_ctx, fn) => fn(),
    getConversation: async () => fx.conversation,
    readProductSources: async () => [],
    approvePlanForAutopilot: async () => fx.conversation,
    generateAndSaveAutopilotPlan: async () => fx.conversation,
    isSearxngAvailable: () => true,
    getEvidenceResearch: async () => {
      await options?.onStage?.("market_research");
      return fx.research;
    },
    prepareEvidenceResearch: async () => fx.research,
    startEvidenceResearch: async () => fx.research,
    ensureFallbackResearchRun: async () => fx.research,
    getMarketSynthesis: async () => {
      await options?.onStage?.("synthesis_and_lock");
      return fx.synthesis;
    },
    analyseMarketSynthesis: async () => fx.synthesis,
    ensureFallbackSynthesis: async () => fx.synthesis,
    lockMarketRoute: async () => fx.synthesis,
    isProspeoAvailable: () => true,
    getCompanySearch: async () => {
      await options?.onStage?.("company_discovery");
      return fx.companySearch;
    },
    runOsmSearch: async () => fx.companySearch,
    prepareProspeoCompanyPreview: async () => fx.companySearch,
    approveCompanySearch: async () => fx.companySearch,
    shortlistAccount: async () => fx.companySearch,
    isDropcontactAvailable: () => false,
    getPeopleDiscovery: async () => {
      await options?.onStage?.("people_and_emails");
      return fx.peopleView;
    },
    runWebsiteTeamDiscovery: async () => fx.peopleView,
    proposeProspeoPeople: async () => fx.peopleView,
    approvePersonSearch: async () => fx.peopleView,
    prepareContactVerification: async () => fx.peopleView,
    approveContactVerification: async () => fx.peopleView,
    getTemplatePack: async () => fx.templatePack,
    generateTemplatePack: async () => {
      await options?.onStage?.("outreach_templates");
      return fx.templatePack;
    },
    appendExecutiveSummaryMessage: async (_s, _c, text) => {
      options?.summariesPosted?.push(text);
    },
  };
}

async function collectFiles(dir: string, extensions: string[]): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full, extensions)));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

test("browser code never invokes /autopilot/step, uses read-only /autopilot/status observation, and Vercel timeouts are 300s", async () => {
  const clientFiles = [
    ...(await collectFiles(path.join(ROOT, "src/components"), [".ts", ".tsx"])),
    ...(await collectFiles(path.join(ROOT, "src/client"), [".ts", ".tsx"])),
    ...(await collectFiles(path.join(ROOT, "src/app"), [".ts", ".tsx"])).filter(
      (absPath) => !path.relative(path.join(ROOT, "src/app"), absPath).startsWith(`api${path.sep}`),
    ),
  ];

  for (const absPath of clientFiles) {
    const raw = await readFile(absPath, "utf8");
    const rel = path.relative(ROOT, absPath);
    assert.equal(
      /autopilot\/step/.test(raw),
      false,
      `Browser code must never call autopilot/step (${rel})`,
    );
  }

  const [workbenchRaw, progressCardRaw, startRouteRaw, statusRouteRaw, convRouteRaw, messagesRouteRaw, workerRouteRaw, vercelRaw] =
    await Promise.all([
      readFile(path.join(ROOT, "src/components/research-conversation-workbench.tsx"), "utf8"),
      readFile(path.join(ROOT, "src/components/artifacts/autopilot-progress-card.tsx"), "utf8"),
      readFile(path.join(ROOT, "src/app/api/v1/conversations/[conversationId]/autopilot/start/route.ts"), "utf8"),
      readFile(path.join(ROOT, "src/app/api/v1/conversations/[conversationId]/autopilot/status/route.ts"), "utf8"),
      readFile(path.join(ROOT, "src/app/api/v1/conversations/[conversationId]/route.ts"), "utf8"),
      readFile(path.join(ROOT, "src/app/api/v1/conversations/[conversationId]/messages/route.ts"), "utf8"),
      readFile(path.join(ROOT, "src/app/api/internal/jobs/autopilot/route.ts"), "utf8"),
      readFile(path.join(ROOT, "vercel.json"), "utf8"),
    ]);

  assert.match(workbenchRaw, /\/autopilot\/status/);
  assert.match(workbenchRaw, /cache:\s*"no-store"/);
  assert.match(workbenchRaw, /addEventListener\("online"/);
  assert.match(workbenchRaw, /addEventListener\("visibilitychange"/);
  assert.equal(/Connection interrupted while stepping autopilot/.test(workbenchRaw), false);

  assert.match(progressCardRaw, /formatAutopilotOutcomeMessage/);
  assert.match(progressCardRaw, /safe to refresh or close this tab/i);

  assert.match(startRouteRaw, /scheduleAutopilotBackgroundExecution/);
  assert.match(startRouteRaw, /export const maxDuration = 300/);
  assert.match(statusRouteRaw, /ensureAutopilotWorkerProgress/);
  assert.match(statusRouteRaw, /export const maxDuration = 300/);
  assert.match(convRouteRaw, /ensureAutopilotWorkerProgress/);
  assert.match(convRouteRaw, /export const maxDuration = 300/);
  assert.match(messagesRouteRaw, /scheduleAutopilotBackgroundExecution/);
  assert.match(messagesRouteRaw, /export const maxDuration = 300/);
  assert.match(workerRouteRaw, /runGlobalAutopilotWorkerSweep/);
  assert.match(workerRouteRaw, /export const maxDuration = 300/);

  const vercelJson = JSON.parse(vercelRaw) as {
    functions: Record<string, { maxDuration: number }>;
    crons?: unknown;
  };
  assert.equal(vercelJson.crons, undefined);
  assert.equal(vercelJson.functions["src/app/api/v1/conversations/[conversationId]/autopilot/start/route.ts"]?.maxDuration, 300);
  assert.equal(vercelJson.functions["src/app/api/v1/conversations/[conversationId]/autopilot/status/route.ts"]?.maxDuration, 300);
  assert.equal(vercelJson.functions["src/app/api/internal/jobs/autopilot/route.ts"]?.maxDuration, 300);
});

test("server worker drains all 6 stages, renews lease heartbeats, coalesces duplicate triggers, and honors pause/resume", async () => {
  const { session, tables } = makeStatefulSupabaseSession();
  const started = await startOrResumeAutopilotRun(session, CONV_ID, {
    explicitApproval: true,
    authorityScope: DEFAULT_AUTOPILOT_AUTHORITY_SCOPE,
  });
  assert.equal(started.status, "running");
  assert.equal(tables.autopilot_jobs.length, 1);
  assert.equal(tables.autopilot_jobs[0].status, "queued");

  const executedStages: AutopilotExecutableStage[] = [];
  const summariesPosted: string[] = [];
  let renewCount = 0;
  let pausedOnce = false;

  const baseDeps = makeOrchestratorDeps(session, executedStages, {
    summariesPosted,
    onStage: async (stage) => {
      if (stage === "market_research") {
        await new Promise((r) => setTimeout(r, 260));
      }
    },
  });

  const deps: AutopilotOrchestratorDeps = {
    ...baseDeps,
    renewAutopilotStageLease: async (s, input) => {
      renewCount += 1;
      return renewAutopilotStageLease(s, input);
    },
    completeAutopilotStageLease: async (s, input) => {
      const doneRun = await completeAutopilotStageLease(s, input);
      if (input.stage === "synthesis_and_lock" && !pausedOnce) {
        pausedOnce = true;
        return cancelAutopilotRun(s, CONV_ID, "paused");
      }
      return doneRun;
    },
  };

  // Two concurrent drains coalesce in-process and pause cleanly after stage 3 completes.
  const [drainA, drainB] = await Promise.all([
    drainAutopilotRunWithDeps(session, CONV_ID, deps, {
      workerId: "worker-a",
      heartbeatIntervalMs: 100,
    }),
    drainAutopilotRunWithDeps(session, CONV_ID, deps, {
      workerId: "worker-b",
      heartbeatIntervalMs: 100,
    }),
  ]);

  assert.equal(drainA.reason, "paused");
  assert.equal(drainB.reason, "paused");
  assert.equal(drainA.autopilotRun?.status, "paused");
  assert.deepEqual(drainA.autopilotRun?.completedStages, [
    "brief_and_plan",
    "market_research",
    "synthesis_and_lock",
  ]);
  assert.ok(renewCount >= 2, `Expected >= 2 heartbeat renewals, saw ${renewCount}`);
  assert.equal(tables.autopilot_jobs[0].status, "paused");

  // Resume explicitly without re-running completed stages 1..3.
  executedStages.length = 0;
  await startOrResumeAutopilotRun(session, CONV_ID, {
    explicitApproval: true,
    authorityScope: DEFAULT_AUTOPILOT_AUTHORITY_SCOPE,
  });
  const resumed = await drainAutopilotRunWithDeps(session, CONV_ID, deps, {
    workerId: "worker-resume",
    heartbeatIntervalMs: 100,
  });

  assert.equal(resumed.reason, "completed");
  assert.equal(resumed.autopilotRun?.status, "completed");
  assert.deepEqual(resumed.executedStages, [
    "company_discovery",
    "people_and_emails",
    "outreach_templates",
  ]);
  assert.equal(executedStages.includes("brief_and_plan"), false);
  assert.equal(executedStages.includes("market_research"), false);
  assert.equal(executedStages.includes("synthesis_and_lock"), false);
  assert.equal(summariesPosted.length, 1);
  assert.equal(
    tables.autopilot_jobs.some((j) => j.status === "completed"),
    true,
  );
});

test("interrupted job recovery resumes expired stage lease without repeating completed stages and pauses at max recovery limit", async () => {
  const t0 = Date.now() - 300_000;
  const { session, tables } = makeStatefulSupabaseSession();

  await startOrResumeAutopilotRun(session, CONV_ID, {
    explicitApproval: true,
    authorityScope: DEFAULT_AUTOPILOT_AUTHORITY_SCOPE,
  });

  const executedStages: AutopilotExecutableStage[] = [];
  const deps = makeOrchestratorDeps(session, executedStages);

  // Worker 1 completes stages 1 and 2 cleanly.
  for (let i = 0; i < 2; i += 1) {
    await completeAutopilotStageLease(session, {
      runId: String(tables.autopilot_runs[0].id),
      conversationId: CONV_ID,
      leaseToken: (await claimAutopilotStageLease(session, CONV_ID, { now: t0 + i * 1_000 })).leaseToken!,
      stage: i === 0 ? "brief_and_plan" : "market_research",
      summary: {
        stage: i === 0 ? "brief_and_plan" : "market_research",
        status: "completed",
        headline: "Done",
        detail: "Completed cleanly.",
        metrics: {},
        warnings: [],
        completedAt: NOW,
      },
    });
  }

  // Worker 1 claims Stage 3 (synthesis_and_lock) with a 30s lease, then crashes before completing.
  const crashedClaim = await claimAutopilotStageLease(session, CONV_ID, {
    workerId: "crashed-worker-1",
    leaseDurationMs: 30_000,
    now: t0 + 5_000,
  });
  assert.equal(crashedClaim.claimed, true);
  assert.equal(crashedClaim.stage, "synthesis_and_lock");
  assert.equal((await readAutopilotRun(session, CONV_ID))?.stageInFlight, false);

  // Lease is expired at t0 + 120_000: recovery clears the orphaned lease & increments recoveryCount.
  const recovery = await recoverStaleAutopilotRuns(session, {
    conversationId: CONV_ID,
    now: t0 + 120_000,
  });
  assert.deepEqual(recovery.recoveredConversationIds, [CONV_ID]);
  assert.deepEqual(recovery.pausedConversationIds, []);

  const afterRecovery = await readAutopilotRun(session, CONV_ID);
  assert.equal(afterRecovery?.recoveryCount, 1);
  assert.equal(afterRecovery?.stageInFlight, false);
  assert.match(afterRecovery?.progressDetail ?? "", /Continuing from saved progress/);
  assert.equal(tables.autopilot_jobs[0].status, "queued");

  // Worker 2 drains from stage 3..6 without repeating stages 1 or 2.
  const drained = await drainAutopilotRunWithDeps(session, CONV_ID, deps, {
    workerId: "worker-2",
    now: () => t0 + 125_000,
  });
  assert.equal(drained.reason, "completed");
  assert.deepEqual(drained.executedStages, [
    "synthesis_and_lock",
    "company_discovery",
    "people_and_emails",
    "outreach_templates",
  ]);
  assert.equal(executedStages.includes("brief_and_plan"), false);
  assert.equal(executedStages.includes("market_research"), false);

  // Verify infinite-crash protection: once recoveryCount reaches AUTOPILOT_MAX_RECOVERIES (3),
  // an expired lease pauses safely instead of looping.
  const { session: capSession, tables: capTables } = makeStatefulSupabaseSession();
  await startOrResumeAutopilotRun(capSession, CONV_ID, {
    explicitApproval: true,
    authorityScope: DEFAULT_AUTOPILOT_AUTHORITY_SCOPE,
  });
  await claimAutopilotStageLease(capSession, CONV_ID, {
    workerId: "crashed-worker-loop",
    leaseDurationMs: 5_000,
    now: t0,
  });
  capTables.autopilot_runs[0].recovery_count = AUTOPILOT_MAX_RECOVERIES;

  const capRecovery = await recoverStaleAutopilotRuns(capSession, {
    conversationId: CONV_ID,
    now: t0 + 60_000,
  });
  assert.deepEqual(capRecovery.recoveredConversationIds, []);
  assert.deepEqual(capRecovery.pausedConversationIds, [CONV_ID]);

  const pausedRun = await readAutopilotRun(capSession, CONV_ID);
  assert.equal(pausedRun?.status, "paused");
  assert.match(pausedRun?.lastError ?? "", /repeated interruptions/i);
  assert.equal(capTables.autopilot_jobs[0].status, "paused");
});

test("mid-wave Stage 2 research interruption recovers expired lease without retrying uncertain provider request and preserves saved wave checkpoint", async () => {
  const fx = makeFixtureData();
  const expiredHeartbeat = new Date(Date.now() - 180_000).toISOString();
  const parentActionId = "00000000-0000-4000-8000-0000000013d1";
  const uncertainFetchId = "00000000-0000-4000-8000-0000000013d2";
  const waveId = "00000000-0000-4000-8000-0000000013d3";
  const originalThreadId = `ano:${WS_ID}:${CONV_ID}:evidence:${RESEARCH_RUN_ID}`;

  const { session, tables } = makeStatefulSupabaseSession({
    ano_research_runs: [
      {
        id: RESEARCH_RUN_ID,
        workspace_id: WS_ID,
        conversation_id: CONV_ID,
        graph_run_id: GRAPH_RUN_ID,
        research_plan_id: PLAN_ID,
        thread_id: originalThreadId,
        attempt_number: 1,
        provider_key: "searxng",
        status: "running",
        maximum_searches: 50,
        maximum_fetches: 100,
        consumed_searches: 5,
        consumed_fetches: 2,
        current_wave: 1,
        coverage_json: {
          fetchedSourceCount: 1,
          distinctDomains: 1,
          sourceClasses: ["official"],
          coveredMarkets: ["Malaysia"],
          gaps: ["Need Singapore comparison data"],
          comparisonReady: false,
        },
        query_plan_json: [
          {
            id: "00000000-0000-4000-8000-0000000013d4",
            query: "malaysia private dental clinic statistics",
            reason: "Check market size",
            candidateMarket: "Malaysia",
            comparisonDimension: "market_density",
            sourceClass: "Government and official statistics",
            priority: 10,
          },
        ],
        failure_message: null,
        heartbeat_at: expiredHeartbeat,
        created_at: expiredHeartbeat,
        updated_at: expiredHeartbeat,
      },
    ],
    provider_action_requests: [
      {
        id: parentActionId,
        workspace_id: WS_ID,
        ano_research_run_id: RESEARCH_RUN_ID,
        provider_key: "searxng",
        action_kind: "research_run",
        request_key: "research-run",
        request_json: { provider: "searxng", maximumSearches: 50, maximumFetches: 100 },
        status: "running",
        maximum_operations: 150,
        reported_credits: null,
        created_at: expiredHeartbeat,
      },
      {
        id: uncertainFetchId,
        workspace_id: WS_ID,
        ano_research_run_id: RESEARCH_RUN_ID,
        provider_key: "searxng",
        action_kind: "fetch",
        request_key: "fetch:uncertain-1",
        request_json: { count: 1, canonicalUrl: "https://example.sg/report" },
        status: "running",
        maximum_operations: 1,
        reported_credits: null,
        created_at: expiredHeartbeat,
      },
    ],
    research_waves: [
      {
        id: waveId,
        workspace_id: WS_ID,
        ano_research_run_id: RESEARCH_RUN_ID,
        wave_number: 1,
        candidate_markets_json: ["Malaysia", "Singapore"],
        status: "running",
      },
    ],
    research_sources: [
      {
        id: CLAIM_ID,
        workspace_id: WS_ID,
        ano_research_run_id: RESEARCH_RUN_ID,
        title: "Malaysia Health Statistics",
        canonical_url: "https://moh.example.my/report",
        source_class: "official",
        supporting_excerpt: "Private dental visits rose 14%.",
        published_at: NOW,
        retrieved_at: expiredHeartbeat,
        status: "fetched",
      },
    ],
  });

  const prevUrl = process.env.SEARXNG_BASE_URL;
  const prevToken = process.env.SEARXNG_GATEWAY_TOKEN;
  process.env.SEARXNG_BASE_URL = "https://search.example.com";
  process.env.SEARXNG_GATEWAY_TOKEN = "test-gateway-token";

  try {
    // Re-entering prepareEvidenceResearchRun recovers the expired research lease on the SAME run
    // without starting from scratch or discarding Wave 1 sources.
    const prepared = await prepareEvidenceResearchRun(session, fx.conversation, {
      maximumSearches: 50,
      maximumFetches: 100,
    });
    assert.ok(prepared);
    assert.equal(prepared.run.id, RESEARCH_RUN_ID);
    assert.equal(prepared.run.status, "requires_manual_review");
    assert.equal(prepared.sources.length, 1);

    // The in-flight fetch was marked requires_manual_review (not retried automatically).
    const uncertainRow = tables.provider_action_requests.find((r) => r.id === uncertainFetchId);
    assert.equal(uncertainRow?.status, "requires_manual_review");

    // Claiming the recovered run resumes LangGraph from assess_coverage on a :resume: continuation thread
    // with Wave 1 candidateMarkets preserved.
    const claim = await claimEvidenceResearchRun(session, RESEARCH_RUN_ID);
    assert.equal(claim.claimed, true);
    assert.equal(claim.startNode, "assess_coverage");
    assert.ok(claim.threadId?.startsWith(`${originalThreadId}:resume:`));
    assert.deepEqual(claim.candidateMarkets, ["Malaysia", "Singapore"]);
    assert.deepEqual(claim.priorQueries, ["malaysia private dental clinic statistics"]);
  } finally {
    if (prevUrl === undefined) delete process.env.SEARXNG_BASE_URL;
    else process.env.SEARXNG_BASE_URL = prevUrl;
    if (prevToken === undefined) delete process.env.SEARXNG_GATEWAY_TOKEN;
    else process.env.SEARXNG_GATEWAY_TOKEN = prevToken;
  }
});

test("formatAutopilotOutcomeMessage strips engineering errors/secrets/vendors while preserving domain guidance, and /api/internal/jobs/autopilot enforces bearer auth", async () => {
  const leakingInputs = [
    "TypeError: fetch failed",
    "read ECONNRESET at TLSSocket.onStreamRead (node:internal/stream_base_commons:218:20)",
    "Google AI Studio model gemini-3.5-flash-lite returned HTTP 503 with PROSPEO_KEY=secret123",
    "Prospeo Dropcontact SearXNG LangGraph Supabase failed",
    "Invalid stage_lease_token update on autopilot_runs for company_discovery",
  ];

  const leakedPattern =
    /TypeError|fetch failed|ECONNRESET|TLSSocket|gemini-|HTTP\s*503|PROSPEO_KEY|secret123|Prospeo|Dropcontact|SearXNG|LangGraph|Supabase|stage_lease_token|autopilot_runs|company_discovery/i;

  for (const raw of leakingInputs) {
    const cleanError = formatAutopilotOutcomeMessage(raw, {
      stage: "company_discovery",
      kind: "error",
    });
    const cleanWarning = formatAutopilotOutcomeMessage(raw, {
      stage: "company_discovery",
      kind: "warning",
    });
    assert.equal(leakedPattern.test(cleanError), false, `Leaked error text: ${cleanError}`);
    assert.equal(leakedPattern.test(cleanWarning), false, `Leaked warning text: ${cleanWarning}`);
  }

  assert.match(
    describeAutopilotStageProgress("market_research", {
      wave: 2,
      maxWaves: 3,
      savedSources: 7,
    }),
    /wave 2 of 3 · 7 sources saved/,
  );

  // Preserve helpful domain guidance unchanged.
  const guidance =
    'Could not verify "United States National Market" as a geographic location. Enter a country, state, or city.';
  assert.equal(
    formatAutopilotOutcomeMessage(guidance, { stage: "company_discovery", kind: "warning" }),
    guidance,
  );

  // Internal worker route enforces configured bearer token via timingSafeEqual.
  const prevWorkerSecret = process.env.ANO_WORKER_SECRET;
  const prevCronSecret = process.env.CRON_SECRET;
  const prevServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevSupabaseSecret = process.env.SUPABASE_SECRET_KEY;

  delete process.env.ANO_WORKER_SECRET;
  delete process.env.CRON_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;

  try {
    const unconfigured = await internalWorkerPost(
      new Request("http://localhost/api/internal/jobs/autopilot", { method: "POST" }),
    );
    assert.equal(unconfigured.status, 503);

    process.env.ANO_WORKER_SECRET = "expected-worker-secret-token";
    const missingAuth = await internalWorkerGet(
      new Request("http://localhost/api/internal/jobs/autopilot", { method: "GET" }),
    );
    assert.equal(missingAuth.status, 401);

    const wrongAuth = await internalWorkerPost(
      new Request("http://localhost/api/internal/jobs/autopilot", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-token" },
      }),
    );
    assert.equal(wrongAuth.status, 401);

    const authorized = await internalWorkerPost(
      new Request("http://localhost/api/internal/jobs/autopilot", {
        method: "POST",
        headers: { Authorization: "Bearer expected-worker-secret-token" },
      }),
    );
    assert.equal(authorized.status, 200);
    const body = (await authorized.json()) as { ok: boolean; configured: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.configured, false);
  } finally {
    if (prevWorkerSecret === undefined) delete process.env.ANO_WORKER_SECRET;
    else process.env.ANO_WORKER_SECRET = prevWorkerSecret;
    if (prevCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCronSecret;
    if (prevServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = prevServiceKey;
    if (prevSupabaseSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = prevSupabaseSecret;
  }
});

test("AUTOPILOT_STAGES stays locked at 6 stages", () => {
  assert.equal(AUTOPILOT_STAGES.length, 6);
});

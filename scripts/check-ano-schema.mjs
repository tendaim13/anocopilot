import { readFile } from "node:fs/promises";
import { Client } from "pg";

if (process.env.ANO_DATABASE_LABEL !== "ano") {
  throw new Error("Refusing to inspect: set ANO_DATABASE_LABEL=ano for the dedicated Ano database.");
}

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is required to inspect Ano’s schema.");
}

const requiredTables = [
  "workspaces", "workspace_domains", "workspace_members", "connector_connections", "research_runs",
  "account_candidates", "contact_candidates", "evidence_items", "scorecards", "briefs", "work_items",
  "proposals", "approval_decisions", "audit_logs", "notifications", "icp_profiles", "icp_briefs", "product_briefs", "market_hypotheses", "market_decisions", "market_scans", "provider_company_searches", "ano_schema_migrations",
  "ano_conversations", "ano_graph_runs", "ano_graph_checkpoints", "ano_messages", "research_briefs", "research_questions", "research_plans", "ano_graph_decisions", "run_events",
  "ano_research_runs", "provider_action_requests", "research_search_results", "research_sources",
  "ano_research_syntheses", "research_claims", "market_profiles", "industry_profiles", "target_decisions",
  "research_waves", "research_queries", "research_source_assessments",
  "provider_person_searches", "contact_verification_runs", "account_playbooks", "outreach_drafts",
  "outreach_template_packs",
  "conversation_product_sources",
  "autopilot_runs",
  "autopilot_jobs",
  "workspace_invites",
];
const requiredMigrations = [
  "20261021_000001_ano_workspace_and_research",
  "20261021_000002_manual_workspace_records",
  "20261021_000003_icp_profiles",
  "20261022_000004_market_discovery_phase_a",
  "20261022_000005_market_discovery_runtime",
  "20261022_000006_prospeo_company_discovery",
  "20261023_000007_langgraph_research_foundation",
  "20261023_000008_controlled_tavily_research",
  "20261023_000009_evidence_research_attempts",
  "20261023_000010_fix_evidence_attempt_constraint",
  "20261023_000011_searxng_research_provider",
  "20261024_000012_phase_c_market_synthesis",
  "20261024_000013_iterative_deep_research",
  "20261030_000014_run_event_update_policy",
  "20261030_000015_durable_research_leases",
  "20261030_000016_phase_c_recommendation_reports",
  "20261121_000017_phase_d_target_to_account_discovery",
  "20261121_000018_phase_e_people_verification_playbooks",
  "20261121_000019_phase_f_outreach_and_mercury_proposals",
  "20261121_000020_phase_d_openstreetmap_discovery",
  "20261121_000021_phase_e_dual_source_buying_committee",
  "20261122_000022_phase_9a_multi_source_email_enrichment",
  "20261122_000023_phase_9b_outreach_template_packs",
  "20261124_000024_internal_api_usage_ledger",
  "20261124_000025_product_sources_and_intake",
  "20261124_000026_autopilot_runs",
  "20261124_000027_workspace_invite_links",
  "20261124_000028_autopilot_explicit_authority",
  "20261124_000029_durable_autopilot_jobs",
];

const databaseUrl = process.env.SUPABASE_DB_URL;

async function databaseSslConfig(url) {
  if (url.includes("localhost") || url.includes("127.0.0.1")) return false;

  const inlineCa = process.env.SUPABASE_DB_SSL_CA?.trim();
  if (inlineCa) {
    const ca = inlineCa.includes("BEGIN CERTIFICATE")
      ? inlineCa
      : Buffer.from(inlineCa, "base64").toString("utf8");
    return { rejectUnauthorized: true, ca };
  }

  const certificatePath = process.env.SUPABASE_DB_SSL_CA_PATH;
  if (!certificatePath) return { rejectUnauthorized: true };

  try {
    return { rejectUnauthorized: true, ca: await readFile(certificatePath, "utf8") };
  } catch {
    throw new Error("Ano could not read SUPABASE_DB_SSL_CA_PATH for strict database certificate verification.");
  }
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: await databaseSslConfig(databaseUrl),
});

try {
  await client.connect();
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
    [requiredTables],
  );
  const present = new Set(rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !present.has(table));
  const migrationResult = await client.query("select id from public.ano_schema_migrations where id = any($1::text[])", [requiredMigrations]);
  const appliedMigrations = new Set(migrationResult.rows.map((row) => row.id));
  const missingMigrations = requiredMigrations.filter((id) => !appliedMigrations.has(id));
  const checkpoints = await client.query(
    "select table_name from information_schema.tables where table_schema = 'ano_langgraph' and table_name = any($1::text[])",
    [["checkpoint_migrations", "checkpoints", "checkpoint_blobs", "checkpoint_writes"]],
  );
  const presentCheckpoints = new Set(checkpoints.rows.map((row) => row.table_name));
  const requiredCheckpoints = ["checkpoint_migrations", "checkpoints", "checkpoint_blobs", "checkpoint_writes"];
  const missingCheckpoints = requiredCheckpoints.filter((table) => !presentCheckpoints.has(table));
  const retryConstraints = await client.query(
    "select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.ano_research_runs'::regclass and contype = 'u'",
  );
  const constraintDefinitions = retryConstraints.rows.map((constraint) => constraint.definition);
  const expectedAttemptConstraint = "UNIQUE (workspace_id, conversation_id, research_plan_id, attempt_number)";
  const legacyAttemptConstraint = "UNIQUE (workspace_id, conversation_id, research_plan_id)";
  const attemptConstraintReady = constraintDefinitions.includes(expectedAttemptConstraint)
    && !constraintDefinitions.includes(legacyAttemptConstraint);
  const providerConstraints = await client.query(
    "select conrelid::regclass::text as table_name, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.ano_research_runs'::regclass, 'public.provider_action_requests'::regclass) and contype = 'c'",
  );
  const searxngProviderReady = providerConstraints.rows.filter((row) => /provider_key/.test(row.definition)).length === 2
    && providerConstraints.rows.filter((row) => /provider_key/.test(row.definition)).every((row) => /searxng/.test(row.definition) && /tavily/.test(row.definition));
  const deepResearchConstraints = await client.query(
    "select conrelid::regclass::text as table_name, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.ano_research_runs'::regclass, 'public.provider_action_requests'::regclass) and contype = 'c'",
  );
  const deepResearchDefinitions = deepResearchConstraints.rows.map((row) => row.definition);
  const hasUpperBound = (column, ceiling) => deepResearchDefinitions.some((definition) => new RegExp(`${column}[^)]*(?:<=|AND)\\s*\\(?${ceiling}\\)?`, "i").test(definition));
  const deepResearchLimitsReady = hasUpperBound("maximum_searches", 50)
    && hasUpperBound("maximum_fetches", 100)
    && hasUpperBound("maximum_operations", 150);
  const runEventPolicyResult = await client.query(
    "select policyname from pg_policies where schemaname = 'public' and tablename = 'run_events' and policyname = 'run_event_update'",
  );
  const runEventUpdateReady = runEventPolicyResult.rows.length === 1;
  const leaseColumns = await client.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and ((table_name = 'ano_research_runs' and column_name = 'heartbeat_at') or (table_name = 'ano_research_syntheses' and column_name = 'heartbeat_at'))",
  );
  const durableLeasesReady = leaseColumns.rows.length === 2;
  const recommendationColumns = await client.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and ((table_name = 'ano_research_syntheses' and column_name = 'recommendation_mode') or (table_name = 'research_claims' and column_name = 'comparison_basis'))",
  );
  const recommendationColumnsReady = recommendationColumns.rows.length === 2;
  const recommendationConstraints = await client.query(
    "select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid in ('public.ano_research_syntheses'::regclass, 'public.research_claims'::regclass) and contype = 'c'",
  );
  const recommendationDefinitions = recommendationConstraints.rows.map((row) => row.definition);
  const recommendationReportsReady = recommendationColumnsReady
    && recommendationDefinitions.some((definition) => /recommendation_mode/.test(definition) && /comparative_inference/.test(definition))
    && recommendationDefinitions.some((definition) => /claim_kind/.test(definition) && /comparable/.test(definition));
  const phaseDColumns = await client.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and ((table_name = 'account_candidates' and column_name = 'signals_json') or (table_name = 'provider_company_searches' and column_name = 'target_decision_id'))",
  );
  const phaseDCompanyDiscoveryReady = phaseDColumns.rows.length === 2;
  const phaseEColumns = await client.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and ((table_name = 'contact_candidates' and column_name = 'verification_status') or (table_name = 'account_playbooks' and column_name = 'evidence_backed_points_json'))",
  );
  const phaseEPeoplePlaybooksReady =
    present.has("provider_person_searches") &&
    present.has("contact_verification_runs") &&
    present.has("account_playbooks") &&
    phaseEColumns.rows.length === 2;
  const phaseFColumns = await client.query(
    "select table_name, column_name from information_schema.columns where table_schema = 'public' and ((table_name = 'outreach_drafts' and column_name = 'eligibility_status') or (table_name = 'proposals' and column_name = 'outreach_draft_id'))",
  );
  const phaseFOutreachProposalsReady =
    present.has("outreach_drafts") &&
    phaseFColumns.rows.length === 2;
  const phase9bTemplatesReady = present.has("outreach_template_packs");
  const internalLedgerResult = await client.query(`
    select
      to_regclass('ano_internal.api_usage_logs') is not null as has_table,
      not has_table_privilege('authenticated', 'ano_internal.api_usage_logs', 'SELECT') as no_auth_select,
      not has_table_privilege('anon', 'ano_internal.api_usage_logs', 'SELECT') as no_anon_select,
      exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'record_internal_api_usage'
      ) as has_record_rpc,
      exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'check_internal_usage_budget'
      ) as has_budget_rpc
  `);
  const internalRow = internalLedgerResult.rows[0] ?? {};
  const internalUsageLedgerReady = Boolean(
    internalRow.has_table &&
      internalRow.no_auth_select &&
      internalRow.no_anon_select &&
      internalRow.has_record_rpc &&
      internalRow.has_budget_rpc,
  );
  const intakeColumns = await client.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'research_briefs' and column_name = any($1::text[])",
    [["business_location", "target_markets_json", "intake_complete"]],
  );
  const phase10bProductIntakeReady =
    present.has("conversation_product_sources") && intakeColumns.rows.length === 3;
  const planApprovalModeColumns = await client.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'research_plans' and column_name = 'plan_approval_mode'",
  );
  const phase10cAutopilotReady =
    present.has("autopilot_runs") && planApprovalModeColumns.rows.length === 1;
  const inviteRpcResult = await client.query(`
    select
      count(*)::int as rpc_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any($1::text[])
  `, [["is_ano_workspace_admin", "ensure_personal_ano_workspace", "preview_workspace_invite", "accept_workspace_invite"]]);
  const phase11WorkspaceInvitesReady =
    present.has("workspace_invites") && Number(inviteRpcResult.rows[0]?.rpc_count ?? 0) === 4;
  const phase13bAuthorityColumns = await client.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'autopilot_runs' and column_name = any($1::text[])",
    [["authority_scope_json", "authorized_at", "authorized_by"]],
  );
  const phase13bAuthorityReady = phase13bAuthorityColumns.rows.length === 3;
  const phase13cDurableColumns = await client.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'autopilot_runs' and column_name = any($1::text[])",
    [["lease_expires_at", "worker_id", "active_job_id", "recovery_count", "progress_detail"]],
  );
  const phase13cDurableJobsReady =
    present.has("autopilot_jobs") && phase13cDurableColumns.rows.length === 5;
  console.log(JSON.stringify({
    migrationReady: missing.length === 0 && missingMigrations.length === 0 && missingCheckpoints.length === 0 && attemptConstraintReady && searxngProviderReady && deepResearchLimitsReady && runEventUpdateReady && durableLeasesReady && recommendationReportsReady && phaseDCompanyDiscoveryReady && phaseEPeoplePlaybooksReady && phaseFOutreachProposalsReady && phase9bTemplatesReady && internalUsageLedgerReady && phase10bProductIntakeReady && phase10cAutopilotReady && phase11WorkspaceInvitesReady && phase13bAuthorityReady && phase13cDurableJobsReady,
    present: present.size,
    required: requiredTables.length,
    missing,
    missingMigrations,
    missingCheckpoints,
    attemptConstraintReady,
    searxngProviderReady,
    deepResearchLimitsReady,
    runEventUpdateReady,
    durableLeasesReady,
    recommendationReportsReady,
    phaseDCompanyDiscoveryReady,
    phaseEPeoplePlaybooksReady,
    phaseFOutreachProposalsReady,
    phase9bTemplatesReady,
    internalUsageLedgerReady,
    phase10bProductIntakeReady,
    phase10cAutopilotReady,
    phase11WorkspaceInvitesReady,
    phase13bAuthorityReady,
    phase13cDurableJobsReady,
  }));
  if (missing.length > 0 || missingMigrations.length > 0 || missingCheckpoints.length > 0 || !attemptConstraintReady || !searxngProviderReady || !deepResearchLimitsReady || !runEventUpdateReady || !durableLeasesReady || !recommendationReportsReady || !phaseDCompanyDiscoveryReady || !phaseEPeoplePlaybooksReady || !phaseFOutreachProposalsReady || !phase9bTemplatesReady || !internalUsageLedgerReady || !phase10bProductIntakeReady || !phase10cAutopilotReady || !phase11WorkspaceInvitesReady || !phase13bAuthorityReady || !phase13cDurableJobsReady) process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

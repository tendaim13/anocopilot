import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client, Pool } from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..");
const migrations = [
  {
    id: "20261021_000001_ano_workspace_and_research",
    file: path.join(projectRoot, "supabase/migrations/20261021_000001_ano_workspace_and_research.sql"),
  },
  {
    id: "20261021_000002_manual_workspace_records",
    file: path.join(projectRoot, "supabase/migrations/20261021_000002_manual_workspace_records.sql"),
  },
  {
    id: "20261021_000003_icp_profiles",
    file: path.join(projectRoot, "supabase/migrations/20261021_000003_icp_profiles.sql"),
  },
  {
    id: "20261022_000004_market_discovery_phase_a",
    file: path.join(projectRoot, "supabase/migrations/20261022_000004_market_discovery_phase_a.sql"),
  },
  {
    id: "20261022_000005_market_discovery_runtime",
    file: path.join(projectRoot, "supabase/migrations/20261022_000005_market_discovery_runtime.sql"),
  },
  {
    id: "20261022_000006_prospeo_company_discovery",
    file: path.join(projectRoot, "supabase/migrations/20261022_000006_prospeo_company_discovery.sql"),
  },
  {
    id: "20261023_000007_langgraph_research_foundation",
    file: path.join(projectRoot, "supabase/migrations/20261023_000007_langgraph_research_foundation.sql"),
  },
  {
    id: "20261023_000008_controlled_tavily_research",
    file: path.join(projectRoot, "supabase/migrations/20261023_000008_controlled_tavily_research.sql"),
  },
  {
    id: "20261023_000009_evidence_research_attempts",
    file: path.join(projectRoot, "supabase/migrations/20261023_000009_evidence_research_attempts.sql"),
  },
  {
    id: "20261023_000010_fix_evidence_attempt_constraint",
    file: path.join(projectRoot, "supabase/migrations/20261023_000010_fix_evidence_attempt_constraint.sql"),
  },
  {
    id: "20261023_000011_searxng_research_provider",
    file: path.join(projectRoot, "supabase/migrations/20261023_000011_searxng_research_provider.sql"),
  },
  {
    id: "20261024_000012_phase_c_market_synthesis",
    file: path.join(projectRoot, "supabase/migrations/20261024_000012_phase_c_market_synthesis.sql"),
  },
  {
    id: "20261024_000013_iterative_deep_research",
    file: path.join(projectRoot, "supabase/migrations/20261024_000013_iterative_deep_research.sql"),
  },
  {
    id: "20261030_000014_run_event_update_policy",
    file: path.join(projectRoot, "supabase/migrations/20261030_000014_run_event_update_policy.sql"),
  },
  {
    id: "20261030_000015_durable_research_leases",
    file: path.join(projectRoot, "supabase/migrations/20261030_000015_durable_research_leases.sql"),
  },
  {
    id: "20261030_000016_phase_c_recommendation_reports",
    file: path.join(projectRoot, "supabase/migrations/20261030_000016_phase_c_recommendation_reports.sql"),
  },
  {
    id: "20261121_000017_phase_d_target_to_account_discovery",
    file: path.join(projectRoot, "supabase/migrations/20261121_000017_phase_d_target_to_account_discovery.sql"),
  },
  {
    id: "20261121_000018_phase_e_people_verification_playbooks",
    file: path.join(projectRoot, "supabase/migrations/20261121_000018_phase_e_people_verification_playbooks.sql"),
  },
  {
    id: "20261121_000019_phase_f_outreach_and_mercury_proposals",
    file: path.join(projectRoot, "supabase/migrations/20261121_000019_phase_f_outreach_and_mercury_proposals.sql"),
  },
  {
    id: "20261121_000020_phase_d_openstreetmap_discovery",
    file: path.join(projectRoot, "supabase/migrations/20261121_000020_phase_d_openstreetmap_discovery.sql"),
  },
  {
    id: "20261121_000021_phase_e_dual_source_buying_committee",
    file: path.join(projectRoot, "supabase/migrations/20261121_000021_phase_e_dual_source_buying_committee.sql"),
  },
  {
    id: "20261122_000022_phase_9a_multi_source_email_enrichment",
    file: path.join(projectRoot, "supabase/migrations/20261122_000022_phase_9a_multi_source_email_enrichment.sql"),
  },
  {
    id: "20261122_000023_phase_9b_outreach_template_packs",
    file: path.join(projectRoot, "supabase/migrations/20261122_000023_phase_9b_outreach_template_packs.sql"),
  },
  {
    id: "20261124_000024_internal_api_usage_ledger",
    file: path.join(projectRoot, "supabase/migrations/20261124_000024_internal_api_usage_ledger.sql"),
  },
  {
    id: "20261124_000025_product_sources_and_intake",
    file: path.join(projectRoot, "supabase/migrations/20261124_000025_product_sources_and_intake.sql"),
  },
  {
    id: "20261124_000026_autopilot_runs",
    file: path.join(projectRoot, "supabase/migrations/20261124_000026_autopilot_runs.sql"),
  },
  {
    id: "20261124_000027_workspace_invite_links",
    file: path.join(projectRoot, "supabase/migrations/20261124_000027_workspace_invite_links.sql"),
  },
];

function requireAnoDatabaseUrl() {
  if (process.env.ANO_DATABASE_LABEL !== "ano") {
    throw new Error("Refusing to run: set ANO_DATABASE_LABEL=ano for the dedicated Ano database.");
  }

  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL is required to apply Ano’s schema. A service-role key cannot run DDL.");
  }

  return databaseUrl;
}

const databaseUrl = requireAnoDatabaseUrl();

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
  await client.query("begin");
  await client.query("set local lock_timeout = '8s'");
  await client.query("set local statement_timeout = '60s'");
  await client.query(`
    create table if not exists public.ano_schema_migrations (
      id text primary key,
      applied_at timestamptz not null default timezone('utc', now())
    )
  `);

  const existing = await client.query("select id from public.ano_schema_migrations where id = any($1::text[])", [migrations.map((migration) => migration.id)]);
  const applied = new Set(existing.rows.map((row) => row.id));
  const newMigrations = [];

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const sql = await readFile(migration.file, "utf8");
    await client.query(sql);
    await client.query("insert into public.ano_schema_migrations (id) values ($1)", [migration.id]);
    newMigrations.push(migration.id);
  }
  await client.query("commit");
  const checkpointer = new PostgresSaver(new Pool({ connectionString: databaseUrl, ssl: await databaseSslConfig(databaseUrl) }), undefined, { schema: "ano_langgraph" });
  await checkpointer.setup();
  await checkpointer.end();
  console.log(newMigrations.length ? `Applied Ano-only schema migrations: ${newMigrations.join(", ")}.` : "Ano schema is already current.");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(error instanceof Error ? error.message : "Ano schema application failed.");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

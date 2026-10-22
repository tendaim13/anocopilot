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
  "proposals", "approval_decisions", "audit_logs", "notifications", "icp_profiles", "icp_briefs", "product_briefs", "market_hypotheses", "market_decisions", "ano_schema_migrations",
];
const requiredMigrations = [
  "20261021_000001_ano_workspace_and_research",
  "20261021_000002_manual_workspace_records",
  "20261021_000003_icp_profiles",
  "20261022_000004_market_discovery_phase_a",
];

const databaseUrl = process.env.SUPABASE_DB_URL;

async function databaseSslConfig(url) {
  if (url.includes("localhost") || url.includes("127.0.0.1")) return false;

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
  console.log(JSON.stringify({
    migrationReady: missing.length === 0 && missingMigrations.length === 0,
    present: present.size,
    required: requiredTables.length,
    missing,
    missingMigrations,
  }));
  if (missing.length > 0 || missingMigrations.length > 0) process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

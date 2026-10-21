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
  "proposals", "approval_decisions", "audit_logs", "notifications", "ano_schema_migrations",
];

const databaseUrl = process.env.SUPABASE_DB_URL;
const client = new Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1") ? false : { rejectUnauthorized: true },
});

try {
  await client.connect();
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
    [requiredTables],
  );
  const present = new Set(rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !present.has(table));
  console.log(JSON.stringify({ migrationReady: missing.length === 0, present: present.size, required: requiredTables.length, missing }));
  if (missing.length > 0) process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

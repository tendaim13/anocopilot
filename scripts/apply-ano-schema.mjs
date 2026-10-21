import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..");
const migration = {
  id: "20261021_000001_ano_workspace_and_research",
  file: path.join(projectRoot, "supabase/migrations/20261021_000001_ano_workspace_and_research.sql"),
};

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

  const existing = await client.query("select id from public.ano_schema_migrations where id = $1", [migration.id]);
  if (existing.rowCount) {
    await client.query("commit");
    console.log(`Ano schema is already at ${migration.id}.`);
  } else {
    const sql = await readFile(migration.file, "utf8");
    await client.query(sql);
    await client.query("insert into public.ano_schema_migrations (id) values ($1)", [migration.id]);
    await client.query("commit");
    console.log(`Applied Ano-only schema migration ${migration.id}.`);
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(error instanceof Error ? error.message : "Ano schema application failed.");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

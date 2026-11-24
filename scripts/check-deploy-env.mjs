import { fileURLToPath } from "node:url";

const REQUIRED_DEPLOY_VARS = [
  "SUPABASE_DB_URL",
  "ANO_DATABASE_LABEL",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "ANO_SMOKE_AUTH_EMAIL",
  "ANO_SMOKE_AUTH_PASSWORD",
];

/**
 * Validates required production deployment, migration, and authenticated smoke-check
 * environment secrets cleanly without ever echoing secret values.
 */
export function validateProductionDeployEnv(env = process.env) {
  const missing = [];
  const invalid = [];

  for (const key of REQUIRED_DEPLOY_VARS) {
    const raw = String(env?.[key] ?? "").trim();
    if (!raw) {
      missing.push(key);
    }
  }

  const label = String(env?.ANO_DATABASE_LABEL ?? "").trim();
  if (label && label !== "ano") {
    invalid.push("ANO_DATABASE_LABEL must equal 'ano'");
  }

  const allowLocal = String(env?.ANO_ALLOW_LOCAL_DEPLOY_CHECK ?? "").trim() === "true";
  const dbUrl = String(env?.SUPABASE_DB_URL ?? "").trim();
  if (dbUrl) {
    let parsedDb = null;
    try {
      parsedDb = new URL(dbUrl);
    } catch {
      invalid.push("SUPABASE_DB_URL must be a valid postgres connection URI");
    }
    if (parsedDb) {
      if (parsedDb.protocol !== "postgres:" && parsedDb.protocol !== "postgresql:") {
        invalid.push("SUPABASE_DB_URL must use postgres:// or postgresql://");
      }
      const host = parsedDb.hostname.toLowerCase();
      if (!allowLocal && (host === "localhost" || host === "127.0.0.1" || host === "example.com" || host.endsWith(".example.com"))) {
        invalid.push("SUPABASE_DB_URL must target Ano's real Postgres instance rather than a placeholder/local host");
      }
    }
  }

  const supabaseUrl = String(env?.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (supabaseUrl) {
    let parsedSupabase = null;
    try {
      parsedSupabase = new URL(supabaseUrl);
    } catch {
      invalid.push("NEXT_PUBLIC_SUPABASE_URL must be a valid URL");
    }
    if (parsedSupabase) {
      if (parsedSupabase.protocol !== "https:" && !allowLocal) {
        invalid.push("NEXT_PUBLIC_SUPABASE_URL must use https://");
      }
      const host = parsedSupabase.hostname.toLowerCase();
      if (!allowLocal && (host === "example.supabase.co" || host.endsWith(".example.com"))) {
        invalid.push("NEXT_PUBLIC_SUPABASE_URL cannot use a CI placeholder host");
      }
    }
  }

  const smokeEmail = String(env?.ANO_SMOKE_AUTH_EMAIL ?? "").trim();
  if (smokeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smokeEmail)) {
    invalid.push("ANO_SMOKE_AUTH_EMAIL must be a valid email address");
  }

  return {
    ok: missing.length === 0 && invalid.length === 0,
    requiredCount: REQUIRED_DEPLOY_VARS.length,
    missing,
    invalid,
  };
}

const isEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  const result = validateProductionDeployEnv(process.env);
  if (!result.ok) {
    console.error(JSON.stringify(result));
    process.exit(1);
  }
  console.log(JSON.stringify(result));
}

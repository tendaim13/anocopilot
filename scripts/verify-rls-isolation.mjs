import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

async function databaseSslConfig(url, sslCaOverride) {
  if (url.includes("localhost") || url.includes("127.0.0.1")) return false;
  const inlineCa = (sslCaOverride ?? process.env.SUPABASE_DB_SSL_CA)?.trim();
  if (inlineCa) {
    const ca = inlineCa.includes("BEGIN CERTIFICATE")
      ? inlineCa
      : Buffer.from(inlineCa, "base64").toString("utf8");
    return { rejectUnauthorized: true, ca };
  }
  const certificatePath = process.env.SUPABASE_DB_SSL_CA_PATH;
  if (!certificatePath) return { rejectUnauthorized: true };
  return { rejectUnauthorized: true, ca: await readFile(certificatePath, "utf8") };
}

/**
 * Verifies real Postgres row-level security isolation between two ephemeral workspaces
 * inside an unconditionally rolled-back transaction.
 */
export async function runLiveTwoWorkspaceRlsCheck({
  databaseUrl = process.env.SUPABASE_DB_URL,
  databaseLabel = process.env.ANO_DATABASE_LABEL,
  sslCa,
} = {}) {
  if (databaseLabel !== "ano") {
    throw new Error("Refusing to run RLS check: set ANO_DATABASE_LABEL=ano for the dedicated Ano database.");
  }
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL is required to verify live Ano RLS policies.");
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: await databaseSslConfig(databaseUrl, sslCa),
  });

  const userAId = "00000000-0000-4000-8000-aaaaaaaaa001";
  const userBId = "00000000-0000-4000-8000-bbbbbbbbb002";
  const userAEmail = "rls-probe-a@rls-a.example.org";
  const userBEmail = "rls-probe-b@rls-b.example.org";

  const setAuthUser = async (userId, email) => {
    await client.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: userId, email, role: "authenticated" })],
    );
    await client.query("set local role authenticated");
  };

  try {
    await client.connect();
    await client.query("begin");

    await client.query(
      `
        insert into auth.users (id, aud, role, email, created_at, updated_at)
        values
          ($1, 'authenticated', 'authenticated', $2, now(), now()),
          ($3, 'authenticated', 'authenticated', $4, now(), now())
        on conflict (id) do nothing
      `,
      [userAId, userAEmail, userBId, userBEmail],
    );

    // 1. User A creates Workspace A and seeds tenant rows across key tables.
    await setAuthUser(userAId, userAEmail);
    const wsARes = await client.query(
      "select public.create_ano_workspace($1, $2) as workspace_id",
      ["RLS Probe Workspace A", `rls-probe-a-${Date.now()}`],
    );
    const workspaceAId = String(wsARes.rows[0].workspace_id);

    const convRes = await client.query(
      `
        insert into public.ano_conversations (workspace_id, created_by, title)
        values ($1, $2, 'Tenant A Private Conversation')
        returning id
      `,
      [workspaceAId, userAId],
    );
    const convAId = String(convRes.rows[0].id);

    const graphRunRes = await client.query(
      `
        insert into public.ano_graph_runs (workspace_id, conversation_id, graph_name, graph_version, active_thread_id, status)
        values ($1, $2, 'research_conversation', 'v1', 'thread-rls-a', 'complete_without_research')
        returning id
      `,
      [workspaceAId, convAId],
    );
    const graphRunAId = String(graphRunRes.rows[0].id);

    await client.query(
      `
        insert into public.research_briefs (workspace_id, conversation_id, content_json)
        values ($1, $2, '{"offer":"Confidential brief A"}'::jsonb)
      `,
      [workspaceAId, convAId],
    );

    await client.query(
      `
        insert into public.autopilot_runs (workspace_id, conversation_id, status, current_stage, created_by)
        values ($1, $2, 'running', 'brief_and_plan', $3)
      `,
      [workspaceAId, convAId, userAId],
    );

    await client.query(
      `
        insert into public.audit_logs (workspace_id, actor_id, event_type, outcome, details_json)
        values ($1, $2, 'rls.probe', 'completed', '{}'::jsonb)
      `,
      [workspaceAId, userAId],
    );

    // 2. Verify audit_logs immutability even for Workspace A owner.
    const auditUpdate = await client.query(
      "update public.audit_logs set outcome = 'tampered' where workspace_id = $1",
      [workspaceAId],
    );
    const auditDelete = await client.query(
      "delete from public.audit_logs where workspace_id = $1",
      [workspaceAId],
    );
    if ((auditUpdate.rowCount ?? 0) !== 0 || (auditDelete.rowCount ?? 0) !== 0) {
      throw new Error("audit_logs allowed client UPDATE or DELETE under authenticated role.");
    }

    // 3. Switch to User B (admin/owner of Workspace B, distinct email domain) and verify strict isolation.
    await client.query("reset role");
    await setAuthUser(userBId, userBEmail);
    const wsBRes = await client.query(
      "select public.create_ano_workspace($1, $2) as workspace_id",
      ["RLS Probe Workspace B", `rls-probe-b-${Date.now()}`],
    );
    const workspaceBId = String(wsBRes.rows[0].workspace_id);

    const leakedTables = [];
    for (const tableName of [
      "workspaces",
      "ano_conversations",
      "ano_graph_runs",
      "research_briefs",
      "autopilot_runs",
      "audit_logs",
    ]) {
      const col = tableName === "workspaces" ? "id" : "workspace_id";
      const readRes = await client.query(
        `select count(*)::int as cnt from public.${tableName} where ${col} = $1`,
        [workspaceAId],
      );
      if (Number(readRes.rows[0]?.cnt ?? 0) > 0) {
        leakedTables.push(tableName);
      }
    }
    if (leakedTables.length > 0) {
      throw new Error(`Cross-workspace SELECT leaked rows for Workspace A in: ${leakedTables.join(", ")}`);
    }

    let crossInsertBlocked = false;
    try {
      await client.query(
        `
          insert into public.ano_conversations (workspace_id, created_by, title)
          values ($1, $2, 'Cross-tenant write')
        `,
        [workspaceAId, userBId],
      );
    } catch {
      crossInsertBlocked = true;
    }
    if (!crossInsertBlocked) {
      throw new Error("Cross-workspace INSERT into Workspace A unexpectedly succeeded.");
    }

    let internalDenied = false;
    try {
      await client.query("select count(*) from ano_internal.api_usage_logs");
    } catch {
      internalDenied = true;
    }
    if (!internalDenied) {
      throw new Error("Authenticated role was able to read ano_internal.api_usage_logs.");
    }

    return {
      ok: true,
      workspaceAId,
      workspaceBId,
      graphRunAId,
      auditLogsImmutable: true,
      crossWorkspaceReadCount: 0,
      crossWorkspaceWriteBlocked: true,
      internalLedgerDenied: true,
    };
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

const isEntrypoint =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  runLiveTwoWorkspaceRlsCheck()
    .then((summary) => {
      console.log(JSON.stringify(summary));
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Live two-workspace RLS verification failed.",
        }),
      );
      process.exit(1);
    });
}

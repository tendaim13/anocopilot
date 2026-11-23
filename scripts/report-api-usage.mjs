import { readFile } from "node:fs/promises";
import { Client } from "pg";

if (process.env.ANO_DATABASE_LABEL !== "ano") {
  throw new Error("Refusing to run: set ANO_DATABASE_LABEL=ano for the dedicated Ano database.");
}

const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DB_URL is required to inspect internal API usage.");
}

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

function parseCliArgs(argv) {
  let days = 30;
  let provider = "all";
  let workspaceId = null;
  let json = false;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
    } else if (arg.startsWith("--days=")) {
      const value = arg.slice("--days=".length).trim().toLowerCase();
      if (value === "all") {
        days = null;
      } else {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`Invalid --days value "${value}". Use a positive integer or "all".`);
        }
        days = Math.floor(parsed);
      }
    } else if (arg.startsWith("--provider=")) {
      provider = arg.slice("--provider=".length).trim().toLowerCase() || "all";
    } else if (arg.startsWith("--workspace=")) {
      workspaceId = arg.slice("--workspace=".length).trim() || null;
    }
  }

  return { days, provider, workspaceId, json };
}

function formatTable(headers, rows) {
  const widths = headers.map((header, idx) =>
    Math.max(header.length, ...rows.map((row) => String(row[idx] ?? "").length)),
  );
  const pad = (row) =>
    row.map((cell, idx) => String(cell ?? "").padEnd(widths[idx])).join(" | ");
  const sep = widths.map((w) => "-".repeat(w)).join("-|-");
  return [pad(headers), sep, ...rows.map(pad)].join("\n");
}

const args = parseCliArgs(process.argv.slice(2));
const sinceIso =
  args.days === null
    ? null
    : new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();

const filters = [];
const values = [];

if (sinceIso) {
  values.push(sinceIso);
  filters.push(`created_at >= $${values.length}::timestamptz`);
}
if (args.provider && args.provider !== "all") {
  values.push(args.provider);
  filters.push(`provider = $${values.length}`);
}
if (args.workspaceId) {
  values.push(args.workspaceId);
  filters.push(`workspace_id = $${values.length}::uuid`);
}

const whereClause = filters.length > 0 ? `where ${filters.join(" and ")}` : "";

const client = new Client({
  connectionString: databaseUrl,
  ssl: await databaseSslConfig(databaseUrl),
});

try {
  await client.connect();

  const breakdownResult = await client.query(
    `
      select
        provider,
        operation,
        coalesce(model_or_endpoint, '-') as model_or_endpoint,
        count(*)::int as calls,
        coalesce(sum(request_count), 0)::int as requests,
        count(*) filter (where status in ('error', 'timeout', 'rate_limited'))::int as errors,
        round(coalesce(sum(credits_used), 0)::numeric, 4)::text as credits_used,
        coalesce(sum(input_tokens), 0)::bigint as input_tokens,
        coalesce(sum(output_tokens), 0)::bigint as output_tokens,
        round(coalesce(sum(estimated_cost_usd), 0)::numeric, 6)::text as estimated_cost_usd,
        coalesce(round(avg(duration_ms))::int, 0) as avg_duration_ms
      from ano_internal.api_usage_logs
      ${whereClause}
      group by provider, operation, coalesce(model_or_endpoint, '-')
      order by provider asc, calls desc, operation asc
    `,
    values,
  );

  const balancesResult = await client.query(
    `
      select distinct on (provider)
        provider,
        credits_remaining::text as credits_remaining,
        created_at as recorded_at
      from ano_internal.api_usage_logs
      where credits_remaining is not null
        ${args.workspaceId ? `and workspace_id = $1::uuid` : ""}
      order by provider, created_at desc
    `,
    args.workspaceId ? [args.workspaceId] : [],
  );

  const totalsResult = await client.query(
    `
      select
        count(*)::int as total_calls,
        coalesce(sum(request_count), 0)::int as total_requests,
        count(*) filter (where status in ('error', 'timeout', 'rate_limited'))::int as total_errors,
        round(coalesce(sum(credits_used), 0)::numeric, 4)::text as total_credits_used,
        coalesce(sum(input_tokens), 0)::bigint as total_input_tokens,
        coalesce(sum(output_tokens), 0)::bigint as total_output_tokens,
        round(coalesce(sum(estimated_cost_usd), 0)::numeric, 6)::text as total_estimated_cost_usd
      from ano_internal.api_usage_logs
      ${whereClause}
    `,
    values,
  );

  const payload = {
    windowDays: args.days ?? "all",
    providerFilter: args.provider,
    workspaceFilter: args.workspaceId,
    totals: totalsResult.rows[0] ?? {
      total_calls: 0,
      total_requests: 0,
      total_errors: 0,
      total_credits_used: "0",
      total_input_tokens: "0",
      total_output_tokens: "0",
      total_estimated_cost_usd: "0",
    },
    latestBalances: balancesResult.rows,
    breakdown: breakdownResult.rows,
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      `=== Ano Internal API Usage Report (window=${args.days === null ? "all" : `last ${args.days}d`}, provider=${args.provider}) ===\n`,
    );
    if (breakdownResult.rows.length === 0) {
      console.log("No internal API usage records matched this window.");
    } else {
      console.log(
        formatTable(
          [
            "Provider",
            "Operation",
            "Model / Endpoint",
            "Calls",
            "Reqs",
            "Errs",
            "Credits",
            "In Tok",
            "Out Tok",
            "Est USD",
            "Avg ms",
          ],
          breakdownResult.rows.map((r) => [
            r.provider,
            r.operation,
            r.model_or_endpoint,
            r.calls,
            r.requests,
            r.errors,
            r.credits_used,
            r.input_tokens,
            r.output_tokens,
            r.estimated_cost_usd,
            r.avg_duration_ms,
          ]),
        ),
      );
    }

    if (balancesResult.rows.length > 0) {
      console.log("\nLatest Known Provider Balances:");
      for (const row of balancesResult.rows) {
        console.log(
          `- ${row.provider}: ${row.credits_remaining} credits remaining (at ${new Date(row.recorded_at).toISOString()})`,
        );
      }
    }

    const t = payload.totals;
    console.log(
      `\nTotals: ${t.total_calls} calls | ${t.total_requests} HTTP requests | ${t.total_errors} errors | ${t.total_credits_used} credits | ${t.total_input_tokens} in / ${t.total_output_tokens} out tokens | $${t.total_estimated_cost_usd} est USD`,
    );
  }
} finally {
  await client.end().catch(() => undefined);
}

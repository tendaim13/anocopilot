// Server-only telemetry module (enforced by node:async_hooks and WorkspaceSession).

import { AsyncLocalStorage } from "node:async_hooks";

import type { WorkspaceSession } from "@/contracts/ano";

export type InternalApiProvider =
  | "gemini"
  | "bedrock"
  | "ollama"
  | "searxng"
  | "prospeo"
  | "dropcontact"
  | "openstreetmap"
  | "website_team"
  | "product_ingest";

export type InternalApiStatus =
  | "success"
  | "error"
  | "timeout"
  | "rate_limited"
  | "skipped_budget";

export type InternalApiUsageEntry = {
  provider: InternalApiProvider;
  operation: string;
  modelOrEndpoint?: string | null;
  status: InternalApiStatus;
  httpStatus?: number | null;
  requestCount?: number;
  creditsUsed?: number;
  creditsRemaining?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
};

export type InternalApiUsageRecord = {
  provider: InternalApiProvider;
  operation: string;
  modelOrEndpoint: string | null;
  status: InternalApiStatus;
  httpStatus: number | null;
  requestCount: number;
  creditsUsed: number;
  creditsRemaining: number | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number | null;
  metadata: Record<string, string | number | boolean>;
  workspaceId: string | null;
  conversationId: string | null;
  autopilotRunId: string | null;
};

type UsageContextStore = {
  session: WorkspaceSession;
  conversationId: string | null;
  autopilotRunId: string | null;
  pending: Promise<void>[];
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_METADATA_KEY_REGEX =
  /key|token|secret|password|auth|cookie|email|phone|html|body|prompt|content/i;
const FLUSH_TIMEOUT_MS = 2_500;

const usageStorage = new AsyncLocalStorage<UsageContextStore>();
let activeTestSink: ((record: InternalApiUsageRecord) => void) | null = null;

function parsePositiveEnvNumber(name: string, fallback?: number): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampNonNegativeInt(value: number | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function clampNonNegativeFloat(value: number | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function optionalUuid(value: string | null | undefined): string | null {
  return typeof value === "string" && UUID_REGEX.test(value.trim()) ? value.trim() : null;
}

export function sanitizeUsageMetadata(
  raw?: Record<string, unknown>,
): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== "object") return {};
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(clean).length >= 16) break;
    if (!key || SENSITIVE_METADATA_KEY_REGEX.test(key)) continue;
    const safeKey = key.slice(0, 64);
    if (typeof value === "boolean") {
      clean[safeKey] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      clean[safeKey] = value;
    } else if (typeof value === "string" && value.trim()) {
      clean[safeKey] = value.replace(/\s+/g, " ").trim().slice(0, 120);
    }
  }
  return clean;
}

export function estimateInternalApiCostUsd(
  entry: Pick<
    InternalApiUsageEntry,
    "provider" | "modelOrEndpoint" | "creditsUsed" | "inputTokens" | "outputTokens" | "estimatedCostUsd"
  >,
): number {
  if (typeof entry.estimatedCostUsd === "number" && Number.isFinite(entry.estimatedCostUsd)) {
    return Number(Math.max(0, entry.estimatedCostUsd).toFixed(6));
  }

  const inputTokens = clampNonNegativeInt(entry.inputTokens, 0);
  const outputTokens = clampNonNegativeInt(entry.outputTokens, 0);
  const creditsUsed = clampNonNegativeFloat(entry.creditsUsed, 0);
  const model = entry.modelOrEndpoint?.toLowerCase() ?? "";

  let cost = 0;
  if (entry.provider === "gemini") {
    const [inPerM, outPerM] = model.includes("pro")
      ? [1.25, 5.0]
      : model.includes("flash-lite")
        ? [0.1, 0.4]
        : [0.15, 0.6];
    cost = (inputTokens / 1_000_000) * inPerM + (outputTokens / 1_000_000) * outPerM;
  } else if (entry.provider === "bedrock") {
    cost = (inputTokens / 1_000_000) * 0.8 + (outputTokens / 1_000_000) * 3.2;
  } else if (entry.provider === "prospeo") {
    const perCredit = parsePositiveEnvNumber("ANO_PROSPEO_CREDIT_COST_USD", 0.015) ?? 0.015;
    cost = creditsUsed * perCredit;
  } else if (entry.provider === "dropcontact") {
    const perCredit = parsePositiveEnvNumber("ANO_DROPCONTACT_CREDIT_COST_USD", 0.025) ?? 0.025;
    cost = creditsUsed * perCredit;
  }

  return Number(Math.max(0, cost).toFixed(6));
}

export function setInternalUsageTestSink(
  sink: ((record: InternalApiUsageRecord) => void) | null,
) {
  activeTestSink = sink;
}

export async function runWithInternalUsageContext<T>(
  ctx: {
    session: WorkspaceSession;
    conversationId?: string | null;
    autopilotRunId?: string | null;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const store: UsageContextStore = {
    session: ctx.session,
    conversationId: ctx.conversationId ?? null,
    autopilotRunId: ctx.autopilotRunId ?? null,
    pending: [],
  };

  return await usageStorage.run(store, async () => {
    try {
      return await fn();
    } finally {
      if (store.pending.length > 0) {
        await Promise.race([
          Promise.allSettled(store.pending),
          new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
        ]);
      }
    }
  });
}

function buildInternalUsageRecord(
  entry: InternalApiUsageEntry,
  explicitCtx?: {
    session?: WorkspaceSession;
    conversationId?: string | null;
    autopilotRunId?: string | null;
  },
): {
  record: InternalApiUsageRecord;
  session: WorkspaceSession | undefined;
} {
  const store = usageStorage.getStore();
  const session = explicitCtx?.session ?? store?.session;
  const conversationId = optionalUuid(explicitCtx?.conversationId ?? store?.conversationId);
  const autopilotRunId = optionalUuid(explicitCtx?.autopilotRunId ?? store?.autopilotRunId);

  const record: InternalApiUsageRecord = {
    provider: entry.provider,
    operation: entry.operation.trim().slice(0, 80) || "unknown",
    modelOrEndpoint: entry.modelOrEndpoint?.trim()
      ? entry.modelOrEndpoint.trim().slice(0, 160)
      : null,
    status: entry.status,
    httpStatus:
      typeof entry.httpStatus === "number" && Number.isFinite(entry.httpStatus)
        ? Math.round(entry.httpStatus)
        : null,
    requestCount: clampNonNegativeInt(entry.requestCount, 1),
    creditsUsed: Number(clampNonNegativeFloat(entry.creditsUsed, 0).toFixed(4)),
    creditsRemaining:
      typeof entry.creditsRemaining === "number" && Number.isFinite(entry.creditsRemaining)
        ? Number(Math.max(0, entry.creditsRemaining).toFixed(4))
        : null,
    inputTokens: clampNonNegativeInt(entry.inputTokens, 0),
    outputTokens: clampNonNegativeInt(entry.outputTokens, 0),
    estimatedCostUsd: estimateInternalApiCostUsd(entry),
    durationMs:
      typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)
        ? clampNonNegativeInt(entry.durationMs, 0)
        : null,
    metadata: sanitizeUsageMetadata(entry.metadata),
    workspaceId: session?.workspace.id ?? null,
    conversationId,
    autopilotRunId,
  };

  if (activeTestSink) {
    try {
      activeTestSink(record);
    } catch {
      // Never allow test diagnostics to disrupt runtime execution.
    }
  }

  return { record, session };
}

function buildRecordUsageRpcPayload(record: InternalApiUsageRecord, workspaceId: string) {
  return {
    p_workspace_id: workspaceId,
    p_provider: record.provider,
    p_operation: record.operation,
    p_status: record.status,
    p_conversation_id: record.conversationId,
    p_autopilot_run_id: record.autopilotRunId,
    p_model_or_endpoint: record.modelOrEndpoint,
    p_http_status: record.httpStatus,
    p_request_count: record.requestCount,
    p_credits_used: record.creditsUsed,
    p_credits_remaining: record.creditsRemaining,
    p_input_tokens: record.inputTokens,
    p_output_tokens: record.outputTokens,
    p_estimated_cost_usd: record.estimatedCostUsd,
    p_duration_ms: record.durationMs,
    p_metadata_json: record.metadata,
  };
}

export function recordInternalApiUsage(
  entry: InternalApiUsageEntry,
  explicitCtx?: {
    session?: WorkspaceSession;
    conversationId?: string | null;
    autopilotRunId?: string | null;
  },
): void {
  const store = usageStorage.getStore();
  const { record, session } = buildInternalUsageRecord(entry, explicitCtx);

  if (!session || session.kind !== "supabase" || !UUID_REGEX.test(session.workspace.id)) {
    return;
  }

  const persistTask = (async () => {
    try {
      await session.client.rpc(
        "record_internal_api_usage",
        buildRecordUsageRpcPayload(record, session.workspace.id),
      );
    } catch {
      // Usage telemetry never fails or blocks non-paid product workflows.
    }
  })();

  if (store) {
    store.pending.push(persistTask);
  }
}

export async function recordInternalApiUsageStrict(
  entry: InternalApiUsageEntry,
  explicitCtx?: {
    session?: WorkspaceSession;
    conversationId?: string | null;
    autopilotRunId?: string | null;
  },
): Promise<boolean> {
  const { record, session } = buildInternalUsageRecord(entry, explicitCtx);

  if (!session || session.kind !== "supabase" || !UUID_REGEX.test(session.workspace.id)) {
    return false;
  }

  try {
    const { error } = await session.client.rpc(
      "record_internal_api_usage",
      buildRecordUsageRpcPayload(record, session.workspace.id),
    );
    return !error;
  } catch {
    return false;
  }
}

function defaultBudgetConfig(provider: InternalApiProvider): {
  limit?: number;
  metric: "credits" | "requests";
} {
  if (provider === "prospeo") {
    return {
      limit: parsePositiveEnvNumber("ANO_INTERNAL_DAILY_PROSPEO_LIMIT"),
      metric: "credits",
    };
  }
  if (provider === "dropcontact") {
    return {
      limit: parsePositiveEnvNumber("ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT"),
      metric: "credits",
    };
  }
  if (provider === "gemini" || provider === "bedrock") {
    return {
      limit: parsePositiveEnvNumber("ANO_INTERNAL_DAILY_LLM_CALL_LIMIT"),
      metric: "requests",
    };
  }
  if (provider === "searxng") {
    return {
      limit: parsePositiveEnvNumber("ANO_INTERNAL_DAILY_SEARXNG_LIMIT"),
      metric: "requests",
    };
  }
  return { limit: undefined, metric: "requests" };
}

export const PAID_INTERNAL_PROVIDERS = new Set<InternalApiProvider>([
  "prospeo",
  "dropcontact",
]);

export function isPaidInternalProvider(provider: InternalApiProvider): boolean {
  return PAID_INTERNAL_PROVIDERS.has(provider);
}

export function validateProductionPaidProviderBudgetConfig(
  env: Record<string, string | undefined> = process.env,
): { ok: boolean; missing: string[] } {
  if (env.NODE_ENV !== "production") {
    return { ok: true, missing: [] };
  }
  const required = [
    "ANO_INTERNAL_DAILY_PROSPEO_LIMIT",
    "ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT",
  ];
  const missing: string[] = [];
  for (const name of required) {
    const raw = env[name]?.trim();
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      missing.push(name);
    }
  }
  return { ok: missing.length === 0, missing };
}

export function isPaidProviderConfigured(
  provider: "prospeo" | "dropcontact",
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (provider === "prospeo") {
    return Boolean(env.PROSPEO_KEY?.trim());
  }
  return Boolean(env.DROPCONTACT_API_KEY?.trim());
}

/**
 * Full fail-closed authority & telemetry preflight for paid provider calls.
 * Blocks execution if provider credentials, daily budget limits, the usage
 * budget ledger check, OR strict usage logging is unavailable.
 */
export async function canExecutePaidProviderCall(
  session: WorkspaceSession,
  provider: "prospeo" | "dropcontact",
  options?: {
    dailyLimit?: number;
    metric?: "credits" | "requests";
    providerConfigured?: boolean;
  },
): Promise<boolean> {
  const configured = options?.providerConfigured ?? isPaidProviderConfigured(provider);
  if (!configured) {
    return false;
  }

  const defaults = defaultBudgetConfig(provider);
  const dailyLimit =
    typeof options?.dailyLimit === "number" && Number.isFinite(options.dailyLimit)
      ? options.dailyLimit
      : defaults.limit;
  const metric = options?.metric ?? defaults.metric;

  if (!dailyLimit || dailyLimit <= 0) {
    return false;
  }

  if (session.kind !== "supabase" || !UUID_REGEX.test(session.workspace.id)) {
    return false;
  }

  let budgetAllowed = false;
  try {
    const { data, error } = await session.client.rpc("check_internal_usage_budget", {
      p_workspace_id: session.workspace.id,
      p_provider: provider,
      p_daily_limit: dailyLimit,
      p_metric: metric,
    });
    if (error || typeof data !== "boolean") {
      return false;
    }
    budgetAllowed = data;
  } catch {
    return false;
  }

  if (!budgetAllowed) {
    await recordInternalApiUsageStrict(
      {
        provider,
        operation: "budget_guard",
        status: "skipped_budget",
        requestCount: 0,
        creditsUsed: 0,
        metadata: { metric, reason: "daily_limit_exceeded" },
      },
      { session },
    );
    return false;
  }

  return await recordInternalApiUsageStrict(
    {
      provider,
      operation: "authority_preflight",
      status: "success",
      requestCount: 0,
      creditsUsed: 0,
      metadata: { metric },
    },
    { session },
  );
}

/**
 * Checks whether a provider call remains inside the silent daily server budget.
 * Paid providers (Prospeo, Dropcontact) MUST fail closed if production daily
 * limits are unconfigured or the internal usage ledger RPC is unavailable.
 */
export async function checkInternalUsageBudget(
  session: WorkspaceSession,
  provider: InternalApiProvider,
  options?: {
    dailyLimit?: number;
    metric?: "credits" | "requests";
    isProduction?: boolean;
  },
): Promise<boolean> {
  const paid = isPaidInternalProvider(provider);
  const isProd = options?.isProduction ?? process.env.NODE_ENV === "production";
  const defaults = defaultBudgetConfig(provider);
  const dailyLimit =
    typeof options?.dailyLimit === "number" && Number.isFinite(options.dailyLimit)
      ? options.dailyLimit
      : defaults.limit;
  const metric = options?.metric ?? defaults.metric;

  if (paid && isProd && (!dailyLimit || dailyLimit <= 0)) {
    recordInternalApiUsage(
      {
        provider,
        operation: "budget_guard",
        status: "skipped_budget",
        requestCount: 0,
        creditsUsed: 0,
        metadata: { metric, reason: "missing_production_limit" },
      },
      { session },
    );
    return false;
  }

  if (!paid && (!dailyLimit || dailyLimit <= 0)) {
    return true;
  }

  if (session.kind !== "supabase" || !UUID_REGEX.test(session.workspace.id)) {
    if (paid && isProd) {
      return false;
    }
    return true;
  }

  const effectiveLimit =
    dailyLimit && dailyLimit > 0 ? dailyLimit : 1_000_000;

  try {
    const { data, error } = await session.client.rpc("check_internal_usage_budget", {
      p_workspace_id: session.workspace.id,
      p_provider: provider,
      p_daily_limit: effectiveLimit,
      p_metric: metric,
    });

    if (error || typeof data !== "boolean") {
      if (paid) {
        recordInternalApiUsage(
          {
            provider,
            operation: "budget_guard",
            status: "skipped_budget",
            requestCount: 0,
            creditsUsed: 0,
            metadata: { metric, reason: "usage_ledger_unavailable" },
          },
          { session },
        );
        return false;
      }
      return true;
    }

    if (data === false) {
      recordInternalApiUsage(
        {
          provider,
          operation: "budget_guard",
          status: "skipped_budget",
          requestCount: 0,
          creditsUsed: 0,
          metadata: { metric, reason: "daily_limit_exceeded" },
        },
        { session },
      );
      return false;
    }

    return true;
  } catch {
    if (paid) {
      recordInternalApiUsage(
        {
          provider,
          operation: "budget_guard",
          status: "skipped_budget",
          requestCount: 0,
          creditsUsed: 0,
          metadata: { metric, reason: "usage_ledger_unavailable" },
        },
        { session },
      );
      return false;
    }
    return true;
  }
}

import "server-only";

import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import {
  AUTOPILOT_STAGES,
  autopilotExecutableStageSchema,
  autopilotRunViewSchema,
  autopilotStageSummarySchema,
  nextPendingAutopilotStage,
  stagesBefore,
  type AutopilotExecutableStage,
  type AutopilotRunView,
  type AutopilotStage,
  type AutopilotStageSummary,
} from "@/lib/ano/autopilot";

export const AUTOPILOT_STAGE_LEASE_TIMEOUT_MS = 180_000;

export class AutopilotPersistenceError extends Error {
  constructor(
    message: string,
    readonly code: string = "AUTOPILOT_STORE_ERROR",
  ) {
    super(message);
    this.name = "AutopilotPersistenceError";
  }
}

type Row = Record<string, unknown>;

function requireLiveSession(
  session: WorkspaceSession,
): asserts session is SupabaseWorkspaceSession {
  if (session.kind === "demo") {
    throw new AutopilotPersistenceError(
      "Sign in before Ano can start or resume an autonomous pipeline run.",
      "AUTH_REQUIRED",
    );
  }
}

function iso(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AutopilotPersistenceError("Ano found an invalid autopilot timestamp.");
  }
  return date.toISOString();
}

function optionalIso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseCompletedStages(value: unknown): AutopilotExecutableStage[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set<AutopilotExecutableStage>();
  for (const item of value) {
    const parsed = autopilotExecutableStageSchema.safeParse(item);
    if (parsed.success) {
      valid.add(parsed.data);
    }
  }
  return AUTOPILOT_STAGES.filter((stage) => valid.has(stage));
}

function parseStageSummaries(
  value: unknown,
): Partial<Record<AutopilotExecutableStage, AutopilotStageSummary>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Partial<Record<AutopilotExecutableStage, AutopilotStageSummary>> = {};
  for (const [key, rawSummary] of Object.entries(value as Record<string, unknown>)) {
    const parsedStage = autopilotExecutableStageSchema.safeParse(key);
    const parsedSummary = autopilotStageSummarySchema.safeParse(rawSummary);
    if (parsedStage.success && parsedSummary.success) {
      out[parsedStage.data] = parsedSummary.data;
    }
  }
  return out;
}

function parseWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = item.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 20) break;
  }
  return out;
}

function isLeaseActive(row: Row, now = Date.now()): boolean {
  if (!row.stage_lease_token) return false;
  const rawTimestamp = row.stage_started_at ?? row.heartbeat_at ?? row.updated_at;
  const ms = rawTimestamp ? new Date(String(rawTimestamp)).getTime() : 0;
  if (!Number.isFinite(ms)) return false;
  return now - ms < AUTOPILOT_STAGE_LEASE_TIMEOUT_MS;
}

function mapAutopilotRow(row: Row): AutopilotRunView {
  return autopilotRunViewSchema.parse({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    status: String(row.status),
    currentStage: String(row.current_stage),
    completedStages: parseCompletedStages(row.completed_stages_json),
    stageSummaries: parseStageSummaries(row.stage_summaries_json),
    warnings: parseWarnings(row.warnings_json),
    lastError:
      typeof row.last_error === "string" && row.last_error.trim()
        ? row.last_error.trim().slice(0, 600)
        : null,
    stageInFlight: isLeaseActive(row),
    heartbeatAt: optionalIso(row.heartbeat_at),
    startedAt: optionalIso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

async function fetchAutopilotRow(
  session: SupabaseWorkspaceSession,
  conversationId: string,
): Promise<Row | null> {
  const { data, error } = await session.client
    .from("autopilot_runs")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (error) {
    throw new AutopilotPersistenceError(
      "Ano could not read the saved autopilot execution state.",
    );
  }
  return (data as Row | null) ?? null;
}

export async function readAutopilotRun(
  session: WorkspaceSession,
  conversationId: string,
): Promise<AutopilotRunView | null> {
  if (session.kind === "demo") {
    return null;
  }
  const row = await fetchAutopilotRow(session, conversationId);
  return row ? mapAutopilotRow(row) : null;
}

export async function startOrResumeAutopilotRun(
  session: WorkspaceSession,
  conversationId: string,
  options?: { fromStage?: AutopilotExecutableStage },
): Promise<AutopilotRunView> {
  requireLiveSession(session);
  const existing = await fetchAutopilotRow(session, conversationId);
  const now = new Date().toISOString();

  let completedStages = existing ? parseCompletedStages(existing.completed_stages_json) : [];
  let stageSummaries = existing ? parseStageSummaries(existing.stage_summaries_json) : {};
  let warnings = existing ? parseWarnings(existing.warnings_json) : [];

  if (options?.fromStage) {
    const keepStages = new Set(stagesBefore(options.fromStage));
    completedStages = completedStages.filter((stage) => keepStages.has(stage));
    const prunedSummaries: Partial<Record<AutopilotExecutableStage, AutopilotStageSummary>> = {};
    for (const stage of completedStages) {
      if (stageSummaries[stage]) {
        prunedSummaries[stage] = stageSummaries[stage];
      }
    }
    stageSummaries = prunedSummaries;
    warnings = completedStages.flatMap((stage) => stageSummaries[stage]?.warnings ?? []);
  }

  const nextStage = nextPendingAutopilotStage(completedStages);
  const nextStatus =
    nextStage === "done"
      ? warnings.length > 0
        ? "completed_with_warnings"
        : "completed"
      : "running";

  const { data, error } = await session.client
    .from("autopilot_runs")
    .upsert(
      {
        id: existing ? String(existing.id) : crypto.randomUUID(),
        workspace_id: session.workspace.id,
        conversation_id: conversationId,
        status: nextStatus,
        current_stage: nextStage,
        completed_stages_json: completedStages,
        stage_summaries_json: stageSummaries,
        warnings_json: warnings,
        stage_lease_token: null,
        stage_started_at: null,
        last_error: null,
        heartbeat_at: now,
        started_at: existing?.started_at ? String(existing.started_at) : now,
        completed_at: nextStage === "done" ? now : null,
        created_by: existing?.created_by ? String(existing.created_by) : session.actorId,
        updated_at: now,
      },
      { onConflict: "workspace_id,conversation_id" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new AutopilotPersistenceError(
      "Ano could not start or resume the autonomous pipeline run.",
    );
  }

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "autopilot.started",
    outcome: nextStatus,
    details_json: {
      conversation_id: conversationId,
      from_stage: options?.fromStage ?? null,
      next_stage: nextStage,
    },
  });

  return mapAutopilotRow(data as Row);
}

export async function claimAutopilotStageLease(
  session: WorkspaceSession,
  conversationId: string,
): Promise<{
  claimed: boolean;
  run: AutopilotRunView | null;
  stage: AutopilotStage;
  leaseToken: string | null;
  reason?: "not_found" | "not_running" | "already_done" | "in_flight";
}> {
  requireLiveSession(session);
  const row = await fetchAutopilotRow(session, conversationId);
  if (!row) {
    return {
      claimed: false,
      run: null,
      stage: "brief_and_plan",
      leaseToken: null,
      reason: "not_found",
    };
  }

  const runView = mapAutopilotRow(row);
  if (runView.status !== "running") {
    return {
      claimed: false,
      run: runView,
      stage: runView.currentStage,
      leaseToken: null,
      reason: "not_running",
    };
  }

  const nextStage = nextPendingAutopilotStage(runView.completedStages);
  if (nextStage === "done") {
    const now = new Date().toISOString();
    const finalStatus =
      runView.warnings.length > 0 ? "completed_with_warnings" : "completed";
    const { data: finalized } = await session.client
      .from("autopilot_runs")
      .update({
        status: finalStatus,
        current_stage: "done",
        stage_lease_token: null,
        stage_started_at: null,
        completed_at: runView.completedAt ?? now,
        heartbeat_at: now,
        updated_at: now,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", runView.id)
      .select("*")
      .maybeSingle();

    return {
      claimed: false,
      run: finalized ? mapAutopilotRow(finalized as Row) : runView,
      stage: "done",
      leaseToken: null,
      reason: "already_done",
    };
  }

  if (isLeaseActive(row)) {
    return {
      claimed: false,
      run: runView,
      stage: nextStage,
      leaseToken: null,
      reason: "in_flight",
    };
  }

  const now = new Date().toISOString();
  const leaseToken = crypto.randomUUID();

  let updateQuery = session.client
    .from("autopilot_runs")
    .update({
      stage_lease_token: leaseToken,
      stage_started_at: now,
      heartbeat_at: now,
      current_stage: nextStage,
      last_error: null,
      updated_at: now,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", runView.id)
    .eq("status", "running");

  if (row.stage_lease_token) {
    updateQuery = updateQuery.eq("stage_lease_token", String(row.stage_lease_token));
  } else {
    updateQuery = updateQuery.is("stage_lease_token", null);
  }

  const { data: claimedRow, error } = await updateQuery.select("*").maybeSingle();
  if (error) {
    throw new AutopilotPersistenceError(
      "Ano could not secure the next pipeline stage checkpoint.",
    );
  }

  if (!claimedRow) {
    const latest = await readAutopilotRun(session, conversationId);
    return {
      claimed: false,
      run: latest ?? runView,
      stage: nextStage,
      leaseToken: null,
      reason: "in_flight",
    };
  }

  return {
    claimed: true,
    run: mapAutopilotRow(claimedRow as Row),
    stage: nextStage,
    leaseToken,
  };
}

export async function completeAutopilotStageLease(
  session: WorkspaceSession,
  input: {
    runId: string;
    conversationId: string;
    leaseToken: string;
    stage: AutopilotExecutableStage;
    summary: AutopilotStageSummary;
    warnings?: string[];
  },
): Promise<AutopilotRunView> {
  requireLiveSession(session);
  const current = await fetchAutopilotRow(session, input.conversationId);
  if (!current || String(current.id) !== input.runId) {
    throw new AutopilotPersistenceError("Ano could not find the active autopilot run.");
  }

  const completedSet = new Set(parseCompletedStages(current.completed_stages_json));
  completedSet.add(input.stage);
  const completedStages = AUTOPILOT_STAGES.filter((stage) => completedSet.has(stage));

  const stageSummaries = parseStageSummaries(current.stage_summaries_json);
  stageSummaries[input.stage] = input.summary;

  const mergedWarnings = parseWarnings([
    ...parseWarnings(current.warnings_json),
    ...(input.warnings ?? []),
    ...input.summary.warnings,
  ]);

  const nextStage = nextPendingAutopilotStage(completedStages);
  const now = new Date().toISOString();
  const nextStatus =
    nextStage === "done"
      ? mergedWarnings.length > 0
        ? "completed_with_warnings"
        : "completed"
      : String(current.status) === "paused" || String(current.status) === "cancelled"
        ? String(current.status)
        : "running";

  const { data, error } = await session.client
    .from("autopilot_runs")
    .update({
      status: nextStatus,
      current_stage: nextStage,
      completed_stages_json: completedStages,
      stage_summaries_json: stageSummaries,
      warnings_json: mergedWarnings,
      stage_lease_token: null,
      stage_started_at: null,
      last_error: null,
      heartbeat_at: now,
      completed_at: nextStage === "done" ? now : null,
      updated_at: now,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", input.runId)
    .eq("stage_lease_token", input.leaseToken)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new AutopilotPersistenceError(
      "Ano could not save the completed autopilot stage checkpoint.",
    );
  }
  if (!data) {
    const refreshed = await readAutopilotRun(session, input.conversationId);
    if (refreshed) return refreshed;
    throw new AutopilotPersistenceError("Autopilot stage lease expired before completion.");
  }

  return mapAutopilotRow(data as Row);
}

export async function failAutopilotStageLease(
  session: WorkspaceSession,
  input: {
    runId: string;
    conversationId: string;
    leaseToken: string;
    errorMessage: string;
  },
): Promise<AutopilotRunView> {
  requireLiveSession(session);
  const now = new Date().toISOString();
  const cleanError = input.errorMessage.replace(/\s+/g, " ").trim().slice(0, 600);

  const { data, error } = await session.client
    .from("autopilot_runs")
    .update({
      status: "failed",
      stage_lease_token: null,
      stage_started_at: null,
      last_error: cleanError || "Autonomous pipeline stopped safely.",
      heartbeat_at: now,
      updated_at: now,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", input.runId)
    .eq("stage_lease_token", input.leaseToken)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new AutopilotPersistenceError(
      "Ano could not record the autopilot stop state.",
    );
  }
  if (!data) {
    const refreshed = await readAutopilotRun(session, input.conversationId);
    if (refreshed) return refreshed;
    throw new AutopilotPersistenceError("Autopilot run could not be updated.");
  }

  return mapAutopilotRow(data as Row);
}

export async function cancelAutopilotRun(
  session: WorkspaceSession,
  conversationId: string,
  mode: "paused" | "cancelled" = "paused",
): Promise<AutopilotRunView> {
  requireLiveSession(session);
  const existing = await fetchAutopilotRow(session, conversationId);
  if (!existing) {
    throw new AutopilotPersistenceError(
      "No autopilot run exists for this conversation yet.",
      "AUTOPILOT_NOT_FOUND",
    );
  }

  const now = new Date().toISOString();
  const currentStatus = String(existing.status);
  const nextStatus =
    currentStatus === "completed" || currentStatus === "completed_with_warnings"
      ? currentStatus
      : mode;

  const { data, error } = await session.client
    .from("autopilot_runs")
    .update({
      status: nextStatus,
      stage_lease_token: null,
      stage_started_at: null,
      heartbeat_at: now,
      updated_at: now,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", String(existing.id))
    .select("*")
    .single();

  if (error || !data) {
    throw new AutopilotPersistenceError("Ano could not pause or cancel the autopilot run.");
  }

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: mode === "cancelled" ? "autopilot.cancelled" : "autopilot.paused",
    outcome: nextStatus,
    details_json: {
      conversation_id: conversationId,
      current_stage: String(existing.current_stage),
    },
  });

  return mapAutopilotRow(data as Row);
}

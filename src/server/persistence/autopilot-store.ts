import "server-only";

import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import {
  AUTOPILOT_STAGES,
  autopilotExecutableStageSchema,
  autopilotRunViewSchema,
  autopilotStageSummarySchema,
  computePartialRerunState,
  describeAutopilotStageProgress,
  formatAutopilotOutcomeMessage,
  nextPendingAutopilotStage,
  resolveAutopilotAuthorityScope,
  stagesBefore,
  type AutopilotAuthorityScope,
  type AutopilotExecutableStage,
  type AutopilotRunView,
  type AutopilotStage,
  type AutopilotStageSummary,
} from "@/lib/ano/autopilot";
import { readEvidenceResearchView } from "@/server/persistence/evidence-research-store";

export const AUTOPILOT_STAGE_LEASE_TIMEOUT_MS = 90_000;
export const AUTOPILOT_HEARTBEAT_INTERVAL_MS = 20_000;
export const AUTOPILOT_MAX_RECOVERIES = 3;

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
    const raw = item.replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const clean = formatAutopilotOutcomeMessage(raw, { kind: "warning" }).slice(0, 400);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= 20) break;
  }
  return out;
}

function isLeaseActive(row: Row, now = Date.now()): boolean {
  if (!row.stage_lease_token) return false;
  if (row.lease_expires_at) {
    const expiresMs = new Date(String(row.lease_expires_at)).getTime();
    if (Number.isFinite(expiresMs)) {
      return expiresMs > now;
    }
  }
  const rawTimestamp = row.stage_started_at ?? row.heartbeat_at ?? row.updated_at;
  const ms = rawTimestamp ? new Date(String(rawTimestamp)).getTime() : 0;
  if (!Number.isFinite(ms)) return false;
  return now - ms < AUTOPILOT_STAGE_LEASE_TIMEOUT_MS;
}

function parseAuthorityScope(value: unknown): AutopilotAuthorityScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return resolveAutopilotAuthorityScope(null);
  }
  return resolveAutopilotAuthorityScope(value as Partial<AutopilotAuthorityScope>);
}

function parseExecutableStage(value: unknown): AutopilotExecutableStage | undefined {
  const parsed = autopilotExecutableStageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function mapAutopilotRow(row: Row): AutopilotRunView {
  const currentStage = parseExecutableStage(row.current_stage);
  const rawLastError =
    typeof row.last_error === "string" && row.last_error.trim()
      ? row.last_error.trim().slice(0, 600)
      : null;
  const rawProgressDetail =
    typeof row.progress_detail === "string" && row.progress_detail.trim()
      ? row.progress_detail.trim().slice(0, 320)
      : null;

  return autopilotRunViewSchema.parse({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    status: String(row.status),
    currentStage: String(row.current_stage),
    completedStages: parseCompletedStages(row.completed_stages_json),
    stageSummaries: parseStageSummaries(row.stage_summaries_json),
    warnings: parseWarnings(row.warnings_json),
    lastError: rawLastError
      ? formatAutopilotOutcomeMessage(rawLastError, { stage: currentStage, kind: "error" })
      : null,
    stageInFlight: isLeaseActive(row),
    leaseExpiresAt: optionalIso(row.lease_expires_at),
    activeJobId: typeof row.active_job_id === "string" ? row.active_job_id : null,
    recoveryCount:
      typeof row.recovery_count === "number" && Number.isFinite(row.recovery_count)
        ? Math.max(0, Math.floor(row.recovery_count))
        : 0,
    progressDetail: rawProgressDetail
      ? formatAutopilotOutcomeMessage(rawProgressDetail, { stage: currentStage, kind: "progress" }).slice(0, 320)
      : null,
    authorityScope: parseAuthorityScope(row.authority_scope_json),
    authorizedAt: optionalIso(row.authorized_at),
    authorizedBy: typeof row.authorized_by === "string" ? row.authorized_by : null,
    heartbeatAt: optionalIso(row.heartbeat_at),
    startedAt: optionalIso(row.started_at),
    completedAt: optionalIso(row.completed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

async function fetchActiveAutopilotJob(
  session: SupabaseWorkspaceSession,
  conversationId: string,
): Promise<Row | null> {
  const { data, error } = await session.client
    .from("autopilot_jobs")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .in("status", ["queued", "leased"])
    .maybeSingle();

  if (error) {
    throw new AutopilotPersistenceError("Ano could not read the queued background job.");
  }
  return (data as Row | null) ?? null;
}

export async function enqueueOrReuseAutopilotJob(
  session: SupabaseWorkspaceSession,
  input: {
    runId: string;
    conversationId: string;
    requestedBy: string;
    fromStage?: AutopilotExecutableStage | null;
    idempotencyKey?: string;
    nowMs?: number;
  },
): Promise<string> {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const existingJob = await fetchActiveAutopilotJob(session, input.conversationId);

  let jobId: string | null = null;
  if (existingJob) {
    jobId = String(existingJob.id);
    const jobLeaseMs = existingJob.lease_expires_at
      ? new Date(String(existingJob.lease_expires_at)).getTime()
      : 0;
    const isJobLeaseLive =
      String(existingJob.status) === "leased" && Number.isFinite(jobLeaseMs) && jobLeaseMs > nowMs;

    if (!isJobLeaseLive) {
      await session.client
        .from("autopilot_jobs")
        .update({
          status: "queued",
          from_stage: input.fromStage ?? existingJob.from_stage ?? null,
          worker_id: null,
          lease_token: null,
          lease_expires_at: null,
          available_at: nowIso,
          updated_at: nowIso,
        })
        .eq("workspace_id", session.workspace.id)
        .eq("id", jobId)
        .in("status", ["queued", "leased"]);
    }
  } else {
    const newId = crypto.randomUUID();
    const { data: inserted, error: insertError } = await session.client
      .from("autopilot_jobs")
      .insert({
        id: newId,
        workspace_id: session.workspace.id,
        conversation_id: input.conversationId,
        autopilot_run_id: input.runId,
        requested_by: input.requestedBy,
        idempotency_key: input.idempotencyKey ?? `run:${input.runId}:${crypto.randomUUID()}`,
        status: "queued",
        from_stage: input.fromStage ?? null,
        available_at: nowIso,
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      const raced = await fetchActiveAutopilotJob(session, input.conversationId);
      if (!raced) {
        throw new AutopilotPersistenceError("Ano could not queue the background pipeline job.");
      }
      jobId = String(raced.id);
    } else {
      jobId = String(inserted?.id ?? newId);
    }
  }

  await session.client
    .from("autopilot_runs")
    .update({ active_job_id: jobId, updated_at: nowIso })
    .eq("workspace_id", session.workspace.id)
    .eq("id", input.runId);

  return jobId;
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
  options?: {
    fromStage?: AutopilotExecutableStage;
    explicitApproval?: boolean;
    authorityScope?: Partial<AutopilotAuthorityScope>;
  },
): Promise<AutopilotRunView> {
  requireLiveSession(session);
  if (options?.explicitApproval !== true) {
    throw new AutopilotPersistenceError(
      "Explicit user approval is required before starting Autopilot.",
      "EXPLICIT_APPROVAL_REQUIRED",
    );
  }
  const existing = await fetchAutopilotRow(session, conversationId);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  if (!options?.fromStage && existing && String(existing.status) === "running" && isLeaseActive(existing, nowMs)) {
    const requestedBy = String(existing.authorized_by ?? existing.created_by ?? session.actorId);
    const activeJobId = await enqueueOrReuseAutopilotJob(session, {
      runId: String(existing.id),
      conversationId,
      requestedBy,
      nowMs,
    });
    return mapAutopilotRow({ ...existing, active_job_id: existing.active_job_id ?? activeJobId });
  }

  const authorityScope = resolveAutopilotAuthorityScope(
    options.authorityScope ?? parseAuthorityScope(existing?.authority_scope_json),
  );
  const authorizedAt = existing?.authorized_at ? String(existing.authorized_at) : now;
  const authorizedBy = existing?.authorized_by ? String(existing.authorized_by) : session.actorId;

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
  const progressDetail =
    nextStage === "done" ? null : describeAutopilotStageProgress(nextStage);

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
        lease_expires_at: null,
        worker_id: null,
        progress_detail: progressDetail,
        last_error: null,
        authority_scope_json: authorityScope,
        authorized_at: authorizedAt,
        authorized_by: authorizedBy,
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

  let savedRow = data as Row;
  if (nextStatus === "running") {
    const activeJobId = await enqueueOrReuseAutopilotJob(session, {
      runId: String(savedRow.id),
      conversationId,
      requestedBy: authorizedBy,
      fromStage: options?.fromStage ?? null,
      nowMs,
    });
    savedRow = { ...savedRow, active_job_id: activeJobId };
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
      authority_scope: authorityScope,
      active_job_id: savedRow.active_job_id ?? null,
    },
  });

  return mapAutopilotRow(savedRow);
}

export async function claimAutopilotStageLease(
  session: WorkspaceSession,
  conversationId: string,
  options?: {
    workerId?: string;
    leaseDurationMs?: number;
    now?: number;
    maxRecoveries?: number;
  },
): Promise<{
  claimed: boolean;
  run: AutopilotRunView | null;
  stage: AutopilotStage;
  leaseToken: string | null;
  reason?: "not_found" | "not_running" | "already_done" | "in_flight";
}> {
  requireLiveSession(session);
  const nowMs = options?.now ?? Date.now();
  const leaseDurationMs = Math.max(
    5_000,
    options?.leaseDurationMs ?? AUTOPILOT_STAGE_LEASE_TIMEOUT_MS,
  );
  const maxRecoveries = Math.max(1, options?.maxRecoveries ?? AUTOPILOT_MAX_RECOVERIES);
  const workerId = options?.workerId?.trim() || `worker:${crypto.randomUUID().slice(0, 8)}`;

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
    const nowIso = new Date(nowMs).toISOString();
    const finalStatus =
      runView.warnings.length > 0 ? "completed_with_warnings" : "completed";
    const { data: finalized } = await session.client
      .from("autopilot_runs")
      .update({
        status: finalStatus,
        current_stage: "done",
        stage_lease_token: null,
        stage_started_at: null,
        lease_expires_at: null,
        worker_id: null,
        progress_detail: null,
        completed_at: runView.completedAt ?? nowIso,
        heartbeat_at: nowIso,
        updated_at: nowIso,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", runView.id)
      .select("*")
      .maybeSingle();

    await session.client
      .from("autopilot_jobs")
      .update({
        status: "completed",
        lease_token: null,
        lease_expires_at: null,
        worker_id: null,
        completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("conversation_id", conversationId)
      .in("status", ["queued", "leased"]);

    return {
      claimed: false,
      run: finalized ? mapAutopilotRow(finalized as Row) : runView,
      stage: "done",
      leaseToken: null,
      reason: "already_done",
    };
  }

  if (isLeaseActive(row, nowMs)) {
    return {
      claimed: false,
      run: runView,
      stage: nextStage,
      leaseToken: null,
      reason: "in_flight",
    };
  }

  const nowIso = new Date(nowMs).toISOString();
  const staleTakeover = Boolean(row.stage_lease_token);
  const currentRecoveries =
    typeof row.recovery_count === "number" && Number.isFinite(row.recovery_count)
      ? Math.max(0, Math.floor(row.recovery_count))
      : 0;

  if (staleTakeover && currentRecoveries >= maxRecoveries) {
    const pauseMessage =
      "Autopilot paused safely after repeated interruptions. Completed stages are saved and ready to resume.";
    const { data: pausedRow } = await session.client
      .from("autopilot_runs")
      .update({
        status: "paused",
        stage_lease_token: null,
        stage_started_at: null,
        lease_expires_at: null,
        worker_id: null,
        progress_detail: null,
        last_error: pauseMessage,
        heartbeat_at: nowIso,
        updated_at: nowIso,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", runView.id)
      .eq("status", "running")
      .eq("stage_lease_token", String(row.stage_lease_token))
      .select("*")
      .maybeSingle();

    await session.client
      .from("autopilot_jobs")
      .update({
        status: "paused",
        lease_token: null,
        lease_expires_at: null,
        worker_id: null,
        outcome_note: pauseMessage,
        completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("conversation_id", conversationId)
      .in("status", ["queued", "leased"]);

    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: "autopilot.paused_max_recoveries",
      outcome: "paused",
      details_json: {
        conversation_id: conversationId,
        stage: nextStage,
        recovery_count: currentRecoveries,
      },
    });

    return {
      claimed: false,
      run: pausedRow ? mapAutopilotRow(pausedRow as Row) : await readAutopilotRun(session, conversationId),
      stage: nextStage,
      leaseToken: null,
      reason: "not_running",
    };
  }

  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(nowMs + leaseDurationMs).toISOString();
  const nextRecoveryCount = staleTakeover ? currentRecoveries + 1 : currentRecoveries;
  const progressDetail = describeAutopilotStageProgress(nextStage, {
    recovered: staleTakeover,
  });

  let updateQuery = session.client
    .from("autopilot_runs")
    .update({
      stage_lease_token: leaseToken,
      stage_started_at: nowIso,
      lease_expires_at: leaseExpiresAt,
      worker_id: workerId,
      heartbeat_at: nowIso,
      recovery_count: nextRecoveryCount,
      progress_detail: progressDetail,
      current_stage: nextStage,
      last_error: null,
      updated_at: nowIso,
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

  const requestedBy = String(row.authorized_by ?? row.created_by ?? session.actorId);
  const jobId =
    typeof row.active_job_id === "string"
      ? row.active_job_id
      : await enqueueOrReuseAutopilotJob(session, {
          runId: runView.id,
          conversationId,
          requestedBy,
          nowMs,
        });

  const existingJob = await fetchActiveAutopilotJob(session, conversationId);
  const nextAttemptCount = existingJob
    ? Math.min(10, Number(existingJob.attempt_count ?? 0) + (staleTakeover ? 1 : existingJob.started_at ? 0 : 1))
    : 1;

  await session.client
    .from("autopilot_jobs")
    .update({
      status: "leased",
      worker_id: workerId,
      lease_token: leaseToken,
      lease_expires_at: leaseExpiresAt,
      heartbeat_at: nowIso,
      started_at: existingJob?.started_at ? String(existingJob.started_at) : nowIso,
      attempt_count: nextAttemptCount,
      checkpoint_json: {
        currentStage: nextStage,
        progressDetail,
        recovered: staleTakeover,
      },
      updated_at: nowIso,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", jobId);

  if (staleTakeover) {
    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: "autopilot.lease_recovered",
      outcome: "running",
      details_json: {
        conversation_id: conversationId,
        stage: nextStage,
        recovery_count: nextRecoveryCount,
        worker_id: workerId,
      },
    });
  }

  return {
    claimed: true,
    run: mapAutopilotRow({ ...(claimedRow as Row), active_job_id: jobId }),
    stage: nextStage,
    leaseToken,
  };
}

export async function renewAutopilotStageLease(
  session: WorkspaceSession,
  input: {
    runId: string;
    conversationId: string;
    leaseToken: string;
    leaseDurationMs?: number;
    progressDetail?: string | null;
    checkpoint?: Record<string, unknown>;
    now?: number;
  },
): Promise<{ renewed: boolean; run: AutopilotRunView | null }> {
  requireLiveSession(session);
  const nowMs = input.now ?? Date.now();
  const leaseDurationMs = Math.max(
    5_000,
    input.leaseDurationMs ?? AUTOPILOT_STAGE_LEASE_TIMEOUT_MS,
  );
  const nowIso = new Date(nowMs).toISOString();
  const leaseExpiresAt = new Date(nowMs + leaseDurationMs).toISOString();

  const patch: Record<string, unknown> = {
    heartbeat_at: nowIso,
    lease_expires_at: leaseExpiresAt,
    updated_at: nowIso,
  };
  if (input.progressDetail !== undefined) {
    patch.progress_detail = input.progressDetail
      ? formatAutopilotOutcomeMessage(input.progressDetail, { kind: "progress" }).slice(0, 320)
      : null;
  }

  const { data, error } = await session.client
    .from("autopilot_runs")
    .update(patch)
    .eq("workspace_id", session.workspace.id)
    .eq("id", input.runId)
    .eq("stage_lease_token", input.leaseToken)
    .eq("status", "running")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new AutopilotPersistenceError("Ano could not refresh the active pipeline lease.");
  }

  if (!data) {
    return {
      renewed: false,
      run: await readAutopilotRun(session, input.conversationId).catch(() => null),
    };
  }

  const jobPatch: Record<string, unknown> = {
    heartbeat_at: nowIso,
    lease_expires_at: leaseExpiresAt,
    updated_at: nowIso,
  };
  if (input.checkpoint || input.progressDetail !== undefined) {
    jobPatch.checkpoint_json = {
      ...(input.checkpoint ?? {}),
      ...(patch.progress_detail ? { progressDetail: patch.progress_detail } : {}),
      currentStage: String((data as Row).current_stage),
    };
  }

  await session.client
    .from("autopilot_jobs")
    .update(jobPatch)
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", input.conversationId)
    .eq("lease_token", input.leaseToken);

  return {
    renewed: true,
    run: mapAutopilotRow(data as Row),
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
  const nextProgressDetail =
    nextStage === "done" || nextStatus !== "running"
      ? null
      : describeAutopilotStageProgress(nextStage);

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
      lease_expires_at: null,
      worker_id: null,
      progress_detail: nextProgressDetail,
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

  await session.client
    .from("autopilot_jobs")
    .update({
      status:
        nextStage === "done"
          ? "completed"
          : nextStatus === "paused" || nextStatus === "cancelled"
            ? nextStatus
            : "queued",
      lease_token: null,
      lease_expires_at: null,
      worker_id: null,
      heartbeat_at: now,
      completed_at: nextStage === "done" ? now : null,
      outcome_note: nextStage === "done" ? input.summary.headline : null,
      checkpoint_json: {
        currentStage: nextStage,
        ...(nextProgressDetail ? { progressDetail: nextProgressDetail } : {}),
      },
      updated_at: now,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", input.conversationId)
    .in("status", ["queued", "leased"]);

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
  const cleanError = formatAutopilotOutcomeMessage(input.errorMessage, { kind: "error" }).slice(
    0,
    600,
  );

  const { data, error } = await session.client
    .from("autopilot_runs")
    .update({
      status: "failed",
      stage_lease_token: null,
      stage_started_at: null,
      lease_expires_at: null,
      worker_id: null,
      progress_detail: null,
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

  await session.client
    .from("autopilot_jobs")
    .update({
      status: "failed",
      lease_token: null,
      lease_expires_at: null,
      worker_id: null,
      outcome_note: cleanError,
      completed_at: now,
      updated_at: now,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", input.conversationId)
    .in("status", ["queued", "leased"]);

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
      lease_expires_at: null,
      worker_id: null,
      progress_detail: null,
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

  if (nextStatus === "paused" || nextStatus === "cancelled") {
    await session.client
      .from("autopilot_jobs")
      .update({
        status: nextStatus,
        lease_token: null,
        lease_expires_at: null,
        worker_id: null,
        completed_at: now,
        updated_at: now,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("conversation_id", conversationId)
      .in("status", ["queued", "leased"]);
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

export async function scheduleAutopilotPartialRerun(
  session: WorkspaceSession,
  conversationId: string,
  input: {
    stagesToRerun: AutopilotExecutableStage[];
    completedStageSummary?: AutopilotStageSummary;
    reason?: string;
  },
): Promise<AutopilotRunView | null> {
  if (session.kind === "demo") {
    return null;
  }
  const existing = await fetchAutopilotRow(session, conversationId);
  if (!existing || !(existing.authorized_at || existing.started_at)) {
    return null;
  }

  const parsedExisting = mapAutopilotRow(existing);
  const next = computePartialRerunState(
    parsedExisting,
    input.stagesToRerun,
    input.completedStageSummary,
  );
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const progressDetail =
    next.nextStage === "done" || next.nextStatus !== "running"
      ? null
      : describeAutopilotStageProgress(next.nextStage);

  const { data, error } = await session.client
    .from("autopilot_runs")
    .update({
      status: next.nextStatus,
      current_stage: next.nextStage,
      completed_stages_json: next.completedStages,
      stage_summaries_json: next.stageSummaries,
      warnings_json: next.warnings,
      stage_lease_token: null,
      stage_started_at: null,
      lease_expires_at: null,
      worker_id: null,
      progress_detail: progressDetail,
      last_error: null,
      heartbeat_at: now,
      started_at: next.nextStatus === "running" ? now : existing.started_at ?? now,
      completed_at: next.nextStage === "done" ? now : null,
      updated_at: now,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", parsedExisting.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new AutopilotPersistenceError(
      "Ano could not schedule the requested downstream update.",
    );
  }

  let savedRow = data as Row;
  if (next.nextStatus === "running") {
    const requestedBy = String(existing.authorized_by ?? existing.created_by ?? session.actorId);
    const activeJobId = await enqueueOrReuseAutopilotJob(session, {
      runId: parsedExisting.id,
      conversationId,
      requestedBy,
      fromStage: next.nextStage === "done" ? null : next.nextStage,
      nowMs,
    });
    savedRow = { ...savedRow, active_job_id: activeJobId };
  }

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "autopilot.partial_rerun",
    outcome: next.nextStatus,
    details_json: {
      conversation_id: conversationId,
      stages_to_rerun: input.stagesToRerun,
      next_stage: next.nextStage,
      reason: input.reason?.slice(0, 200) ?? null,
    },
  });

  return mapAutopilotRow(savedRow);
}

export async function recoverStaleAutopilotRuns(
  session: WorkspaceSession,
  options?: {
    conversationId?: string;
    now?: number;
    maxRecoveries?: number;
  },
): Promise<{
  recoveredConversationIds: string[];
  pausedConversationIds: string[];
}> {
  if (session.kind === "demo") {
    return { recoveredConversationIds: [], pausedConversationIds: [] };
  }

  const nowMs = options?.now ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const maxRecoveries = Math.max(1, options?.maxRecoveries ?? AUTOPILOT_MAX_RECOVERIES);

  let query = session.client
    .from("autopilot_runs")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("status", "running");

  if (options?.conversationId) {
    query = query.eq("conversation_id", options.conversationId);
  }

  const { data: rows, error } = await query;
  if (error) {
    throw new AutopilotPersistenceError(
      "Ano could not inspect interrupted pipeline runs for recovery.",
    );
  }

  const recoveredConversationIds: string[] = [];
  const pausedConversationIds: string[] = [];

  for (const rawRow of (rows ?? []) as Row[]) {
    const convId = String(rawRow.conversation_id);
    if (isLeaseActive(rawRow, nowMs)) {
      continue;
    }

    const updatedMs = new Date(String(rawRow.heartbeat_at ?? rawRow.updated_at)).getTime();
    const isUnleasedStale =
      !rawRow.stage_lease_token &&
      (!rawRow.active_job_id ||
        (Number.isFinite(updatedMs) && nowMs - updatedMs >= AUTOPILOT_STAGE_LEASE_TIMEOUT_MS));

    if (!rawRow.stage_lease_token && !isUnleasedStale) {
      continue;
    }

    if (String(rawRow.current_stage) === "market_research") {
      await readEvidenceResearchView(session, convId).catch(() => null);
    }

    const runId = String(rawRow.id);
    const currentRecoveries =
      typeof rawRow.recovery_count === "number" && Number.isFinite(rawRow.recovery_count)
        ? Math.max(0, Math.floor(rawRow.recovery_count))
        : 0;
    const currentStage = parseExecutableStage(rawRow.current_stage) ?? "brief_and_plan";

    if (rawRow.stage_lease_token && currentRecoveries >= maxRecoveries) {
      const pauseMessage =
        "Autopilot paused safely after repeated interruptions. Completed stages are saved and ready to resume.";
      const { data: paused } = await session.client
        .from("autopilot_runs")
        .update({
          status: "paused",
          stage_lease_token: null,
          stage_started_at: null,
          lease_expires_at: null,
          worker_id: null,
          progress_detail: null,
          last_error: pauseMessage,
          heartbeat_at: nowIso,
          updated_at: nowIso,
        })
        .eq("workspace_id", session.workspace.id)
        .eq("id", runId)
        .eq("status", "running")
        .eq("stage_lease_token", String(rawRow.stage_lease_token))
        .select("id")
        .maybeSingle();

      if (paused) {
        await session.client
          .from("autopilot_jobs")
          .update({
            status: "paused",
            lease_token: null,
            lease_expires_at: null,
            worker_id: null,
            outcome_note: pauseMessage,
            completed_at: nowIso,
            updated_at: nowIso,
          })
          .eq("workspace_id", session.workspace.id)
          .eq("conversation_id", convId)
          .in("status", ["queued", "leased"]);

        await session.client.from("audit_logs").insert({
          workspace_id: session.workspace.id,
          actor_id: session.actorId,
          event_type: "autopilot.paused_max_recoveries",
          outcome: "paused",
          details_json: {
            conversation_id: convId,
            stage: currentStage,
            recovery_count: currentRecoveries,
          },
        });
        pausedConversationIds.push(convId);
      }
      continue;
    }

    const nextRecoveryCount = rawRow.stage_lease_token
      ? currentRecoveries + 1
      : currentRecoveries;
    const progressDetail = describeAutopilotStageProgress(currentStage, {
      recovered: Boolean(rawRow.stage_lease_token),
    });

    let recoverQuery = session.client
      .from("autopilot_runs")
      .update({
        stage_lease_token: null,
        stage_started_at: null,
        lease_expires_at: null,
        worker_id: null,
        recovery_count: nextRecoveryCount,
        progress_detail: progressDetail,
        heartbeat_at: nowIso,
        updated_at: nowIso,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", runId)
      .eq("status", "running");

    if (rawRow.stage_lease_token) {
      recoverQuery = recoverQuery.eq("stage_lease_token", String(rawRow.stage_lease_token));
    } else {
      recoverQuery = recoverQuery.is("stage_lease_token", null);
    }

    const { data: recovered } = await recoverQuery.select("id").maybeSingle();
    if (!recovered) continue;

    const requestedBy = String(rawRow.authorized_by ?? rawRow.created_by ?? session.actorId);
    await enqueueOrReuseAutopilotJob(session, {
      runId,
      conversationId: convId,
      requestedBy,
      nowMs,
    });

    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: "autopilot.stale_lease_recovered",
      outcome: "queued",
      details_json: {
        conversation_id: convId,
        stage: currentStage,
        recovery_count: nextRecoveryCount,
      },
    });
    recoveredConversationIds.push(convId);
  }

  return { recoveredConversationIds, pausedConversationIds };
}

export async function recordAutopilotStageSummary(
  session: WorkspaceSession,
  conversationId: string,
  summary: AutopilotStageSummary,
): Promise<AutopilotRunView | null> {
  if (session.kind === "demo") {
    return null;
  }
  const existing = await fetchAutopilotRow(session, conversationId);
  if (!existing || !(existing.authorized_at || existing.started_at)) {
    return null;
  }

  const parsedExisting = mapAutopilotRow(existing);
  const completedSet = new Set<AutopilotExecutableStage>(parsedExisting.completedStages);
  completedSet.add(summary.stage);
  const completedStages = AUTOPILOT_STAGES.filter((stage) => completedSet.has(stage));
  const stageSummaries: Partial<Record<AutopilotExecutableStage, AutopilotStageSummary>> = {
    ...parsedExisting.stageSummaries,
    [summary.stage]: summary,
  };
  const warnings = parseWarnings(
    completedStages.flatMap((stage) => stageSummaries[stage]?.warnings ?? []),
  );
  const nextStage = nextPendingAutopilotStage(completedStages);
  const nextStatus =
    parsedExisting.status === "running" && nextStage !== "done"
      ? "running"
      : nextStage === "done"
        ? warnings.length > 0
          ? "completed_with_warnings"
          : "completed"
        : parsedExisting.status;
  const now = new Date().toISOString();

  const { data, error } = await session.client
    .from("autopilot_runs")
    .update({
      status: nextStatus,
      current_stage: nextStage,
      completed_stages_json: completedStages,
      stage_summaries_json: stageSummaries,
      warnings_json: warnings,
      heartbeat_at: now,
      completed_at: nextStage === "done" ? now : existing.completed_at ?? null,
      updated_at: now,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", parsedExisting.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new AutopilotPersistenceError(
      "Ano could not update the autopilot stage summary.",
    );
  }

  return mapAutopilotRow(data as Row);
}

import type { WorkspaceSession } from "@/contracts/ano";
import type { ResearchInput, ResearchResult } from "@/lib/ano/types";

export class ResearchRunPersistenceError extends Error {
  constructor(message: string, public readonly code: "RUN_IN_PROGRESS" | "RUN_ALREADY_FINALIZED" | "PERSISTENCE_FAILED") {
    super(message);
    this.name = "ResearchRunPersistenceError";
  }
}

function isResearchResult(value: unknown): value is ResearchResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      "run" in value &&
      "candidates" in value &&
      Array.isArray((value as ResearchResult).candidates),
  );
}

function withPersistedRunId(result: ResearchResult, runId: string): ResearchResult {
  return {
    ...result,
    run: {
      ...result.run,
      id: runId,
    },
  };
}

function persistenceFailureMessage() {
  return "Ano could not safely save this research run. No external provider or Mercury action was attempted.";
}

/**
 * Saves Phase 1's simulated artefacts through Ano-owned tables. The database
 * client carries the signed-in user's session, so every database operation is
 * still constrained by Supabase RLS. Mercury is intentionally not referenced.
 */
export async function persistResearchRun(
  session: WorkspaceSession,
  input: ResearchInput,
  result: ResearchResult,
  idempotencyKey: string,
): Promise<ResearchResult> {
  if (session.kind === "demo") {
    return withPersistedRunId(result, `demo-${idempotencyKey}`);
  }

  const { client, workspace, actorId } = session;
  const { data: existing, error: existingError } = await client
    .from("research_runs")
    .select("id, status, result_snapshot")
    .eq("workspace_id", workspace.id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingError) {
    throw new ResearchRunPersistenceError(persistenceFailureMessage(), "PERSISTENCE_FAILED");
  }

  if (existing?.status === "completed" && isResearchResult(existing.result_snapshot)) {
    return existing.result_snapshot;
  }

  if (existing?.status === "running") {
    throw new ResearchRunPersistenceError("This research request is already running. Please wait for it to finish.", "RUN_IN_PROGRESS");
  }

  if (existing) {
    throw new ResearchRunPersistenceError(
      "This research request already finished in a non-resumable state. Start a new run to retry safely.",
      "RUN_ALREADY_FINALIZED",
    );
  }

  const runId = crypto.randomUUID();
  const persisted = withPersistedRunId(result, runId);
  const now = new Date().toISOString();

  const { error: runError } = await client.from("research_runs").insert({
    id: runId,
    workspace_id: workspace.id,
    started_by: actorId,
    status: "running",
    mode: "mock",
    idempotency_key: idempotencyKey,
    input_json: input,
    checkpoint: { phase: "research", version: 1 },
    heartbeat_at: now,
  });

  if (runError) {
    throw new ResearchRunPersistenceError(persistenceFailureMessage(), "PERSISTENCE_FAILED");
  }

  try {
    const { data: candidates, error: candidateError } = await client
      .from("account_candidates")
      .insert(
        persisted.candidates.map((candidate) => ({
          workspace_id: workspace.id,
          research_run_id: runId,
          source_key: candidate.id,
          name: candidate.name,
          industry: candidate.industry,
          location: candidate.location,
          employee_band: candidate.employees,
          lifecycle_state: "discovered",
          source_label: "simulated",
          raw_snapshot: candidate,
        })),
      )
      .select("id, source_key");

    if (candidateError || !candidates) {
      throw new Error("Could not save account candidates.");
    }

    const candidateIdBySourceKey = new Map(
      (candidates as Array<{ id: string; source_key: string }>).map((candidate) => [candidate.source_key, candidate.id]),
    );

    const contactRows = persisted.candidates.flatMap((candidate) => {
      const accountCandidateId = candidateIdBySourceKey.get(candidate.id);
      if (!accountCandidateId) return [];
      return [{
        workspace_id: workspace.id,
        research_run_id: runId,
        account_candidate_id: accountCandidateId,
        source_key: `${candidate.id}-contact`,
        full_name: candidate.contact.name,
        title: candidate.contact.role,
        availability: candidate.contact.availability,
        source_label: "simulated",
      }];
    });

    if (contactRows.length > 0) {
      const { error } = await client.from("contact_candidates").insert(contactRows);
      if (error) throw new Error("Could not save contact candidates.");
    }

    const evidenceRows = persisted.candidates.flatMap((candidate) => {
      const accountCandidateId = candidateIdBySourceKey.get(candidate.id);
      if (!accountCandidateId) return [];
      return candidate.evidence.map((item) => ({
        id: crypto.randomUUID(),
        workspace_id: workspace.id,
        research_run_id: runId,
        account_candidate_id: accountCandidateId,
        evidence_key: item.id,
        source_name: item.source,
        source_kind: item.kind,
        observation: item.observation,
        captured_at: item.capturedAt,
        is_simulated: item.simulated,
      }));
    });

    if (evidenceRows.length > 0) {
      const { error } = await client.from("evidence_items").insert(evidenceRows);
      if (error) throw new Error("Could not save evidence items.");
    }

    const scorecardRows = persisted.candidates.flatMap((candidate) => {
      const accountCandidateId = candidateIdBySourceKey.get(candidate.id);
      if (!accountCandidateId) return [];
      return [{
        workspace_id: workspace.id,
        research_run_id: runId,
        account_candidate_id: accountCandidateId,
        score_version: "phase-1-mock-v1",
        total_score: candidate.score,
        confidence: candidate.confidence.toLowerCase(),
        components_json: candidate.scoreComponents,
        explanation_json: {
          recommendation: candidate.recommendationReason,
          signals: candidate.signals,
        },
      }];
    });

    if (scorecardRows.length > 0) {
      const { error } = await client.from("scorecards").insert(scorecardRows);
      if (error) throw new Error("Could not save scorecards.");
    }

    const briefRows = persisted.candidates.flatMap((candidate) => {
      const accountCandidateId = candidateIdBySourceKey.get(candidate.id);
      if (!accountCandidateId) return [];
      return [{
        workspace_id: workspace.id,
        research_run_id: runId,
        account_candidate_id: accountCandidateId,
        title: `Ano Brief — ${candidate.name}`,
        content_json: {
          recommendation: candidate.recommendedAction,
          reason: candidate.recommendationReason,
          evidence_keys: candidate.evidence.map((item) => item.id),
        },
        status: "ready_for_review",
        confidence: candidate.confidence.toLowerCase(),
      }];
    });

    if (briefRows.length > 0) {
      const { error } = await client.from("briefs").insert(briefRows);
      if (error) throw new Error("Could not save briefs.");
    }

    const workItemRows = persisted.plan.flatMap((item, index) => {
      const accountCandidateId = candidateIdBySourceKey.get(item.candidateId);
      if (!accountCandidateId) return [];
      return [{
        workspace_id: workspace.id,
        research_run_id: runId,
        account_candidate_id: accountCandidateId,
        title: item.title,
        recommended_action: item.action,
        priority: item.priority.toLowerCase().replaceAll(" ", "_"),
        rationale: item.reason,
        position: index,
        status: "proposed",
      }];
    });

    if (workItemRows.length > 0) {
      const { error } = await client.from("work_items").insert(workItemRows);
      if (error) throw new Error("Could not save work items.");
    }

    const { error: auditError } = await client.from("audit_logs").insert([
      {
        workspace_id: workspace.id,
        research_run_id: runId,
        actor_id: actorId,
        event_type: "research.run.started",
        outcome: "completed",
        details_json: { mode: "mock", tool_count: persisted.toolTrail.length },
      },
      ...persisted.toolTrail.map((tool) => ({
        workspace_id: workspace.id,
        research_run_id: runId,
        actor_id: actorId,
        event_type: `tool.${tool.tool}`,
        outcome: tool.status,
        details_json: { summary: tool.summary, simulated: true },
      })),
    ]);

    if (auditError) throw new Error("Could not write the audit trail.");

    const { error: completeError } = await client
      .from("research_runs")
      .update({
        status: "completed",
        result_snapshot: persisted,
        checkpoint: { phase: "completed", version: 1 },
        heartbeat_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("workspace_id", workspace.id);

    if (completeError) throw new Error("Could not complete the research run.");
    return persisted;
  } catch {
    await client
      .from("research_runs")
      .update({
        status: "failed",
        failure_code: "PERSISTENCE_FAILED",
        failure_message: "The run could not save all Ano-owned records.",
        heartbeat_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("workspace_id", workspace.id);

    throw new ResearchRunPersistenceError(persistenceFailureMessage(), "PERSISTENCE_FAILED");
  }
}

/** Called by a future protected job route; it never retries a provider or Mercury action. */
export async function recoverStaleResearchRuns(session: WorkspaceSession, staleAfterMinutes = 30) {
  if (session.kind === "demo") return { recovered: 0 };

  const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000).toISOString();
  const { data, error } = await session.client
    .from("research_runs")
    .update({
      status: "failed",
      failure_code: "STALE_RUN_RECOVERED",
      failure_message: "The run exceeded its safe heartbeat window and requires a new user-initiated run.",
      completed_at: new Date().toISOString(),
    })
    .eq("workspace_id", session.workspace.id)
    .eq("status", "running")
    .lt("heartbeat_at", cutoff)
    .select("id");

  if (error) {
    throw new ResearchRunPersistenceError("Ano could not recover stale research runs.", "PERSISTENCE_FAILED");
  }

  return { recovered: data?.length ?? 0 };
}

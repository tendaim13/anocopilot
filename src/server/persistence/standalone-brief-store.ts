import type { WorkspaceSession } from "@/contracts/ano";
import type { StandaloneBriefInput, StandaloneBriefResult } from "@/lib/ano/standalone";

export class StandaloneBriefPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StandaloneBriefPersistenceError";
  }
}

function persistenceFailureMessage() {
  return "Ano could not safely save this workspace brief. No connector or external sales action was attempted.";
}

function resultWithRunId(result: StandaloneBriefResult, runId: string): StandaloneBriefResult {
  return { ...result, run: { ...result.run, id: runId } };
}

/**
 * Persists only user-supplied workspace information and Ano's generated
 * planning artefacts. Provider, Mercury, browser, and email integrations are
 * not involved in this standalone path.
 */
export async function persistStandaloneBrief(
  session: WorkspaceSession,
  input: StandaloneBriefInput,
  result: StandaloneBriefResult,
  idempotencyKey: string,
): Promise<StandaloneBriefResult> {
  if (session.kind === "demo") {
    throw new StandaloneBriefPersistenceError("Sign in before Ano can save a real workspace brief.");
  }

  const { client, workspace, actorId } = session;
  const { data: existing, error: existingError } = await client
    .from("research_runs")
    .select("id, status, result_snapshot")
    .eq("workspace_id", workspace.id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingError) throw new StandaloneBriefPersistenceError(persistenceFailureMessage());
  if (existing?.status === "completed" && existing.result_snapshot && typeof existing.result_snapshot === "object") {
    return existing.result_snapshot as StandaloneBriefResult;
  }
  if (existing?.status === "running") throw new StandaloneBriefPersistenceError("This Ano brief is already being prepared. Please wait for it to finish.");
  if (existing) throw new StandaloneBriefPersistenceError("This request already ended without a saved brief. Start a new request to retry.");

  const runId = crypto.randomUUID();
  const persisted = resultWithRunId(result, runId);
  const now = new Date().toISOString();

  const { error: runError } = await client.from("research_runs").insert({
    id: runId,
    workspace_id: workspace.id,
    started_by: actorId,
    status: "running",
    mode: "bedrock",
    idempotency_key: idempotencyKey,
    input_json: input,
    checkpoint: { phase: "briefing", version: 3, turn: 1, tool_calls: 0, runtime: "standalone_workspace_brief" },
    heartbeat_at: now,
  });
  if (runError) throw new StandaloneBriefPersistenceError(persistenceFailureMessage());

  try {
    const { data: account, error: accountError } = await client
      .from("account_candidates")
      .insert({
        workspace_id: workspace.id,
        research_run_id: runId,
        source_key: "manual-account",
        name: persisted.account.name,
        industry: persisted.account.industry,
        location: persisted.account.location,
        lifecycle_state: "review",
        source_label: "manual",
        raw_snapshot: {
          source: "workspace_member",
          accountContext: input.accountContext,
          salesObjective: input.salesObjective,
        },
      })
      .select("id")
      .single();
    if (accountError || !account) throw new Error("Could not save the manual account record.");

    if (persisted.account.contact?.name) {
      const { error } = await client.from("contact_candidates").insert({
        workspace_id: workspace.id,
        research_run_id: runId,
        account_candidate_id: account.id,
        source_key: "manual-contact",
        full_name: persisted.account.contact.name,
        title: persisted.account.contact.role || null,
        availability: "Workspace supplied",
        source_label: "manual",
      });
      if (error) throw new Error("Could not save the manual contact record.");
    }

    const { error: evidenceError } = await client.from("evidence_items").insert(
      persisted.evidence.map((item) => ({
        workspace_id: workspace.id,
        research_run_id: runId,
        account_candidate_id: account.id,
        evidence_key: item.id,
        source_name: item.label,
        source_kind: "workspace_input",
        observation: item.observation,
        captured_at: now,
        is_simulated: false,
      })),
    );
    if (evidenceError) throw new Error("Could not save the workspace evidence.");

    const { error: scoreError } = await client.from("scorecards").insert({
      workspace_id: workspace.id,
      research_run_id: runId,
      account_candidate_id: account.id,
      score_version: "standalone-readiness-v1",
      total_score: persisted.readiness.score,
      confidence: "low",
      components_json: persisted.readiness.components,
      explanation_json: { label: persisted.readiness.label, note: "This measures information readiness, not buying intent." },
    });
    if (scoreError) throw new Error("Could not save the readiness scorecard.");

    const { error: briefError } = await client.from("briefs").insert({
      workspace_id: workspace.id,
      research_run_id: runId,
      account_candidate_id: account.id,
      title: `Ano Brief — ${persisted.account.name}`,
      content_json: persisted.brief,
      status: "ready_for_review",
      confidence: "low",
    });
    if (briefError) throw new Error("Could not save the Ano brief.");

    const { error: workItemsError } = await client.from("work_items").insert(
      persisted.plan.map((item, index) => ({
        workspace_id: workspace.id,
        research_run_id: runId,
        account_candidate_id: account.id,
        title: item.title,
        recommended_action: item.action,
        priority: item.priority.toLowerCase().replaceAll(" ", "_"),
        rationale: item.reason,
        position: index,
        status: "proposed",
      })),
    );
    if (workItemsError) throw new Error("Could not save the Ano plan.");

    const { error: auditError } = await client.from("audit_logs").insert({
      workspace_id: workspace.id,
      research_run_id: runId,
      actor_id: actorId,
      event_type: "standalone_brief.created",
      outcome: "completed",
      details_json: {
        source: "workspace_member",
        evidence_count: persisted.evidence.length,
        plan_count: persisted.plan.length,
        external_actions: "disabled",
      },
    });
    if (auditError) throw new Error("Could not write the Ano audit event.");

    const { error: completeError } = await client
      .from("research_runs")
      .update({
        status: "completed",
        result_snapshot: persisted,
        checkpoint: { phase: "completed", version: 3, turn: 1, tool_calls: 0, runtime: "standalone_workspace_brief" },
        heartbeat_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("workspace_id", workspace.id);
    if (completeError) throw new Error("Could not complete the Ano brief.");
    return persisted;
  } catch {
    await client
      .from("research_runs")
      .update({
        status: "failed",
        failure_code: "PERSISTENCE_FAILED",
        failure_message: "Ano could not save all workspace-only brief records.",
        heartbeat_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("workspace_id", workspace.id);
    throw new StandaloneBriefPersistenceError(persistenceFailureMessage());
  }
}

import type { WorkspaceSession } from "@/contracts/ano";
import type { IcpProfileInput, IcpProfileResult } from "@/lib/ano/icp";

export class IcpProfilePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcpProfilePersistenceError";
  }
}

function persistenceFailureMessage() {
  return "Ano could not safely save this market profile. No connector or external sales action was attempted.";
}

function resultWithRunId(result: IcpProfileResult, runId: string): IcpProfileResult {
  return { ...result, run: { ...result.run, id: runId }, profile: { ...result.profile, id: `icp-${runId}` } };
}

/** Persists only a member's own offer and market definition inside Ano. */
export async function persistIcpProfile(
  session: WorkspaceSession,
  input: IcpProfileInput,
  result: IcpProfileResult,
  idempotencyKey: string,
): Promise<IcpProfileResult> {
  if (session.kind === "demo") throw new IcpProfilePersistenceError("Sign in before Ano can save a real market profile.");

  const { client, workspace, actorId } = session;
  const { data: existing, error: existingError } = await client
    .from("research_runs")
    .select("id, status, result_snapshot")
    .eq("workspace_id", workspace.id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingError) throw new IcpProfilePersistenceError(persistenceFailureMessage());
  if (existing?.status === "completed" && existing.result_snapshot && typeof existing.result_snapshot === "object") return existing.result_snapshot as IcpProfileResult;
  if (existing?.status === "running") throw new IcpProfilePersistenceError("This Ano market profile is already being prepared. Please wait for it to finish.");
  if (existing) throw new IcpProfilePersistenceError("This request already ended without a saved ICP. Start a new request to retry.");

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
    checkpoint: { phase: "icp_setup", version: 4, turn: 1, tool_calls: 0, runtime: "standalone_icp_profile" },
    heartbeat_at: now,
  });
  if (runError) throw new IcpProfilePersistenceError(persistenceFailureMessage());

  try {
    const { data: profile, error: profileError } = await client
      .from("icp_profiles")
      .insert({
        workspace_id: workspace.id,
        research_run_id: runId,
        created_by: actorId,
        product_name: input.productName,
        product_description: input.productDescription,
        value_proposition: input.valueProposition,
        target_market: input.targetMarket,
        target_locations: input.targetLocations,
        ideal_customer_profile: input.idealCustomerProfile,
        buyer_roles: input.buyerRoles,
        sales_objective: input.salesObjective,
        exclusions: input.exclusions,
        context_notes: input.contextNotes,
        status: "active",
        profile_json: persisted.profile,
      })
      .select("id")
      .single();
    if (profileError || !profile) throw new Error("Could not save the ICP profile.");

    const { error: evidenceError } = await client.from("evidence_items").insert(
      persisted.evidence.map((item) => ({
        workspace_id: workspace.id,
        research_run_id: runId,
        account_candidate_id: null,
        evidence_key: item.id,
        source_name: item.label,
        source_kind: "workspace_input",
        observation: item.observation,
        captured_at: now,
        is_simulated: false,
      })),
    );
    if (evidenceError) throw new Error("Could not save the ICP evidence.");

    const { error: briefError } = await client.from("icp_briefs").insert({
      workspace_id: workspace.id,
      research_run_id: runId,
      icp_profile_id: profile.id,
      title: `Ano ICP — ${input.productName}`,
      content_json: persisted.brief,
      status: "ready_for_review",
      confidence: "low",
    });
    if (briefError) throw new Error("Could not save the ICP brief.");

    const { error: workItemsError } = await client.from("work_items").insert(
      persisted.plan.map((item, index) => ({
        workspace_id: workspace.id,
        research_run_id: runId,
        account_candidate_id: null,
        title: item.title,
        recommended_action: item.action,
        priority: item.priority.toLowerCase().replaceAll(" ", "_"),
        rationale: item.reason,
        position: index,
        status: "proposed",
      })),
    );
    if (workItemsError) throw new Error("Could not save the ICP plan.");

    const { error: auditError } = await client.from("audit_logs").insert({
      workspace_id: workspace.id,
      research_run_id: runId,
      actor_id: actorId,
      event_type: "icp_profile.created",
      outcome: "completed",
      details_json: { source: "workspace_member", evidence_count: persisted.evidence.length, plan_count: persisted.plan.length, external_actions: "disabled" },
    });
    if (auditError) throw new Error("Could not write the Ano audit event.");

    const { error: completeError } = await client
      .from("research_runs")
      .update({
        status: "completed",
        result_snapshot: persisted,
        checkpoint: { phase: "completed", version: 4, turn: 1, tool_calls: 0, runtime: "standalone_icp_profile" },
        heartbeat_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId)
      .eq("workspace_id", workspace.id);
    if (completeError) throw new Error("Could not complete the ICP profile.");
    return persisted;
  } catch {
    await client
      .from("research_runs")
      .update({ status: "failed", failure_code: "PERSISTENCE_FAILED", failure_message: "Ano could not save all ICP profile records.", heartbeat_at: new Date().toISOString(), completed_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("workspace_id", workspace.id);
    throw new IcpProfilePersistenceError(persistenceFailureMessage());
  }
}

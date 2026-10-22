import type { WorkspaceSession } from "@/contracts/ano";
import type { MarketBriefResult, MarketDecisionInput, ProductBriefInput } from "@/lib/ano/market-discovery";

export class MarketDiscoveryPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDiscoveryPersistenceError";
  }
}

function failureMessage() {
  return "Ano could not safely save this product brief. No provider, connector, or sales action was attempted.";
}

function withIds(result: MarketBriefResult, runId: string, productBriefId: string, decisionId: string): MarketBriefResult {
  return {
    ...result,
    run: { ...result.run, id: runId },
    productBrief: { ...result.productBrief, id: productBriefId },
    locationDecision: { ...result.locationDecision, id: decisionId },
  };
}

/** Saves Ano's own product brief and a paused, decision-gated hypothesis run. */
export async function persistMarketBrief(
  session: WorkspaceSession,
  input: ProductBriefInput,
  result: MarketBriefResult,
  idempotencyKey: string,
): Promise<MarketBriefResult> {
  if (session.kind === "demo") return result;

  const { client, workspace, actorId } = session;
  const { data: existing, error: existingError } = await client
    .from("research_runs")
    .select("status, result_snapshot")
    .eq("workspace_id", workspace.id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) throw new MarketDiscoveryPersistenceError(failureMessage());
  if (existing?.status === "paused" && existing.result_snapshot && typeof existing.result_snapshot === "object") return existing.result_snapshot as MarketBriefResult;
  if (existing?.status === "running") throw new MarketDiscoveryPersistenceError("Ano is already preparing this product brief. Please wait for it to finish.");
  if (existing) throw new MarketDiscoveryPersistenceError("This product-brief request already ended without a saved result. Start a new request to retry.");

  const runId = crypto.randomUUID();
  const productBriefId = crypto.randomUUID();
  const decisionId = crypto.randomUUID();
  const persisted = withIds(result, runId, productBriefId, decisionId);
  const now = new Date().toISOString();
  const { error: runError } = await client.from("research_runs").insert({
    id: runId,
    workspace_id: workspace.id,
    started_by: actorId,
    status: "running",
    mode: "bedrock",
    idempotency_key: idempotencyKey,
    input_json: input,
    checkpoint: { phase: "market_hypothesis", state: "running", version: 5, turn: 1, tool_calls: 0, runtime: "standalone_market_discovery" },
    heartbeat_at: now,
  });
  if (runError) throw new MarketDiscoveryPersistenceError(failureMessage());

  try {
    const { error: briefError } = await client.from("product_briefs").insert({
      id: productBriefId,
      workspace_id: workspace.id,
      research_run_id: runId,
      created_by: actorId,
      offer: input.offer,
      objective: input.objective,
      input_json: input,
      status: "active",
    });
    if (briefError) throw new Error("Could not save the product brief.");
    const { error: hypothesisError } = await client.from("market_hypotheses").insert({
      workspace_id: workspace.id,
      research_run_id: runId,
      product_brief_id: productBriefId,
      content_json: persisted.hypothesis,
      status: "awaiting_scope_decision",
    });
    if (hypothesisError) throw new Error("Could not save the market hypotheses.");
    const { error: evidenceError } = await client.from("evidence_items").insert(persisted.evidence.map((item) => ({
      workspace_id: workspace.id,
      research_run_id: runId,
      account_candidate_id: null,
      evidence_key: item.id,
      source_name: item.label,
      source_kind: item.source,
      observation: item.observation,
      captured_at: now,
      is_simulated: false,
    })));
    if (evidenceError) throw new Error("Could not save product-brief evidence.");
    const { error: decisionError } = await client.from("market_decisions").insert({
      id: decisionId,
      workspace_id: workspace.id,
      research_run_id: runId,
      product_brief_id: productBriefId,
      decision_type: "location_path",
      status: "awaiting_choice",
      options_json: persisted.locationDecision.options,
    });
    if (decisionError) throw new Error("Could not save the location decision.");
    const { error: auditError } = await client.from("audit_logs").insert({
      workspace_id: workspace.id,
      research_run_id: runId,
      actor_id: actorId,
      event_type: "market_brief.created",
      outcome: "awaiting_scope_decision",
      details_json: { evidence_count: persisted.evidence.length, hypothesis_count: persisted.hypothesis.hypotheses.length, provider_calls: 0, connector_calls: 0 },
    });
    if (auditError) throw new Error("Could not write the Ano audit event.");
    const { error: pauseError } = await client.from("research_runs").update({
      status: "paused",
      result_snapshot: persisted,
      checkpoint: { phase: "market_hypothesis", state: "awaiting_scope_decision", version: 5, turn: 1, tool_calls: 0, runtime: "standalone_market_discovery" },
      heartbeat_at: new Date().toISOString(),
    }).eq("id", runId).eq("workspace_id", workspace.id);
    if (pauseError) throw new Error("Could not checkpoint the location decision.");
    return persisted;
  } catch {
    await client.from("research_runs").update({
      status: "failed",
      failure_code: "PERSISTENCE_FAILED",
      failure_message: "Ano could not save all product-brief records.",
      heartbeat_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).eq("id", runId).eq("workspace_id", workspace.id);
    throw new MarketDiscoveryPersistenceError(failureMessage());
  }
}

function decisionMessage(choice: MarketDecisionInput["choice"]) {
  if (choice === "lock_location") return "Location scope locked. Provider research remains off until a later, explicit approval phase.";
  if (choice === "compare_markets") return "Market comparison selected. Ano will need research evidence before it can recommend a location; no provider call has been made.";
  if (choice === "set_preference") return "Add a location preference to the product brief, then prepare fresh hypotheses.";
  return "Location remains open. Ano will not claim a preferred market without research evidence.";
}

export async function saveMarketDecision(session: WorkspaceSession, productBriefId: string, input: MarketDecisionInput) {
  if (session.kind === "demo") return { choice: input.choice, message: decisionMessage(input.choice), persisted: false };
  const { client, workspace, actorId } = session;
  const { data: decision, error: findError } = await client.from("market_decisions").select("id, research_run_id, status").eq("workspace_id", workspace.id).eq("product_brief_id", productBriefId).eq("decision_type", "location_path").maybeSingle();
  if (findError || !decision) throw new MarketDiscoveryPersistenceError("Ano could not find that pending location decision.");
  if (decision.status === "selected") return { choice: input.choice, message: decisionMessage(input.choice), persisted: true };
  const now = new Date().toISOString();
  const { error: decisionError } = await client.from("market_decisions").update({ status: "selected", selected_key: input.choice, selected_by: actorId, selected_at: now }).eq("id", decision.id).eq("workspace_id", workspace.id);
  if (decisionError) throw new MarketDiscoveryPersistenceError(failureMessage());
  const { error: hypothesisError } = await client.from("market_hypotheses").update({ status: "scope_locked" }).eq("research_run_id", decision.research_run_id).eq("workspace_id", workspace.id);
  if (hypothesisError) throw new MarketDiscoveryPersistenceError(failureMessage());
  const { error: runError } = await client.from("research_runs").update({ checkpoint: { phase: "market_scope", state: "market_scope_locked", version: 5, turn: 1, tool_calls: 0, runtime: "standalone_market_discovery", selection: input.choice }, heartbeat_at: now }).eq("id", decision.research_run_id).eq("workspace_id", workspace.id);
  if (runError) throw new MarketDiscoveryPersistenceError(failureMessage());
  const { error: auditError } = await client.from("audit_logs").insert({ workspace_id: workspace.id, research_run_id: decision.research_run_id, actor_id: actorId, event_type: "market_scope.selected", outcome: "completed", details_json: { choice: input.choice, provider_calls: 0, connector_calls: 0 } });
  if (auditError) throw new MarketDiscoveryPersistenceError(failureMessage());
  return { choice: input.choice, message: decisionMessage(input.choice), persisted: true };
}

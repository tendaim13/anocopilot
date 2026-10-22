import type { WorkspaceSession } from "@/contracts/ano";
import { productBriefInputSchema, type MarketAuditEvent, type MarketBriefResult, type MarketDecisionInput, type MarketHypothesisPatch, type MarketScope, type MarketScopeInput, type ProductBriefInput } from "@/lib/ano/market-discovery";
import { canTransition, disabledProviderReadiness, scopeForDecision, scopeForManualLocation, MarketStateTransitionError } from "@/server/domain/market-state-machine";

export class MarketDiscoveryPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketDiscoveryPersistenceError";
  }
}

function failureMessage() {
  return "Ano could not safely save this product brief. No provider, connector, or sales action was attempted.";
}

function withIds(result: MarketBriefResult, runId: string, productBriefId: string, decisionId: string, scanId: string): MarketBriefResult {
  return {
    ...result,
    run: { ...result.run, id: runId },
    productBrief: { ...result.productBrief, id: productBriefId },
    locationDecision: { ...result.locationDecision, id: decisionId },
    scan: { ...result.scan, id: scanId },
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
  const scanId = crypto.randomUUID();
  const persisted = withIds(result, runId, productBriefId, decisionId, scanId);
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
    const { error: scanError } = await client.from("market_scans").insert({
      id: scanId,
      workspace_id: workspace.id,
      research_run_id: runId,
      product_brief_id: productBriefId,
      scope_json: persisted.scan.scope,
      comparison_criteria_json: persisted.scan.comparisonCriteria,
      evidence_ids: persisted.scan.evidenceIds,
      provider_key: "prospeo",
      status: persisted.scan.status,
    });
    if (scanError) throw new Error("Could not save the market scan checkpoint.");
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

function baseScope(): MarketScope {
  return { state: "awaiting_scope_decision", kind: "unselected", locations: [], source: "none", summary: "Choose a location path before Ano considers a future research step." };
}

function hydrateResult(value: unknown): MarketBriefResult {
  if (!value || typeof value !== "object" || !("run" in value) || !("productBrief" in value) || !("hypothesis" in value) || !("locationDecision" in value)) {
    throw new MarketDiscoveryPersistenceError("Ano could not resume this product brief safely.");
  }
  const result = value as MarketBriefResult;
  const scope = result.scope ?? baseScope();
  return {
    ...result,
    scope,
    scan: result.scan ?? { id: crypto.randomUUID(), scope, status: "not_started", evidenceIds: [], comparisonCriteria: ["User-confirmed location preference", "Visible research evidence", "Approved provider availability"] },
    provider: result.provider ?? disabledProviderReadiness(),
    timeline: result.timeline ?? [],
  };
}

function event(label: string, detail: string, category: MarketAuditEvent["category"]): MarketAuditEvent {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), label, detail, category };
}

function withTimeline(result: MarketBriefResult, entry: MarketAuditEvent): MarketBriefResult {
  return { ...result, timeline: [...result.timeline, entry] };
}

function scanStatus(scope: MarketScope): "awaiting_provider_approval" | "blocked_provider" {
  return scope.state === "awaiting_provider_approval" ? "awaiting_provider_approval" : "blocked_provider";
}

async function writeScopeSnapshot(
  session: Extract<WorkspaceSession, { kind: "supabase" }>,
  runId: string,
  result: MarketBriefResult,
  scope: MarketScope,
  auditEvent: { event_type: string; outcome: string; details_json: Record<string, unknown> },
) {
  const now = new Date().toISOString();
  const next = withTimeline({
    ...result,
    run: { ...result.run, status: scope.state, message: scope.summary },
    scope,
    scan: { ...result.scan, scope, status: scanStatus(scope) },
    provider: disabledProviderReadiness(),
  }, event(auditEvent.event_type === "market_scope.manual_location" ? "Location scope locked" : "Location path selected", scope.summary, "decision"));
  const { error: scanError } = await session.client.from("market_scans").upsert({
    id: next.scan.id,
    workspace_id: session.workspace.id,
    research_run_id: runId,
    product_brief_id: next.productBrief.id,
    scope_json: next.scan.scope,
    comparison_criteria_json: next.scan.comparisonCriteria,
    evidence_ids: next.scan.evidenceIds,
    provider_key: "prospeo",
    status: next.scan.status,
  }, { onConflict: "workspace_id,research_run_id" });
  if (scanError) throw new MarketDiscoveryPersistenceError(failureMessage());
  const { error: hypothesisError } = await session.client.from("market_hypotheses").update({ status: scope.state === "awaiting_provider_approval" ? "scope_locked" : "active" }).eq("research_run_id", runId).eq("workspace_id", session.workspace.id);
  if (hypothesisError) throw new MarketDiscoveryPersistenceError(failureMessage());
  const { error: runError } = await session.client.from("research_runs").update({
    status: "paused",
    result_snapshot: next,
    checkpoint: { phase: "market_scope", state: scope.state, version: 6, turn: 1, tool_calls: 0, runtime: "standalone_market_discovery" },
    heartbeat_at: now,
  }).eq("id", runId).eq("workspace_id", session.workspace.id);
  if (runError) throw new MarketDiscoveryPersistenceError(failureMessage());
  const { error: auditError } = await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    research_run_id: runId,
    actor_id: session.actorId,
    ...auditEvent,
  });
  if (auditError) throw new MarketDiscoveryPersistenceError(failureMessage());
  return next;
}

async function runForBrief(session: Extract<WorkspaceSession, { kind: "supabase" }>, productBriefId: string) {
  const { data: brief, error: briefError } = await session.client.from("product_briefs").select("id, research_run_id").eq("workspace_id", session.workspace.id).eq("id", productBriefId).maybeSingle();
  if (briefError || !brief) throw new MarketDiscoveryPersistenceError("Ano could not find that product brief.");
  const { data: run, error: runError } = await session.client.from("research_runs").select("id, input_json, result_snapshot").eq("workspace_id", session.workspace.id).eq("id", brief.research_run_id).maybeSingle();
  if (runError || !run) throw new MarketDiscoveryPersistenceError("Ano could not find the product brief’s research run.");
  const input = productBriefInputSchema.safeParse(run.input_json);
  if (!input.success) throw new MarketDiscoveryPersistenceError("Ano could not resume this product brief because its original input is invalid.");
  return { run, input: input.data, result: hydrateResult(run.result_snapshot) };
}

export async function saveMarketDecision(session: WorkspaceSession, productBriefId: string, input: MarketDecisionInput) {
  if (session.kind === "demo") {
    const scope = scopeForDecision({ offer: "", objective: "", marketHunch: "", locationPreference: "", buyerHunch: "", customerExamples: "", exclusions: "", additionalContext: "" }, input.choice);
    return { scope, message: decisionMessage(input.choice), persisted: false };
  }
  const { client, workspace, actorId } = session;
  const { data: decision, error: findError } = await client.from("market_decisions").select("id, research_run_id, status, selected_key, options_json").eq("workspace_id", workspace.id).eq("product_brief_id", productBriefId).eq("decision_type", "location_path").maybeSingle();
  if (findError || !decision) throw new MarketDiscoveryPersistenceError("Ano could not find that pending location decision.");
  const allowedChoices = Array.isArray(decision.options_json) ? decision.options_json.flatMap((option: { key?: unknown }) => typeof option.key === "string" ? [option.key] : []) : [];
  if (!allowedChoices.includes(input.choice)) throw new MarketDiscoveryPersistenceError("That location choice is not available for this product brief.");
  const resumed = await runForBrief(session, productBriefId);
  if (decision.status === "selected") {
    if (decision.selected_key !== input.choice) throw new MarketDiscoveryPersistenceError("Ano already recorded a different location path for this run. Edit the brief to begin a new scope decision.");
    return { result: resumed.result, message: "That location path is already saved.", persisted: true };
  }
  let scope: MarketScope;
  try {
    scope = scopeForDecision(resumed.input, input.choice);
    if (!canTransition(resumed.result.scope.state, scope.state)) throw new MarketStateTransitionError("That location transition is not available from this run state.");
  } catch (error) {
    if (error instanceof MarketStateTransitionError) throw new MarketDiscoveryPersistenceError(error.message);
    throw error;
  }
  const now = new Date().toISOString();
  const { error: decisionError } = await client.from("market_decisions").update({ status: "selected", selected_key: input.choice, selected_by: actorId, selected_at: now }).eq("id", decision.id).eq("workspace_id", workspace.id);
  if (decisionError) throw new MarketDiscoveryPersistenceError(failureMessage());
  const selectedResult = { ...resumed.result, locationDecision: { ...resumed.result.locationDecision, status: "selected" as const, selection: input.choice } };
  const result = await writeScopeSnapshot(session, decision.research_run_id, selectedResult, scope, { event_type: "market_scope.selected", outcome: "completed", details_json: { choice: input.choice, provider_calls: 0, connector_calls: 0 } });
  return { result, message: decisionMessage(input.choice), persisted: true };
}

export async function saveManualMarketScope(session: WorkspaceSession, productBriefId: string, input: MarketScopeInput) {
  if (session.kind === "demo") return { scope: scopeForManualLocation(input.location), persisted: false };
  const resumed = await runForBrief(session, productBriefId);
  if (resumed.result.scope.state !== "awaiting_location_input") throw new MarketDiscoveryPersistenceError("Ano is not waiting for a location in this run.");
  const scope = scopeForManualLocation(input.location);
  const result = await writeScopeSnapshot(session, resumed.run.id, resumed.result, scope, { event_type: "market_scope.manual_location", outcome: "completed", details_json: { location: input.location, provider_calls: 0, connector_calls: 0 } });
  return { result, persisted: true };
}

export async function updateMarketHypotheses(session: WorkspaceSession, productBriefId: string, patch: MarketHypothesisPatch) {
  if (session.kind === "demo") throw new MarketDiscoveryPersistenceError("Sign in before Ano can save an edited hypothesis.");
  const resumed = await runForBrief(session, productBriefId);
  if (resumed.result.locationDecision.status === "selected") throw new MarketDiscoveryPersistenceError("Edit the brief and start a new scope decision if you need to change hypotheses after choosing a location path.");
  const allowedEvidence = new Set(resumed.result.evidence.map((item) => item.id));
  if (patch.hypotheses.some((item) => item.evidenceIds.some((id) => !allowedEvidence.has(id)))) throw new MarketDiscoveryPersistenceError("Ano cannot save a hypothesis that cites evidence outside your product brief.");
  const now = new Date().toISOString();
  const hypotheses = patch.hypotheses.map((item) => ({ ...item, origin: "workspace_member" as const, editedAt: now }));
  const next = withTimeline({ ...resumed.result, hypothesis: { ...resumed.result.hypothesis, hypotheses } }, event("Hypotheses edited", "You edited Ano’s hypotheses. They remain unverified until future research supplies evidence.", "hypothesis"));
  const { error: hypothesisError } = await session.client.from("market_hypotheses").update({ content_json: next.hypothesis, status: "active" }).eq("research_run_id", resumed.run.id).eq("workspace_id", session.workspace.id);
  if (hypothesisError) throw new MarketDiscoveryPersistenceError(failureMessage());
  const { error: runError } = await session.client.from("research_runs").update({ result_snapshot: next, heartbeat_at: now }).eq("id", resumed.run.id).eq("workspace_id", session.workspace.id);
  if (runError) throw new MarketDiscoveryPersistenceError(failureMessage());
  const { error: auditError } = await session.client.from("audit_logs").insert({ workspace_id: session.workspace.id, research_run_id: resumed.run.id, actor_id: session.actorId, event_type: "market_hypothesis.edited", outcome: "completed", details_json: { hypothesis_count: hypotheses.length, provider_calls: 0, connector_calls: 0 } });
  if (auditError) throw new MarketDiscoveryPersistenceError(failureMessage());
  return next;
}

export async function readMarketBrief(session: WorkspaceSession, productBriefId: string): Promise<MarketBriefResult> {
  if (session.kind === "demo") throw new MarketDiscoveryPersistenceError("Sign in before Ano can restore a saved product brief.");
  const resumed = await runForBrief(session, productBriefId);
  const { data: scan } = await session.client.from("market_scans").select("id, scope_json, status, evidence_ids, comparison_criteria_json").eq("workspace_id", session.workspace.id).eq("research_run_id", resumed.run.id).maybeSingle();
  if (!scan) return resumed.result;
  const scope = scan.scope_json as MarketScope;
  return { ...resumed.result, run: { ...resumed.result.run, status: scope.state, message: scope.summary }, scope, scan: { id: scan.id, scope, status: scan.status, evidenceIds: scan.evidence_ids ?? [], comparisonCriteria: scan.comparison_criteria_json ?? [] }, provider: disabledProviderReadiness() };
}

export async function readLatestMarketBrief(session: WorkspaceSession) {
  if (session.kind === "demo") return null;
  const { data: brief, error } = await session.client.from("product_briefs").select("id").eq("workspace_id", session.workspace.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !brief) return null;
  return readMarketBrief(session, brief.id);
}

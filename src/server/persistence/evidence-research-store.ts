import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import {
  evidenceResearchViewSchema,
  type EvidenceResearchView,
  type ResearchQuery,
} from "@/lib/ano/evidence-research";
import type { ResearchConversationView } from "@/lib/ano/research-conversation";
import type { EvidenceResearchExecutor } from "@/server/langgraph/evidence-research-graph";
import type { IterativeResearchExecutor, IterativeResearchStartNode } from "@/server/langgraph/iterative-evidence-research-graph";
import { IterativeResearchPlannerError } from "@/server/agents/iterative-research-planner";
import {
  ResearchProviderError,
  type ProviderExtractResponse,
  type ProviderSearchResponse,
} from "@/server/research/research-provider";
import {
  assessFetchedSource,
  assessResearchCoverage,
  classifySourceUrl,
  scoreSearchCandidate,
  type ResearchCoverage,
  type SourceClass,
} from "@/server/research/deep-research-assessment";
import { evidenceSourceRetriever } from "@/server/research/evidence-source-retriever";
import { searxngConfiguration, searxngResearchProvider } from "@/server/research/searxng-provider";

export class EvidenceResearchPersistenceError extends Error {
  constructor(message: string, readonly code: string = "EVIDENCE_RESEARCH_UNAVAILABLE") {
    super(message);
    this.name = "EvidenceResearchPersistenceError";
  }
}

type ResearchRunRow = Record<string, unknown>;
type SearchResultRow = Record<string, unknown>;

const RESEARCH_LEASE_TIMEOUT_MS = 90_000;

export const EVIDENCE_RESEARCH_ACTION_KINDS = ["research_run", "search", "fetch"] as const;

export function isEvidenceResearchActionKind(
  value: unknown,
): value is (typeof EVIDENCE_RESEARCH_ACTION_KINDS)[number] {
  return (
    typeof value === "string" &&
    (EVIDENCE_RESEARCH_ACTION_KINDS as readonly string[]).includes(value)
  );
}

function normalisedResearchQuery(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function queryTextsFromRun(run: ResearchRunRow) {
  if (!Array.isArray(run.query_plan_json)) return [];
  return run.query_plan_json.flatMap((item) => item && typeof item === "object" && "query" in item && typeof item.query === "string" ? [item.query] : []);
}

/**
 * Continuations need a fresh LangGraph thread, but must always derive it from
 * the original thread—not by repeatedly appending to an earlier continuation.
 * This also lets legacy, overlong thread IDs remain visible in the read model.
 */
function researchThreadRoot(value: unknown) {
  return String(value).split(":resume:")[0] || "ano:research";
}

function requireLiveSession(session: WorkspaceSession): asserts session is SupabaseWorkspaceSession {
  if (session.kind === "demo") throw new EvidenceResearchPersistenceError("Sign in before Ano can prepare durable public research.", "AUTH_REQUIRED");
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeText(value: unknown, maximum = 600) {
  const text = String(value ?? "").replace(/\u0000/g, "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, maximum) : null;
}

function isoTimestamp(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new EvidenceResearchPersistenceError("Ano received an invalid research timestamp.");
  return date.toISOString();
}

function safeProviderMessage(error: unknown) {
  if (error instanceof IterativeResearchPlannerError) return error.message;
  if (error instanceof ResearchProviderError || error instanceof EvidenceResearchPersistenceError) return error.message;
  return "Ano could not safely complete this research stage. It did not retry any provider request.";
}

function safeProviderDiagnostic(error: unknown) {
  return error instanceof ResearchProviderError ? error.diagnostic : {};
}

async function updateConnectionState(session: SupabaseWorkspaceSession, status: "connected" | "error", code: string | null = null) {
  const { error } = await session.client.from("connector_connections").upsert({
    workspace_id: session.workspace.id,
    connector_key: "searxng",
    status,
    scopes: ["public_evidence_search", "public_source_fetch"],
    credential_reference: "server_env:SEARXNG_BASE_URL+SEARXNG_GATEWAY_TOKEN",
    last_checked_at: new Date().toISOString(),
    last_error_code: code,
  }, { onConflict: "workspace_id,connector_key" });
  if (error) throw new EvidenceResearchPersistenceError("Ano could not save the public-research provider state.");
}

async function appendEvent(session: SupabaseWorkspaceSession, graphRunId: string, eventKey: string, label: string, detail: string) {
  const { error } = await session.client.from("run_events").upsert({
    workspace_id: session.workspace.id,
    graph_run_id: graphRunId,
    event_key: eventKey,
    label,
    detail,
  }, { onConflict: "graph_run_id,event_key" });
  if (error) throw new EvidenceResearchPersistenceError("Ano could not save the public-research activity record.");
}

async function getRun(session: SupabaseWorkspaceSession, runId: string) {
  const { data, error } = await session.client
    .from("ano_research_runs")
    .select("id, conversation_id, graph_run_id, research_plan_id, thread_id, attempt_number, provider_key, status, maximum_searches, maximum_fetches, consumed_searches, consumed_fetches, current_wave, coverage_json, query_plan_json, failure_message, heartbeat_at, created_at, updated_at")
    .eq("workspace_id", session.workspace.id)
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) throw new EvidenceResearchPersistenceError("Ano could not find that public-research run.", "RUN_NOT_FOUND");
  return data as ResearchRunRow;
}

function hasExpiredLease(run: ResearchRunRow, now = Date.now()) {
  if (String(run.status) !== "running") return false;
  const timestamp = new Date(String(run.heartbeat_at ?? run.updated_at)).getTime();
  return Number.isFinite(timestamp) && now - timestamp > RESEARCH_LEASE_TIMEOUT_MS;
}

async function touchResearchLease(session: SupabaseWorkspaceSession, runId: string) {
  const { error } = await session.client.from("ano_research_runs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("workspace_id", session.workspace.id)
    .eq("id", runId)
    .eq("status", "running");
  if (error) throw new EvidenceResearchPersistenceError("Ano could not record research progress safely.", "LEASE_NOT_SAVED");
}

async function getRunForConversation(session: SupabaseWorkspaceSession, conversationId: string) {
  const { data, error } = await session.client
    .from("ano_research_runs")
    .select("id")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new EvidenceResearchPersistenceError("Ano could not read the public-research run.");
  return data?.id ? String(data.id) : null;
}

async function parentAction(session: SupabaseWorkspaceSession, runId: string) {
  const { data, error } = await session.client
    .from("provider_action_requests")
    .select("id, status")
    .eq("workspace_id", session.workspace.id)
    .eq("ano_research_run_id", runId)
    .eq("request_key", "research-run")
    .maybeSingle();
  if (error || !data) throw new EvidenceResearchPersistenceError("Ano could not find the research approval record.");
  return { id: String(data.id), status: String(data.status) };
}

async function latestWaveCandidateMarkets(session: SupabaseWorkspaceSession, runId: string) {
  const { data, error } = await session.client
    .from("research_waves")
    .select("candidate_markets_json")
    .eq("workspace_id", session.workspace.id)
    .eq("ano_research_run_id", runId)
    .order("wave_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || !Array.isArray(data.candidate_markets_json)) {
    throw new EvidenceResearchPersistenceError("Ano could not identify the next safe research checkpoint.", "RESUME_STATE_UNAVAILABLE");
  }
  const markets = data.candidate_markets_json
    .map((value) => safeText(value, 140))
    .filter((value): value is string => Boolean(value));
  if (!markets.length) throw new EvidenceResearchPersistenceError("Ano could not identify the markets for the interrupted research wave.", "RESUME_STATE_UNAVAILABLE");
  return markets;
}

type EvidenceResearchClaim = {
  claimed: boolean;
  alreadyComplete: boolean;
  startNode?: IterativeResearchStartNode;
  threadId?: string;
  candidateMarkets?: string[];
  coverage?: ResearchCoverage | null;
  priorQueries?: string[];
};

async function resumeAfterUncertainProviderAction(session: SupabaseWorkspaceSession, run: ResearchRunRow): Promise<EvidenceResearchClaim> {
  const runId = String(run.id);
  const { data: manualActions, error: manualActionsError } = await session.client
    .from("provider_action_requests")
    .select("id, action_kind")
    .eq("workspace_id", session.workspace.id)
    .eq("ano_research_run_id", runId)
    .eq("status", "requires_manual_review");
  const hasUncertainProviderAction = Boolean(manualActions?.some((action) => action.action_kind === "search" || action.action_kind === "fetch"));
  const hasUnexpectedManualAction = Boolean(manualActions?.some((action) => action.action_kind !== "search" && action.action_kind !== "fetch" && action.action_kind !== "research_run"));
  if (manualActionsError || !hasUncertainProviderAction || hasUnexpectedManualAction) {
    return { claimed: false, alreadyComplete: false };
  }
  const parent = await parentAction(session, runId);
  if (parent.status !== "requires_manual_review") return { claimed: false, alreadyComplete: false };
  const candidateMarkets = await latestWaveCandidateMarkets(session, runId);
  const now = new Date().toISOString();
  const nextThreadId = `${researchThreadRoot(run.thread_id)}:resume:${crypto.randomUUID()}`;
  const { data: resumedParent, error: parentError } = await session.client.from("provider_action_requests").update({
    status: "running",
    failure_message: null,
    completed_at: null,
    started_at: now,
    provider_receipt_json: { outcome: "resumed_after_excluded_provider_action", retry: "not_attempted" },
  }).eq("workspace_id", session.workspace.id).eq("id", parent.id).eq("status", "requires_manual_review").select("id").maybeSingle();
  if (parentError || !resumedParent) throw new EvidenceResearchPersistenceError("Ano could not secure continuation of the approved research mission.", "RESUME_NOT_SAVED");
  const { data: resumedRun, error: runError } = await session.client.from("ano_research_runs").update({
    status: "running",
    failure_message: null,
    completed_at: null,
    started_at: now,
    thread_id: nextThreadId,
    heartbeat_at: now,
  }).eq("workspace_id", session.workspace.id).eq("id", runId).eq("status", "requires_manual_review").select("id").maybeSingle();
  if (runError || !resumedRun) throw new EvidenceResearchPersistenceError("Ano could not record continuation of the approved research mission.", "RESUME_NOT_SAVED");
  await appendEvent(session, String(run.graph_run_id), `deep-research-resume:${runId}:${nextThreadId}`, "Approved research continued", "Ano excluded the provider request whose outcome was uncertain and did not retry it. It is reassessing saved evidence before considering the remaining approved research budget.");
  return {
    claimed: true,
    alreadyComplete: false,
    startNode: "assess_coverage",
    threadId: nextThreadId,
    candidateMarkets,
    coverage: (run.coverage_json ?? null) as ResearchCoverage | null,
    priorQueries: queryTextsFromRun(run),
  };
}

/**
 * A Next request can end during a restart even though its last provider action
 * has already been durably marked running. Once its heartbeat expires, turn
 * that unknown outcome into a visible no-retry review state. No provider call
 * is made by this recovery path.
 */
async function recoverExpiredResearchLease(session: SupabaseWorkspaceSession, run: ResearchRunRow) {
  if (!hasExpiredLease(run)) return run;
  const runId = String(run.id);
  const now = new Date().toISOString();
  const message = "Ano's research worker stopped before it could confirm an in-flight provider request. That request was not retried; continue the remaining approved budget from the saved evidence.";
  const { data: recoveredRun, error: runError } = await session.client.from("ano_research_runs").update({
    status: "requires_manual_review",
    failure_message: message,
    completed_at: now,
    heartbeat_at: null,
  }).eq("workspace_id", session.workspace.id).eq("id", runId).eq("status", "running").select("id").maybeSingle();
  if (runError) throw new EvidenceResearchPersistenceError("Ano could not preserve the interrupted research state.", "LEASE_RECOVERY_NOT_SAVED");
  if (!recoveredRun) return getRun(session, runId);
  const receipt = { outcome: "requires_manual_review", reason: "research_lease_expired", retry: "not_attempted" };
  const { error: childError } = await session.client.from("provider_action_requests").update({
    status: "requires_manual_review",
    failure_message: message,
    completed_at: now,
    provider_receipt_json: receipt,
  }).eq("workspace_id", session.workspace.id).eq("ano_research_run_id", runId).in("action_kind", ["search", "fetch"]).eq("status", "running");
  if (childError) throw new EvidenceResearchPersistenceError("Ano could not preserve the interrupted provider request.", "LEASE_RECOVERY_NOT_SAVED");
  const { error: parentError } = await session.client.from("provider_action_requests").update({
    status: "requires_manual_review",
    failure_message: message,
    completed_at: now,
    provider_receipt_json: receipt,
  }).eq("workspace_id", session.workspace.id).eq("ano_research_run_id", runId).eq("request_key", "research-run").eq("status", "running");
  if (parentError) throw new EvidenceResearchPersistenceError("Ano could not preserve the interrupted research approval.", "LEASE_RECOVERY_NOT_SAVED");
  await appendEvent(session, String(run.graph_run_id), `deep-research-lease-expired:${runId}`, "Research paused after an interruption", "Ano recorded the unfinished provider request for review and did not retry it. You can continue the remaining approved research budget from saved evidence.");
  return getRun(session, runId);
}

async function hasProviderRisk(session: SupabaseWorkspaceSession, runId: string) {
  const { data, error } = await session.client
    .from("provider_action_requests")
    .select("id")
    .eq("workspace_id", session.workspace.id)
    .eq("ano_research_run_id", runId)
    .in("action_kind", ["search", "fetch"])
    .eq("status", "requires_manual_review")
    .limit(1);
  if (error) return true;
  return Boolean(data?.length);
}

async function setStopped(session: SupabaseWorkspaceSession, runId: string, status: "failed_safe" | "requires_manual_review", message: string, error: unknown) {
  const now = new Date().toISOString();
  const run = await getRun(session, runId);
  const { data: stoppedRun, error: runError } = await session.client
    .from("ano_research_runs")
    .update({ status, failure_message: safeText(message), completed_at: now, heartbeat_at: null })
    .eq("workspace_id", session.workspace.id)
    .eq("id", runId)
    .eq("status", "running")
    .select("id")
    .maybeSingle();
  if (runError) {
    throw new EvidenceResearchPersistenceError("Ano could not record the research stop state.", "STOP_STATE_NOT_SAVED");
  }
  // A final persistence action may have completed the run before a later
  // non-provider error reaches this handler. Never downgrade saved evidence
  // back to failed_safe in that situation.
  if (!stoppedRun) return;
  const diagnostic = safeProviderDiagnostic(error);
  const { error: childActionError } = await session.client.from("provider_action_requests").update({ status, failure_message: safeText(message), completed_at: now, provider_receipt_json: { outcome: status, diagnostic } }).eq("workspace_id", session.workspace.id).eq("ano_research_run_id", runId).in("action_kind", ["search", "fetch"]).eq("status", "running");
  if (childActionError) throw new EvidenceResearchPersistenceError("Ano could not record the stopped provider requests.", "STOP_STATE_NOT_SAVED");
  const { data: stoppedParent, error: parentError } = await session.client.from("provider_action_requests").update({ status, failure_message: safeText(message), completed_at: now, provider_receipt_json: { outcome: status, diagnostic } }).eq("workspace_id", session.workspace.id).eq("ano_research_run_id", runId).eq("request_key", "research-run").eq("status", "running").select("id").maybeSingle();
  if (parentError || !stoppedParent) throw new EvidenceResearchPersistenceError("Ano could not record the parent research approval state.", "STOP_STATE_NOT_SAVED");
  try {
    await appendEvent(session, String(run.graph_run_id), `phase-b-stop:${runId}`, status === "requires_manual_review" ? "Research stopped for manual review" : "Research stopped safely", status === "requires_manual_review" ? "Ano could not confirm a provider outcome, so it did not retry the request." : message);
  } catch (eventError) {
    // The durable run and provider action states above are the safety record.
    // A supplementary activity-log failure must not turn that recorded result
    // into a failed client request or hide its actual reason from the user.
    console.error("Ano could not append the public-research stop event.", eventError);
  }
}

function actionDescription(provider: string, kind: "research_run" | "search" | "fetch", request: Record<string, unknown>) {
  if (kind === "research_run") return `One bounded ${provider === "tavily" ? "Tavily" : "SearXNG"} public-evidence research run`;
  if (kind === "search") return `Search: ${safeText(request.query, 260) ?? "bounded public-evidence query"}`;
  return `Fetch up to ${Number(request.count ?? 0)} approved public source${Number(request.count ?? 0) === 1 ? "" : "s"}`;
}

async function claimChildAction(
  session: SupabaseWorkspaceSession,
  runId: string,
  kind: "search" | "fetch",
  requestKey: string,
  requestJson: Record<string, unknown>,
) {
  const id = crypto.randomUUID();
  const { error } = await session.client.from("provider_action_requests").insert({
    id,
    workspace_id: session.workspace.id,
    ano_research_run_id: runId,
    provider_key: "searxng",
    action_kind: kind,
    request_key: requestKey,
    request_json: requestJson,
    status: "running",
    maximum_operations: 1,
    created_by: session.actorId,
    started_at: new Date().toISOString(),
  });
  if (!error) return { id, alreadySucceeded: false };

  const { data: existing, error: existingError } = await session.client
    .from("provider_action_requests")
    .select("id, status")
    .eq("workspace_id", session.workspace.id)
    .eq("ano_research_run_id", runId)
    .eq("request_key", requestKey)
    .maybeSingle();
  if (existingError || !existing) throw new EvidenceResearchPersistenceError("Ano could not secure a unique provider request.");
  if (existing.status === "succeeded") return { id: String(existing.id), alreadySucceeded: true };
  // An excluded provider operation is a durable audit record, not a retry
  // candidate. This protects a continuation if a cached plan reaches it again.
  if (existing.status === "requires_manual_review" || existing.status === "failed_safe") {
    return { id: String(existing.id), alreadySucceeded: false, skippedAsExcluded: true };
  }
  throw new EvidenceResearchPersistenceError("Ano will not retry this provider request automatically because its prior outcome needs review.", "REQUEST_ALREADY_STARTED");
}

async function completeChildAction(
  session: SupabaseWorkspaceSession,
  actionId: string,
  response: ProviderSearchResponse | ProviderExtractResponse,
  details: Record<string, unknown>,
) {
  const { data, error } = await session.client.from("provider_action_requests").update({
    status: "succeeded",
    completed_at: new Date().toISOString(),
    reported_credits: response.credits,
    provider_receipt_json: { requestId: response.requestId, ...details },
  }).eq("workspace_id", session.workspace.id).eq("id", actionId).eq("status", "running").select("id").maybeSingle();
  if (error || !data) throw new EvidenceResearchPersistenceError("Ano received a provider response but could not save its receipt. It will not retry automatically.", "RECEIPT_NOT_SAVED");
}

/**
 * An uncertain source request is never retried. Its durable child action stays
 * visible for review, while the larger approved mission can continue using the
 * sources whose outcomes were confirmed.
 */
async function markChildActionForManualReview(
  session: SupabaseWorkspaceSession,
  actionId: string,
  error: ResearchProviderError,
) {
  const { data, error: updateError } = await session.client.from("provider_action_requests").update({
    status: "requires_manual_review",
    failure_message: safeText(error.message),
    completed_at: new Date().toISOString(),
    provider_receipt_json: {
      outcome: "requires_manual_review",
      diagnostic: safeProviderDiagnostic(error),
      retry: "not_attempted",
    },
  }).eq("workspace_id", session.workspace.id).eq("id", actionId).eq("status", "running").select("id").maybeSingle();
  if (updateError || !data) {
    throw new EvidenceResearchPersistenceError("Ano could not record the uncertain source retrieval. It will not retry the request.", "RECEIPT_NOT_SAVED");
  }
}

async function persistSearchResults(session: SupabaseWorkspaceSession, runId: string, actionId: string, response: ProviderSearchResponse, researchQueryId: string | null = null) {
  const rows = response.results.map((result, index) => ({
    id: crypto.randomUUID(),
    workspace_id: session.workspace.id,
    ano_research_run_id: runId,
    provider_action_request_id: actionId,
    provider_result_id: result.providerResultId,
    rank: index + 1,
    title: result.title,
    url: result.url,
    canonical_url: result.url,
    snippet: result.snippet,
    provider_score: result.score,
    published_at: result.publishedAt,
    research_query_id: researchQueryId,
  }));
  if (!rows.length) return;
  const { error } = await session.client.from("research_search_results").upsert(rows, { onConflict: "ano_research_run_id,canonical_url", ignoreDuplicates: true });
  if (error) throw new EvidenceResearchPersistenceError("Ano could not save the public search results. It will not retry the provider request.", "RESULTS_NOT_SAVED");
}

async function selectedSearchResults(session: SupabaseWorkspaceSession, runId: string, limit: number) {
  const { data, error } = await session.client
    .from("research_search_results")
    .select("id, title, canonical_url, published_at")
    .eq("workspace_id", session.workspace.id)
    .eq("ano_research_run_id", runId)
    .order("provider_score", { ascending: false, nullsFirst: false })
    .order("rank", { ascending: true })
    .limit(limit);
  if (error) throw new EvidenceResearchPersistenceError("Ano could not select the saved search results for source retrieval.");
  return (data ?? []) as SearchResultRow[];
}

async function persistFetchedSources(
  session: SupabaseWorkspaceSession,
  runId: string,
  actionId: string,
  searchResults: SearchResultRow[],
  response: ProviderExtractResponse,
) {
  const fetched = new Map(response.results.map((item) => [item.url, item.content]));
  const failures = new Map(response.failures.map((item) => [item.url, item]));
  const rows = searchResults.map((item) => {
    const canonicalUrl = String(item.canonical_url);
    const content = fetched.get(canonicalUrl);
    const failure = failures.get(canonicalUrl) ?? (!content ? { message: "Ano could not retrieve this saved source safely.", status: "failed_safe" as const } : null);
    const excerpt = content ? safeText(content, 1_200) : null;
    return {
      id: crypto.randomUUID(),
      workspace_id: session.workspace.id,
      ano_research_run_id: runId,
      search_result_id: String(item.id),
      provider_action_request_id: actionId,
      title: safeText(item.title, 500) ?? "Untitled source",
      canonical_url: canonicalUrl,
      source_class: classifySourceUrl(canonicalUrl),
      content_type: content ? response.results.find((item) => item.url === canonicalUrl)?.contentType ?? "text/html" : null,
      supporting_excerpt: excerpt,
      content_hash: content ? stableHash(content) : null,
      published_at: item.published_at ? isoTimestamp(item.published_at) : null,
      retrieved_at: new Date().toISOString(),
      status: content ? "fetched" : failure?.status ?? "failed_safe",
      failure_message: failure ? safeText(failure.message) : null,
    };
  });
  if (!rows.length) return;
  const { error } = await session.client.from("research_sources").upsert(rows, { onConflict: "search_result_id", ignoreDuplicates: true });
  if (error) throw new EvidenceResearchPersistenceError("Ano could not save the retrieved source evidence. It will not retry the provider request.", "SOURCES_NOT_SAVED");
}

function queryFromRow(row: Record<string, unknown>): ResearchQuery {
  return {
    id: String(row.id),
    query: String(row.query),
    reason: String(row.reason),
    sourceClass: String(row.intended_source_class) as ResearchQuery["sourceClass"],
    candidateMarket: row.candidate_market ? String(row.candidate_market) : null,
    comparisonDimension: String(row.comparison_dimension) as ResearchQuery["comparisonDimension"],
    priority: Number(row.priority),
    waveNumber: 1,
  };
}

async function deepQueryMap(session: SupabaseWorkspaceSession, runId: string) {
  const { data, error } = await session.client
    .from("research_queries")
    .select("id, query, reason, candidate_market, comparison_dimension, intended_source_class, priority")
    .eq("workspace_id", session.workspace.id)
    .eq("ano_research_run_id", runId);
  if (error) throw new EvidenceResearchPersistenceError("Ano could not read the saved iterative research queries.");
  return new Map((data ?? []).map((row) => [String(row.id), queryFromRow(row as Record<string, unknown>)]));
}

async function deepSelectedSearchResults(session: SupabaseWorkspaceSession, runId: string, limit: number) {
  const [{ data: results, error: resultsError }, { data: sources, error: sourcesError }, { data: fetchActions, error: fetchActionsError }, queries] = await Promise.all([
    session.client.from("research_search_results")
      .select("id, title, canonical_url, published_at, provider_score, snippet, research_query_id")
      .eq("workspace_id", session.workspace.id)
      .eq("ano_research_run_id", runId),
    session.client.from("research_sources")
      .select("search_result_id")
      .eq("workspace_id", session.workspace.id)
      .eq("ano_research_run_id", runId),
    session.client.from("provider_action_requests")
      .select("request_json")
      .eq("workspace_id", session.workspace.id)
      .eq("ano_research_run_id", runId)
      .eq("action_kind", "fetch"),
    deepQueryMap(session, runId),
  ]);
  if (resultsError || sourcesError || fetchActionsError) throw new EvidenceResearchPersistenceError("Ano could not select the next source candidates.");
  // A source row normally proves a result was already handled. Older safe
  // failures can have only their fetch action, however, so include those too.
  // This preserves the no-retry rule without letting one orphaned action stop
  // the rest of the approved mission whenever it is ranked again.
  const alreadyAttempted = new Set((sources ?? []).map((source) => String(source.search_result_id)));
  for (const action of fetchActions ?? []) {
    const request = action.request_json;
    if (request && typeof request === "object" && "searchResultId" in request && typeof request.searchResultId === "string") {
      alreadyAttempted.add(request.searchResultId);
    }
  }
  type DeepSearchResult = SearchResultRow & { research_query_id: string | null; candidate_score: number };
  const ranked: DeepSearchResult[] = (results ?? [])
    .filter((row) => !alreadyAttempted.has(String(row.id)))
    .map((row): DeepSearchResult => ({
      ...(row as SearchResultRow),
      research_query_id: row.research_query_id ? String(row.research_query_id) : null,
      candidate_score: scoreSearchCandidate({
        id: String(row.id),
        url: String(row.canonical_url),
        title: String(row.title),
        snippet: row.snippet ? String(row.snippet) : null,
        providerScore: row.provider_score === null ? null : Number(row.provider_score),
        publishedAt: row.published_at ? isoTimestamp(row.published_at) : null,
        query: row.research_query_id ? queries.get(String(row.research_query_id)) ?? null : null,
      }).score,
    }));
  return ranked.sort((left, right) => Number(right.candidate_score) - Number(left.candidate_score)).slice(0, limit);
}

async function assessPersistedSource(
  session: SupabaseWorkspaceSession,
  runId: string,
  searchResult: SearchResultRow,
) {
  const [{ data: source, error: sourceError }, { data: prior, error: priorError }, queries] = await Promise.all([
    session.client.from("research_sources")
      .select("id, title, canonical_url, source_class, supporting_excerpt, published_at, status")
      .eq("workspace_id", session.workspace.id)
      .eq("search_result_id", String(searchResult.id))
      .maybeSingle(),
    session.client.from("research_sources")
      .select("id, title, source_class, supporting_excerpt")
      .eq("workspace_id", session.workspace.id)
      .eq("ano_research_run_id", runId)
      .eq("status", "fetched"),
    deepQueryMap(session, runId),
  ]);
  if (sourceError || priorError || !source || source.status !== "fetched" || !source.supporting_excerpt) return;
  const query = searchResult.research_query_id ? queries.get(String(searchResult.research_query_id)) ?? null : null;
  const assessment = assessFetchedSource({
    url: String(source.canonical_url),
    title: String(source.title),
    excerpt: String(source.supporting_excerpt),
    publishedAt: source.published_at ? isoTimestamp(source.published_at) : null,
    query,
    priorSources: (prior ?? [])
      .filter((item) => String(item.id) !== String(source.id) && item.supporting_excerpt)
      .map((item) => ({ sourceClass: item.source_class as SourceClass, title: String(item.title), excerpt: String(item.supporting_excerpt) })),
  });
  const { error } = await session.client.from("research_source_assessments").upsert({
    id: crypto.randomUUID(),
    workspace_id: session.workspace.id,
    ano_research_run_id: runId,
    research_source_id: String(source.id),
    authority_score: assessment.authorityScore,
    query_directness_score: assessment.queryDirectnessScore,
    freshness_score: assessment.freshnessScore,
    diversity_score: assessment.diversityScore,
    extractability_score: assessment.extractabilityScore,
    redundancy_penalty: assessment.redundancyPenalty,
    overall_score: assessment.overallScore,
    decision_relevant: assessment.decisionRelevant,
    assessment_json: { rationale: assessment.rationale, queryId: query?.id ?? null, candidateMarket: query?.candidateMarket ?? null, comparisonDimension: query?.comparisonDimension ?? null },
  }, { onConflict: "research_source_id" });
  if (error) throw new EvidenceResearchPersistenceError("Ano could not save the evidence-quality assessment.");
}

async function deepCoverage(session: SupabaseWorkspaceSession, runId: string, candidateMarkets: string[]): Promise<ResearchCoverage> {
  const [{ data: assessments, error: assessmentError }, queries] = await Promise.all([
    session.client.from("research_source_assessments")
      .select("research_source_id, overall_score, decision_relevant, research_sources!inner(source_class, search_result_id)")
      .eq("workspace_id", session.workspace.id)
      .eq("ano_research_run_id", runId),
    deepQueryMap(session, runId),
  ]);
  if (assessmentError) throw new EvidenceResearchPersistenceError("Ano could not assess research coverage.");
  const { data: resultRows, error: resultError } = await session.client.from("research_search_results")
    .select("id, research_query_id")
    .eq("workspace_id", session.workspace.id)
    .eq("ano_research_run_id", runId);
  if (resultError) throw new EvidenceResearchPersistenceError("Ano could not trace evidence back to its research question.");
  const resultQueryIds = new Map((resultRows ?? []).map((result) => [String(result.id), result.research_query_id ? String(result.research_query_id) : null]));
  const sources = (assessments ?? []).flatMap((assessment) => {
    const source = Array.isArray(assessment.research_sources) ? assessment.research_sources[0] : assessment.research_sources;
    if (!source) return [];
    const queryId = resultQueryIds.get(String((source as Record<string, unknown>).search_result_id));
    return [{
      sourceClass: String((source as Record<string, unknown>).source_class) as SourceClass,
      overallScore: Number(assessment.overall_score),
      decisionRelevant: Boolean(assessment.decision_relevant),
      query: queryId ? queries.get(queryId) ?? null : null,
    }];
  });
  return assessResearchCoverage({ candidateMarkets, sources });
}

async function refreshDeepRunUsage(session: SupabaseWorkspaceSession, runId: string, coverage?: ResearchCoverage) {
  const { data, error } = await session.client.from("provider_action_requests")
    .select("action_kind, status")
    .eq("workspace_id", session.workspace.id)
    .eq("ano_research_run_id", runId)
    .in("action_kind", ["search", "fetch"])
    .in("status", ["succeeded", "requires_manual_review"]);
  if (error) throw new EvidenceResearchPersistenceError("Ano could not record research mission usage.");
  const actions = data ?? [];
  const consumedSearches = actions.filter((action) => action.action_kind === "search").length;
  const consumedFetches = actions.filter((action) => action.action_kind === "fetch").length;
  const { error: updateError } = await session.client.from("ano_research_runs").update({
    consumed_searches: consumedSearches,
    consumed_fetches: consumedFetches,
    coverage_json: coverage ?? undefined,
    heartbeat_at: new Date().toISOString(),
  }).eq("workspace_id", session.workspace.id).eq("id", runId);
  if (updateError) throw new EvidenceResearchPersistenceError("Ano could not save iterative research mission usage.");
}

export function createEvidenceResearchExecutor(session: WorkspaceSession): EvidenceResearchExecutor {
  requireLiveSession(session);
  return {
    async persistQueryPlan(runId, queries) {
      const { error } = await session.client.from("ano_research_runs").update({ query_plan_json: queries, heartbeat_at: new Date().toISOString() }).eq("workspace_id", session.workspace.id).eq("id", runId).eq("status", "running");
      if (error) throw new EvidenceResearchPersistenceError("Ano could not save the proposed research queries.");
      const run = await getRun(session, runId);
      await appendEvent(session, String(run.graph_run_id), `phase-b-queries:${runId}`, "Research queries prepared", `Ano prepared ${queries.length} bounded public-evidence queries. The provider has not been asked to search yet.`);
    },

    async executeSearch(runId, query) {
      const action = await claimChildAction(session, runId, "search", `search:${stableHash(query.query)}`, { query: query.query, sourceClass: query.sourceClass });
      if (action.alreadySucceeded || action.skippedAsExcluded) return;
      await touchResearchLease(session, runId);
      const response = await searxngResearchProvider.search(query.query);
      await persistSearchResults(session, runId, action.id, response);
      await completeChildAction(session, action.id, response, { resultCount: response.results.length, query: query.query });
    },

    async selectSourcesToFetch(runId, maximumFetches) {
      return (await selectedSearchResults(session, runId, maximumFetches)).map((item) => String(item.id));
    },

    async executeFetch(runId, searchResultIds) {
      const all = await selectedSearchResults(session, runId, 30);
      const wanted = new Set(searchResultIds);
      const selected = all.filter((item) => wanted.has(String(item.id))).slice(0, 30);
      for (const result of selected) {
        const url = String(result.canonical_url);
        const action = await claimChildAction(session, runId, "fetch", `fetch:${String(result.id)}`, { count: 1, searchResultId: String(result.id), canonicalUrl: url });
        if (action.alreadySucceeded) continue;
        const response = await evidenceSourceRetriever.fetchSavedResult({ id: String(result.id), canonicalUrl: url });
        await persistFetchedSources(session, runId, action.id, [result], response);
        await completeChildAction(session, action.id, response, { requestedSources: 1, retrievedSources: response.results.length, failedSources: response.failures.length });
      }
    },

    async complete(runId) {
      const run = await getRun(session, runId);
      const { count, error: sourceCountError } = await session.client
        .from("research_sources")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", session.workspace.id)
        .eq("ano_research_run_id", runId)
        .eq("status", "fetched");
      if (sourceCountError) throw new EvidenceResearchPersistenceError("Ano could not count the saved source evidence.");
      const completedAt = new Date().toISOString();
      const { error: runError } = await session.client.from("ano_research_runs").update({ status: "sources_ready", completed_at: completedAt, failure_message: null }).eq("workspace_id", session.workspace.id).eq("id", runId).eq("status", "running");
      if (runError) throw new EvidenceResearchPersistenceError("Ano could not complete the public-research run.");
      const { error: parentError } = await session.client.from("provider_action_requests").update({ status: "succeeded", completed_at: completedAt, provider_receipt_json: { fetchedSources: count ?? 0, provider: "searxng" } }).eq("workspace_id", session.workspace.id).eq("ano_research_run_id", runId).eq("request_key", "research-run").eq("status", "running");
      if (parentError) throw new EvidenceResearchPersistenceError("Ano could not save the completed research receipt.");
      await appendEvent(session, String(run.graph_run_id), `phase-b-complete:${runId}`, "Public evidence saved", `Ano saved ${count ?? 0} source excerpts for the approved plan. It has not ranked markets, searched Prospeo, looked up people, or started outreach.`);
    },
  };
}

/**
 * Deep-research executor. It owns persistence, provider calls, evidence scoring,
 * and the durable budget. Bedrock can propose only the next query wave.
 */
export function createIterativeEvidenceResearchExecutor(session: WorkspaceSession): IterativeResearchExecutor {
  requireLiveSession(session);
  return {
    async persistWave(runId, wave) {
      const run = await getRun(session, runId);
      const previousQueries = Array.isArray(run.query_plan_json) ? run.query_plan_json : [];
      const knownQueries = new Set(queryTextsFromRun(run).map(normalisedResearchQuery));
      const acceptedQueries = wave.queries.filter((query) => {
        const key = normalisedResearchQuery(query.query);
        if (!key || knownQueries.has(key)) return false;
        knownQueries.add(key);
        return true;
      });
      const { data: existingWave, error: existingWaveError } = await session.client.from("research_waves")
        .select("id")
        .eq("workspace_id", session.workspace.id)
        .eq("ano_research_run_id", runId)
        .eq("wave_number", wave.waveNumber)
        .maybeSingle();
      if (existingWaveError) throw new EvidenceResearchPersistenceError("Ano could not inspect the next iterative research wave.");
      const waveId = existingWave?.id ? String(existingWave.id) : wave.id;

      if (!acceptedQueries.length) {
        if (existingWave?.id) {
          const { error: stoppedWaveError } = await session.client.from("research_waves").update({
            status: "stopped",
            completed_at: new Date().toISOString(),
          }).eq("workspace_id", session.workspace.id).eq("id", waveId);
          if (stoppedWaveError) throw new EvidenceResearchPersistenceError("Ano could not close the empty iterative research wave.");
        }
        await appendEvent(session, String(run.graph_run_id), `deep-research-wave-noop:${runId}:${wave.waveNumber}`, "No new research queries planned", "Ano excluded repeated research questions from the next wave. No provider request was made, and it will continue with the evidence already saved.");
        return { id: waveId, queries: [] };
      }

      const waveValues = {
        objective: wave.objective,
        candidate_markets_json: wave.candidateMarkets,
        status: "running",
        search_budget: acceptedQueries.length,
        fetch_budget: Math.min(wave.fetchBudget, Math.max(8, acceptedQueries.length * 3)),
        coverage_before_json: run.coverage_json ?? {},
        completed_at: null,
      };
      if (existingWave?.id) {
        const { error: waveError } = await session.client.from("research_waves").update(waveValues)
          .eq("workspace_id", session.workspace.id)
          .eq("id", waveId);
        if (waveError) throw new EvidenceResearchPersistenceError("Ano could not resume the saved iterative research wave.");
      } else {
        const { error: waveError } = await session.client.from("research_waves").insert({
          id: waveId,
          workspace_id: session.workspace.id,
          ano_research_run_id: runId,
          wave_number: wave.waveNumber,
          ...waveValues,
        });
        if (waveError) throw new EvidenceResearchPersistenceError("Ano could not save the next iterative research wave.");
      }

      const { error: queryError } = await session.client.from("research_queries").insert(acceptedQueries.map((query) => ({
        id: query.id,
        workspace_id: session.workspace.id,
        ano_research_run_id: runId,
        research_wave_id: waveId,
        query: query.query,
        reason: query.reason,
        candidate_market: query.candidateMarket,
        comparison_dimension: query.comparisonDimension ?? "problem_urgency",
        intended_source_class: query.sourceClass,
        priority: query.priority ?? 50,
        status: "planned",
      })));
      if (queryError) throw new EvidenceResearchPersistenceError("Ano could not save the bounded iterative research queries.");
      const { error: runError } = await session.client.from("ano_research_runs").update({
        current_wave: wave.waveNumber,
        query_plan_json: [...previousQueries, ...acceptedQueries],
        heartbeat_at: new Date().toISOString(),
      }).eq("workspace_id", session.workspace.id).eq("id", runId).eq("status", "running");
      if (runError) throw new EvidenceResearchPersistenceError("Ano could not attach the research wave to its approved mission.");
      await appendEvent(session, String(run.graph_run_id), `deep-research-wave:${runId}:${wave.waveNumber}`, `Research wave ${wave.waveNumber} planned`, `${acceptedQueries.length} targeted queries will test ${wave.candidateMarkets.join(", ")}. Ano has not expanded the approved provider scope.`);
      return { id: waveId, queries: acceptedQueries };
    },

    async executeSearch(runId, _waveId, query) {
      const action = await claimChildAction(session, runId, "search", `search:${stableHash(query.query)}`, {
        query: query.query,
        researchQueryId: query.id,
        candidateMarket: query.candidateMarket,
        comparisonDimension: query.comparisonDimension,
        sourceClass: query.sourceClass,
      });
      if (!action.alreadySucceeded) {
        const response = await searxngResearchProvider.search(query.query);
        await persistSearchResults(session, runId, action.id, response, query.id);
        await completeChildAction(session, action.id, response, { resultCount: response.results.length, query: query.query, researchQueryId: query.id });
      }
      const { error } = await session.client.from("research_queries").update({ status: "searched" })
        .eq("workspace_id", session.workspace.id).eq("id", query.id).eq("status", "planned");
      if (error) throw new EvidenceResearchPersistenceError("Ano could not record the completed iterative search.");
      await refreshDeepRunUsage(session, runId);
    },

    async selectSourcesToFetch(runId, fetchBudget) {
      return (await deepSelectedSearchResults(session, runId, fetchBudget)).map((item) => String(item.id));
    },

    async executeFetch(runId, searchResultIds) {
      const candidates = await deepSelectedSearchResults(session, runId, searchResultIds.length);
      const wanted = new Set(searchResultIds);
      const selected = candidates.filter((item) => wanted.has(String(item.id)));
      for (const result of selected) {
        const url = String(result.canonical_url);
        const action = await claimChildAction(session, runId, "fetch", `fetch:${String(result.id)}`, {
          count: 1,
          searchResultId: String(result.id),
          canonicalUrl: url,
          researchQueryId: result.research_query_id ?? null,
        });
        if ("skippedAsExcluded" in action && action.skippedAsExcluded) continue;
        if (!action.alreadySucceeded) {
          try {
            await touchResearchLease(session, runId);
            const response = await evidenceSourceRetriever.fetchSavedResult({ id: String(result.id), canonicalUrl: url });
            await persistFetchedSources(session, runId, action.id, [result], response);
            await completeChildAction(session, action.id, response, { requestedSources: 1, retrievedSources: response.results.length, failedSources: response.failures.length });
          } catch (error) {
            if (!(error instanceof ResearchProviderError) || error.code !== "UNCERTAIN_OUTCOME") throw error;
            const response: ProviderExtractResponse = {
              requestId: null,
              credits: null,
              results: [],
              failures: [{ url, message: error.message, status: "failed_safe" }],
            };
            await persistFetchedSources(session, runId, action.id, [result], response);
            await markChildActionForManualReview(session, action.id, error);
          }
        }
        await assessPersistedSource(session, runId, result);
        await refreshDeepRunUsage(session, runId);
      }
    },

    async assessCoverage(runId, candidateMarkets) {
      const coverage = await deepCoverage(session, runId, candidateMarkets);
      await refreshDeepRunUsage(session, runId, coverage);
      const run = await getRun(session, runId);
      const { error } = await session.client.from("research_waves").update({
        status: "assessed",
        coverage_after_json: coverage,
      }).eq("workspace_id", session.workspace.id).eq("ano_research_run_id", runId).eq("wave_number", Number(run.current_wave));
      if (error) throw new EvidenceResearchPersistenceError("Ano could not save the research coverage assessment.");
      await appendEvent(
        session,
        String(run.graph_run_id),
        `deep-research-coverage:${runId}:${run.current_wave}`,
        "Evidence coverage assessed",
        coverage.comparisonReady
          ? "The evidence supports a directly grounded market report."
          : `${coverage.gaps.length} decision-relevant evidence gaps remain. Ano will calibrate the report with direct findings, comparable evidence, and explicit unknowns.`,
      );
      return coverage;
    },

    async complete(runId, coverage) {
      const run = await getRun(session, runId);
      await refreshDeepRunUsage(session, runId, coverage);
      const { count, error: sourceCountError } = await session.client
        .from("research_sources")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", session.workspace.id)
        .eq("ano_research_run_id", runId)
        .eq("status", "fetched");
      if (sourceCountError) throw new EvidenceResearchPersistenceError("Ano could not count the saved source evidence.");
      const { count: unresolvedSourceActions, error: unresolvedError } = await session.client.from("provider_action_requests")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", session.workspace.id)
        .eq("ano_research_run_id", runId)
        .eq("action_kind", "fetch")
        .eq("status", "requires_manual_review");
      if (unresolvedError) throw new EvidenceResearchPersistenceError("Ano could not count the excluded source records.");
      const completedAt = new Date().toISOString();
      const { error: waveError } = await session.client.from("research_waves").update({ status: "completed", completed_at: completedAt })
        .eq("workspace_id", session.workspace.id).eq("ano_research_run_id", runId).eq("wave_number", Number(run.current_wave));
      if (waveError) throw new EvidenceResearchPersistenceError("Ano could not complete the final research wave.");
      const { data: completedRun, error: runError } = await session.client.from("ano_research_runs").update({ status: "sources_ready", completed_at: completedAt, failure_message: null, coverage_json: coverage, heartbeat_at: null }).eq("workspace_id", session.workspace.id).eq("id", runId).eq("status", "running").select("id").maybeSingle();
      if (runError || !completedRun) throw new EvidenceResearchPersistenceError("Ano could not complete the iterative public-research mission.");
      const { data: completedParent, error: parentError } = await session.client.from("provider_action_requests").update({
        status: "succeeded",
        completed_at: completedAt,
        provider_receipt_json: { fetchedSources: count ?? 0, unresolvedSourceActions: unresolvedSourceActions ?? 0, provider: "searxng", coverage, researchMode: "iterative" },
      }).eq("workspace_id", session.workspace.id).eq("ano_research_run_id", runId).eq("request_key", "research-run").eq("status", "running").select("id").maybeSingle();
      if (parentError || !completedParent) throw new EvidenceResearchPersistenceError("Ano could not save the completed deep-research receipt.");
      const excludedSources = unresolvedSourceActions ?? 0;
      const sourceNote = excludedSources ? ` ${excludedSources} source retrieval${excludedSources === 1 ? " was" : "s were"} excluded after an uncertain outcome and not retried.` : "";
      await appendEvent(session, String(run.graph_run_id), `deep-research-complete:${runId}`, "Iterative public research complete", coverage.comparisonReady ? `Ano saved ${count ?? 0} source excerpts and met the comparison gate.${sourceNote} No company or contact search has been attempted.` : `Ano saved ${count ?? 0} source excerpts but did not meet the comparison gate.${sourceNote} It will not manufacture a market recommendation.`);
    },
  };
}

export async function prepareEvidenceResearchRun(session: WorkspaceSession, conversation: ResearchConversationView) {
  requireLiveSession(session);
  const plan = conversation.plan;
  if (!plan || plan.approvalStatus !== "approved") throw new EvidenceResearchPersistenceError("Approve the research plan before Ano can prepare a provider scope.", "PLAN_NOT_APPROVED");
  const configuration = searxngConfiguration();
  if (!configuration.available) {
    await updateConnectionState(session, "error", "NOT_CONFIGURED").catch(() => undefined);
    throw new EvidenceResearchPersistenceError("SearXNG is not configured. Add the private HTTPS gateway URL and gateway token to Ano’s server environment before preparing live public research.", "PROVIDER_NOT_CONFIGURED");
  }
  await updateConnectionState(session, "connected");
  const existingId = await getRunForConversation(session, conversation.conversation.id);
  const existing = existingId ? await getRun(session, existingId) : null;
  if (existing && ["awaiting_provider_approval", "running", "sources_ready"].includes(String(existing.status))) {
    return readEvidenceResearchView(session, conversation.conversation.id);
  }
  const { data: priorAttempts, error: attemptsError } = await session.client
    .from("ano_research_runs")
    .select("attempt_number")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversation.conversation.id)
    .eq("research_plan_id", plan.id);
  if (attemptsError) throw new EvidenceResearchPersistenceError("Ano could not inspect previous research attempts.");
  const attemptNumber = (priorAttempts ?? []).reduce((maximum, row) => Math.max(maximum, Number(row.attempt_number) || 0), 0) + 1;

  const runId = crypto.randomUUID();
  const threadId = `ano:${session.workspace.id}:${conversation.conversation.id}:evidence:${runId}`;
  const maximumSearches = Math.min(plan.budget.maximumSearches, configuration.maximumSearches);
  const maximumFetches = Math.min(plan.budget.maximumFetches, configuration.maximumFetches);
  const { error: runError } = await session.client.from("ano_research_runs").insert({
    id: runId,
    workspace_id: session.workspace.id,
    conversation_id: conversation.conversation.id,
    graph_run_id: conversation.run.id,
    research_plan_id: plan.id,
    thread_id: threadId,
    attempt_number: attemptNumber,
    provider_key: "searxng",
    status: "awaiting_provider_approval",
    maximum_searches: maximumSearches,
    maximum_fetches: maximumFetches,
    started_by: session.actorId,
  });
  if (runError) throw new EvidenceResearchPersistenceError("Ano could not save the public-research preview.");
  const { error: actionError } = await session.client.from("provider_action_requests").insert({
    workspace_id: session.workspace.id,
    ano_research_run_id: runId,
    provider_key: "searxng",
    action_kind: "research_run",
    request_key: "research-run",
    request_json: { provider: "searxng", maximumSearches, maximumFetches, rawContentRetention: false },
    status: "awaiting_approval",
    maximum_operations: maximumSearches + maximumFetches,
    created_by: session.actorId,
  });
  if (actionError) throw new EvidenceResearchPersistenceError("Ano could not save the provider approval request.");
  await appendEvent(session, conversation.run.id, `phase-b-preview:${runId}`, "Public research scope prepared", `The private SearXNG service can run up to ${maximumSearches} searches and Ano can fetch up to ${maximumFetches} public sources. Ano will not contact the provider until you approve this scope.`);
  return readEvidenceResearchView(session, conversation.conversation.id);
}

export async function claimEvidenceResearchRun(session: WorkspaceSession, runId: string): Promise<EvidenceResearchClaim> {
  requireLiveSession(session);
  const run = await getRun(session, runId);
  if (run.status === "sources_ready") return { claimed: false, alreadyComplete: true };
  if (run.status === "requires_manual_review") return resumeAfterUncertainProviderAction(session, run);
  if (run.status !== "awaiting_provider_approval") return { claimed: false, alreadyComplete: false };
  const approval = await parentAction(session, runId);
  if (approval.status !== "awaiting_approval") return { claimed: false, alreadyComplete: false };
  const now = new Date().toISOString();
  const { data, error } = await session.client.from("provider_action_requests").update({
    status: "running", approved_by: session.actorId, approved_at: now, started_at: now,
  }).eq("workspace_id", session.workspace.id).eq("id", approval.id).eq("status", "awaiting_approval").select("id").maybeSingle();
  if (error) throw new EvidenceResearchPersistenceError("Ano could not secure the approved research scope.");
  if (!data) return { claimed: false, alreadyComplete: false };
  const { error: runError } = await session.client.from("ano_research_runs").update({ status: "running", approved_by: session.actorId, approved_at: now, started_at: now, heartbeat_at: now }).eq("workspace_id", session.workspace.id).eq("id", runId).eq("status", "awaiting_provider_approval");
  if (runError) throw new EvidenceResearchPersistenceError("Ano could not start the approved research run.");
  await appendEvent(session, String(run.graph_run_id), `phase-b-start:${runId}`, "Approved public research started", "Ano is generating a bounded query plan, then will use private SearXNG discovery and Ano-owned source retrieval within the approved limits. No Prospeo, people, or outreach action is included.");
  return { claimed: true, alreadyComplete: false, startNode: "plan_wave", threadId: String(run.thread_id), priorQueries: queryTextsFromRun(run) };
}

export async function stopEvidenceResearchRun(session: WorkspaceSession, runId: string, error: unknown) {
  requireLiveSession(session);
  const message = safeProviderMessage(error);
  const status = await hasProviderRisk(session, runId) ? "requires_manual_review" : "failed_safe";
  await setStopped(session, runId, status, message, error);
}

export async function readEvidenceResearchView(session: WorkspaceSession, conversationId: string): Promise<EvidenceResearchView | null> {
  requireLiveSession(session);
  const runId = await getRunForConversation(session, conversationId);
  if (!runId) return null;
  const run = await recoverExpiredResearchLease(session, await getRun(session, runId));
  const [actionsResult, sourcesResult] = await Promise.all([
    session.client
      .from("provider_action_requests")
      .select("id, action_kind, status, request_json, maximum_operations, reported_credits, created_at")
      .eq("workspace_id", session.workspace.id)
      .eq("ano_research_run_id", runId)
      .in("action_kind", [...EVIDENCE_RESEARCH_ACTION_KINDS])
      .order("created_at", { ascending: true }),
    session.client.from("research_sources").select("id, title, canonical_url, source_class, supporting_excerpt, published_at, retrieved_at, status").eq("workspace_id", session.workspace.id).eq("ano_research_run_id", runId).order("retrieved_at", { ascending: false }),
  ]);
  if (actionsResult.error || sourcesResult.error) throw new EvidenceResearchPersistenceError("Ano could not read the saved public-evidence record.");
  const queries = Array.isArray(run.query_plan_json) ? run.query_plan_json : [];
  return evidenceResearchViewSchema.parse({
    run: {
      id: String(run.id),
      conversationId: String(run.conversation_id),
      threadId: researchThreadRoot(run.thread_id),
      attemptNumber: Number(run.attempt_number),
      provider: run.provider_key,
      status: run.status,
      maximumSearches: Number(run.maximum_searches),
      maximumFetches: Number(run.maximum_fetches),
      consumedSearches: Number(run.consumed_searches ?? 0),
      consumedFetches: Number(run.consumed_fetches ?? 0),
      currentWave: Number(run.current_wave ?? 0),
      sourceCount: (sourcesResult.data ?? []).filter((source) => source.status === "fetched").length,
      failureMessage: run.failure_message ? safeText(run.failure_message) : null,
      createdAt: isoTimestamp(run.created_at),
      updatedAt: isoTimestamp(run.updated_at),
    },
    actions: (actionsResult.data ?? [])
      .filter((action) => isEvidenceResearchActionKind(action.action_kind))
      .map((action) => {
        const kind = action.action_kind as (typeof EVIDENCE_RESEARCH_ACTION_KINDS)[number];
        return {
          id: String(action.id),
          kind,
          status: action.status,
          description: actionDescription(
            String(run.provider_key),
            kind,
            (action.request_json ?? {}) as Record<string, unknown>,
          ),
          maximumOperations: Number(action.maximum_operations),
          reportedCredits: action.reported_credits === null ? null : Number(action.reported_credits),
          createdAt: isoTimestamp(action.created_at),
        };
      }),
    queries,
    sources: (sourcesResult.data ?? []).map((source) => ({
      id: String(source.id),
      title: safeText(source.title, 500) ?? "Untitled source",
      url: String(source.canonical_url),
      sourceClass: source.source_class,
      excerpt: source.supporting_excerpt ? safeText(source.supporting_excerpt, 1_200) : null,
      publishedAt: source.published_at ? isoTimestamp(source.published_at) : null,
      retrievedAt: isoTimestamp(source.retrieved_at),
      status: source.status,
    })),
  });
}

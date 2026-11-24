import "server-only";

import type { StateSnapshot } from "@langchain/langgraph";

import type { WorkspaceSession } from "@/contracts/ano";
import type {
  Clarification,
  ConversationMessage,
  GraphRunStatus,
  ResearchBrief,
  ResearchConversationSummary,
  ResearchConversationView,
  ResearchPlan,
} from "@/lib/ano/research-conversation";
import {
  buildFriendlyConversationTitle,
  conversationMessageMetadataSchema,
  conversationTitle,
  DEFAULT_CONVERSATION_TITLE,
  needsFriendlyTitleRefresh,
  researchConversationSummarySchema,
  researchConversationViewSchema,
  type ConversationMessageMetadata,
} from "@/lib/ano/research-conversation";
import {
  classifyConversationWorkItem,
  workQueueSummarySchema,
  type WorkQueueItem,
  type WorkQueueSummary,
} from "@/lib/ano/work-queue";
import { RESEARCH_GRAPH_NAME, RESEARCH_GRAPH_VERSION, type ResearchGraphStateValue } from "@/server/langgraph/research-graph";
import { readConversationProductSources } from "@/server/persistence/product-source-store";

type LiveSession = Extract<WorkspaceSession, { kind: "supabase" }>;

type ConversationRow = {
  id: string;
  title: string;
  status: GraphRunStatus;
  active_thread_id: string;
  created_at: string;
  updated_at: string;
};

type GraphRunRow = {
  id: string;
  status: GraphRunStatus;
  graph_version: string;
  current_node: string;
  checkpoint_ref: string | null;
  failure_message: string | null;
};

export class ResearchConversationPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchConversationPersistenceError";
  }
}

function requireLiveSession(session: WorkspaceSession): asserts session is LiveSession {
  if (session.kind === "demo") {
    throw new ResearchConversationPersistenceError("Sign in before starting a durable Ano research conversation.");
  }
}

function failure() {
  return "Ano could not safely save this conversation. No research, provider, contact, email, schedule, or call action was attempted.";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** Supabase/PostgREST may serialize timestamptz values with a space and offset;
 * Ano's public contract deliberately uses canonical ISO 8601 timestamps. */
function isoTimestamp(value: unknown) {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new ResearchConversationPersistenceError("Ano received an invalid timestamp while reading this research conversation.");
  return parsed.toISOString();
}

function asMessage(row: Record<string, unknown>): ConversationMessage {
  const content = record(row.content_json);
  const parsedMeta = content.metadata
    ? conversationMessageMetadataSchema.safeParse(content.metadata)
    : null;
  return {
    id: String(row.id),
    role: row.role === "assistant" ? "assistant" : "user",
    kind: ["clarifying_question", "research_plan", "decision"].includes(String(row.message_type)) ? String(row.message_type) as ConversationMessage["kind"] : "message",
    text: String(content.text ?? ""),
    createdAt: isoTimestamp(row.created_at),
    ...(parsedMeta?.success ? { metadata: parsedMeta.data } : {}),
  };
}

function asBrief(row: Record<string, unknown> | null): ResearchBrief | null {
  if (!row) return null;
  const content = record(row.content_json);
  const targetMarkets = strings(row.target_markets_json);
  const businessLocation =
    typeof row.business_location === "string" && row.business_location.trim()
      ? row.business_location.trim()
      : typeof content.businessLocation === "string" && content.businessLocation.trim()
        ? content.businessLocation.trim()
        : null;
  const intakeComplete =
    typeof row.intake_complete === "boolean"
      ? row.intake_complete
      : typeof content.intakeComplete === "boolean"
        ? content.intakeComplete
        : undefined;
  return {
    offer: String(content.offer ?? ""),
    goal: String(content.goal ?? ""),
    ...(businessLocation ? { businessLocation } : {}),
    ...(targetMarkets.length > 0 ? { targetMarkets } : {}),
    ...(intakeComplete !== undefined ? { intakeComplete } : {}),
    marketHints: strings(content.marketHints),
    locationHints: strings(content.locationHints),
    buyerHints: strings(content.buyerHints),
    constraints: strings(content.constraints),
    unknowns: strings(content.unknowns),
    sourceMessageIds: strings(content.sourceMessageIds),
  };
}

function asQuestion(row: Record<string, unknown> | null): Clarification | null {
  if (!row) return null;
  return { id: String(row.id), question: String(row.question), purpose: String(row.purpose) };
}

function asPlan(row: Record<string, unknown> | null): ResearchPlan | null {
  if (!row) return null;
  const content = record(row.content_json);
  const budget = record(content.budget);
  const scope = record(content.plannedScope);
  const sourceClasses = strings(content.intendedSourceClasses).filter((item): item is ResearchPlan["intendedSourceClasses"][number] => [
    "Government and official statistics", "Industry bodies and primary research", "Public company reports and filings", "Independent reporting",
  ].includes(item));
  return {
    id: String(row.id),
    version: Number(row.version),
    approvalStatus: row.approval_status === "approved" ? "approved" : row.approval_status === "declined" ? "declined" : "awaiting_approval",
    createdAt: isoTimestamp(row.created_at),
    summary: String(content.summary ?? ""),
    researchQuestions: strings(content.researchQuestions),
    comparisonCriteria: strings(content.comparisonCriteria),
    intendedSourceClasses: sourceClasses,
    plannedScope: { markets: strings(scope.markets), industries: strings(scope.industries), buyerRoles: strings(scope.buyerRoles) },
    budget: {
      maximumSearches: Number(budget.maximumSearches),
      maximumFetches: Number(budget.maximumFetches),
      providerSpend: "not_available_in_phase_a",
    },
    uncertainties: strings(content.uncertainties),
    ...(typeof content.userEditInstruction === "string" && content.userEditInstruction.trim() ? { userEditInstruction: content.userEditInstruction } : {}),
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function readConversationRow(session: LiveSession, conversationId: string) {
  const { data, error } = await session.client
    .from("ano_conversations")
    .select("id, title, status, active_thread_id, created_at, updated_at")
    .eq("workspace_id", session.workspace.id)
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !data) throw new ResearchConversationPersistenceError("Ano could not find that research conversation.");
  return data as ConversationRow;
}

export async function createResearchConversation(
  session: WorkspaceSession,
  openingMessage: string,
  initialTitle?: string,
) {
  requireLiveSession(session);
  const conversationId = crypto.randomUUID();
  const threadId = `ano:${session.workspace.id}:${conversationId}`;
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const resolvedTitle =
    initialTitle && initialTitle.trim()
      ? initialTitle.trim().slice(0, 160)
      : conversationTitle(openingMessage);
  const { error: conversationError } = await session.client.from("ano_conversations").insert({
    id: conversationId,
    workspace_id: session.workspace.id,
    created_by: session.actorId,
    title: resolvedTitle,
    active_graph: RESEARCH_GRAPH_NAME,
    active_thread_id: threadId,
    status: "draft",
  });
  if (conversationError) throw new ResearchConversationPersistenceError(failure());
  const { error: runError } = await session.client.from("ano_graph_runs").insert({
    id: runId,
    workspace_id: session.workspace.id,
    conversation_id: conversationId,
    started_by: session.actorId,
    graph_name: RESEARCH_GRAPH_NAME,
    graph_version: RESEARCH_GRAPH_VERSION,
    thread_id: threadId,
    status: "draft",
    current_node: "capture_message",
    started_at: now,
  });
  if (runError) throw new ResearchConversationPersistenceError(failure());
  return { conversationId, graphRunId: runId, threadId };
}

export async function appendUserMessage(session: WorkspaceSession, conversationId: string, text: string, idempotencyKey: string) {
  requireLiveSession(session);
  await readConversationRow(session, conversationId);
  const { data: existing, error: existingError } = await session.client
    .from("ano_messages")
    .select("id")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) throw new ResearchConversationPersistenceError(failure());
  if (existing?.id) return { id: String(existing.id), created: false };
  const id = crypto.randomUUID();
  const { error } = await session.client.from("ano_messages").insert({
    id,
    workspace_id: session.workspace.id,
    conversation_id: conversationId,
    role: "user",
    message_type: "message",
    content_json: { text },
    idempotency_key: idempotencyKey,
    created_by: session.actorId,
  });
  if (error) throw new ResearchConversationPersistenceError(failure());
  return { id, created: true };
}

export async function appendAssistantMessage(
  session: WorkspaceSession,
  conversationId: string,
  text: string,
  dedupeKey: string,
  metadata?: ConversationMessageMetadata,
) {
  requireLiveSession(session);
  await readConversationRow(session, conversationId);
  const { data: existing, error: existingError } = await session.client
    .from("ano_messages")
    .select("id")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (existingError) {
    console.error("[ano:messages] appendAssistantMessage lookup failed", {
      code: existingError.code,
      message: existingError.message,
    });
    throw new ResearchConversationPersistenceError(failure());
  }
  if (existing?.id) return { id: String(existing.id), created: false };

  const id = crypto.randomUUID();
  const { error } = await session.client.from("ano_messages").insert({
    id,
    workspace_id: session.workspace.id,
    conversation_id: conversationId,
    role: "assistant",
    message_type: "message",
    content_json: {
      text,
      ...(metadata ? { metadata } : {}),
    },
    dedupe_key: dedupeKey,
  });
  if (error) {
    console.error("[ano:messages] appendAssistantMessage insert failed", {
      code: error.code,
      message: error.message,
    });
    throw new ResearchConversationPersistenceError(failure());
  }

  await session.client
    .from("ano_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("workspace_id", session.workspace.id)
    .eq("id", conversationId);

  return { id, created: true };
}

export async function recordGraphDecision(session: WorkspaceSession, conversationId: string, response: unknown, idempotencyKey: string) {
  requireLiveSession(session);
  const run = await readGraphRun(session, conversationId);
  const { data: existing, error: existingError } = await session.client
    .from("ano_graph_decisions")
    .select("id")
    .eq("workspace_id", session.workspace.id)
    .eq("graph_run_id", run.id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) throw new ResearchConversationPersistenceError(failure());
  if (existing?.id) return false;
  const { error } = await session.client.from("ano_graph_decisions").insert({
    workspace_id: session.workspace.id,
    graph_run_id: run.id,
    conversation_id: conversationId,
    decision_type: "graph_interrupt",
    response_json: response,
    idempotency_key: idempotencyKey,
    decided_by: session.actorId,
  });
  if (error) throw new ResearchConversationPersistenceError(failure());
  return true;
}

export async function readGraphRun(session: WorkspaceSession, conversationId: string) {
  requireLiveSession(session);
  const { data, error } = await session.client
    .from("ano_graph_runs")
    .select("id, status, graph_version, current_node, checkpoint_ref, failure_message")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .eq("graph_name", RESEARCH_GRAPH_NAME)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new ResearchConversationPersistenceError("Ano could not find the active research run for this conversation.");
  return data as GraphRunRow;
}

export async function readResearchConversation(session: WorkspaceSession, conversationId: string): Promise<ResearchConversationView> {
  requireLiveSession(session);
  const conversation = await readConversationRow(session, conversationId);
  const run = await readGraphRun(session, conversationId);
  const [messagesResult, productSourcesResult, briefResult, questionResult, planResult, eventsResult] = await Promise.all([
    session.client.from("ano_messages").select("id, role, message_type, content_json, created_at").eq("workspace_id", session.workspace.id).eq("conversation_id", conversationId).order("created_at", { ascending: true }),
    readConversationProductSources(session, conversationId).catch(() => ({ summaries: [], fullSources: [] })),
    session.client.from("research_briefs").select("content_json, business_location, target_markets_json, intake_complete").eq("workspace_id", session.workspace.id).eq("conversation_id", conversationId).maybeSingle(),
    session.client.from("research_questions").select("id, question, purpose").eq("workspace_id", session.workspace.id).eq("conversation_id", conversationId).eq("status", "open").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    session.client.from("research_plans").select("id, version, approval_status, content_json, created_at").eq("workspace_id", session.workspace.id).eq("conversation_id", conversationId).order("version", { ascending: false }).limit(1).maybeSingle(),
    session.client.from("run_events").select("id, label, detail, created_at").eq("workspace_id", session.workspace.id).eq("graph_run_id", run.id).order("created_at", { ascending: false }).limit(12),
  ]);
  if (messagesResult.error || briefResult.error || questionResult.error || planResult.error || eventsResult.error) throw new ResearchConversationPersistenceError(failure());
  return researchConversationViewSchema.parse({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      threadId: conversation.active_thread_id,
      createdAt: isoTimestamp(conversation.created_at),
      updatedAt: isoTimestamp(conversation.updated_at),
    },
    run: {
      id: run.id,
      status: run.status,
      graphVersion: run.graph_version,
      currentNode: run.current_node,
      checkpointRef: run.checkpoint_ref,
      failureMessage: run.failure_message,
    },
    messages: (messagesResult.data ?? []).map((row) => asMessage(row as Record<string, unknown>)),
    ...(productSourcesResult.summaries.length > 0
      ? { productSources: productSourcesResult.summaries }
      : {}),
    brief: asBrief(briefResult.data as Record<string, unknown> | null),
    pendingQuestion: asQuestion(questionResult.data as Record<string, unknown> | null),
    plan: asPlan(planResult.data as Record<string, unknown> | null),
    events: (eventsResult.data ?? []).reverse().map((row) => ({ id: String(row.id), label: String(row.label), detail: String(row.detail), at: isoTimestamp(row.created_at) })),
  });
}

async function conversationIdsFromAuditEvent(
  session: LiveSession,
  eventType: "conversation_archived" | "conversation_renamed",
): Promise<Set<string>> {
  const { data, error } = await session.client
    .from("audit_logs")
    .select("details_json")
    .eq("workspace_id", session.workspace.id)
    .eq("event_type", eventType);
  if (error) throw new ResearchConversationPersistenceError(failure());
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const details = record(row.details_json);
    if (typeof details.conversationId === "string" && details.conversationId) {
      ids.add(details.conversationId);
    }
  }
  return ids;
}

async function archivedConversationIds(session: LiveSession): Promise<Set<string>> {
  return conversationIdsFromAuditEvent(session, "conversation_archived");
}

async function manuallyRenamedConversationIds(session: LiveSession): Promise<Set<string>> {
  return conversationIdsFromAuditEvent(session, "conversation_renamed");
}

/**
 * Updates a conversation's title automatically without writing a
 * `conversation_renamed` audit event, so subsequent lifecycle refinements
 * (such as locking a target market in Phase C / Stage 3) continue to work while
 * explicit user renames always take precedence.
 */
export async function autoUpdateConversationTitle(
  session: WorkspaceSession,
  conversationId: string,
  candidateTitle: string,
  options?: { preserveUpdatedAt?: boolean; forceUpgrade?: boolean },
): Promise<string | null> {
  if (session.kind === "demo") return null;
  const normalized = candidateTitle.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!normalized || normalized === DEFAULT_CONVERSATION_TITLE) return null;

  const [manuallyRenamed, current] = await Promise.all([
    manuallyRenamedConversationIds(session),
    readConversationRow(session, conversationId),
  ]);
  if (manuallyRenamed.has(conversationId)) return null;
  if (current.title === normalized) return null;
  if (!options?.forceUpgrade && !needsFriendlyTitleRefresh(current.title, normalized)) {
    return null;
  }

  const updatePayload: Record<string, unknown> = { title: normalized };
  if (!options?.preserveUpdatedAt) {
    updatePayload.updated_at = new Date().toISOString();
  }

  const { error } = await session.client
    .from("ano_conversations")
    .update(updatePayload)
    .eq("workspace_id", session.workspace.id)
    .eq("id", conversationId);
  if (error) throw new ResearchConversationPersistenceError(failure());
  return normalized;
}

export async function backfillFriendlyConversationTitles(
  session: WorkspaceSession,
  options?: { conversationIds?: string[]; forceAll?: boolean },
): Promise<{
  scannedCount: number;
  updatedCount: number;
  titles: Record<string, string>;
}> {
  if (session.kind === "demo") {
    return { scannedCount: 0, updatedCount: 0, titles: {} };
  }

  const [archived, manuallyRenamed] = await Promise.all([
    archivedConversationIds(session),
    manuallyRenamedConversationIds(session),
  ]);

  let convQuery = session.client
    .from("ano_conversations")
    .select("id, title")
    .eq("workspace_id", session.workspace.id)
    .eq("active_graph", RESEARCH_GRAPH_NAME)
    .neq("status", "draft");

  if (options?.conversationIds && options.conversationIds.length > 0) {
    convQuery = convQuery.in("id", options.conversationIds);
  } else {
    convQuery = convQuery.order("updated_at", { ascending: false }).limit(100);
  }

  const { data: convRows, error: convError } = await convQuery;
  if (convError) throw new ResearchConversationPersistenceError(failure());

  const eligibleRows = (convRows ?? [])
    .map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
    }))
    .filter((row) => !archived.has(row.id) && !manuallyRenamed.has(row.id));

  const candidates = options?.forceAll
    ? eligibleRows
    : eligibleRows.filter(
        (row) => needsFriendlyTitleRefresh(row.title) || !row.title.includes(" — "),
      );

  if (candidates.length === 0) {
    return { scannedCount: eligibleRows.length, updatedCount: 0, titles: {} };
  }

  const candidateIds = candidates.map((row) => row.id);
  const [briefsRes, decisionsRes, sourcesRes, messagesRes] = await Promise.all([
    session.client
      .from("research_briefs")
      .select("conversation_id, content_json, business_location, target_markets_json, intake_complete")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", candidateIds),
    session.client
      .from("target_decisions")
      .select("conversation_id, status, market_profile_id, industry_profile_id")
      .eq("workspace_id", session.workspace.id)
      .eq("status", "locked")
      .in("conversation_id", candidateIds),
    session.client
      .from("conversation_product_sources")
      .select("conversation_id, label, summary_text, created_at")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", candidateIds)
      .order("created_at", { ascending: true }),
    session.client
      .from("ano_messages")
      .select("conversation_id, content_json, created_at")
      .eq("workspace_id", session.workspace.id)
      .eq("role", "user")
      .in("conversation_id", candidateIds)
      .order("created_at", { ascending: true }),
  ]);

  if (briefsRes.error || decisionsRes.error || sourcesRes.error || messagesRes.error) {
    throw new ResearchConversationPersistenceError(failure());
  }

  const lockedDecisions = (decisionsRes.data ?? []).map((row) => ({
    conversationId: String(row.conversation_id),
    marketProfileId:
      typeof row.market_profile_id === "string" ? row.market_profile_id : null,
    industryProfileId:
      typeof row.industry_profile_id === "string" ? row.industry_profile_id : null,
  }));

  const marketIds = Array.from(
    new Set(
      lockedDecisions
        .map((d) => d.marketProfileId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const industryIds = Array.from(
    new Set(
      lockedDecisions
        .map((d) => d.industryProfileId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [marketsRes, industriesRes] = await Promise.all([
    marketIds.length > 0
      ? session.client
          .from("market_profiles")
          .select("id, name")
          .eq("workspace_id", session.workspace.id)
          .in("id", marketIds)
      : Promise.resolve({ data: [], error: null }),
    industryIds.length > 0
      ? session.client
          .from("industry_profiles")
          .select("id, name")
          .eq("workspace_id", session.workspace.id)
          .in("id", industryIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (marketsRes.error || industriesRes.error) {
    throw new ResearchConversationPersistenceError(failure());
  }

  const marketNameById = new Map<string, string>();
  for (const row of marketsRes.data ?? []) {
    if (row.id && typeof row.name === "string") {
      marketNameById.set(String(row.id), row.name);
    }
  }
  const industryNameById = new Map<string, string>();
  for (const row of industriesRes.data ?? []) {
    if (row.id && typeof row.name === "string") {
      industryNameById.set(String(row.id), row.name);
    }
  }

  const briefByConversation = new Map<string, ResearchBrief>();
  for (const row of briefsRes.data ?? []) {
    const cid = String(row.conversation_id);
    const parsed = asBrief(row as Record<string, unknown>);
    if (parsed) briefByConversation.set(cid, parsed);
  }

  const decisionNamesByConversation = new Map<
    string,
    { marketName: string | null; industryName: string | null }
  >();
  for (const decision of lockedDecisions) {
    decisionNamesByConversation.set(decision.conversationId, {
      marketName: decision.marketProfileId
        ? (marketNameById.get(decision.marketProfileId) ?? null)
        : null,
      industryName: decision.industryProfileId
        ? (industryNameById.get(decision.industryProfileId) ?? null)
        : null,
    });
  }

  const sourcesByConversation = new Map<
    string,
    { labels: string[]; summaries: string[] }
  >();
  for (const row of sourcesRes.data ?? []) {
    const cid = String(row.conversation_id);
    const bucket = sourcesByConversation.get(cid) ?? { labels: [], summaries: [] };
    if (typeof row.label === "string" && row.label.trim()) {
      bucket.labels.push(row.label.trim());
    }
    if (typeof row.summary_text === "string" && row.summary_text.trim()) {
      bucket.summaries.push(row.summary_text.trim());
    }
    sourcesByConversation.set(cid, bucket);
  }

  const firstMessageByConversation = new Map<string, string>();
  for (const row of messagesRes.data ?? []) {
    const cid = String(row.conversation_id);
    if (firstMessageByConversation.has(cid)) continue;
    const content = record(row.content_json);
    if (typeof content.text === "string" && content.text.trim()) {
      firstMessageByConversation.set(cid, content.text.trim());
    }
  }

  const titles: Record<string, string> = {};
  let updatedCount = 0;

  for (const candidate of candidates) {
    const brief = briefByConversation.get(candidate.id) ?? null;
    const decision = decisionNamesByConversation.get(candidate.id);
    const sources = sourcesByConversation.get(candidate.id) ?? {
      labels: [],
      summaries: [],
    };
    const firstUserMessage = firstMessageByConversation.get(candidate.id) ?? null;
    const fallbackTitleAsPrompt =
      !firstUserMessage && !brief && sources.labels.length === 0 && needsFriendlyTitleRefresh(candidate.title)
        ? candidate.title
        : null;

    const nextTitle = buildFriendlyConversationTitle({
      openingMessage: firstUserMessage ?? fallbackTitleAsPrompt,
      brief,
      lockedMarketName: decision?.marketName ?? null,
      lockedIndustryName: decision?.industryName ?? null,
      productSourceLabels: sources.labels,
      productSourceSummaries: sources.summaries,
    });

    if (!nextTitle || nextTitle === candidate.title) continue;
    if (
      !options?.forceAll &&
      !needsFriendlyTitleRefresh(candidate.title, nextTitle)
    ) {
      continue;
    }

    // Preserve updated_at during background backfill so existing sidebar order stays intact.
    const { error: updateError } = await session.client
      .from("ano_conversations")
      .update({ title: nextTitle })
      .eq("workspace_id", session.workspace.id)
      .eq("id", candidate.id);

    if (!updateError) {
      titles[candidate.id] = nextTitle;
      updatedCount += 1;
    }
  }

  return {
    scannedCount: eligibleRows.length,
    updatedCount,
    titles,
  };
}

export async function readLatestResearchConversation(session: WorkspaceSession) {
  requireLiveSession(session);
  const { conversations } = await listResearchConversationSummaries(session, { limit: 1 });
  const latest = conversations[0];
  return latest ? readResearchConversation(session, latest.id) : null;
}

export async function renameResearchConversation(
  session: WorkspaceSession,
  conversationId: string,
  title: string,
): Promise<ResearchConversationView> {
  requireLiveSession(session);
  const normalized = title.trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > 160) {
    throw new ResearchConversationPersistenceError(
      "Conversation title must be between 1 and 160 characters.",
    );
  }
  const current = await readConversationRow(session, conversationId);
  const now = new Date().toISOString();
  const { error } = await session.client
    .from("ano_conversations")
    .update({ title: normalized, updated_at: now })
    .eq("workspace_id", session.workspace.id)
    .eq("id", conversationId);
  if (error) throw new ResearchConversationPersistenceError(failure());
  const { error: auditError } = await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "conversation_renamed",
    outcome: "succeeded",
    details_json: {
      conversationId,
      previousTitle: current.title,
      title: normalized,
    },
  });
  if (auditError) throw new ResearchConversationPersistenceError(failure());
  return readResearchConversation(session, conversationId);
}

export async function archiveResearchConversation(
  session: WorkspaceSession,
  conversationId: string,
): Promise<void> {
  requireLiveSession(session);
  await readConversationRow(session, conversationId);
  const archivedAt = new Date().toISOString();
  const { error } = await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "conversation_archived",
    outcome: "succeeded",
    details_json: {
      conversationId,
      archivedAt,
    },
  });
  if (error) throw new ResearchConversationPersistenceError(failure());
}

export async function listResearchConversationSummaries(
  session: WorkspaceSession,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ conversations: ResearchConversationSummary[]; nextCursor: string | null }> {
  if (session.kind === "demo") return { conversations: [], nextCursor: null };
  const boundedLimit = Math.max(1, Math.min(options.limit ?? 25, 50));
  const archived = await archivedConversationIds(session);

  let query = session.client
    .from("ano_conversations")
    .select("id, title, status, created_at, updated_at")
    .eq("workspace_id", session.workspace.id)
    .eq("active_graph", RESEARCH_GRAPH_NAME)
    .neq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(Math.min(100, boundedLimit + archived.size + 1));

  if (options.cursor) {
    query = query.lt("updated_at", options.cursor);
  }

  const { data, error } = await query;
  if (error) throw new ResearchConversationPersistenceError(failure());

  const activeRows = (data ?? [])
    .filter((row) => !archived.has(String(row.id)))
    .map((row) =>
      researchConversationSummarySchema.parse({
        id: String(row.id),
        title: String(row.title),
        status: row.status,
        createdAt: isoTimestamp(row.created_at),
        updatedAt: isoTimestamp(row.updated_at),
      }),
    );

  const hasMore = activeRows.length > boundedLimit;
  const page = activeRows.slice(0, boundedLimit);
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].updatedAt : null;
  return { conversations: page, nextCursor };
}

export async function readWorkspaceWorkQueue(
  session: WorkspaceSession,
): Promise<WorkQueueSummary> {
  if (session.kind === "demo") {
    return { needsReviewCount: 0, activeResearchCount: 0, items: [] };
  }
  const { conversations } = await listResearchConversationSummaries(session, { limit: 50 });
  if (conversations.length === 0) {
    return { needsReviewCount: 0, activeResearchCount: 0, items: [] };
  }

  const conversationIds = conversations.map((item) => item.id);
  const [plansRes, runsRes, synthesesRes, decisionsRes, companySearchesRes, personSearchesRes, verificationRunsRes, proposalsRes] = await Promise.all([
    session.client
      .from("research_plans")
      .select("conversation_id, version, approval_status")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", conversationIds)
      .order("version", { ascending: false }),
    session.client
      .from("ano_research_runs")
      .select("conversation_id, status, maximum_searches, maximum_fetches, consumed_searches, current_wave, failure_message, updated_at, created_at")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false }),
    session.client
      .from("ano_research_syntheses")
      .select("conversation_id, status, failure_message, updated_at, created_at")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false }),
    session.client
      .from("target_decisions")
      .select("conversation_id, status, updated_at")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", conversationIds),
    session.client
      .from("provider_company_searches")
      .select("conversation_id, status, result_count, failure_message, updated_at, created_at")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false }),
    session.client
      .from("provider_person_searches")
      .select("conversation_id, status, result_count, failure_message, updated_at, created_at")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false }),
    session.client
      .from("contact_verification_runs")
      .select("conversation_id, status, estimated_credits, failure_message, updated_at, created_at")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false }),
    session.client
      .from("proposals")
      .select("conversation_id, status, updated_at")
      .eq("workspace_id", session.workspace.id)
      .eq("status", "awaiting_approval")
      .in("conversation_id", conversationIds),
  ]);

  if (
    plansRes.error ||
    runsRes.error ||
    synthesesRes.error ||
    decisionsRes.error ||
    companySearchesRes.error ||
    personSearchesRes.error ||
    verificationRunsRes.error ||
    proposalsRes.error
  ) {
    throw new ResearchConversationPersistenceError(failure());
  }

  const planByConversation = new Map<string, "awaiting_approval" | "approved" | "declined">();
  for (const row of plansRes.data ?? []) {
    const cid = String(row.conversation_id);
    if (!planByConversation.has(cid)) {
      const val = String(row.approval_status);
      planByConversation.set(
        cid,
        val === "approved" ? "approved" : val === "declined" ? "declined" : "awaiting_approval",
      );
    }
  }

  const runByConversation = new Map<string, Record<string, unknown>>();
  for (const row of runsRes.data ?? []) {
    const cid = String(row.conversation_id);
    if (!runByConversation.has(cid)) {
      runByConversation.set(cid, row as Record<string, unknown>);
    }
  }

  const synthesisByConversation = new Map<string, Record<string, unknown>>();
  for (const row of synthesesRes.data ?? []) {
    const cid = String(row.conversation_id);
    if (!synthesisByConversation.has(cid)) {
      synthesisByConversation.set(cid, row as Record<string, unknown>);
    }
  }

  const decisionByConversation = new Map<string, Record<string, unknown>>();
  for (const row of decisionsRes.data ?? []) {
    const cid = String(row.conversation_id);
    if (!decisionByConversation.has(cid)) {
      decisionByConversation.set(cid, row as Record<string, unknown>);
    }
  }

  const companySearchByConversation = new Map<string, Record<string, unknown>>();
  for (const row of companySearchesRes.data ?? []) {
    const cid = String(row.conversation_id);
    if (!companySearchByConversation.has(cid)) {
      companySearchByConversation.set(cid, row as Record<string, unknown>);
    }
  }

  const personSearchByConversation = new Map<string, Record<string, unknown>>();
  for (const row of personSearchesRes.data ?? []) {
    const cid = String(row.conversation_id);
    if (!personSearchByConversation.has(cid)) {
      personSearchByConversation.set(cid, row as Record<string, unknown>);
    }
  }

  const verificationRunByConversation = new Map<string, Record<string, unknown>>();
  for (const row of verificationRunsRes.data ?? []) {
    const cid = String(row.conversation_id);
    if (!verificationRunByConversation.has(cid)) {
      verificationRunByConversation.set(cid, row as Record<string, unknown>);
    }
  }

  const pendingProposalsByConversation = new Map<string, { count: number; updatedAt: string }>();
  for (const row of proposalsRes.data ?? []) {
    const cid = String(row.conversation_id);
    if (!cid) continue;
    const prev = pendingProposalsByConversation.get(cid);
    const updated = isoTimestamp(row.updated_at);
    pendingProposalsByConversation.set(cid, {
      count: (prev?.count ?? 0) + 1,
      updatedAt: !prev || new Date(updated).getTime() > new Date(prev.updatedAt).getTime() ? updated : prev.updatedAt,
    });
  }

  const items: WorkQueueItem[] = [];
  for (const conversation of conversations) {
    const run = runByConversation.get(conversation.id);
    const synthesis = synthesisByConversation.get(conversation.id);
    const decision = decisionByConversation.get(conversation.id);
    const companySearch = companySearchByConversation.get(conversation.id);
    const personSearch = personSearchByConversation.get(conversation.id);
    const verificationRun = verificationRunByConversation.get(conversation.id);
    const pendingProposals = pendingProposalsByConversation.get(conversation.id) ?? null;

    const item = classifyConversationWorkItem({
      conversation,
      planApprovalStatus: planByConversation.get(conversation.id) ?? null,
      researchRun: run
        ? {
            status: String(run.status),
            maximumSearches: Number(run.maximum_searches ?? 50),
            maximumFetches: Number(run.maximum_fetches ?? 100),
            consumedSearches: Number(run.consumed_searches ?? 0),
            currentWave: Number(run.current_wave ?? 0),
            failureMessage: run.failure_message ? String(run.failure_message) : null,
            updatedAt: isoTimestamp(run.updated_at),
          }
        : null,
      synthesis: synthesis
        ? {
            status: String(synthesis.status),
            failureMessage: synthesis.failure_message ? String(synthesis.failure_message) : null,
            updatedAt: isoTimestamp(synthesis.updated_at),
          }
        : null,
      targetDecision: decision
        ? {
            status: String(decision.status),
            updatedAt: isoTimestamp(decision.updated_at),
          }
        : null,
      companySearch: companySearch
        ? {
            status: String(companySearch.status),
            resultCount:
              typeof companySearch.result_count === "number"
                ? companySearch.result_count
                : null,
            failureMessage: companySearch.failure_message
              ? String(companySearch.failure_message)
              : null,
            updatedAt: isoTimestamp(companySearch.updated_at),
          }
        : null,
      personSearch: personSearch
        ? {
            status: String(personSearch.status),
            resultCount:
              typeof personSearch.result_count === "number"
                ? personSearch.result_count
                : null,
            failureMessage: personSearch.failure_message
              ? String(personSearch.failure_message)
              : null,
            updatedAt: isoTimestamp(personSearch.updated_at),
          }
        : null,
      verificationRun: verificationRun
        ? {
            status: String(verificationRun.status),
            estimatedCredits:
              typeof verificationRun.estimated_credits === "number"
                ? verificationRun.estimated_credits
                : null,
            failureMessage: verificationRun.failure_message
              ? String(verificationRun.failure_message)
              : null,
            updatedAt: isoTimestamp(verificationRun.updated_at),
          }
        : null,
      pendingProposals,
    });

    if (item) {
      items.push(item);
    }
  }

  items.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());

  const needsReviewCount = items.filter((item) => item.bucket === "needs_review").length;
  const activeResearchCount = items.filter((item) => item.bucket === "active_research").length;

  return workQueueSummarySchema.parse({
    needsReviewCount,
    activeResearchCount,
    items,
  });
}

function stateFromSnapshot(snapshot: StateSnapshot) {
  return snapshot.values as ResearchGraphStateValue;
}

function checkpointRef(snapshot: StateSnapshot) {
  const configurable = snapshot.config.configurable ?? {};
  return typeof configurable.checkpoint_id === "string" ? configurable.checkpoint_id : null;
}

function assistantMessage(state: ResearchGraphStateValue, graphRunId: string) {
  if (state.pendingQuestion) {
    return {
      dedupeKey: `question:${graphRunId}:${state.pendingQuestion.id}`,
      type: "clarifying_question",
      text: `${state.pendingQuestion.question}\n\nWhy Ano is asking: ${state.pendingQuestion.purpose}`,
    };
  }
  if (state.plan && state.status === "awaiting_plan_approval") {
    return {
      dedupeKey: `plan:${graphRunId}:${state.plan.version}`,
      type: "research_plan",
      text: "Ano prepared a research plan for your review. No research has started.",
    };
  }
  if (state.plan?.approvalStatus === "approved") {
    if (state.brief?.intakeComplete) {
      const loc = state.brief.businessLocation ?? "your business location";
      const markets = state.brief.targetMarkets?.length
        ? state.brief.targetMarkets.join(", ")
        : "recommended best target markets";
      return {
        dedupeKey: `plan-approved:${graphRunId}:${state.plan.version}`,
        type: "decision",
        text: `Understood — your business is in ${loc}, selling to ${markets}. Your product brief is ready.`,
      };
    }
    return { dedupeKey: `plan-approved:${graphRunId}:${state.plan.version}`, type: "decision", text: "Research plan approved. Research itself remains locked until Phase B." };
  }
  if (state.plan?.approvalStatus === "declined") {
    return { dedupeKey: `plan-declined:${graphRunId}:${state.plan.version}`, type: "decision", text: "Research plan declined. No research was started." };
  }
  return null;
}

export async function syncResearchGraphSnapshot(session: WorkspaceSession, conversationId: string, snapshot: StateSnapshot) {
  requireLiveSession(session);
  const state = stateFromSnapshot(snapshot);
  const run = await readGraphRun(session, conversationId);
  const ref = checkpointRef(snapshot);
  const now = new Date().toISOString();
  const currentNode = snapshot.next[0] ?? state.currentNode ?? "complete";

  const { error: conversationError } = await session.client.from("ano_conversations").update({ status: state.status, updated_at: now }).eq("workspace_id", session.workspace.id).eq("id", conversationId);
  if (conversationError) throw new ResearchConversationPersistenceError(failure());
  const { error: runError } = await session.client.from("ano_graph_runs").update({
    status: state.status,
    current_node: currentNode,
    checkpoint_ref: ref,
    state_snapshot: state,
    failure_message: null,
    completed_at: state.status === "complete_without_research" ? now : null,
    updated_at: now,
  }).eq("workspace_id", session.workspace.id).eq("id", run.id);
  if (runError) throw new ResearchConversationPersistenceError(failure());

  if (ref) {
    const { error } = await session.client.from("ano_graph_checkpoints").upsert({
      workspace_id: session.workspace.id,
      graph_run_id: run.id,
      checkpoint_ref: ref,
      safe_state_json: state,
      current_node: currentNode,
    }, { onConflict: "graph_run_id,checkpoint_ref" });
    if (error) throw new ResearchConversationPersistenceError(failure());
  }
  if (state.brief) {
    const { error } = await session.client.from("research_briefs").upsert({
      workspace_id: session.workspace.id,
      conversation_id: conversationId,
      graph_run_id: run.id,
      content_json: state.brief,
      business_location: state.brief.businessLocation ?? null,
      target_markets_json: state.brief.targetMarkets ?? [],
      intake_complete: state.brief.intakeComplete ?? false,
      status: state.status === "awaiting_context" ? "awaiting_context" : "ready",
    }, { onConflict: "conversation_id" });
    if (error) throw new ResearchConversationPersistenceError(failure());

    const productSources = await readConversationProductSources(session, conversationId).catch(
      () => ({ summaries: [], fullSources: [] }),
    );
    const openingContext =
      state.contextMessages?.[0]?.text ?? state.submittedMessage?.text ?? null;
    const friendlyTitle = buildFriendlyConversationTitle({
      openingMessage: openingContext,
      brief: state.brief,
      productSourceLabels: productSources.summaries.map((s) => s.label),
      productSourceSummaries: productSources.summaries
        .map((s) => s.summaryText)
        .filter((v): v is string => Boolean(v)),
    });
    await autoUpdateConversationTitle(session, conversationId, friendlyTitle, {
      preserveUpdatedAt: false,
    }).catch(() => undefined);
  }
  if (state.pendingQuestion) {
    await session.client.from("research_questions").update({ status: "resolved", resolved_at: now }).eq("workspace_id", session.workspace.id).eq("conversation_id", conversationId).eq("status", "open");
    const { error } = await session.client.from("research_questions").upsert({
      id: state.pendingQuestion.id,
      workspace_id: session.workspace.id,
      conversation_id: conversationId,
      graph_run_id: run.id,
      question: state.pendingQuestion.question,
      purpose: state.pendingQuestion.purpose,
      status: "open",
    }, { onConflict: "id" });
    if (error) throw new ResearchConversationPersistenceError(failure());
  } else {
    const { error } = await session.client.from("research_questions").update({ status: "resolved", resolved_at: now }).eq("workspace_id", session.workspace.id).eq("conversation_id", conversationId).eq("status", "open");
    if (error) throw new ResearchConversationPersistenceError(failure());
  }
  if (state.plan) {
    const planApprovalMode =
      state.brief?.intakeComplete && state.plan.approvalStatus === "approved"
        ? "autopilot"
        : "manual";
    const { error } = await session.client.from("research_plans").upsert({
      id: state.plan.id,
      workspace_id: session.workspace.id,
      conversation_id: conversationId,
      graph_run_id: run.id,
      version: state.plan.version,
      approval_status: state.plan.approvalStatus,
      plan_approval_mode: planApprovalMode,
      content_json: state.plan,
      approved_by: state.plan.approvalStatus === "approved" ? session.actorId : null,
      approved_at: state.plan.approvalStatus === "approved" ? now : null,
    }, { onConflict: "id" });
    if (error) throw new ResearchConversationPersistenceError(failure());
  }
  const message = assistantMessage(state, run.id);
  if (message) {
    const { error } = await session.client.from("ano_messages").upsert({
      workspace_id: session.workspace.id,
      conversation_id: conversationId,
      role: "assistant",
      message_type: message.type,
      content_json: { text: message.text },
      dedupe_key: message.dedupeKey,
    }, { onConflict: "conversation_id,dedupe_key" });
    if (error) throw new ResearchConversationPersistenceError(failure());
  }
  const eventKey = ref ?? `${state.status}:${currentNode}`;
  const { error: eventError } = await session.client.from("run_events").upsert({
    workspace_id: session.workspace.id,
    graph_run_id: run.id,
    event_key: eventKey,
    label: state.status === "awaiting_context" ? "Ano needs one answer" : state.status === "awaiting_plan_approval" ? "Research plan ready" : state.status === "complete_without_research" ? "Phase A complete" : "Ano updated the research brief",
    detail: state.status === "awaiting_context" ? "Ano paused for a decision-changing clarification." : state.status === "awaiting_plan_approval" ? "Review, edit, approve, or decline the plan. Nothing has started." : state.status === "complete_without_research" ? "No external research or sales action was taken." : `Safe graph checkpoint at ${currentNode}.`,
  }, { onConflict: "graph_run_id,event_key" });
  if (eventError) throw new ResearchConversationPersistenceError(failure());
  return readResearchConversation(session, conversationId);
}

export async function failResearchConversation(session: WorkspaceSession, conversationId: string, message: string) {
  requireLiveSession(session);
  const run = await readGraphRun(session, conversationId);
  const { error } = await session.client.from("ano_graph_runs").update({ status: "failed_safe", failure_message: message, completed_at: new Date().toISOString() }).eq("workspace_id", session.workspace.id).eq("id", run.id);
  if (error) throw new ResearchConversationPersistenceError(failure());
  await session.client.from("ano_conversations").update({ status: "failed_safe" }).eq("workspace_id", session.workspace.id).eq("id", conversationId);
}

export async function approveResearchPlanForAutopilot(
  session: WorkspaceSession,
  conversationId: string,
  planId: string,
): Promise<ResearchConversationView> {
  requireLiveSession(session);
  const now = new Date().toISOString();
  const { error: planError } = await session.client
    .from("research_plans")
    .update({
      approval_status: "approved",
      plan_approval_mode: "autopilot",
      approved_by: session.actorId,
      approved_at: now,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .eq("id", planId);

  if (planError) {
    throw new ResearchConversationPersistenceError(failure());
  }

  const run = await readGraphRun(session, conversationId);
  if (run.status === "awaiting_plan_approval") {
    await session.client
      .from("ano_graph_runs")
      .update({
        status: "complete_without_research",
        current_node: "intake_complete_autopilot_ready",
        completed_at: now,
        updated_at: now,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", run.id);

    await session.client
      .from("ano_conversations")
      .update({
        status: "complete_without_research",
        updated_at: now,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", conversationId);
  }

  return readResearchConversation(session, conversationId);
}

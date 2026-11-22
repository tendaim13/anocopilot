import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import {
  accountCandidateDossierSchema,
  accountCohortSummarySchema,
  accountSignalSchema,
  buildTargetCompanySearchPreview,
  companySearchViewSchema,
  deriveIndustryKeywords,
  deriveOsmTagFilters,
  scoreAndBuildAccountDossier,
  summarizeAccountCohort,
  workspaceAccountDirectoryItemSchema,
  type AccountCandidateDossier,
  type AccountCohortSummary,
  type AccountLifecycleState,
  type CompanyDiscoveryProvider,
  type CompanySearchView,
  type NormalizedDiscoveredCompanyInput,
  type OsmResolvedArea,
  type OsmTagFilter,
  type ProspeoProviderState,
  type WorkspaceAccountDirectoryItem,
} from "@/lib/ano/company-discovery";
import type { IndustryProfile, MarketProfile } from "@/lib/ano/market-synthesis";
import type { ResearchBrief } from "@/lib/ano/research-conversation";
import {
  enrichMissingOsmWebsitesWithSearxng,
  OsmClientError,
  searchOsmBusinesses,
} from "@/server/connectors/openstreetmap/osm-client";
import {
  ProspeoClientError,
  searchProspeoCompanies,
} from "@/server/connectors/prospeo/prospeo-client";
import { getResearchConversation } from "@/server/domain/research-conversation-service";
import { readMarketSynthesis } from "@/server/persistence/market-synthesis-store";

export class TargetAccountDiscoveryPersistenceError extends Error {
  constructor(message: string, readonly code: string = "COMPANY_DISCOVERY_UNAVAILABLE") {
    super(message);
    this.name = "TargetAccountDiscoveryPersistenceError";
  }
}

type Row = Record<string, unknown>;

export type LockedTargetContext = {
  conversationId: string;
  targetDecisionId: string;
  anoResearchRunId: string;
  graphRunId: string;
  brief: ResearchBrief | null;
  market: MarketProfile;
  industry: IndustryProfile;
};

function requireLiveSession(
  session: WorkspaceSession,
): asserts session is SupabaseWorkspaceSession {
  if (session.kind === "demo") {
    throw new TargetAccountDiscoveryPersistenceError(
      "Sign in before Ano can preview or run Prospeo company discovery.",
      "AUTH_REQUIRED",
    );
  }
}

function iso(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano found an invalid company-discovery timestamp.",
    );
  }
  return date.toISOString();
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapAccountRow(row: Row, fallbackClaimIds: string[] = []): AccountCandidateDossier {
  const rawSnapshot = asRecord(row.raw_snapshot);
  const rawFit = asRecord(row.fit_breakdown_json);
  const rawSignals = Array.isArray(row.signals_json) ? row.signals_json : [];
  const signals = rawSignals
    .map((item) => accountSignalSchema.safeParse(item))
    .filter((parsed): parsed is { success: true; data: zInferSignal } => parsed.success)
    .map((parsed) => parsed.data);

  const locationScore = Number(rawFit.locationScore ?? 20);
  const industryScore = Number(rawFit.industryScore ?? 15);
  const signalScore = Number(rawFit.signalScore ?? 10);
  const totalScore = Number(
    row.fit_score ?? rawFit.totalScore ?? Math.min(100, locationScore + industryScore + signalScore),
  );
  const confidenceRaw = String(row.fit_confidence ?? rawFit.confidence ?? "medium");
  const confidence =
    confidenceRaw === "high" || confidenceRaw === "low" ? confidenceRaw : "medium";

  return accountCandidateDossierSchema.parse({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    targetDecisionId: String(row.target_decision_id),
    companySearchId: String(row.company_search_id),
    sourceKey: String(row.source_key),
    name: String(row.name),
    domain: typeof rawSnapshot.domain === "string" ? rawSnapshot.domain : null,
    website: typeof rawSnapshot.website === "string" ? rawSnapshot.website : null,
    linkedInUrl: typeof rawSnapshot.linkedInUrl === "string" ? rawSnapshot.linkedInUrl : null,
    industry: row.industry ? String(row.industry) : null,
    location: row.location ? String(row.location) : null,
    employeeBand: row.employee_band ? String(row.employee_band) : null,
    employeeCount:
      typeof rawSnapshot.employeeCount === "number" ? rawSnapshot.employeeCount : null,
    description: typeof rawSnapshot.description === "string" ? rawSnapshot.description : null,
    lifecycleState: String(row.lifecycle_state ?? "discovered"),
    fit: {
      locationScore,
      industryScore,
      signalScore,
      totalScore,
      confidence,
      rationale:
        typeof rawFit.rationale === "string" && rawFit.rationale
          ? rawFit.rationale
          : `Scored ${totalScore}/100 from ${rawSnapshot.provider === "openstreetmap" ? "OpenStreetMap" : "Prospeo"} company attributes.`,
      industryHypothesisNote:
        typeof rawFit.industryHypothesisNote === "string" && rawFit.industryHypothesisNote
          ? rawFit.industryHypothesisNote
          : "Phase C industry claims remain segment hypotheses until validated directly.",
    },
    signals,
    claimIds: asStringArray(row.claim_ids, fallbackClaimIds),
    evidenceUrls: asStringArray(row.evidence_urls_json),
    unknowns: asStringArray(row.unknowns_json),
    retrievedAt: iso(row.retrieved_at ?? row.created_at),
  });
}

type zInferSignal = ReturnType<typeof accountSignalSchema.parse>;

export function prospeoConfiguration(): ProspeoProviderState {
  return {
    provider: "prospeo",
    available: Boolean(process.env.PROSPEO_KEY?.trim()),
    maximumResults: 25,
    estimatedMaximumCredits: 1,
    pricingNote:
      "Location suggestions are free. An approved company search fetches 1 page (up to 25 companies) for at most 1 credit.",
  };
}

export async function loadLockedTargetContext(
  session: WorkspaceSession,
  conversationId: string,
): Promise<LockedTargetContext> {
  requireLiveSession(session);
  const [conversation, synthesis] = await Promise.all([
    getResearchConversation(session, conversationId),
    readMarketSynthesis(session, conversationId),
  ]);

  if (!synthesis || synthesis.decision?.status !== "locked") {
    throw new TargetAccountDiscoveryPersistenceError(
      "Lock a Phase C target market and industry route before preparing company discovery.",
      "TARGET_DECISION_REQUIRED",
    );
  }

  const market = synthesis.markets.find(
    (item) => item.id === synthesis.decision?.marketProfileId,
  );
  const industry = synthesis.industries.find(
    (item) => item.id === synthesis.decision?.industryProfileId,
  );

  if (!market || !industry) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano could not resolve the locked market and industry profiles for this conversation.",
      "TARGET_ROUTE_MISSING",
    );
  }

  const { data: runRow, error: runError } = await session.client
    .from("ano_research_runs")
    .select("id, graph_run_id")
    .eq("workspace_id", session.workspace.id)
    .eq("id", synthesis.researchRunId)
    .maybeSingle();

  if (runError || !runRow) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano could not resolve the parent research run for this target route.",
      "RESEARCH_RUN_NOT_FOUND",
    );
  }

  return {
    conversationId,
    targetDecisionId: synthesis.decision.id,
    anoResearchRunId: String(runRow.id),
    graphRunId: String(runRow.graph_run_id),
    brief: conversation.brief,
    market,
    industry,
  };
}

function buildSearchViewFromRows(
  searchRow: Row,
  accountRows: Row[],
  targetMarketName: string,
  targetIndustryName: string,
  industryKeywords: string[],
): CompanySearchView {
  const canonicalLocations = asStringArray(searchRow.canonical_locations_json);
  const scopeJson = asRecord(searchRow.scope_json);
  const requestedLocations = asStringArray(scopeJson.locations, canonicalLocations);
  const canonicalIndustries = asStringArray(scopeJson.canonicalIndustries);
  const claimIds = asStringArray(searchRow.claim_ids_json);
  const excludedCategories = asStringArray(searchRow.excluded_categories_json);
  const resolvedKeywords = asStringArray(scopeJson.industryKeywords, industryKeywords);
  const criteria = asStringArray(searchRow.criteria_json, [
    `Locked market route: ${targetMarketName} (${canonicalLocations.join(", ")})`,
    `Target segment context: ${targetIndustryName}`,
  ]);

  const accounts = accountRows.map((row) => mapAccountRow(row, claimIds));

  const rawStatus = String(searchRow.status ?? "awaiting_approval");
  const normalizedStatus =
    rawStatus === "failed" ? "failed_safe" : rawStatus;

  const providerKey: CompanyDiscoveryProvider =
    searchRow.provider_key === "openstreetmap" ? "openstreetmap" : "prospeo";

  const rawCohort = asRecord(searchRow.cohort_summary_json);
  let cohort: AccountCohortSummary | null = null;
  if (normalizedStatus === "completed") {
    const parsedCohort = accountCohortSummarySchema.safeParse(rawCohort);
    if (parsedCohort.success) {
      cohort = summarizeAccountCohort(
        accounts,
        targetMarketName,
        targetIndustryName,
        parsedCohort.data.providerTotalAvailable,
        providerKey,
      );
    } else {
      const receipt = asRecord(searchRow.provider_receipt_json);
      const totalCount =
        typeof receipt.total_count === "number" ? receipt.total_count : null;
      cohort = summarizeAccountCohort(
        accounts,
        targetMarketName,
        targetIndustryName,
        totalCount,
        providerKey,
      );
    }
  }

  return companySearchViewSchema.parse({
    id: String(searchRow.id),
    conversationId: String(searchRow.conversation_id),
    targetDecisionId: String(searchRow.target_decision_id),
    providerActionRequestId: searchRow.provider_action_request_id
      ? String(searchRow.provider_action_request_id)
      : null,
    providerKey,
    status: normalizedStatus,
    targetMarketName,
    targetIndustryName,
    requestedLocations:
      requestedLocations.length > 0 ? requestedLocations : ["Unspecified location"],
    canonicalLocations:
      canonicalLocations.length > 0 ? canonicalLocations : ["Unspecified location"],
    canonicalIndustries,
    industryKeywords: resolvedKeywords,
    excludedCategories,
    linkedClaimIds: claimIds,
    criteria,
    providerFilters: asRecord(searchRow.filters_json),
    maximumResults: 25,
    estimatedMaximumCredits: providerKey === "openstreetmap" ? 0 : 1,
    estimateDetail:
      providerKey === "openstreetmap"
        ? "Free OpenStreetMap local discovery returns up to 25 physical businesses for 0 credits. Optional missing-website lookup uses your private SearXNG instance (max 10 lookups, 0 credits). No Prospeo credits are spent."
        : "One first-page Prospeo request returns up to 25 companies and costs at most 1 credit only when at least one company matches; exact duplicate pages may be free for 30 days.",
    resultCount:
      typeof searchRow.result_count === "number" ? searchRow.result_count : null,
    providerReceipt: asRecord(searchRow.provider_receipt_json),
    failureMessage: searchRow.failure_message ? String(searchRow.failure_message) : null,
    cohort,
    accounts,
    approvedAt: searchRow.approved_at ? iso(searchRow.approved_at) : null,
    completedAt: searchRow.completed_at ? iso(searchRow.completed_at) : null,
    createdAt: iso(searchRow.created_at),
    updatedAt: iso(searchRow.updated_at),
  });
}

export function selectAccountsForCompanySearchView(
  status: string,
  activeActionId: string | null,
  allAccounts: Row[],
): Row[] {
  const hasLatestRunRows =
    Boolean(activeActionId) &&
    allAccounts.some((row) => String(row.provider_action_request_id ?? "") === activeActionId);

  if (status === "completed" && hasLatestRunRows) {
    const matching = allAccounts.filter(
      (row) =>
        String(row.provider_action_request_id ?? "") === activeActionId ||
        String(row.lifecycle_state ?? "") === "shortlisted",
    );
    if (matching.length <= 50) {
      return matching;
    }
    const activeRows = matching
      .filter((row) => String(row.provider_action_request_id ?? "") === activeActionId)
      .slice(0, 25);
    const activeSet = new Set(activeRows);
    const extraShortlisted = matching
      .filter((row) => !activeSet.has(row) && String(row.lifecycle_state ?? "") === "shortlisted")
      .slice(0, 50 - activeRows.length);
    const selected = new Set([...activeRows, ...extraShortlisted]);
    return matching.filter((row) => selected.has(row));
  }

  const shortlisted = allAccounts
    .filter((row) => String(row.lifecycle_state ?? "") === "shortlisted")
    .slice(0, 50);
  if (shortlisted.length > 0) {
    return shortlisted;
  }

  if (allAccounts.length === 0) {
    return [];
  }

  const batchMaxTime = new Map<string, number>();
  for (const row of allAccounts) {
    const batchKey = String(row.provider_action_request_id ?? "");
    const rawTs = row.retrieved_at ?? row.created_at;
    const ts = rawTs ? new Date(String(rawTs)).getTime() : 0;
    const safeTs = Number.isFinite(ts) ? ts : 0;
    const prev = batchMaxTime.get(batchKey) ?? Number.NEGATIVE_INFINITY;
    if (safeTs > prev) {
      batchMaxTime.set(batchKey, safeTs);
    }
  }

  let newestBatchKey: string | null = null;
  let newestBatchTs = Number.NEGATIVE_INFINITY;
  for (const [batchKey, ts] of batchMaxTime.entries()) {
    if (newestBatchKey === null || ts > newestBatchTs) {
      newestBatchKey = batchKey;
      newestBatchTs = ts;
    }
  }

  if (newestBatchKey === null) {
    return allAccounts.slice(0, 25);
  }

  return allAccounts
    .filter((row) => String(row.provider_action_request_id ?? "") === newestBatchKey)
    .slice(0, 25);
}

export async function readCompanySearchForConversation(
  session: WorkspaceSession,
  conversationId: string,
): Promise<CompanySearchView | null> {
  requireLiveSession(session);
  const { data: searchRow, error: searchError } = await session.client
    .from("provider_company_searches")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (searchError) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano could not read the saved company discovery record.",
    );
  }
  if (!searchRow) return null;

  const synthesis = await readMarketSynthesis(session, conversationId);
  const targetMarket = synthesis?.markets.find(
    (item) => item.id === synthesis.decision?.marketProfileId,
  );
  const targetIndustry = synthesis?.industries.find(
    (item) => item.id === synthesis.decision?.industryProfileId,
  );
  const scopeJson = asRecord(searchRow.scope_json);

  const targetMarketName =
    typeof scopeJson.targetMarketName === "string" && scopeJson.targetMarketName
      ? scopeJson.targetMarketName
      : targetMarket?.name ?? "Locked market";
  const targetIndustryName =
    typeof scopeJson.targetIndustryName === "string" && scopeJson.targetIndustryName
      ? scopeJson.targetIndustryName
      : targetIndustry?.name ?? "Locked industry";
  const industryKeywords = targetIndustry
    ? deriveIndustryKeywords(targetIndustry)
    : asStringArray(scopeJson.industryKeywords);

  const { data: accountRows, error: accountError } = await session.client
    .from("account_candidates")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("company_search_id", String(searchRow.id))
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (accountError) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano could not read the discovered account candidates.",
    );
  }

  const activeActionId = searchRow.provider_action_request_id
    ? String(searchRow.provider_action_request_id)
    : null;
  const allAccounts = (accountRows ?? []) as Row[];
  const filteredAccounts = selectAccountsForCompanySearchView(
    String(searchRow.status ?? ""),
    activeActionId,
    allAccounts,
  );

  return buildSearchViewFromRows(
    searchRow as Row,
    filteredAccounts,
    targetMarketName,
    targetIndustryName,
    industryKeywords,
  );
}

export async function saveCompanySearchPreview(
  session: WorkspaceSession,
  input: {
    context: LockedTargetContext;
    providerKey?: CompanyDiscoveryProvider;
    requestedLocations: string[];
    canonicalLocations: string[];
    canonicalIndustries?: string[];
    searchKeywords?: string[];
    excludedCategories: string[];
    osmAreas?: OsmResolvedArea[];
    osmTags?: OsmTagFilter[];
    resolveWebsites?: boolean;
  },
): Promise<CompanySearchView> {
  requireLiveSession(session);
  const {
    context,
    providerKey = "prospeo",
    requestedLocations,
    canonicalLocations,
    canonicalIndustries = [],
    searchKeywords = [],
    excludedCategories,
    osmAreas = [],
    osmTags = [],
    resolveWebsites = true,
  } = input;

  const { data: existing, error: existingError } = await session.client
    .from("provider_company_searches")
    .select("id, status")
    .eq("workspace_id", session.workspace.id)
    .eq("target_decision_id", context.targetDecisionId)
    .maybeSingle();

  if (existingError) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano could not check the existing company-search preview.",
    );
  }

  if (existing && String(existing.status) === "running") {
    const view = await readCompanySearchForConversation(session, context.conversationId);
    if (view) return view;
  }

  const searchId = existing ? String(existing.id) : crypto.randomUUID();
  const now = new Date().toISOString();
  const preview = buildTargetCompanySearchPreview({
    searchId,
    conversationId: context.conversationId,
    targetDecisionId: context.targetDecisionId,
    market: context.market,
    industry: context.industry,
    providerKey,
    requestedLocations,
    canonicalLocations,
    canonicalIndustries,
    searchKeywords,
    excludedCategories,
    osmAreas,
    osmTags,
    resolveWebsites,
    nowIso: now,
  });

  const actionRequestId = crypto.randomUUID();
  const previewRequestKey = `${providerKey}-preview:${context.targetDecisionId}`;
  const estimatedCredits = providerKey === "openstreetmap" ? 0 : 1;
  const { error: actionError } = await session.client
    .from("provider_action_requests")
    .upsert(
      {
        id: actionRequestId,
        workspace_id: session.workspace.id,
        ano_research_run_id: context.anoResearchRunId,
        provider_key: providerKey,
        action_kind: "company_search_preview",
        request_key: previewRequestKey,
        request_json: {
          providerKey,
          requestedLocations,
          canonicalLocations,
          canonicalIndustries: preview.canonicalIndustries,
          industryKeywords: preview.industryKeywords,
          excludedCategories,
          osmAreas,
          osmTags,
          resolveWebsites,
        },
        status: "succeeded",
        maximum_operations: 1,
        reported_credits: 0,
        provider_receipt_json:
          providerKey === "openstreetmap"
            ? {
                source: "openstreetmap",
                resolved_areas: osmAreas.length || canonicalLocations.length,
                credit_bearing_request: false,
              }
            : {
                suggestion_requests: canonicalLocations.length,
                credit_bearing_request: false,
              },
        created_by: session.actorId,
        approved_by: session.actorId,
        approved_at: now,
        started_at: now,
        completed_at: now,
      },
      { onConflict: "ano_research_run_id,request_key" },
    );

  if (actionError) {
    throw new TargetAccountDiscoveryPersistenceError(
      `Ano could not record the zero-credit ${providerKey === "openstreetmap" ? "OpenStreetMap" : "Prospeo"} preview request.`,
    );
  }

  const { data: savedAction } = await session.client
    .from("provider_action_requests")
    .select("id")
    .eq("ano_research_run_id", context.anoResearchRunId)
    .eq("request_key", previewRequestKey)
    .maybeSingle();

  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        provider: providerKey,
        page: 1,
        targetDecisionId: context.targetDecisionId,
        filters: preview.providerFilters,
      }),
    )
    .digest("hex");

  const payload = {
    id: searchId,
    workspace_id: session.workspace.id,
    conversation_id: context.conversationId,
    target_decision_id: context.targetDecisionId,
    provider_action_request_id: savedAction?.id ? String(savedAction.id) : null,
    provider_key: providerKey,
    request_hash: requestHash,
    scope_json: {
      providerKey,
      locations: preview.requestedLocations,
      targetMarketName: preview.targetMarketName,
      targetIndustryName: preview.targetIndustryName,
      canonicalIndustries: preview.canonicalIndustries,
      industryKeywords: preview.industryKeywords,
      osmAreas,
      osmTags,
      resolveWebsites,
    },
    filters_json: preview.providerFilters,
    criteria_json: preview.criteria,
    canonical_locations_json: preview.canonicalLocations,
    claim_ids_json: preview.linkedClaimIds,
    excluded_categories_json: preview.excludedCategories,
    maximum_results: 25,
    estimated_max_credits: estimatedCredits,
    status: "awaiting_approval",
    approved_by: null,
    approved_at: null,
    started_at: null,
    completed_at: null,
    result_count: null,
    cohort_summary_json: {},
    failure_code: null,
    failure_message: null,
    provider_receipt_json: preview.providerReceipt,
    updated_at: now,
  };

  const { error: upsertError } = await session.client
    .from("provider_company_searches")
    .upsert(payload, { onConflict: "workspace_id,target_decision_id" });

  if (upsertError) {
    throw new TargetAccountDiscoveryPersistenceError(
      `Ano could not save the ${providerKey === "openstreetmap" ? "OpenStreetMap" : "Prospeo"} company-search preview.`,
    );
  }

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: `provider.${providerKey}.preview_prepared`,
    outcome: "awaiting_approval",
    details_json: {
      provider: providerKey,
      conversation_id: context.conversationId,
      target_decision_id: context.targetDecisionId,
      locations: canonicalLocations,
      suggestion_requests: canonicalLocations.length,
      credit_bearing_request: false,
      estimated_max_credits: estimatedCredits,
    },
  });

  await session.client.from("run_events").upsert(
    {
      workspace_id: session.workspace.id,
      graph_run_id: context.graphRunId,
      event_key: `phase-d-preview:${context.targetDecisionId}`,
      label: "Company search preview prepared",
      detail:
        providerKey === "openstreetmap"
          ? `Ano resolved OpenStreetMap areas (${canonicalLocations.join(", ")}) for free local discovery ($0 credits, max 25 businesses). Waiting for your explicit approval.`
          : `Ano verified canonical Prospeo locations (${canonicalLocations.join(", ")}) with free suggestions. Waiting for your explicit 1-page (max 25 companies / max 1 credit) approval.`,
    },
    { onConflict: "graph_run_id,event_key" },
  );

  return (await readCompanySearchForConversation(session, context.conversationId)) ?? preview;
}

export async function executeApprovedProspeoSearch(
  session: WorkspaceSession,
  input: {
    context: LockedTargetContext;
    searchId: string;
    fetcher?: typeof fetch;
  },
): Promise<CompanySearchView> {
  requireLiveSession(session);
  const { context, searchId, fetcher } = input;

  const { data: beforeRow, error: beforeError } = await session.client
    .from("provider_company_searches")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", context.conversationId)
    .eq("id", searchId)
    .maybeSingle();

  if (beforeError || !beforeRow) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano could not find that company-search preview.",
      "SEARCH_NOT_FOUND",
    );
  }

  const providerKey: CompanyDiscoveryProvider =
    beforeRow.provider_key === "openstreetmap" ? "openstreetmap" : "prospeo";
  const providerLabel = providerKey === "openstreetmap" ? "OpenStreetMap" : "Prospeo";

  if (providerKey === "prospeo" && !prospeoConfiguration().available) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Add PROSPEO_KEY on the server before running Prospeo company discovery.",
      "PROSPEO_NOT_CONFIGURED",
    );
  }

  const currentStatus = String(beforeRow.status);
  if (currentStatus !== "awaiting_approval") {
    const view = await readCompanySearchForConversation(session, context.conversationId);
    if (view) return view;
  }

  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await session.client
    .from("provider_company_searches")
    .update({
      status: "running",
      approved_by: session.actorId,
      approved_at: startedAt,
      started_at: startedAt,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", searchId)
    .eq("status", "awaiting_approval")
    .select("id")
    .maybeSingle();

  if (claimError) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano could not claim the approved company search.",
    );
  }
  if (!claimed) {
    const view = await readCompanySearchForConversation(session, context.conversationId);
    if (view) return view;
    throw new TargetAccountDiscoveryPersistenceError(
      "Another request already started this company search.",
    );
  }

  const filters = asRecord(beforeRow.filters_json);
  const scopeJson = asRecord(beforeRow.scope_json);
  const requestSuffix = String(beforeRow.request_hash ?? startedAt).slice(0, 12);
  const requestKey = `${providerKey}-search:${searchId}:${requestSuffix}`;
  await session.client.from("provider_action_requests").upsert(
    {
      id: crypto.randomUUID(),
      workspace_id: session.workspace.id,
      ano_research_run_id: context.anoResearchRunId,
      provider_key: providerKey,
      action_kind: "company_search",
      request_key: requestKey,
      request_json: { page: 1, filters },
      status: "running",
      maximum_operations: 1,
      created_by: session.actorId,
      approved_by: session.actorId,
      approved_at: startedAt,
      started_at: startedAt,
    },
    { onConflict: "ano_research_run_id,request_key" },
  );

  const { data: savedSearchAction } = await session.client
    .from("provider_action_requests")
    .select("id")
    .eq("ano_research_run_id", context.anoResearchRunId)
    .eq("request_key", requestKey)
    .maybeSingle();
  const actionId = savedSearchAction?.id ? String(savedSearchAction.id) : crypto.randomUUID();

  const canonicalLocations = asStringArray(beforeRow.canonical_locations_json);
  const canonicalIndustries = asStringArray(scopeJson.canonicalIndustries);
  const targetKeywords = asStringArray(scopeJson.industryKeywords);
  const excludedTerms = asStringArray(beforeRow.excluded_categories_json);
  const linkedClaimIds = asStringArray(beforeRow.claim_ids_json);

  try {
    let companiesToScore: NormalizedDiscoveredCompanyInput[] = [];
    let totalCount: number | undefined;
    let isFree = providerKey === "openstreetmap";
    let rateLimit: Record<string, unknown> | undefined;
    let searxngResolvedCount = 0;

    if (providerKey === "openstreetmap") {
      const rawAreas = Array.isArray(filters.areas)
        ? filters.areas
        : Array.isArray(scopeJson.osmAreas)
          ? scopeJson.osmAreas
          : [];
      const areas = rawAreas as OsmResolvedArea[];
      if (areas.length === 0) {
        throw new OsmClientError(
          "LOCATION_NOT_FOUND",
          "OpenStreetMap search preview has no resolved geographic areas.",
        );
      }

      const rawTags = Array.isArray(filters.osm_tags)
        ? filters.osm_tags
        : Array.isArray(scopeJson.osmTags)
          ? scopeJson.osmTags
          : deriveOsmTagFilters(context.industry.name, targetKeywords);
      const tags = rawTags as OsmTagFilter[];

      const osmResult = await searchOsmBusinesses(
        { areas, tags, limit: 25, excludedTerms },
        fetcher,
      );

      const shouldResolveWebsites =
        filters.resolve_missing_websites_via_searxng !== false &&
        scopeJson.resolveWebsites !== false;
      if (shouldResolveWebsites) {
        const enriched = await enrichMissingOsmWebsitesWithSearxng(osmResult.companies, {
          maxLookups: 10,
        });
        companiesToScore = enriched.businesses;
        searxngResolvedCount = enriched.resolvedCount;
      } else {
        companiesToScore = osmResult.companies;
      }
      totalCount = osmResult.totalMatchedRaw;
    } else {
      const providerResult = await searchProspeoCompanies(filters, fetcher);
      companiesToScore = providerResult.companies;
      totalCount = providerResult.totalCount;
      isFree = providerResult.free;
      rateLimit = providerResult.rateLimit;
    }

    const completedAt = new Date().toISOString();

    const dossiers = companiesToScore.map((company) =>
      scoreAndBuildAccountDossier(company, {
        dossierId: crypto.randomUUID(),
        conversationId: context.conversationId,
        targetDecisionId: context.targetDecisionId,
        companySearchId: searchId,
        providerKey,
        targetMarketName: context.market.name,
        targetIndustryName: context.industry.name,
        canonicalLocations,
        canonicalIndustries,
        targetKeywords,
        linkedClaimIds,
        capturedAt: completedAt,
        lifecycleState: "discovered",
      }),
    );

    if (dossiers.length > 0) {
      const rowsToUpsert = dossiers.map((dossier, index) => {
        const company = companiesToScore[index];
        return {
          id: dossier.id,
          workspace_id: session.workspace.id,
          research_run_id: null,
          conversation_id: context.conversationId,
          target_decision_id: context.targetDecisionId,
          company_search_id: searchId,
          provider_action_request_id: actionId,
          source_key: dossier.sourceKey,
          name: dossier.name,
          industry: dossier.industry,
          location: dossier.location,
          employee_band: dossier.employeeBand,
          lifecycle_state: dossier.lifecycleState,
          source_label: "provider",
          raw_snapshot: {
            provider: providerKey,
            providerCompanyId: company?.id ?? dossier.sourceKey,
            website: dossier.website,
            domain: dossier.domain,
            linkedInUrl: dossier.linkedInUrl,
            osmUrl: company?.osmUrl ?? null,
            phone: company?.phone ?? null,
            address: company?.address ?? null,
            osmTags: company?.osmTags ?? null,
            websiteSource: company?.websiteSource ?? null,
            employeeCount: dossier.employeeCount,
            description: dossier.description,
            retrievedAt: completedAt,
          },
          signals_json: dossier.signals,
          claim_ids: dossier.claimIds,
          fit_score: dossier.fit.totalScore,
          fit_confidence: dossier.fit.confidence,
          fit_breakdown_json: dossier.fit,
          evidence_urls_json: dossier.evidenceUrls,
          unknowns_json: dossier.unknowns,
          retrieved_at: completedAt,
        };
      });

      const { error: upsertAccountsError } = await session.client
        .from("account_candidates")
        .upsert(rowsToUpsert, { onConflict: "workspace_id,company_search_id,source_key" });

      if (upsertAccountsError) {
        throw new TargetAccountDiscoveryPersistenceError(
          "Ano received company candidates but could not save their signal dossiers.",
        );
      }
    }

    const cohort = summarizeAccountCohort(
      dossiers,
      context.market.name,
      context.industry.name,
      totalCount ?? dossiers.length,
      providerKey,
    );

    const creditBearingRequest = providerKey === "prospeo";
    const receipt =
      providerKey === "openstreetmap"
        ? {
            free: true,
            provider: "openstreetmap",
            result_count: dossiers.length,
            total_count: totalCount ?? dossiers.length,
            searxng_websites_resolved: searxngResolvedCount,
            credit_bearing_request: false,
          }
        : {
            free: isFree,
            result_count: dossiers.length,
            total_count: totalCount ?? dossiers.length,
            rate_limit: rateLimit,
            credit_bearing_request: true,
          };

    await session.client
      .from("provider_action_requests")
      .update({
        status: "succeeded",
        reported_credits: !creditBearingRequest || isFree || dossiers.length === 0 ? 0 : 1,
        provider_receipt_json: receipt,
        completed_at: completedAt,
      })
      .eq("id", actionId);

    await session.client
      .from("provider_company_searches")
      .update({
        status: "completed",
        provider_action_request_id: actionId,
        completed_at: completedAt,
        result_count: dossiers.length,
        cohort_summary_json: cohort,
        provider_receipt_json: receipt,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", searchId)
      .eq("status", "running");

    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: `provider.${providerKey}.company_search_completed`,
      outcome: "completed",
      details_json: {
        provider: providerKey,
        conversation_id: context.conversationId,
        target_decision_id: context.targetDecisionId,
        result_count: dossiers.length,
        free: isFree,
        searxng_websites_resolved: searxngResolvedCount,
        credit_bearing_request: creditBearingRequest,
      },
    });

    await session.client.from("run_events").upsert(
      {
        workspace_id: session.workspace.id,
        graph_run_id: context.graphRunId,
        event_key: `phase-d-search:${searchId}`,
        label: "Company cohort discovered",
        detail:
          providerKey === "openstreetmap"
            ? `OpenStreetMap returned ${dossiers.length} local candidate${dossiers.length === 1 ? "" : "s"} ($0 credits${searxngResolvedCount ? `; ${searxngResolvedCount} official website${searxngResolvedCount === 1 ? "" : "s"} resolved via SearXNG` : ""}) for ${context.market.name} · ${context.industry.name}. Named buyer search and contact verification remain locked.`
            : `Prospeo returned ${dossiers.length} candidate companies on one approved page for ${context.market.name} · ${context.industry.name}. Named buyer search and contact verification remain locked.`,
      },
      { onConflict: "graph_run_id,event_key" },
    );

    return (await readCompanySearchForConversation(session, context.conversationId))!;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const isKnownProviderError =
      error instanceof ProspeoClientError || error instanceof OsmClientError;
    const noResults = isKnownProviderError && error.code === "NO_RESULTS";
    const status = noResults ? "completed" : "requires_manual_review";
    const creditBearingRequest = providerKey === "prospeo";
    const message = noResults
      ? `${providerLabel} returned no companies for this approved query.`
      : isKnownProviderError
        ? error.message
        : `Ano could not complete the approved ${providerLabel} search safely and did not retry automatically.`;
    const failureCode =
      noResults
        ? null
        : isKnownProviderError
          ? error.code
          : "DISCOVERY_FAILED";

    const emptyCohort = summarizeAccountCohort(
      [],
      context.market.name,
      context.industry.name,
      0,
      providerKey,
    );

    await session.client
      .from("provider_action_requests")
      .update({
        status: noResults ? "succeeded" : "requires_manual_review",
        reported_credits: 0,
        failure_message: noResults ? null : message,
        provider_receipt_json: {
          provider: providerKey,
          credit_bearing_request: creditBearingRequest,
          outcome: noResults ? "no_results" : "manual_review_required",
        },
        completed_at: completedAt,
      })
      .eq("id", actionId);

    await session.client
      .from("provider_company_searches")
      .update({
        status,
        provider_action_request_id: actionId,
        completed_at: completedAt,
        result_count: noResults ? 0 : null,
        cohort_summary_json: noResults ? emptyCohort : {},
        failure_code: failureCode,
        failure_message: noResults ? null : message,
        provider_receipt_json: {
          provider: providerKey,
          credit_bearing_request: creditBearingRequest,
          outcome: noResults ? "no_results" : "manual_review_required",
        },
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", searchId)
      .eq("status", "running");

    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: `provider.${providerKey}.company_search_finished`,
      outcome: noResults ? "no_results" : "requires_manual_review",
      details_json: {
        provider: providerKey,
        conversation_id: context.conversationId,
        target_decision_id: context.targetDecisionId,
        error_code: failureCode,
        credit_bearing_request: creditBearingRequest,
      },
    });

    await session.client.from("run_events").upsert(
      {
        workspace_id: session.workspace.id,
        graph_run_id: context.graphRunId,
        event_key: `phase-d-search:${searchId}`,
        label: noResults ? "Company search returned 0 matches" : "Company search paused for review",
        detail: message,
      },
      { onConflict: "graph_run_id,event_key" },
    );

    return (await readCompanySearchForConversation(session, context.conversationId))!;
  }
}

export async function updateAccountCandidateLifecycleState(
  session: WorkspaceSession,
  conversationId: string,
  accountId: string,
  state: Exclude<AccountLifecycleState, "discovered" | "review">,
): Promise<CompanySearchView> {
  requireLiveSession(session);
  const { data: updated, error } = await session.client
    .from("account_candidates")
    .update({ lifecycle_state: state })
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .eq("id", accountId)
    .select("id, source_key, company_search_id, name")
    .maybeSingle();

  if (error || !updated) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano could not update that company candidate in this workspace.",
      "ACCOUNT_NOT_FOUND",
    );
  }

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "candidate.state_changed",
    outcome: "completed",
    details_json: {
      conversation_id: conversationId,
      account_candidate_id: updated.id,
      source_key: updated.source_key,
      state,
    },
  });

  const view = await readCompanySearchForConversation(session, conversationId);
  if (!view) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano updated the company state but could not reload the cohort.",
    );
  }

  if (view.cohort) {
    await session.client
      .from("provider_company_searches")
      .update({ cohort_summary_json: view.cohort })
      .eq("workspace_id", session.workspace.id)
      .eq("id", view.id);
  }

  return view;
}

export async function listWorkspaceAccounts(
  session: WorkspaceSession,
): Promise<WorkspaceAccountDirectoryItem[]> {
  if (session.kind === "demo") return [];

  const { data: accounts, error } = await session.client
    .from("account_candidates")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .not("company_search_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano could not load workspace company candidates.",
    );
  }

  const rows = (accounts ?? []) as Row[];
  if (rows.length === 0) return [];

  const conversationIds = Array.from(
    new Set(rows.map((row) => String(row.conversation_id)).filter(Boolean)),
  );
  const searchIds = Array.from(
    new Set(rows.map((row) => String(row.company_search_id)).filter(Boolean)),
  );

  const [convRes, searchRes] = await Promise.all([
    session.client
      .from("ano_conversations")
      .select("id, title")
      .eq("workspace_id", session.workspace.id)
      .in("id", conversationIds),
    session.client
      .from("provider_company_searches")
      .select("id, scope_json, claim_ids_json")
      .eq("workspace_id", session.workspace.id)
      .in("id", searchIds),
  ]);

  if (convRes.error || searchRes.error) {
    throw new TargetAccountDiscoveryPersistenceError(
      "Ano could not load conversation context for discovered companies.",
    );
  }

  const titleByConversation = new Map(
    (convRes.data ?? []).map((item) => [String(item.id), String(item.title)]),
  );
  const searchById = new Map(
    (searchRes.data ?? []).map((item) => [String(item.id), item as Row]),
  );

  return rows.map((row) => {
    const search = searchById.get(String(row.company_search_id));
    const scope = asRecord(search?.scope_json);
    const claimIds = asStringArray(search?.claim_ids_json);
    const dossier = mapAccountRow(row, claimIds);
    return workspaceAccountDirectoryItemSchema.parse({
      ...dossier,
      conversationTitle:
        titleByConversation.get(dossier.conversationId) ?? "Research conversation",
      targetMarketName:
        typeof scope.targetMarketName === "string" && scope.targetMarketName
          ? scope.targetMarketName
          : "Locked market",
      targetIndustryName:
        typeof scope.targetIndustryName === "string" && scope.targetIndustryName
          ? scope.targetIndustryName
          : "Locked industry",
    });
  });
}

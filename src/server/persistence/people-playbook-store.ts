import "server-only";

import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import type { AccountCandidateDossier } from "@/lib/ano/company-discovery";
import type {
  IndustryProfile,
  MarketProfile,
  ResearchClaim,
} from "@/lib/ano/market-synthesis";
import {
  accountPlaybookViewSchema,
  buildDropcontactVerificationPreview,
  buildPersonSearchPreview,
  buyerRoleRecommendationSchema,
  compileFactualAccountPlaybook,
  contactCandidateViewSchema,
  contactVerificationRunViewSchema,
  dropcontactPreviewPairSchema,
  matchAccountForPerson,
  normalizeDiscoveredPersonCandidate,
  peopleDiscoveryViewSchema,
  personSearchViewSchema,
  verifiedContactDetailsSchema,
  workspaceContactDirectoryItemSchema,
  workspacePlaybookDirectoryItemSchema,
  type AccountPlaybookView,
  type ContactCandidateView,
  type ContactVerificationRunView,
  type PeopleDiscoveryView,
  type PersonSearchView,
  type WorkspaceContactDirectoryItem,
  type WorkspacePlaybookDirectoryItem,
} from "@/lib/ano/people-playbooks";
import type { ResearchBrief } from "@/lib/ano/research-conversation";
import {
  DropcontactClientError,
  verifyContactsWithDropcontact,
} from "@/server/connectors/dropcontact/dropcontact-client";
import {
  ProspeoClientError,
  searchProspeoPeople,
} from "@/server/connectors/prospeo/prospeo-client";
import { readMarketSynthesis } from "@/server/persistence/market-synthesis-store";
import {
  loadLockedTargetContext,
  readCompanySearchForConversation,
} from "@/server/persistence/target-account-discovery-store";

export class PeoplePlaybookPersistenceError extends Error {
  constructor(message: string, readonly code: string = "PEOPLE_DISCOVERY_UNAVAILABLE") {
    super(message);
    this.name = "PeoplePlaybookPersistenceError";
  }
}

type Row = Record<string, unknown>;

export type ShortlistedTargetContext = {
  conversationId: string;
  targetDecisionId: string;
  anoResearchRunId: string;
  graphRunId: string;
  brief: ResearchBrief | null;
  market: MarketProfile;
  industry: IndustryProfile;
  claims: ResearchClaim[];
  shortlistedAccounts: AccountCandidateDossier[];
  allAccountsById: Map<string, AccountCandidateDossier>;
};

function requireLiveSession(
  session: WorkspaceSession,
): asserts session is SupabaseWorkspaceSession {
  if (session.kind === "demo") {
    throw new PeoplePlaybookPersistenceError(
      "Sign in before Ano can discover contacts or verify people.",
      "AUTH_REQUIRED",
    );
  }
}

function iso(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new PeoplePlaybookPersistenceError("Ano found an invalid Phase E timestamp.");
  }
  return date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function mapPersonSearchRow(
  row: Row,
  accountNamesById: Map<string, string>,
): PersonSearchView {
  const accountIds = asStringArray(row.shortlisted_account_ids_json);
  const rawRoles = Array.isArray(row.role_recommendations_json)
    ? row.role_recommendations_json
    : [];
  const roleRecommendations = rawRoles
    .map((item) => buyerRoleRecommendationSchema.safeParse(item))
    .filter((parsed): parsed is { success: true; data: ReturnType<typeof buyerRoleRecommendationSchema.parse> } => parsed.success)
    .map((parsed) => parsed.data);

  const approvedRoles = asStringArray(row.approved_roles_json);
  const resolvedRoles =
    roleRecommendations.length > 0
      ? roleRecommendations
      : (approvedRoles.length > 0 ? approvedRoles : ["Managing Director"]).map((title) => ({
          title,
          rationale: "Approved buyer role criterion.",
          claimIds: [],
        }));

  const shortlistedNames = accountIds.map(
    (id) => accountNamesById.get(id) ?? "Shortlisted company",
  );

  return personSearchViewSchema.parse({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    targetDecisionId: String(row.target_decision_id),
    providerActionRequestId: row.provider_action_request_id
      ? String(row.provider_action_request_id)
      : null,
    providerKey: "prospeo",
    status: String(row.status),
    shortlistedAccountIds: accountIds,
    shortlistedAccountNames:
      shortlistedNames.length > 0 ? shortlistedNames : ["Shortlisted company"],
    roleRecommendations: resolvedRoles,
    approvedRoles:
      approvedRoles.length > 0
        ? approvedRoles
        : resolvedRoles.map((item) => item.title),
    providerFilters: asRecord(row.filters_json),
    maximumResults: 25,
    estimatedMaximumCredits: 1,
    estimateDetail:
      "One first-page Prospeo person search returns up to 25 named people across shortlisted companies (max 1 credit). Verified contact details require a separate selective Dropcontact approval.",
    resultCount: typeof row.result_count === "number" ? row.result_count : null,
    providerReceipt: asRecord(row.provider_receipt_json),
    failureMessage: row.failure_message ? String(row.failure_message) : null,
    approvedAt: row.approved_at ? iso(row.approved_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapContactRow(
  row: Row,
  accountsById: Map<string, { name: string; domain: string | null }>,
): ContactCandidateView {
  const accountInfo = accountsById.get(String(row.account_candidate_id)) ?? {
    name: "Shortlisted company",
    domain: null,
  };
  const verifiedParsed = row.verified_details_json
    ? verifiedContactDetailsSchema.safeParse(row.verified_details_json)
    : null;

  const rawConfidence = String(row.confidence ?? "medium");
  const confidence =
    rawConfidence === "high" || rawConfidence === "low" ? rawConfidence : "medium";

  return contactCandidateViewSchema.parse({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    targetDecisionId: String(row.target_decision_id),
    accountCandidateId: String(row.account_candidate_id),
    accountName: accountInfo.name,
    accountDomain: accountInfo.domain,
    personSearchId: String(row.person_search_id),
    sourceKey: String(row.source_key),
    fullName: String(row.full_name),
    firstName: row.first_name ? String(row.first_name) : null,
    lastName: row.last_name ? String(row.last_name) : null,
    title: row.title ? String(row.title) : null,
    seniority: row.seniority ? String(row.seniority) : null,
    department: row.department ? String(row.department) : null,
    location: row.location ? String(row.location) : null,
    linkedInUrl: row.linkedin_url ? String(row.linkedin_url) : null,
    roleRationale: row.role_rationale ? String(row.role_rationale) : null,
    confidence,
    claimIds: asStringArray(row.claim_ids),
    selectedForVerification: Boolean(row.selected_for_verification),
    verificationStatus: String(row.verification_status ?? "not_requested"),
    verifiedDetails: verifiedParsed?.success ? verifiedParsed.data : null,
    retrievedAt: iso(row.retrieved_at ?? row.created_at),
    verifiedAt: row.verified_at ? iso(row.verified_at) : null,
  });
}

function mapVerificationRow(row: Row): ContactVerificationRunView {
  const rawPairs = Array.isArray(row.preview_pairs_json) ? row.preview_pairs_json : [];
  const previewPairs = rawPairs
    .map((item) => dropcontactPreviewPairSchema.safeParse(item))
    .filter((parsed): parsed is { success: true; data: ReturnType<typeof dropcontactPreviewPairSchema.parse> } => parsed.success)
    .map((parsed) => parsed.data);

  const selectedIds = asStringArray(row.selected_contact_ids_json);
  const credits = Math.max(1, Number(row.estimated_credits ?? (previewPairs.length || 1)));

  return contactVerificationRunViewSchema.parse({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    personSearchId: String(row.person_search_id),
    providerActionRequestId: row.provider_action_request_id
      ? String(row.provider_action_request_id)
      : null,
    providerKey: "dropcontact",
    status: String(row.status),
    selectedContactIds: selectedIds,
    previewPairs,
    estimatedCredits: credits,
    estimateDetail: `Dropcontact checks ${previewPairs.length} selected name-and-company pair${previewPairs.length === 1 ? "" : "s"} (estimated ${credits} Dropcontact credit${credits === 1 ? "" : "s"}). No other discovered contacts are submitted.`,
    verifiedCount: typeof row.verified_count === "number" ? row.verified_count : null,
    providerReceipt: asRecord(row.provider_receipt_json),
    failureMessage: row.failure_message ? String(row.failure_message) : null,
    approvedAt: row.approved_at ? iso(row.approved_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapPlaybookRow(
  row: Row,
  accountNamesById: Map<string, string>,
  targetMarketName: string,
  targetIndustryName: string,
): AccountPlaybookView {
  return accountPlaybookViewSchema.parse({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    targetDecisionId: String(row.target_decision_id),
    accountCandidateId: String(row.account_candidate_id),
    accountName:
      accountNamesById.get(String(row.account_candidate_id)) ?? "Shortlisted company",
    targetMarketName,
    targetIndustryName,
    status: String(row.status ?? "ready"),
    headline: String(row.headline),
    accountThesis: String(row.account_thesis),
    industryContext: String(row.industry_context),
    selectedContactIds: asStringArray(row.selected_contact_ids_json),
    claimIds: asStringArray(row.claim_ids_json),
    signalIds: asStringArray(row.signal_ids_json),
    buyerAngles: Array.isArray(row.buyer_angles_json) ? row.buyer_angles_json : [],
    evidenceBackedPoints: Array.isArray(row.evidence_backed_points_json)
      ? row.evidence_backed_points_json
      : [],
    validationQuestions: asStringArray(row.validation_questions_json),
    unknowns: asStringArray(row.unknowns_json),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

export async function loadShortlistedContext(
  session: WorkspaceSession,
  conversationId: string,
): Promise<ShortlistedTargetContext> {
  requireLiveSession(session);
  const [targetContext, synthesis, companySearch] = await Promise.all([
    loadLockedTargetContext(session, conversationId),
    readMarketSynthesis(session, conversationId),
    readCompanySearchForConversation(session, conversationId),
  ]);

  const accounts = companySearch?.accounts ?? [];
  const allAccountsById = new Map(accounts.map((account) => [account.id, account]));
  const shortlistedAccounts = accounts.filter(
    (account) => account.lifecycleState === "shortlisted",
  );

  return {
    ...targetContext,
    claims: synthesis?.claims ?? [],
    shortlistedAccounts,
    allAccountsById,
  };
}

export async function readPeopleDiscoveryForConversation(
  session: WorkspaceSession,
  conversationId: string,
): Promise<PeopleDiscoveryView> {
  if (session.kind === "demo") {
    return {
      shortlistedCount: 0,
      personSearch: null,
      contacts: [],
      verificationRun: null,
      playbooks: [],
    };
  }

  const [companySearch, synthesis] = await Promise.all([
    readCompanySearchForConversation(session, conversationId),
    readMarketSynthesis(session, conversationId),
  ]);

  const accounts = companySearch?.accounts ?? [];
  const shortlistedCount = accounts.filter(
    (item) => item.lifecycleState === "shortlisted",
  ).length;
  const accountsById = new Map(
    accounts.map((item) => [item.id, { name: item.name, domain: item.domain }]),
  );
  const accountNamesById = new Map(accounts.map((item) => [item.id, item.name]));

  const targetMarketName =
    synthesis?.markets.find((item) => item.id === synthesis.decision?.marketProfileId)?.name ??
    companySearch?.targetMarketName ??
    "Locked market";
  const targetIndustryName =
    synthesis?.industries.find((item) => item.id === synthesis.decision?.industryProfileId)
      ?.name ??
    companySearch?.targetIndustryName ??
    "Locked industry";

  const [personSearchRes, contactsRes, verificationRes, playbooksRes] = await Promise.all([
    session.client
      .from("provider_person_searches")
      .select("*")
      .eq("workspace_id", session.workspace.id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    session.client
      .from("contact_candidates")
      .select("*")
      .eq("workspace_id", session.workspace.id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
    session.client
      .from("contact_verification_runs")
      .select("*")
      .eq("workspace_id", session.workspace.id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    session.client
      .from("account_playbooks")
      .select("*")
      .eq("workspace_id", session.workspace.id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }),
  ]);

  if (
    personSearchRes.error ||
    contactsRes.error ||
    verificationRes.error ||
    playbooksRes.error
  ) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not load saved people discovery and playbooks.",
    );
  }

  return peopleDiscoveryViewSchema.parse({
    shortlistedCount,
    personSearch: personSearchRes.data
      ? mapPersonSearchRow(personSearchRes.data as Row, accountNamesById)
      : null,
    contacts: (contactsRes.data ?? []).map((row) =>
      mapContactRow(row as Row, accountsById),
    ),
    verificationRun: verificationRes.data
      ? mapVerificationRow(verificationRes.data as Row)
      : null,
    playbooks: (playbooksRes.data ?? []).map((row) =>
      mapPlaybookRow(
        row as Row,
        accountNamesById,
        targetMarketName,
        targetIndustryName,
      ),
    ),
  });
}

export async function saveRoleProposalAndPersonSearchPreview(
  session: WorkspaceSession,
  input: {
    context: ShortlistedTargetContext;
    roleRecommendations: ReturnType<typeof buyerRoleRecommendationSchema.parse>[];
  },
): Promise<PeopleDiscoveryView> {
  requireLiveSession(session);
  const { context, roleRecommendations } = input;
  if (context.shortlistedAccounts.length === 0) {
    throw new PeoplePlaybookPersistenceError(
      "Shortlist at least one company in Phase D before preparing buyer-role person discovery.",
      "SHORTLIST_REQUIRED",
    );
  }

  const { data: existing, error: existingError } = await session.client
    .from("provider_person_searches")
    .select("id, status")
    .eq("workspace_id", session.workspace.id)
    .eq("target_decision_id", context.targetDecisionId)
    .maybeSingle();

  if (existingError) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not check the existing person-search preview.",
    );
  }

  if (existing && String(existing.status) !== "awaiting_approval") {
    return readPeopleDiscoveryForConversation(session, context.conversationId);
  }

  const personSearchId = existing ? String(existing.id) : crypto.randomUUID();
  const now = new Date().toISOString();
  const preview = buildPersonSearchPreview({
    personSearchId,
    conversationId: context.conversationId,
    targetDecisionId: context.targetDecisionId,
    shortlistedAccounts: context.shortlistedAccounts,
    roleRecommendations,
    nowIso: now,
  });

  const actionRequestId = crypto.randomUUID();
  await session.client.from("provider_action_requests").upsert(
    {
      id: actionRequestId,
      workspace_id: session.workspace.id,
      ano_research_run_id: context.anoResearchRunId,
      provider_key: "prospeo",
      action_kind: "person_search_preview",
      request_key: `prospeo-person-preview:${context.targetDecisionId}`,
      request_json: {
        shortlistedAccountIds: preview.shortlistedAccountIds,
        approvedRoles: preview.approvedRoles,
        filters: preview.providerFilters,
      },
      status: "succeeded",
      maximum_operations: 1,
      reported_credits: 0,
      provider_receipt_json: preview.providerReceipt,
      created_by: session.actorId,
      approved_by: session.actorId,
      approved_at: now,
      started_at: now,
      completed_at: now,
    },
    { onConflict: "ano_research_run_id,request_key" },
  );

  const { data: savedAction } = await session.client
    .from("provider_action_requests")
    .select("id")
    .eq("ano_research_run_id", context.anoResearchRunId)
    .eq("request_key", `prospeo-person-preview:${context.targetDecisionId}`)
    .maybeSingle();

  const { error: upsertError } = await session.client
    .from("provider_person_searches")
    .upsert(
      {
        id: personSearchId,
        workspace_id: session.workspace.id,
        conversation_id: context.conversationId,
        target_decision_id: context.targetDecisionId,
        provider_action_request_id: savedAction?.id ? String(savedAction.id) : null,
        provider_key: "prospeo",
        shortlisted_account_ids_json: preview.shortlistedAccountIds,
        role_recommendations_json: preview.roleRecommendations,
        approved_roles_json: preview.approvedRoles,
        filters_json: preview.providerFilters,
        maximum_results: 25,
        estimated_max_credits: 1,
        status: "awaiting_approval",
        provider_receipt_json: preview.providerReceipt,
        updated_at: now,
      },
      { onConflict: "workspace_id,target_decision_id" },
    );

  if (upsertError) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not save the Prospeo buyer-role & person search preview.",
    );
  }

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "provider.prospeo.person_preview_prepared",
    outcome: "awaiting_approval",
    details_json: {
      conversation_id: context.conversationId,
      shortlisted_count: preview.shortlistedAccountIds.length,
      approved_roles: preview.approvedRoles,
      credit_bearing_request: false,
    },
  });

  await session.client.from("run_events").upsert(
    {
      workspace_id: session.workspace.id,
      graph_run_id: context.graphRunId,
      event_key: `phase-e-person-preview:${context.targetDecisionId}`,
      label: "Buyer roles & person preview ready",
      detail: `Ano proposed ${preview.approvedRoles.join(", ")} across ${preview.shortlistedAccountIds.length} shortlisted compan${preview.shortlistedAccountIds.length === 1 ? "y" : "ies"}. Awaiting explicit approval before running 1-page Prospeo person search.`,
    },
    { onConflict: "graph_run_id,event_key" },
  );

  return readPeopleDiscoveryForConversation(session, context.conversationId);
}

export async function executeApprovedProspeoPersonSearch(
  session: WorkspaceSession,
  input: {
    context: ShortlistedTargetContext;
    personSearchId: string;
    fetcher?: typeof fetch;
  },
): Promise<PeopleDiscoveryView> {
  requireLiveSession(session);
  const { context, personSearchId, fetcher } = input;

  const { data: beforeRow, error: beforeError } = await session.client
    .from("provider_person_searches")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", context.conversationId)
    .eq("id", personSearchId)
    .maybeSingle();

  if (beforeError || !beforeRow) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not find that person-search preview.",
      "PERSON_SEARCH_NOT_FOUND",
    );
  }

  if (String(beforeRow.status) !== "awaiting_approval") {
    return readPeopleDiscoveryForConversation(session, context.conversationId);
  }

  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await session.client
    .from("provider_person_searches")
    .update({
      status: "running",
      approved_by: session.actorId,
      approved_at: startedAt,
      started_at: startedAt,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", personSearchId)
    .eq("status", "awaiting_approval")
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    return readPeopleDiscoveryForConversation(session, context.conversationId);
  }

  const actionId = crypto.randomUUID();
  const filters = asRecord(beforeRow.filters_json);
  const rawRoles: unknown[] = Array.isArray(beforeRow.role_recommendations_json)
    ? (beforeRow.role_recommendations_json as unknown[])
    : [];
  const roleRecommendations = rawRoles
    .map((item) => buyerRoleRecommendationSchema.safeParse(item))
    .filter((parsed): parsed is { success: true; data: ReturnType<typeof buyerRoleRecommendationSchema.parse> } => parsed.success)
    .map((parsed) => parsed.data);

  await session.client.from("provider_action_requests").upsert(
    {
      id: actionId,
      workspace_id: session.workspace.id,
      ano_research_run_id: context.anoResearchRunId,
      provider_key: "prospeo",
      action_kind: "person_search",
      request_key: `prospeo-person-search:${personSearchId}`,
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

  try {
    const providerResult = await searchProspeoPeople(filters, fetcher);
    const completedAt = new Date().toISOString();

    const rowsToUpsert: Record<string, unknown>[] = [];
    for (const person of providerResult.people) {
      const matchedAccount = matchAccountForPerson(person, context.shortlistedAccounts);
      if (!matchedAccount) continue;
      const candidate = normalizeDiscoveredPersonCandidate(person, {
        candidateId: crypto.randomUUID(),
        conversationId: context.conversationId,
        targetDecisionId: context.targetDecisionId,
        personSearchId,
        account: matchedAccount,
        roleRecommendations,
        capturedAt: completedAt,
      });

      rowsToUpsert.push({
        id: candidate.id,
        workspace_id: session.workspace.id,
        research_run_id: null,
        account_candidate_id: candidate.accountCandidateId,
        conversation_id: context.conversationId,
        target_decision_id: context.targetDecisionId,
        person_search_id: personSearchId,
        discovery_action_request_id: actionId,
        source_key: candidate.sourceKey,
        full_name: candidate.fullName,
        first_name: candidate.firstName,
        last_name: candidate.lastName,
        title: candidate.title,
        seniority: candidate.seniority,
        department: candidate.department,
        linkedin_url: candidate.linkedInUrl,
        location: candidate.location,
        role_rationale: candidate.roleRationale,
        confidence: candidate.confidence,
        claim_ids: candidate.claimIds,
        availability: "named_only",
        source_label: "provider",
        selected_for_verification: false,
        verification_status: "not_requested",
        verified_details_json: null,
        provider_receipt_json: {
          provider: "prospeo",
          person_id: person.id,
        },
        retrieved_at: completedAt,
      });
    }

    if (rowsToUpsert.length > 0) {
      const { error: upsertContactsError } = await session.client
        .from("contact_candidates")
        .upsert(rowsToUpsert, {
          onConflict: "workspace_id,person_search_id,source_key",
        });

      if (upsertContactsError) {
        throw new PeoplePlaybookPersistenceError(
          "Ano discovered named people but could not save their records safely.",
        );
      }
    }

    const receipt = {
      free: providerResult.free,
      result_count: rowsToUpsert.length,
      total_count: providerResult.totalCount ?? rowsToUpsert.length,
      rate_limit: providerResult.rateLimit,
      credit_bearing_request: true,
    };

    await session.client
      .from("provider_action_requests")
      .update({
        status: "succeeded",
        reported_credits: providerResult.free || rowsToUpsert.length === 0 ? 0 : 1,
        provider_receipt_json: receipt,
        completed_at: completedAt,
      })
      .eq("id", actionId);

    await session.client
      .from("provider_person_searches")
      .update({
        status: "completed",
        provider_action_request_id: actionId,
        completed_at: completedAt,
        result_count: rowsToUpsert.length,
        provider_receipt_json: receipt,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", personSearchId)
      .eq("status", "running");

    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: "provider.prospeo.person_search_completed",
      outcome: "completed",
      details_json: {
        conversation_id: context.conversationId,
        result_count: rowsToUpsert.length,
        free: providerResult.free,
      },
    });

    await session.client.from("run_events").upsert(
      {
        workspace_id: session.workspace.id,
        graph_run_id: context.graphRunId,
        event_key: `phase-e-person-search:${personSearchId}`,
        label: "Named buyer candidates saved",
        detail: `Prospeo returned ${rowsToUpsert.length} named people for shortlisted accounts. No contact verification or Dropcontact call has run yet.`,
      },
      { onConflict: "graph_run_id,event_key" },
    );

    return readPeopleDiscoveryForConversation(session, context.conversationId);
  } catch (error) {
    const completedAt = new Date().toISOString();
    const noResults = error instanceof ProspeoClientError && error.code === "NO_RESULTS";
    const status = noResults ? "completed" : "requires_manual_review";
    const message = noResults
      ? "Prospeo returned no named people for the approved roles and shortlisted companies."
      : error instanceof ProspeoClientError
        ? error.message
        : "Ano could not complete the approved Prospeo person search safely and did not retry automatically.";

    await session.client
      .from("provider_action_requests")
      .update({
        status: noResults ? "succeeded" : "requires_manual_review",
        reported_credits: 0,
        failure_message: noResults ? null : message,
        provider_receipt_json: {
          credit_bearing_request: true,
          outcome: noResults ? "no_results" : "manual_review_required",
        },
        completed_at: completedAt,
      })
      .eq("id", actionId);

    await session.client
      .from("provider_person_searches")
      .update({
        status,
        provider_action_request_id: actionId,
        completed_at: completedAt,
        result_count: noResults ? 0 : null,
        failure_message: noResults ? null : message,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", personSearchId)
      .eq("status", "running");

    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: "provider.prospeo.person_search_finished",
      outcome: noResults ? "no_results" : "requires_manual_review",
      details_json: {
        conversation_id: context.conversationId,
        error_code: noResults
          ? null
          : error instanceof ProspeoClientError
            ? error.code
            : "PERSON_SEARCH_FAILED",
      },
    });

    await session.client.from("run_events").upsert(
      {
        workspace_id: session.workspace.id,
        graph_run_id: context.graphRunId,
        event_key: `phase-e-person-search:${personSearchId}`,
        label: noResults
          ? "Person search returned 0 matches"
          : "Person search paused for review",
        detail: message,
      },
      { onConflict: "graph_run_id,event_key" },
    );

    return readPeopleDiscoveryForConversation(session, context.conversationId);
  }
}

export async function saveDropcontactVerificationPreview(
  session: WorkspaceSession,
  input: {
    context: ShortlistedTargetContext;
    selectedContactIds: string[];
  },
): Promise<PeopleDiscoveryView> {
  requireLiveSession(session);
  const { context, selectedContactIds } = input;
  const view = await readPeopleDiscoveryForConversation(session, context.conversationId);
  if (!view.personSearch) {
    throw new PeoplePlaybookPersistenceError(
      "Discover named people before preparing selective Dropcontact verification.",
      "PERSON_SEARCH_REQUIRED",
    );
  }

  const selectedSet = new Set(selectedContactIds);
  const selectedContacts = view.contacts.filter((contact) => selectedSet.has(contact.id));
  if (selectedContacts.length === 0) {
    throw new PeoplePlaybookPersistenceError(
      "Select at least one named person before preparing a Dropcontact preview.",
      "NO_CONTACTS_SELECTED",
    );
  }

  if (
    view.verificationRun &&
    view.verificationRun.status !== "awaiting_approval"
  ) {
    return view;
  }

  const verificationRunId = view.verificationRun?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const preview = buildDropcontactVerificationPreview({
    verificationRunId,
    conversationId: context.conversationId,
    personSearchId: view.personSearch.id,
    selectedContacts,
    nowIso: now,
  });

  const actionRequestId = crypto.randomUUID();
  await session.client.from("provider_action_requests").upsert(
    {
      id: actionRequestId,
      workspace_id: session.workspace.id,
      ano_research_run_id: context.anoResearchRunId,
      provider_key: "dropcontact",
      action_kind: "contact_verification_preview",
      request_key: `dropcontact-preview:${view.personSearch.id}`,
      request_json: {
        selectedContactIds: preview.selectedContactIds,
        previewPairs: preview.previewPairs,
      },
      status: "succeeded",
      maximum_operations: preview.previewPairs.length,
      reported_credits: 0,
      provider_receipt_json: preview.providerReceipt,
      created_by: session.actorId,
      approved_by: session.actorId,
      approved_at: now,
      started_at: now,
      completed_at: now,
    },
    { onConflict: "ano_research_run_id,request_key" },
  );

  const { data: savedAction } = await session.client
    .from("provider_action_requests")
    .select("id")
    .eq("ano_research_run_id", context.anoResearchRunId)
    .eq("request_key", `dropcontact-preview:${view.personSearch.id}`)
    .maybeSingle();

  const { error: upsertRunError } = await session.client
    .from("contact_verification_runs")
    .upsert(
      {
        id: verificationRunId,
        workspace_id: session.workspace.id,
        conversation_id: context.conversationId,
        person_search_id: view.personSearch.id,
        provider_action_request_id: savedAction?.id ? String(savedAction.id) : null,
        provider_key: "dropcontact",
        selected_contact_ids_json: preview.selectedContactIds,
        preview_pairs_json: preview.previewPairs,
        estimated_credits: preview.estimatedCredits,
        status: "awaiting_approval",
        provider_receipt_json: preview.providerReceipt,
        updated_at: now,
      },
      { onConflict: "workspace_id,person_search_id" },
    );

  if (upsertRunError) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not save the selective Dropcontact verification preview.",
    );
  }

  // Update contact selection state transparently before any external enrichment call.
  await session.client
    .from("contact_candidates")
    .update({
      selected_for_verification: false,
      verification_status: "not_requested",
    })
    .eq("workspace_id", session.workspace.id)
    .eq("person_search_id", view.personSearch.id)
    .in("verification_status", ["not_requested", "awaiting_approval"]);

  await session.client
    .from("contact_candidates")
    .update({
      selected_for_verification: true,
      verification_status: "awaiting_approval",
    })
    .eq("workspace_id", session.workspace.id)
    .eq("person_search_id", view.personSearch.id)
    .in("id", preview.selectedContactIds);

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "provider.dropcontact.preview_prepared",
    outcome: "awaiting_approval",
    details_json: {
      conversation_id: context.conversationId,
      selected_contact_count: preview.selectedContactIds.length,
      estimated_credits: preview.estimatedCredits,
      credit_bearing_request: false,
    },
  });

  await session.client.from("run_events").upsert(
    {
      workspace_id: session.workspace.id,
      graph_run_id: context.graphRunId,
      event_key: `phase-e-dc-preview:${verificationRunId}`,
      label: "Dropcontact verification preview ready",
      detail: `Selected ${preview.previewPairs.length} contact pair${preview.previewPairs.length === 1 ? "" : "s"} for selective Dropcontact preview. Waiting for explicit approval.`,
    },
    { onConflict: "graph_run_id,event_key" },
  );

  return readPeopleDiscoveryForConversation(session, context.conversationId);
}

export async function executeApprovedDropcontactVerification(
  session: WorkspaceSession,
  input: {
    context: ShortlistedTargetContext;
    verificationRunId: string;
    fetcher?: typeof fetch;
  },
): Promise<PeopleDiscoveryView> {
  requireLiveSession(session);
  const { context, verificationRunId, fetcher } = input;

  const { data: beforeRow, error: beforeError } = await session.client
    .from("contact_verification_runs")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", context.conversationId)
    .eq("id", verificationRunId)
    .maybeSingle();

  if (beforeError || !beforeRow) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not find that Dropcontact verification preview.",
      "VERIFICATION_NOT_FOUND",
    );
  }

  if (String(beforeRow.status) !== "awaiting_approval") {
    return readPeopleDiscoveryForConversation(session, context.conversationId);
  }

  const startedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await session.client
    .from("contact_verification_runs")
    .update({
      status: "running",
      approved_by: session.actorId,
      approved_at: startedAt,
      started_at: startedAt,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", verificationRunId)
    .eq("status", "awaiting_approval")
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    return readPeopleDiscoveryForConversation(session, context.conversationId);
  }

  const rawPairs: unknown[] = Array.isArray(beforeRow.preview_pairs_json)
    ? (beforeRow.preview_pairs_json as unknown[])
    : [];
  const pairs = rawPairs
    .map((item) => dropcontactPreviewPairSchema.safeParse(item))
    .filter((parsed): parsed is { success: true; data: ReturnType<typeof dropcontactPreviewPairSchema.parse> } => parsed.success)
    .map((parsed) => parsed.data);

  const selectedIds = pairs.map((pair) => pair.contactId);
  const actionId = crypto.randomUUID();

  await session.client.from("provider_action_requests").upsert(
    {
      id: actionId,
      workspace_id: session.workspace.id,
      ano_research_run_id: context.anoResearchRunId,
      provider_key: "dropcontact",
      action_kind: "contact_verification",
      request_key: `dropcontact-verify:${verificationRunId}`,
      request_json: { selectedIds, count: pairs.length },
      status: "running",
      maximum_operations: pairs.length,
      created_by: session.actorId,
      approved_by: session.actorId,
      approved_at: startedAt,
      started_at: startedAt,
    },
    { onConflict: "ano_research_run_id,request_key" },
  );

  await session.client
    .from("contact_candidates")
    .update({
      verification_status: "running",
      verification_action_request_id: actionId,
    })
    .eq("workspace_id", session.workspace.id)
    .in("id", selectedIds);

  try {
    const result = await verifyContactsWithDropcontact(pairs, fetcher);
    const completedAt = new Date().toISOString();

    let verifiedCount = 0;
    for (const entry of result.results) {
      if (entry.verified) verifiedCount += 1;
      const verifiedDetails = entry.verified
        ? {
            email: entry.email,
            emailQualification: entry.emailQualification,
            phone: entry.phone,
            verifiedDomain: entry.verifiedDomain,
            provider: "dropcontact" as const,
            verifiedAt: completedAt,
          }
        : null;

      await session.client
        .from("contact_candidates")
        .update({
          availability: entry.verified ? "verified_email" : "unverified",
          verification_status: entry.verified ? "verified" : "unverified",
          verified_details_json: verifiedDetails,
          verification_action_request_id: actionId,
          verified_at: completedAt,
          provider_receipt_json: {
            provider: "dropcontact",
            request_id: result.requestId,
          },
        })
        .eq("workspace_id", session.workspace.id)
        .eq("id", entry.contactId);
    }

    const receipt = {
      provider: "dropcontact",
      request_id: result.requestId,
      credits_left: result.creditsLeft,
      submitted_count: pairs.length,
      verified_count: verifiedCount,
      credit_bearing_request: true,
    };

    await session.client
      .from("provider_action_requests")
      .update({
        status: "succeeded",
        reported_credits: pairs.length,
        provider_receipt_json: receipt,
        completed_at: completedAt,
      })
      .eq("id", actionId);

    await session.client
      .from("contact_verification_runs")
      .update({
        status: "completed",
        provider_action_request_id: actionId,
        verified_count: verifiedCount,
        provider_receipt_json: receipt,
        completed_at: completedAt,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", verificationRunId)
      .eq("status", "running");

    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: "provider.dropcontact.verification_completed",
      outcome: "completed",
      details_json: {
        conversation_id: context.conversationId,
        submitted_count: pairs.length,
        verified_count: verifiedCount,
        request_id: result.requestId,
      },
    });

    await session.client.from("run_events").upsert(
      {
        workspace_id: session.workspace.id,
        graph_run_id: context.graphRunId,
        event_key: `phase-e-dc-verify:${verificationRunId}`,
        label: "Selective contact verification completed",
        detail: `Dropcontact verified ${verifiedCount} of ${pairs.length} selected contact pair${pairs.length === 1 ? "" : "s"}. Outreach remains gated until Phase 8.`,
      },
      { onConflict: "graph_run_id,event_key" },
    );

    return readPeopleDiscoveryForConversation(session, context.conversationId);
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message =
      error instanceof DropcontactClientError
        ? error.message
        : "Ano could not confirm the Dropcontact verification batch safely and did not retry automatically.";

    await session.client
      .from("contact_candidates")
      .update({
        verification_status: "requires_manual_review",
      })
      .eq("workspace_id", session.workspace.id)
      .in("id", selectedIds);

    await session.client
      .from("provider_action_requests")
      .update({
        status: "requires_manual_review",
        failure_message: message,
        provider_receipt_json: {
          provider: "dropcontact",
          credit_bearing_request: true,
          outcome: "manual_review_required",
        },
        completed_at: completedAt,
      })
      .eq("id", actionId);

    await session.client
      .from("contact_verification_runs")
      .update({
        status: "requires_manual_review",
        provider_action_request_id: actionId,
        failure_message: message,
        completed_at: completedAt,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", verificationRunId)
      .eq("status", "running");

    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: "provider.dropcontact.verification_stopped",
      outcome: "requires_manual_review",
      details_json: {
        conversation_id: context.conversationId,
        error_code:
          error instanceof DropcontactClientError ? error.code : "VERIFICATION_FAILED",
      },
    });

    await session.client.from("run_events").upsert(
      {
        workspace_id: session.workspace.id,
        graph_run_id: context.graphRunId,
        event_key: `phase-e-dc-verify:${verificationRunId}`,
        label: "Contact verification paused for review",
        detail: message,
      },
      { onConflict: "graph_run_id,event_key" },
    );

    return readPeopleDiscoveryForConversation(session, context.conversationId);
  }
}

export async function compileAndSaveAccountPlaybooks(
  session: WorkspaceSession,
  input: {
    context: ShortlistedTargetContext;
  },
): Promise<PeopleDiscoveryView> {
  requireLiveSession(session);
  const { context } = input;
  if (context.shortlistedAccounts.length === 0) {
    throw new PeoplePlaybookPersistenceError(
      "Shortlist at least one discovered company before generating factual playbooks.",
      "SHORTLIST_REQUIRED",
    );
  }

  const currentView = await readPeopleDiscoveryForConversation(
    session,
    context.conversationId,
  );
  const now = new Date().toISOString();

  const rowsToUpsert = context.shortlistedAccounts.map((account) => {
    const playbook = compileFactualAccountPlaybook({
      playbookId: crypto.randomUUID(),
      conversationId: context.conversationId,
      targetDecisionId: context.targetDecisionId,
      account,
      targetMarketName: context.market.name,
      industry: context.industry,
      claims: context.claims,
      contacts: currentView.contacts,
      offerSummary: context.brief?.offer,
      nowIso: now,
    });

    return {
      id: playbook.id,
      workspace_id: session.workspace.id,
      conversation_id: context.conversationId,
      target_decision_id: context.targetDecisionId,
      account_candidate_id: playbook.accountCandidateId,
      selected_contact_ids_json: playbook.selectedContactIds,
      claim_ids_json: playbook.claimIds,
      signal_ids_json: playbook.signalIds,
      status: "ready",
      headline: playbook.headline,
      account_thesis: playbook.accountThesis,
      industry_context: playbook.industryContext,
      buyer_angles_json: playbook.buyerAngles,
      evidence_backed_points_json: playbook.evidenceBackedPoints,
      validation_questions_json: playbook.validationQuestions,
      unknowns_json: playbook.unknowns,
      created_by: session.actorId,
      updated_at: now,
    };
  });

  const { error } = await session.client
    .from("account_playbooks")
    .upsert(rowsToUpsert, {
      onConflict: "workspace_id,conversation_id,account_candidate_id",
    });

  if (error) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not save the compiled factual account playbooks.",
    );
  }

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "playbook.compiled",
    outcome: "completed",
    details_json: {
      conversation_id: context.conversationId,
      playbook_count: rowsToUpsert.length,
    },
  });

  await session.client.from("run_events").upsert(
    {
      workspace_id: session.workspace.id,
      graph_run_id: context.graphRunId,
      event_key: `phase-e-playbooks:${context.targetDecisionId}`,
      label: "Factual account playbooks prepared",
      detail: `Compiled ${rowsToUpsert.length} factual account playbook${rowsToUpsert.length === 1 ? "" : "s"} referencing approved research claims, company signals, and selected contacts.`,
    },
    { onConflict: "graph_run_id,event_key" },
  );

  return readPeopleDiscoveryForConversation(session, context.conversationId);
}

export async function listWorkspaceContacts(
  session: WorkspaceSession,
): Promise<WorkspaceContactDirectoryItem[]> {
  if (session.kind === "demo") return [];

  const { data: contacts, error } = await session.client
    .from("contact_candidates")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .not("person_search_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not load workspace contact candidates.",
    );
  }

  const rows = (contacts ?? []) as Row[];
  if (rows.length === 0) return [];

  const conversationIds = Array.from(
    new Set(rows.map((row) => String(row.conversation_id)).filter(Boolean)),
  );
  const accountIds = Array.from(
    new Set(rows.map((row) => String(row.account_candidate_id)).filter(Boolean)),
  );

  const [convRes, accRes, searchRes] = await Promise.all([
    session.client
      .from("ano_conversations")
      .select("id, title")
      .eq("workspace_id", session.workspace.id)
      .in("id", conversationIds),
    session.client
      .from("account_candidates")
      .select("id, name, raw_snapshot")
      .eq("workspace_id", session.workspace.id)
      .in("id", accountIds),
    session.client
      .from("provider_company_searches")
      .select("conversation_id, scope_json")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", conversationIds),
  ]);

  if (convRes.error || accRes.error || searchRes.error) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not load account provenance for workspace people.",
    );
  }

  const titleByConversation = new Map(
    (convRes.data ?? []).map((item) => [String(item.id), String(item.title)]),
  );
  const accountsById = new Map(
    (accRes.data ?? []).map((item) => {
      const snap = asRecord(item.raw_snapshot);
      return [
        String(item.id),
        {
          name: String(item.name),
          domain: typeof snap.domain === "string" ? snap.domain : null,
        },
      ];
    }),
  );
  const routeByConversation = new Map(
    (searchRes.data ?? []).map((item) => {
      const scope = asRecord(item.scope_json);
      return [
        String(item.conversation_id),
        {
          market:
            typeof scope.targetMarketName === "string" && scope.targetMarketName
              ? scope.targetMarketName
              : "Locked market",
          industry:
            typeof scope.targetIndustryName === "string" && scope.targetIndustryName
              ? scope.targetIndustryName
              : "Locked industry",
        },
      ];
    }),
  );

  return rows.map((row) => {
    const contact = mapContactRow(row, accountsById);
    const route = routeByConversation.get(contact.conversationId) ?? {
      market: "Locked market",
      industry: "Locked industry",
    };
    return workspaceContactDirectoryItemSchema.parse({
      ...contact,
      conversationTitle:
        titleByConversation.get(contact.conversationId) ?? "Research conversation",
      targetMarketName: route.market,
      targetIndustryName: route.industry,
    });
  });
}

export async function listWorkspacePlaybooks(
  session: WorkspaceSession,
): Promise<WorkspacePlaybookDirectoryItem[]> {
  if (session.kind === "demo") return [];

  const { data: playbooks, error } = await session.client
    .from("account_playbooks")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not load workspace account playbooks.",
    );
  }

  const rows = (playbooks ?? []) as Row[];
  if (rows.length === 0) return [];

  const conversationIds = Array.from(
    new Set(rows.map((row) => String(row.conversation_id)).filter(Boolean)),
  );
  const accountIds = Array.from(
    new Set(rows.map((row) => String(row.account_candidate_id)).filter(Boolean)),
  );

  const [convRes, accRes, searchRes] = await Promise.all([
    session.client
      .from("ano_conversations")
      .select("id, title")
      .eq("workspace_id", session.workspace.id)
      .in("id", conversationIds),
    session.client
      .from("account_candidates")
      .select("id, name")
      .eq("workspace_id", session.workspace.id)
      .in("id", accountIds),
    session.client
      .from("provider_company_searches")
      .select("conversation_id, scope_json")
      .eq("workspace_id", session.workspace.id)
      .in("conversation_id", conversationIds),
  ]);

  if (convRes.error || accRes.error || searchRes.error) {
    throw new PeoplePlaybookPersistenceError(
      "Ano could not load metadata for workspace playbooks.",
    );
  }

  const titleByConversation = new Map(
    (convRes.data ?? []).map((item) => [String(item.id), String(item.title)]),
  );
  const accountNamesById = new Map(
    (accRes.data ?? []).map((item) => [String(item.id), String(item.name)]),
  );
  const routeByConversation = new Map(
    (searchRes.data ?? []).map((item) => {
      const scope = asRecord(item.scope_json);
      return [
        String(item.conversation_id),
        {
          market:
            typeof scope.targetMarketName === "string" && scope.targetMarketName
              ? scope.targetMarketName
              : "Locked market",
          industry:
            typeof scope.targetIndustryName === "string" && scope.targetIndustryName
              ? scope.targetIndustryName
              : "Locked industry",
        },
      ];
    }),
  );

  return rows.map((row) => {
    const cid = String(row.conversation_id);
    const route = routeByConversation.get(cid) ?? {
      market: "Locked market",
      industry: "Locked industry",
    };
    const playbook = mapPlaybookRow(row, accountNamesById, route.market, route.industry);
    return workspacePlaybookDirectoryItemSchema.parse({
      ...playbook,
      conversationTitle: titleByConversation.get(cid) ?? "Research conversation",
    });
  });
}

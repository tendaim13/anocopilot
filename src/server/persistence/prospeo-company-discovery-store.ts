import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import type { MarketAuditEvent, MarketBriefResult, ProviderReadiness } from "@/lib/ano/market-discovery";
import { checkProspeoAccount, ProspeoClientError, searchProspeoCompanies, suggestProspeoLocations, type ProspeoCompany } from "@/server/connectors/prospeo/prospeo-client";
import { CompanyDiscoveryBoundaryError, createProspeoCompanySearchPreview, selectCanonicalLocation, stableSearchHash } from "@/server/domain/prospeo-company-discovery";
import { loadMarketBriefContext, MarketDiscoveryPersistenceError, readMarketBrief } from "@/server/persistence/market-discovery-store";

export class ProspeoDiscoveryError extends Error {
  constructor(message: string, readonly code: string = "PROSPEO_DISCOVERY_FAILED") {
    super(message);
    this.name = "ProspeoDiscoveryError";
  }
}

function requireSupabaseSession(session: WorkspaceSession): SupabaseWorkspaceSession {
  if (session.kind === "demo") throw new ProspeoDiscoveryError("Sign in before Ano can use a workspace’s Prospeo connection.", "AUTH_REQUIRED");
  return session;
}

function safeCode(error: unknown) {
  return error instanceof ProspeoClientError ? error.code : "CONNECTION_FAILED";
}

function providerReady(checkedAt: string): ProviderReadiness {
  return {
    key: "prospeo",
    state: "ready",
    message: "Prospeo is checked and ready. Ano will show the exact one-page query and its maximum credit use before a company search can run.",
    action: "create_preview",
    checkedAt,
  };
}

async function saveConnection(session: SupabaseWorkspaceSession, status: "connected" | "error", checkedAt: string, lastErrorCode: string | null = null) {
  const { error } = await session.client.from("connector_connections").upsert({
    workspace_id: session.workspace.id,
    connector_key: "prospeo",
    status,
    scopes: ["search"],
    credential_reference: "server_env:PROSPEO_KEY",
    last_checked_at: checkedAt,
    last_error_code: lastErrorCode,
  }, { onConflict: "workspace_id,connector_key" });
  if (error) throw new ProspeoDiscoveryError("Ano could not save the Prospeo connection status.");
}

export async function checkProspeoConnection(session: WorkspaceSession) {
  const workspaceSession = requireSupabaseSession(session);
  const checkedAt = new Date().toISOString();
  try {
    const { account } = await checkProspeoAccount();
    await saveConnection(workspaceSession, "connected", checkedAt);
    await workspaceSession.client.from("audit_logs").insert({
      workspace_id: workspaceSession.workspace.id,
      actor_id: workspaceSession.actorId,
      event_type: "provider.prospeo.checked",
      outcome: "connected",
      details_json: { provider: "prospeo", credit_bearing_request: false, account_check: true },
    });
    return { provider: providerReady(checkedAt), account: { plan: account.plan, remainingCredits: account.remainingCredits, renewalDate: account.renewalDate, renewalDays: account.renewalDays } };
  } catch (error) {
    const code = safeCode(error);
    await saveConnection(workspaceSession, "error", checkedAt, code).catch(() => undefined);
    if (error instanceof ProspeoClientError) throw new ProspeoDiscoveryError(error.message, error.code);
    throw error;
  }
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hasReadyConnection(connection: { status?: unknown } | null) {
  return connection?.status === "connected";
}

async function appendRunEvent(
  session: SupabaseWorkspaceSession,
  result: MarketBriefResult,
  runId: string,
  label: string,
  detail: string,
  category: MarketAuditEvent["category"],
  checkpointState: string,
) {
  const timeline = [...result.timeline, { id: crypto.randomUUID(), at: new Date().toISOString(), label, detail, category }];
  const { error } = await session.client.from("research_runs").update({
    result_snapshot: { ...result, timeline },
    checkpoint: { phase: "company_discovery", state: checkpointState, version: 7, turn: 1, tool_calls: 0, runtime: "standalone_market_discovery" },
    heartbeat_at: new Date().toISOString(),
  }).eq("id", runId).eq("workspace_id", session.workspace.id);
  if (error) throw new ProspeoDiscoveryError("Ano could not checkpoint the company-discovery step.");
}

export async function prepareProspeoCompanySearch(session: WorkspaceSession, productBriefId: string) {
  const workspaceSession = requireSupabaseSession(session);
  const context = await loadMarketBriefContext(workspaceSession, productBriefId);
  if (context.result.scope.state !== "awaiting_provider_approval" || context.result.scope.kind !== "location") {
    throw new ProspeoDiscoveryError("Lock a location scope before Ano can prepare a company-search preview.", "SCOPE_REQUIRED");
  }
  const { data: connection, error: connectionError } = await workspaceSession.client.from("connector_connections").select("status").eq("workspace_id", workspaceSession.workspace.id).eq("connector_key", "prospeo").maybeSingle();
  if (connectionError) throw new ProspeoDiscoveryError("Ano could not confirm the Prospeo connection state.");
  if (!hasReadyConnection(connection)) throw new ProspeoDiscoveryError("Check the Prospeo connection before Ano can prepare a company-search preview.", "CONNECTION_REQUIRED");

  const { data: existing, error: existingError } = await workspaceSession.client.from("provider_company_searches").select("id").eq("workspace_id", workspaceSession.workspace.id).eq("research_run_id", context.run.id).maybeSingle();
  if (existingError) throw new ProspeoDiscoveryError("Ano could not read the existing company-search preview.");
  if (existing) return { result: await readMarketBrief(workspaceSession, productBriefId), message: "Ano already prepared this run’s company-search preview. It has not created a second provider request." };

  let canonicalLocations: string[];
  try {
    canonicalLocations = await Promise.all(context.result.scope.locations.map(async (location) => {
      const suggestions = await suggestProspeoLocations(location);
      const canonical = selectCanonicalLocation(location, suggestions);
      if (!canonical) throw new CompanyDiscoveryBoundaryError(`Prospeo could not verify the location “${location}”.`);
      return canonical;
    }));
  } catch (error) {
    if (error instanceof ProspeoClientError || error instanceof CompanyDiscoveryBoundaryError) throw new ProspeoDiscoveryError(error.message, error instanceof ProspeoClientError ? error.code : "LOCATION_UNRESOLVED");
    throw error;
  }

  const searchId = crypto.randomUUID();
  const preview = createProspeoCompanySearchPreview(searchId, context.result.scope, canonicalLocations);
  const { error: insertError } = await workspaceSession.client.from("provider_company_searches").insert({
    id: preview.id,
    workspace_id: workspaceSession.workspace.id,
    research_run_id: context.run.id,
    product_brief_id: productBriefId,
    request_hash: stableSearchHash(context.result.scope, canonicalLocations),
    scope_json: { locations: preview.scope },
    filters_json: preview.providerFilters,
    criteria_json: preview.criteria,
    canonical_locations_json: preview.canonicalLocations,
    maximum_results: preview.maximumResults,
    estimated_max_credits: preview.estimatedMaximumCredits,
    status: "awaiting_approval",
    provider_receipt_json: { suggestion_requests: canonicalLocations.length, credit_bearing_request: false },
  });
  if (insertError) throw new ProspeoDiscoveryError("Ano could not save the company-search preview.");
  const { error: scanError } = await workspaceSession.client.from("market_scans").update({ status: "preview_ready" }).eq("workspace_id", workspaceSession.workspace.id).eq("research_run_id", context.run.id);
  if (scanError) throw new ProspeoDiscoveryError("Ano could not save the market-scan preview state.");
  await workspaceSession.client.from("audit_logs").insert({
    workspace_id: workspaceSession.workspace.id,
    research_run_id: context.run.id,
    actor_id: workspaceSession.actorId,
    event_type: "provider.prospeo.preview_prepared",
    outcome: "awaiting_approval",
    details_json: { provider: "prospeo", locations: canonicalLocations, suggestion_requests: canonicalLocations.length, credit_bearing_request: false, estimated_max_credits: 1 },
  });
  await appendRunEvent(workspaceSession, context.result, context.run.id, "Company search preview prepared", `Ano verified the selected location values with Prospeo’s free suggestion service. The one-page query is waiting for your explicit approval; no company search was run.`, "boundary", "awaiting_provider_approval");
  return { result: await readMarketBrief(workspaceSession, productBriefId), message: "Search preview ready. No Prospeo company search has run and no search credit has been spent." };
}

function companyLocation(company: ProspeoCompany) {
  return [company.location?.city, company.location?.state, company.location?.country].filter(Boolean).join(", ") || undefined;
}

function matchingSignals(company: ProspeoCompany, canonicalLocations: string[]) {
  const signals = [`Returned by Prospeo for the approved location scope: ${canonicalLocations.join(", ")}`];
  if (company.industry) signals.push(`Industry listed by Prospeo: ${company.industry}`);
  if (company.employeeRange) signals.push(`Employee range listed by Prospeo: ${company.employeeRange}`);
  return signals;
}

async function persistCandidates(session: SupabaseWorkspaceSession, runId: string, companies: ProspeoCompany[], canonicalLocations: string[], capturedAt: string) {
  const drafts = companies.map((company, index) => {
    const evidenceKey = `P-${String(index + 1).padStart(3, "0")}`;
    const signals = matchingSignals(company, canonicalLocations);
    return {
      source_key: `prospeo:${company.id}`,
      name: company.name,
      industry: company.industry ?? null,
      location: companyLocation(company) ?? null,
      employee_band: company.employeeRange ?? null,
      lifecycle_state: "discovered",
      source_label: "provider",
      raw_snapshot: {
        provider: "prospeo",
        providerCompanyId: company.id,
        website: company.website,
        domain: company.domain,
        linkedInUrl: company.linkedInUrl,
        employeeCount: company.employeeCount,
        description: company.description,
        matchingSignals: signals,
        evidenceIds: [evidenceKey],
        retrievedAt: capturedAt,
      },
      workspace_id: session.workspace.id,
      research_run_id: runId,
    };
  });
  if (drafts.length === 0) return;
  const { data: saved, error: candidateError } = await session.client.from("account_candidates").upsert(drafts, { onConflict: "workspace_id,research_run_id,source_key" }).select("id, source_key, name, industry, location, employee_band, raw_snapshot");
  if (candidateError || !saved) throw new ProspeoDiscoveryError("Ano could not save the returned company candidates.");
  const rows = saved as Array<{ id: string; source_key: string; name: string; industry: string | null; location: string | null; employee_band: string | null; raw_snapshot: Record<string, unknown> }>;
  const evidence = rows.map((candidate, index) => ({
    workspace_id: session.workspace.id,
    research_run_id: runId,
    account_candidate_id: candidate.id,
    evidence_key: `P-${String(index + 1).padStart(3, "0")}`,
    source_name: "Prospeo company search",
    source_kind: "provider",
    source_reference: candidate.source_key,
    observation: `Prospeo returned ${candidate.name}${candidate.industry ? ` in ${candidate.industry}` : ""}${candidate.location ? `, located in ${candidate.location}` : ""} for Ano’s approved location query.`,
    captured_at: capturedAt,
    is_simulated: false,
  }));
  const { error: evidenceError } = await session.client.from("evidence_items").upsert(evidence, { onConflict: "workspace_id,research_run_id,evidence_key" });
  if (evidenceError) throw new ProspeoDiscoveryError("Ano could not save provenance for the returned companies.");
}

async function currentSearch(session: SupabaseWorkspaceSession, searchId: string) {
  const { data, error } = await session.client.from("provider_company_searches").select("id, research_run_id, product_brief_id, status, filters_json, canonical_locations_json").eq("workspace_id", session.workspace.id).eq("id", searchId).maybeSingle();
  if (error || !data) throw new ProspeoDiscoveryError("Ano could not find that company-search preview.", "SEARCH_NOT_FOUND");
  return data as { id: string; research_run_id: string; product_brief_id: string; status: string; filters_json: Record<string, unknown>; canonical_locations_json: unknown };
}

export async function approveProspeoCompanySearch(session: WorkspaceSession, searchId: string) {
  const workspaceSession = requireSupabaseSession(session);
  const beforeClaim = await currentSearch(workspaceSession, searchId);
  if (beforeClaim.status === "completed") return { result: await readMarketBrief(workspaceSession, beforeClaim.product_brief_id), message: "This approved search is already complete. Ano did not send a duplicate request." };
  if (beforeClaim.status !== "awaiting_approval") return { result: await readMarketBrief(workspaceSession, beforeClaim.product_brief_id), message: "Ano will not retry this provider request automatically. Review its saved outcome before creating a new research run." };

  const startedAt = new Date().toISOString();
  const { data: claim, error: claimError } = await workspaceSession.client.from("provider_company_searches").update({ status: "running", approved_by: workspaceSession.actorId, approved_at: startedAt, started_at: startedAt }).eq("workspace_id", workspaceSession.workspace.id).eq("id", searchId).eq("status", "awaiting_approval").select("id").maybeSingle();
  if (claimError) throw new ProspeoDiscoveryError("Ano could not secure the approved company search.");
  if (!claim) return { result: await readMarketBrief(workspaceSession, beforeClaim.product_brief_id), message: "Ano detected another request handling this preview and did not send a duplicate provider request." };

  await workspaceSession.client.from("market_scans").update({ status: "search_in_progress" }).eq("workspace_id", workspaceSession.workspace.id).eq("research_run_id", beforeClaim.research_run_id);
  const canonicalLocations = asStringArray(beforeClaim.canonical_locations_json);
  try {
    const providerResult = await searchProspeoCompanies(beforeClaim.filters_json);
    const completedAt = new Date().toISOString();
    await persistCandidates(workspaceSession, beforeClaim.research_run_id, providerResult.companies, canonicalLocations, completedAt);
    const { error: completeError } = await workspaceSession.client.from("provider_company_searches").update({
      status: "completed",
      completed_at: completedAt,
      result_count: providerResult.companies.length,
      provider_receipt_json: { free: providerResult.free, result_count: providerResult.companies.length, total_count: providerResult.totalCount, rate_limit: providerResult.rateLimit, credit_bearing_request: true },
    }).eq("workspace_id", workspaceSession.workspace.id).eq("id", searchId).eq("status", "running");
    if (completeError) throw new ProspeoDiscoveryError("Ano received company data but could not save the provider receipt. It will not retry automatically.");
    await workspaceSession.client.from("market_scans").update({ status: "completed", evidence_ids: providerResult.companies.map((_, index) => `P-${String(index + 1).padStart(3, "0")}`) }).eq("workspace_id", workspaceSession.workspace.id).eq("research_run_id", beforeClaim.research_run_id);
    await workspaceSession.client.from("audit_logs").insert({
      workspace_id: workspaceSession.workspace.id,
      research_run_id: beforeClaim.research_run_id,
      actor_id: workspaceSession.actorId,
      event_type: "provider.prospeo.company_search_completed",
      outcome: "completed",
      details_json: { provider: "prospeo", result_count: providerResult.companies.length, free: providerResult.free, credit_bearing_request: true },
    });
    const context = await loadMarketBriefContext(workspaceSession, beforeClaim.product_brief_id);
    await appendRunEvent(workspaceSession, context.result, beforeClaim.research_run_id, "Company search completed", `Prospeo returned ${providerResult.companies.length} companies from one approved page. Ano has not searched for people, enriched contacts, created CRM records, or started outreach.`, "input", "completed");
    return { result: await readMarketBrief(workspaceSession, beforeClaim.product_brief_id), message: providerResult.companies.length ? `Ano saved ${providerResult.companies.length} companies from the approved Prospeo page.` : "Prospeo returned no companies for this approved query." };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const noResults = error instanceof ProspeoClientError && error.code === "NO_RESULTS";
    const status = noResults ? "completed" : "requires_manual_review";
    const message = noResults ? "Prospeo returned no companies for this approved query." : error instanceof ProspeoClientError ? error.message : "Ano could not complete the approved Prospeo search.";
    await workspaceSession.client.from("provider_company_searches").update({
      status,
      completed_at: completedAt,
      result_count: noResults ? 0 : null,
      failure_code: noResults ? null : safeCode(error),
      failure_message: noResults ? null : message,
      provider_receipt_json: { credit_bearing_request: true, outcome: noResults ? "no_results" : "manual_review_required" },
    }).eq("workspace_id", workspaceSession.workspace.id).eq("id", searchId).eq("status", "running");
    await workspaceSession.client.from("market_scans").update({ status: noResults ? "completed" : "requires_manual_review" }).eq("workspace_id", workspaceSession.workspace.id).eq("research_run_id", beforeClaim.research_run_id);
    await workspaceSession.client.from("audit_logs").insert({
      workspace_id: workspaceSession.workspace.id,
      research_run_id: beforeClaim.research_run_id,
      actor_id: workspaceSession.actorId,
      event_type: "provider.prospeo.company_search_finished",
      outcome: noResults ? "no_results" : "requires_manual_review",
      details_json: { provider: "prospeo", credit_bearing_request: true, error_code: noResults ? null : safeCode(error) },
    });
    const context = await loadMarketBriefContext(workspaceSession, beforeClaim.product_brief_id);
    await appendRunEvent(workspaceSession, context.result, beforeClaim.research_run_id, noResults ? "Company search completed with no matches" : "Company search stopped for review", noResults ? "Prospeo returned no companies. Ano did not retry or change the query." : "Ano could not safely determine the outcome of the provider request, so it did not retry it.", "boundary", status);
    return { result: await readMarketBrief(workspaceSession, beforeClaim.product_brief_id), message };
  }
}

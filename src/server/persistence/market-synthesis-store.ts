import "server-only";

import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import { isOpenMarketRecommendationIntent } from "@/lib/ano/autopilot";
import { resolveSourceProvenance, type SourceEvidenceRole, type SourceProvenance } from "@/lib/ano/evidence-research";
import {
  buildStructuredSynthesisReport,
  evidenceAssessmentSchema,
  evidenceGroupSummarySchema,
  lockTargetDecisionInputSchema,
  marketSynthesisSchema,
  recommendationModeSchema,
  synthesisReportSchema,
  type EvidenceAssessment,
  type EvidenceGroupSummary,
  type LockTargetDecisionInput,
  type MarketSynthesis,
  type MarketSynthesisDraft,
  type RecommendationMode,
  type SynthesisStatus,
} from "@/lib/ano/market-synthesis";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import { MarketSynthesisModelError, type SynthesisSource } from "@/server/agents/market-synthesis-model";
import type { ResearchCoverage } from "@/server/research/deep-research-assessment";

export class MarketSynthesisPersistenceError extends Error {
  constructor(message: string, readonly code: string = "MARKET_SYNTHESIS_UNAVAILABLE") {
    super(message);
    this.name = "MarketSynthesisPersistenceError";
  }
}

type Row = Record<string, unknown>;

const SYNTHESIS_LEASE_TIMEOUT_MS = 90_000;

function requireLiveSession(session: WorkspaceSession): asserts session is SupabaseWorkspaceSession {
  if (session.kind === "demo") throw new MarketSynthesisPersistenceError("Sign in before Ano can create durable evidence synthesis.", "AUTH_REQUIRED");
}

function text(value: unknown, maximum = 700) {
  const result = String(value ?? "").replace(/\u0000/g, "").trim().replace(/\s+/g, " ");
  return result ? result.slice(0, maximum) : null;
}

function strings(value: unknown, maximum: number) {
  return Array.isArray(value) ? value.map((item) => text(item, 280)).filter((item): item is string => Boolean(item)).slice(0, maximum) : [];
}

function iso(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new MarketSynthesisPersistenceError("Ano found an invalid market-synthesis timestamp.");
  return date.toISOString();
}

function strengthFor(sourceCount: number, sourceClassCount: number): EvidenceAssessment["coverageStrength"] {
  if (sourceCount < 3) return "insufficient";
  if (sourceClassCount < 2) return "limited";
  if (sourceCount >= 10 && sourceClassCount >= 3) return "strong";
  return "moderate";
}

function hasLockableRoute(draft: MarketSynthesisDraft) {
  if (draft.markets.length === 0 || draft.industries.length === 0) return false;
  const marketIds = new Set(draft.markets.map((market) => market.id));
  return draft.industries.some(
    (industry) => !industry.marketProfileId || marketIds.has(industry.marketProfileId),
  );
}

function recommendationModeFor(assessment: EvidenceAssessment, draft: MarketSynthesisDraft, sources: SynthesisSource[]): RecommendationMode {
  if (sources.length === 0) return "no_usable_evidence";
  if (assessment.comparisonReady && hasLockableRoute(draft)) return "directly_supported";
  if (draft.claims.some((claim) => claim.kind === "comparable")) return "comparative_inference";
  return "exploratory";
}

export function assessSourceLedger(sources: SynthesisSource[], missionCoverage?: ResearchCoverage | null): EvidenceAssessment {
  const nonWorkspacePublic = sources.filter(
    (source) => (source.sourceProvenance ?? "public_web") !== "workspace_supplied",
  );
  const nonVendorPublic = nonWorkspacePublic.filter((source) => source.sourceClass !== "vendor");
  const sourceClasses = new Set(nonVendorPublic.map((source) => source.sourceClass));
  const sourceCount = sources.length;
  const publicSourceCount = nonWorkspacePublic.length;
  const qualifyingCount = nonVendorPublic.length;
  const sourceClassCount = sourceClasses.size;
  const coverageStrength = strengthFor(qualifyingCount, sourceClassCount);
  const gaps: string[] = [];
  if (sourceCount > 0 && publicSourceCount === 0) {
    gaps.push(
      "Saved items come from workspace uploads rather than external public research; conclusions remain exploratory.",
    );
  } else if (qualifyingCount < 3) {
    gaps.push(
      "Direct comparison coverage is limited because fewer than three non-vendor public sources are available.",
    );
  }
  if (sourceClassCount < 2) {
    gaps.push(
      "The current evidence comes from one source class, so Ano will label any route as exploratory unless comparable evidence supports it.",
    );
  }
  const noPublishedDate = nonWorkspacePublic.filter((source) => !source.publishedAt).length;
  if (noPublishedDate) {
    gaps.push(`${noPublishedDate} saved source${noPublishedDate === 1 ? " has" : "s have"} no published date, so freshness is limited.`);
  }
  if (missionCoverage) gaps.push(...missionCoverage.gaps);
  return evidenceAssessmentSchema.parse({
    fetchedSourceCount: sourceCount,
    sourceClassCount,
    coverageStrength,
    comparisonReady: missionCoverage
      ? missionCoverage.comparisonReady
      : qualifyingCount >= 3 && sourceClassCount >= 2,
    contradictions: [],
    // The persisted assessment is intentionally concise. Deep research may
    // identify more gaps than the review card can use; retain a stable,
    // de-duplicated first six instead of rejecting the entire analysis.
    gaps: Array.from(new Set(gaps)).slice(0, 6),
    sourcesAnalyzedCount: sourceCount,
    summary: sourceCount
      ? missionCoverage
        ? `Ano has ${missionCoverage.qualifyingSourceCount} decision-relevant excerpts across ${missionCoverage.sourceClassCount} source classes for a comparative market study.`
        : qualifyingCount > 0
          ? `Ano has ${qualifyingCount} public research excerpt${qualifyingCount === 1 ? "" : "s"} across ${sourceClassCount} source class${sourceClassCount === 1 ? "" : "es"}.`
          : `Ano saved ${sourceCount} workspace reference${sourceCount === 1 ? "" : "s"}; external public market evidence is still limited.`
      : "Ano has no retrievable source excerpts to assess.",
  });
}

export function auditMarketSynthesisDraft(draft: MarketSynthesisDraft, sources: SynthesisSource[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const claimIds = new Set<string>();
  const restrictedClaimIds = new Set<string>();
  for (const claim of draft.claims) {
    if (claimIds.has(claim.id)) throw new MarketSynthesisPersistenceError("Ano rejected a duplicate evidence claim before saving it.", "CITATION_AUDIT_FAILED");
    claimIds.add(claim.id);
    if (claim.sourceIds.some((sourceId) => !sourceById.has(sourceId))) {
      throw new MarketSynthesisPersistenceError("Ano rejected a claim that cited a source outside the saved evidence ledger.", "CITATION_AUDIT_FAILED");
    }
    if (claim.kind === "comparable" && !claim.comparisonBasis) {
      throw new MarketSynthesisPersistenceError("Ano rejected comparable evidence without a stated basis for the comparison.", "CITATION_AUDIT_FAILED");
    }
    const citedSources = claim.sourceIds.map((id) => sourceById.get(id)!);
    const onlyVendor =
      citedSources.length > 0 && citedSources.every((source) => source.sourceClass === "vendor");
    const onlyWorkspace =
      citedSources.length > 0 &&
      citedSources.every((source) => source.sourceProvenance === "workspace_supplied");
    if (onlyVendor && (claim.kind === "observation" || claim.kind === "comparable" || claim.evidenceStrength === "strong" || claim.evidenceStrength === "moderate")) {
      throw new MarketSynthesisPersistenceError("Ano rejected vendor sources acting as direct demand proof rather than contextual or counter-evidence.", "CITATION_AUDIT_FAILED");
    }
    if (onlyWorkspace && (claim.kind === "observation" || claim.evidenceStrength === "strong" || claim.evidenceStrength === "moderate")) {
      throw new MarketSynthesisPersistenceError("Ano rejected workspace-supplied context labeled as direct public market evidence.", "CITATION_AUDIT_FAILED");
    }
    if (onlyVendor || onlyWorkspace) {
      restrictedClaimIds.add(claim.id);
    }
  }
  const marketIds = new Set<string>();
  for (const market of draft.markets) {
    if (marketIds.has(market.id)) throw new MarketSynthesisPersistenceError("Ano rejected duplicate market profiles before saving them.", "CITATION_AUDIT_FAILED");
    marketIds.add(market.id);
    if (market.claimIds.some((claimId) => !claimIds.has(claimId))) {
      throw new MarketSynthesisPersistenceError("Ano rejected a market profile with an unverified claim reference.", "CITATION_AUDIT_FAILED");
    }
    if (
      (market.evidenceStrength === "strong" || market.evidenceStrength === "moderate") &&
      market.claimIds.every((claimId) => restrictedClaimIds.has(claimId))
    ) {
      throw new MarketSynthesisPersistenceError("Ano rejected a market strength rating supported solely by vendor or workspace sources.", "CITATION_AUDIT_FAILED");
    }
  }
  const industryIds = new Set<string>();
  for (const industry of draft.industries) {
    if (industryIds.has(industry.id)) throw new MarketSynthesisPersistenceError("Ano rejected duplicate industry profiles before saving them.", "CITATION_AUDIT_FAILED");
    industryIds.add(industry.id);
    if (industry.marketProfileId && !marketIds.has(industry.marketProfileId)) {
      throw new MarketSynthesisPersistenceError("Ano rejected an industry profile with an unknown market reference.", "CITATION_AUDIT_FAILED");
    }
    if (industry.claimIds.some((claimId) => !claimIds.has(claimId))) {
      throw new MarketSynthesisPersistenceError("Ano rejected an industry profile with an unverified claim reference.", "CITATION_AUDIT_FAILED");
    }
    if (
      (industry.evidenceStrength === "strong" || industry.evidenceStrength === "moderate") &&
      industry.claimIds.every((claimId) => restrictedClaimIds.has(claimId))
    ) {
      throw new MarketSynthesisPersistenceError("Ano rejected an industry strength rating supported solely by vendor or workspace sources.", "CITATION_AUDIT_FAILED");
    }
  }
  if (draft.groupSummaries?.length) {
    const coveredSourceIds = new Set<string>();
    for (const group of draft.groupSummaries) {
      for (const sourceId of group.sourceIds) {
        if (!sourceById.has(sourceId)) {
          throw new MarketSynthesisPersistenceError("Ano rejected a group summary that cited a source outside the saved evidence ledger.", "CITATION_AUDIT_FAILED");
        }
        coveredSourceIds.add(sourceId);
      }
      for (const finding of group.findings) {
        if (finding.sourceIds.some((sourceId) => !sourceById.has(sourceId))) {
          throw new MarketSynthesisPersistenceError("Ano rejected a group finding that cited a source outside the saved evidence ledger.", "CITATION_AUDIT_FAILED");
        }
        if (finding.kind === "comparable" && !finding.comparisonBasis) {
          throw new MarketSynthesisPersistenceError("Ano rejected comparable group evidence without a stated comparison basis.", "CITATION_AUDIT_FAILED");
        }
        const cited = finding.sourceIds.map((id) => sourceById.get(id)!);
        const onlyVendor = cited.length > 0 && cited.every((s) => s.sourceClass === "vendor");
        const onlyWorkspace =
          cited.length > 0 && cited.every((s) => s.sourceProvenance === "workspace_supplied");
        if (
          onlyVendor &&
          (finding.kind === "observation" ||
            finding.kind === "comparable" ||
            finding.evidenceStrength === "strong" ||
            finding.evidenceStrength === "moderate")
        ) {
          throw new MarketSynthesisPersistenceError(
            "Ano rejected vendor group findings acting as direct demand proof rather than contextual or counter-evidence.",
            "CITATION_AUDIT_FAILED",
          );
        }
        if (
          onlyWorkspace &&
          (finding.kind === "observation" ||
            finding.evidenceStrength === "strong" ||
            finding.evidenceStrength === "moderate")
        ) {
          throw new MarketSynthesisPersistenceError(
            "Ano rejected workspace-supplied group findings labeled as direct public market evidence.",
            "CITATION_AUDIT_FAILED",
          );
        }
      }
    }
    if (sources.some((source) => !coveredSourceIds.has(source.id))) {
      throw new MarketSynthesisPersistenceError(
        "Ano rejected an incomplete map-reduce summary that omitted saved evidence sources.",
        "CITATION_AUDIT_FAILED",
      );
    }
  }
  if (draft.report) {
    for (const item of [...draft.report.evidence, ...draft.report.comparableEvidence]) {
      if (item.sourceIds.some((sourceId) => !sourceById.has(sourceId))) {
        throw new MarketSynthesisPersistenceError(
          "Ano rejected a report citation outside the saved evidence ledger.",
          "CITATION_AUDIT_FAILED",
        );
      }
    }
    for (const item of draft.report.evidence) {
      const cited = item.sourceIds.map((id) => sourceById.get(id)!);
      const onlyRestricted =
        cited.length > 0 &&
        (cited.every((s) => s.sourceClass === "vendor") ||
          cited.every((s) => s.sourceProvenance === "workspace_supplied"));
      if (onlyRestricted) {
        throw new MarketSynthesisPersistenceError(
          "Ano rejected vendor or workspace-only entries inside direct report evidence.",
          "CITATION_AUDIT_FAILED",
        );
      }
    }
  }
}

async function runForConversation(session: SupabaseWorkspaceSession, conversationId: string) {
  const { data, error } = await session.client
    .from("ano_research_runs")
    .select("id, graph_run_id, status, coverage_json")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new MarketSynthesisPersistenceError("Ano could not find saved public evidence for this conversation.", "RESEARCH_RUN_NOT_FOUND");
  if (data.status !== "sources_ready") throw new MarketSynthesisPersistenceError("Ano needs a completed public-evidence run before it can assess the market.", "SOURCES_NOT_READY");
  return data as Row;
}

export async function loadSynthesisSources(session: WorkspaceSession, conversationId: string): Promise<{ researchRunId: string; graphRunId: string; sources: SynthesisSource[]; missionCoverage: ResearchCoverage | null }> {
  requireLiveSession(session);
  const run = await runForConversation(session, conversationId);
  const runId = String(run.id);
  const [sourcesResult, assessmentsResult, searchResultsResult, queriesResult] = await Promise.all([
    session.client
      .from("research_sources")
      .select(
        "id, search_result_id, title, canonical_url, source_class, source_provenance, root_domain, duplicate_of_source_id, supporting_excerpt, published_at",
      )
      .eq("workspace_id", session.workspace.id)
      .eq("ano_research_run_id", runId)
      .eq("status", "fetched")
      .not("supporting_excerpt", "is", null)
      .order("retrieved_at", { ascending: false })
      .limit(100),
    session.client
      .from("research_source_assessments")
      .select("research_source_id, overall_score, assessment_json")
      .eq("workspace_id", session.workspace.id)
      .eq("ano_research_run_id", runId),
    session.client
      .from("research_search_results")
      .select("id, research_query_id")
      .eq("workspace_id", session.workspace.id)
      .eq("ano_research_run_id", runId),
    session.client
      .from("research_queries")
      .select("id, candidate_market, comparison_dimension")
      .eq("workspace_id", session.workspace.id)
      .eq("ano_research_run_id", runId),
  ]);
  if (sourcesResult.error) throw new MarketSynthesisPersistenceError("Ano could not read the stored source excerpts.");
  if (assessmentsResult.error) throw new MarketSynthesisPersistenceError("Ano could not read evidence-quality assessments.");

  const allSourceRows = sourcesResult.data ?? [];
  const nonDuplicateRows = allSourceRows.filter((row) => !row.duplicate_of_source_id);
  const sourceRows = nonDuplicateRows.length > 0 ? nonDuplicateRows : allSourceRows;

  const scoreBySource = new Map<string, number>();
  const roleBySource = new Map<string, SourceEvidenceRole>();
  for (const assessment of assessmentsResult.data ?? []) {
    const srcId = String(assessment.research_source_id);
    scoreBySource.set(srcId, Number(assessment.overall_score));
    const json = (assessment.assessment_json ?? {}) as Record<string, unknown>;
    const rawRole = typeof json.evidenceRole === "string" ? json.evidenceRole : null;
    if (
      rawRole === "direct_evidence" ||
      rawRole === "comparable_evidence" ||
      rawRole === "contextual_counter_only" ||
      rawRole === "non_qualifying"
    ) {
      roleBySource.set(srcId, rawRole);
    }
  }

  const queryIdBySearchResultId = new Map<string, string>();
  if (!searchResultsResult.error) {
    for (const row of searchResultsResult.data ?? []) {
      if (row.research_query_id) {
        queryIdBySearchResultId.set(String(row.id), String(row.research_query_id));
      }
    }
  }

  const queryMetaById = new Map<string, { candidateMarket: string | null; comparisonDimension: string | null }>();
  if (!queriesResult.error) {
    for (const row of queriesResult.data ?? []) {
      queryMetaById.set(String(row.id), {
        candidateMarket: row.candidate_market ? text(row.candidate_market, 140) : null,
        comparisonDimension: row.comparison_dimension ? String(row.comparison_dimension) : null,
      });
    }
  }

  const ranked = sourceRows
    .map((source) => {
      const url = String(source.canonical_url ?? "");
      const provenance = resolveSourceProvenance({
        url,
        sourceProvenance:
          typeof source.source_provenance === "string"
            ? (source.source_provenance as SourceProvenance)
            : undefined,
      });
      const provenanceBoost = provenance === "workspace_supplied" ? -100 : provenance === "comparable_evidence" ? -10 : 0;
      const vendorPenalty = String(source.source_class) === "vendor" ? -30 : 0;
      const score = scoreBySource.get(String(source.id)) ?? 0;
      const queryId = source.search_result_id
        ? queryIdBySearchResultId.get(String(source.search_result_id))
        : undefined;
      const queryMeta = queryId ? queryMetaById.get(queryId) : undefined;
      return {
        source,
        provenance,
        evidenceRole: roleBySource.get(String(source.id)),
        candidateMarket: queryMeta?.candidateMarket ?? null,
        comparisonDimension: queryMeta?.comparisonDimension ?? null,
        rootDomain: source.root_domain ? String(source.root_domain) : null,
        score,
        rankScore: score + provenanceBoost + vendorPenalty,
      };
    })
    .sort((left, right) => right.rankScore - left.rankScore);

  // Retain ALL non-duplicate fetched sources so map-reduce synthesis never silently drops evidence.
  const sources: SynthesisSource[] = ranked
    .map(({ source, provenance, evidenceRole, candidateMarket, comparisonDimension, rootDomain, score }) => ({
      id: String(source.id),
      title: text(source.title, 500) ?? "Untitled source",
      sourceClass: source.source_class as SynthesisSource["sourceClass"],
      sourceProvenance: provenance,
      ...(evidenceRole ? { evidenceRole } : {}),
      candidateMarket,
      comparisonDimension,
      rootDomain,
      excerpt: text(source.supporting_excerpt, 1_200) ?? "",
      publishedAt: source.published_at ? iso(source.published_at) : null,
      evidenceScore: score,
    }))
    .filter((source) => Boolean(source.excerpt));

  const rawCoverage = run.coverage_json;
  const missionCoverage = rawCoverage && typeof rawCoverage === "object" && Array.isArray((rawCoverage as Record<string, unknown>).cells)
    ? rawCoverage as ResearchCoverage
    : null;
  return { researchRunId: runId, graphRunId: String(run.graph_run_id), sources, missionCoverage };
}

async function synthesisRow(session: SupabaseWorkspaceSession, conversationId: string) {
  const { data, error } = await session.client
    .from("ano_research_syntheses")
    .select("id, conversation_id, ano_research_run_id, status, recommendation_mode, assessment_json, group_summaries_json, report_json, failure_message, heartbeat_at, created_at, updated_at")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new MarketSynthesisPersistenceError("Ano could not read the evidence synthesis.");
  return data ? data as Row : null;
}

async function recoverExpiredSynthesisLease(session: SupabaseWorkspaceSession, synthesis: Row) {
  if (String(synthesis.status) !== "running") return synthesis;
  const heartbeat = new Date(String(synthesis.heartbeat_at ?? synthesis.updated_at)).getTime();
  if (!Number.isFinite(heartbeat) || Date.now() - heartbeat <= SYNTHESIS_LEASE_TIMEOUT_MS) return synthesis;
  const message = "Ano's evidence-analysis worker stopped before it could confirm the saved synthesis. No web search, company lookup, or sales action was attempted. You can explicitly analyze the same saved evidence again.";
  const { data, error } = await session.client.from("ano_research_syntheses").update({
    status: "requires_manual_review",
    failure_message: message,
    completed_at: new Date().toISOString(),
    heartbeat_at: null,
  }).eq("workspace_id", session.workspace.id).eq("id", synthesis.id).eq("status", "running").select("id").maybeSingle();
  if (error) throw new MarketSynthesisPersistenceError("Ano could not preserve the interrupted evidence analysis.", "LEASE_RECOVERY_NOT_SAVED");
  if (!data) return (await synthesisRow(session, String(synthesis.conversation_id))) ?? synthesis;
  const run = await runForConversation(session, String(synthesis.conversation_id));
  await session.client.from("run_events").upsert({
    workspace_id: session.workspace.id,
    graph_run_id: String(run.graph_run_id),
    event_key: `phase-c-lease-expired:${synthesis.id}`,
    label: "Evidence analysis paused after an interruption",
    detail: "Ano preserved the saved evidence and did not retry the interrupted model request automatically. A new analysis requires an explicit user action.",
  }, { onConflict: "graph_run_id,event_key" });
  return (await synthesisRow(session, String(synthesis.conversation_id))) ?? synthesis;
}

async function hasPartialSynthesis(session: SupabaseWorkspaceSession, synthesisId: string) {
  const checks = await Promise.all([
    session.client.from("research_claims").select("id", { count: "exact", head: true }).eq("workspace_id", session.workspace.id).eq("synthesis_id", synthesisId),
    session.client.from("market_profiles").select("id", { count: "exact", head: true }).eq("workspace_id", session.workspace.id).eq("synthesis_id", synthesisId),
    session.client.from("industry_profiles").select("id", { count: "exact", head: true }).eq("workspace_id", session.workspace.id).eq("synthesis_id", synthesisId),
    session.client.from("target_decisions").select("id", { count: "exact", head: true }).eq("workspace_id", session.workspace.id).eq("synthesis_id", synthesisId),
  ]);
  if (checks.some((result) => result.error)) throw new MarketSynthesisPersistenceError("Ano could not inspect the previous evidence synthesis safely.");
  return checks.some((result) => (result.count ?? 0) > 0);
}

export async function readMarketSynthesis(session: WorkspaceSession, conversationId: string): Promise<MarketSynthesis | null> {
  requireLiveSession(session);
  const existing = await synthesisRow(session, conversationId);
  const synthesis = existing ? await recoverExpiredSynthesisLease(session, existing) : null;
  if (!synthesis) return null;
  const synthesisId = String(synthesis.id);
  const [claimsResult, marketsResult, industriesResult, decisionResult] = await Promise.all([
    session.client.from("research_claims").select("id, claim_kind, statement, source_ids, comparison_basis, evidence_strength, citation_status").eq("workspace_id", session.workspace.id).eq("synthesis_id", synthesisId).order("created_at", { ascending: true }),
    session.client.from("market_profiles").select("id, name, summary, evidence_strength, claim_ids, unknowns_json, next_research_actions_json").eq("workspace_id", session.workspace.id).eq("synthesis_id", synthesisId).order("created_at", { ascending: true }),
    session.client.from("industry_profiles").select("id, market_profile_id, name, summary, operational_problems_json, solution_fit_json, buyer_role_hypotheses_json, evidence_strength, claim_ids, unknowns_json").eq("workspace_id", session.workspace.id).eq("synthesis_id", synthesisId).order("created_at", { ascending: true }),
    session.client.from("target_decisions").select("id, status, market_profile_id, industry_profile_id, rationale, selected_at").eq("workspace_id", session.workspace.id).eq("synthesis_id", synthesisId).maybeSingle(),
  ]);
  if (claimsResult.error || marketsResult.error || industriesResult.error || decisionResult.error) throw new MarketSynthesisPersistenceError("Ano could not read the saved market findings.");
  const recommendationMode = recommendationModeSchema.parse(synthesis.recommendation_mode ?? "pending");
  const parsedAssessment = evidenceAssessmentSchema.parse(synthesis.assessment_json);
  const claims = (claimsResult.data ?? []).map((claim) => ({ id: claim.id, kind: claim.claim_kind, statement: claim.statement, sourceIds: strings(claim.source_ids, 6), comparisonBasis: claim.comparison_basis ? text(claim.comparison_basis, 280) : null, evidenceStrength: claim.evidence_strength, citationStatus: claim.citation_status }));
  const markets = (marketsResult.data ?? []).map((market) => ({ id: market.id, name: market.name, summary: market.summary, evidenceStrength: market.evidence_strength, claimIds: strings(market.claim_ids, 8), unknowns: strings(market.unknowns_json, 5), nextResearchActions: strings(market.next_research_actions_json, 4) }));
  const industries = (industriesResult.data ?? []).map((industry) => ({ id: industry.id, marketProfileId: industry.market_profile_id, name: industry.name, summary: industry.summary, operationalProblems: strings(industry.operational_problems_json, 5), solutionFit: strings(industry.solution_fit_json, 4), buyerRoleHypotheses: strings(industry.buyer_role_hypotheses_json, 5), evidenceStrength: industry.evidence_strength, claimIds: strings(industry.claim_ids, 8), unknowns: strings(industry.unknowns_json, 5) }));
  const groupSummaries: EvidenceGroupSummary[] = Array.isArray(synthesis.group_summaries_json)
    ? synthesis.group_summaries_json.flatMap((entry) => {
        const parsed = evidenceGroupSummarySchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const rawReport = synthesis.report_json;
  const parsedPersistedReport =
    rawReport && typeof rawReport === "object" && !Array.isArray(rawReport) && Object.keys(rawReport).length > 0
      ? synthesisReportSchema.safeParse(rawReport)
      : null;
  const resolvedReport = parsedPersistedReport?.success
    ? parsedPersistedReport.data
    : synthesis.status === "ready_for_decision" ||
        synthesis.status === "ready_for_review" ||
        synthesis.status === "insufficient_evidence" ||
        claims.length > 0
      ? buildStructuredSynthesisReport({
          draft:
            claims.length > 0
              ? {
                  claims,
                  markets,
                  industries,
                  contradictions: parsedAssessment.contradictions,
                  gaps: parsedAssessment.gaps,
                  summary: parsedAssessment.summary,
                }
              : null,
          assessment: parsedAssessment,
          recommendationMode,
          groupSummaries,
        })
      : undefined;
  return marketSynthesisSchema.parse({
    id: synthesis.id,
    conversationId: synthesis.conversation_id,
    researchRunId: synthesis.ano_research_run_id,
    status: synthesis.status,
    recommendationMode,
    assessment: parsedAssessment,
    claims,
    markets,
    industries,
    decision: decisionResult.data ? { id: decisionResult.data.id, status: decisionResult.data.status, marketProfileId: decisionResult.data.market_profile_id, industryProfileId: decisionResult.data.industry_profile_id, rationale: decisionResult.data.rationale ? text(decisionResult.data.rationale) : null, selectedAt: decisionResult.data.selected_at ? iso(decisionResult.data.selected_at) : null } : null,
    failureMessage: synthesis.failure_message ? text(synthesis.failure_message, 700) : null,
    groupSummaries,
    ...(resolvedReport ? { report: resolvedReport } : {}),
    createdAt: iso(synthesis.created_at),
    updatedAt: iso(synthesis.updated_at),
  });
}

export async function claimMarketSynthesis(session: WorkspaceSession, conversationId: string, researchRunId: string, assessment: EvidenceAssessment) {
  requireLiveSession(session);
  const existing = await synthesisRow(session, conversationId);
  const now = new Date().toISOString();
  if (existing) {
    const status = String(existing.status);
    const restartable = ["failed_safe", "requires_manual_review", "insufficient_evidence"] as string[];
    if (!restartable.includes(status) || await hasPartialSynthesis(session, String(existing.id))) {
      return { synthesisId: String(existing.id), claimed: false, status };
    }
    const { data, error } = await session.client.from("ano_research_syntheses").update({
      status: "running",
      recommendation_mode: "pending",
      assessment_json: assessment,
      failure_message: null,
      started_at: now,
      completed_at: null,
      heartbeat_at: now,
    }).eq("workspace_id", session.workspace.id).eq("id", existing.id).in("status", restartable).select("id").maybeSingle();
    if (error) throw new MarketSynthesisPersistenceError("Ano could not restart the saved evidence analysis.");
    return { synthesisId: String(existing.id), claimed: Boolean(data), status: data ? "running" : status };
  }
  const id = crypto.randomUUID();
  const { error } = await session.client.from("ano_research_syntheses").insert({
    id,
    workspace_id: session.workspace.id,
    conversation_id: conversationId,
    ano_research_run_id: researchRunId,
    status: "awaiting_analysis",
    recommendation_mode: "pending",
    assessment_json: assessment,
    created_by: session.actorId,
    heartbeat_at: now,
  });
  if (error) {
    const recovered = await synthesisRow(session, conversationId);
    if (recovered) return { synthesisId: String(recovered.id), claimed: false, status: String(recovered.status) };
    throw new MarketSynthesisPersistenceError("Ano could not create the citation-bound evidence assessment.");
  }
  const { data: claimed, error: claimError } = await session.client.from("ano_research_syntheses")
    .update({ status: "running", started_at: now, heartbeat_at: now })
    .eq("workspace_id", session.workspace.id).eq("id", id).eq("status", "awaiting_analysis").select("id").maybeSingle();
  if (claimError || !claimed) throw new MarketSynthesisPersistenceError("Ano could not secure the evidence assessment.");
  return { synthesisId: id, claimed: true, status: "running" };
}

export async function saveNoUsableEvidence(session: WorkspaceSession, synthesisId: string, assessment: EvidenceAssessment, graphRunId: string) {
  requireLiveSession(session);
  const completedAt = new Date().toISOString();
  const noEvidenceAssessment = evidenceAssessmentSchema.parse({
    ...assessment,
    sourcesAnalyzedCount: 0,
    evidenceGroupCount: 0,
    summary: "Ano could not retrieve usable public evidence for this question. It has not invented a market recommendation.",
  });
  const noEvidenceReport = buildStructuredSynthesisReport({
    draft: null,
    assessment: noEvidenceAssessment,
    recommendationMode: "no_usable_evidence",
    groupSummaries: [],
    totalSourcesAnalyzed: 0,
    directEvidenceCount: 0,
    comparableEvidenceCount: 0,
  });
  const { data, error } = await session.client.from("ano_research_syntheses").update({
    status: "ready_for_review",
    recommendation_mode: "no_usable_evidence",
    assessment_json: noEvidenceAssessment,
    group_summaries_json: [],
    report_json: noEvidenceReport,
    failure_message: null,
    completed_at: completedAt,
    heartbeat_at: null,
  }).eq("workspace_id", session.workspace.id).eq("id", synthesisId).eq("status", "running").select("id").maybeSingle();
  if (error || !data) throw new MarketSynthesisPersistenceError("Ano could not save the no-evidence research result.");
  await session.client.from("run_events").upsert({ workspace_id: session.workspace.id, graph_run_id: graphRunId, event_key: `phase-c-no-usable-evidence:${synthesisId}`, label: "Research result ready without usable evidence", detail: "Ano found no usable public evidence for this question. It preserved the research record and did not invent a market recommendation." }, { onConflict: "graph_run_id,event_key" });
}

export async function saveMarketSynthesis(session: WorkspaceSession, synthesisId: string, graphRunId: string, baseline: EvidenceAssessment, draft: MarketSynthesisDraft, sources: SynthesisSource[]): Promise<{ status: SynthesisStatus }> {
  requireLiveSession(session);
  const groupSummaries = draft.groupSummaries ?? [];
  const directEvidenceCount = sources.filter(
    (source) =>
      (source.sourceProvenance ?? "public_web") === "public_web" &&
      source.sourceClass !== "vendor" &&
      source.evidenceRole !== "comparable_evidence" &&
      source.evidenceRole !== "contextual_counter_only" &&
      source.sourceClass !== "other",
  ).length;
  const comparableEvidenceCount = sources.filter(
    (source) =>
      source.sourceProvenance === "comparable_evidence" ||
      source.evidenceRole === "comparable_evidence",
  ).length;
  const assessment = evidenceAssessmentSchema.parse({
    ...baseline,
    sourcesAnalyzedCount: sources.length,
    evidenceGroupCount: groupSummaries.length,
    contradictions: draft.contradictions,
    gaps: Array.from(new Set([...baseline.gaps, ...draft.gaps])).slice(0, 6),
    summary: draft.summary,
  });
  const recommendationMode = recommendationModeFor(assessment, draft, sources);
  const report =
    draft.report ??
    buildStructuredSynthesisReport({
      draft,
      assessment,
      recommendationMode,
      groupSummaries,
      totalSourcesAnalyzed: sources.length,
      directEvidenceCount,
      comparableEvidenceCount,
    });
  auditMarketSynthesisDraft({ ...draft, report }, sources);
  const decisionReady = hasLockableRoute(draft);
  const status: SynthesisStatus = decisionReady ? "ready_for_decision" : "ready_for_review";
  const completedAt = new Date().toISOString();
  const { data: synthesis, error: synthesisError } = await session.client.from("ano_research_syntheses").select("ano_research_run_id, conversation_id").eq("workspace_id", session.workspace.id).eq("id", synthesisId).maybeSingle();
  if (synthesisError || !synthesis) throw new MarketSynthesisPersistenceError("Ano could not recover the evidence run while saving its synthesis.");
  const claims = draft.claims.map((claim) => ({ id: claim.id, workspace_id: session.workspace.id, synthesis_id: synthesisId, ano_research_run_id: synthesis.ano_research_run_id, claim_kind: claim.kind, statement: claim.statement, source_ids: claim.sourceIds, comparison_basis: claim.comparisonBasis, evidence_strength: claim.evidenceStrength, citation_status: claim.citationStatus }));
  const markets = draft.markets.map((market) => ({ id: market.id, workspace_id: session.workspace.id, synthesis_id: synthesisId, ano_research_run_id: synthesis.ano_research_run_id, name: market.name, summary: market.summary, evidence_strength: market.evidenceStrength, claim_ids: market.claimIds, unknowns_json: market.unknowns, next_research_actions_json: market.nextResearchActions }));
  const industries = draft.industries.map((industry) => ({ id: industry.id, workspace_id: session.workspace.id, synthesis_id: synthesisId, ano_research_run_id: synthesis.ano_research_run_id, market_profile_id: industry.marketProfileId, name: industry.name, summary: industry.summary, operational_problems_json: industry.operationalProblems, solution_fit_json: industry.solutionFit, buyer_role_hypotheses_json: industry.buyerRoleHypotheses, evidence_strength: industry.evidenceStrength, claim_ids: industry.claimIds, unknowns_json: industry.unknowns }));
  // Industry profiles reference their market profile. These writes must be
  // ordered; parallel inserts can race the foreign key and discard an otherwise
  // valid citation-bound synthesis.
  if (claims.length) {
    const { error } = await session.client.from("research_claims").insert(claims);
    if (error) throw new MarketSynthesisPersistenceError("Ano could not save the citation-bound claims.");
  }
  if (markets.length) {
    const { error } = await session.client.from("market_profiles").insert(markets);
    if (error) throw new MarketSynthesisPersistenceError("Ano could not save the market profiles.");
  }
  if (industries.length) {
    const { error } = await session.client.from("industry_profiles").insert(industries);
    if (error) throw new MarketSynthesisPersistenceError("Ano could not save the industry profiles.");
  }
  if (decisionReady) {
    const { error: decisionError } = await session.client.from("target_decisions").insert({ workspace_id: session.workspace.id, conversation_id: synthesis.conversation_id, synthesis_id: synthesisId, status: "awaiting_selection" });
    if (decisionError) throw new MarketSynthesisPersistenceError("Ano could not save the target-decision checkpoint.");
  }
  const { data: completed, error: updateError } = await session.client.from("ano_research_syntheses").update({
    status,
    recommendation_mode: recommendationMode,
    assessment_json: assessment,
    group_summaries_json: groupSummaries,
    report_json: report,
    completed_at: completedAt,
    failure_message: null,
    heartbeat_at: null,
  }).eq("workspace_id", session.workspace.id).eq("id", synthesisId).eq("status", "running").select("id").maybeSingle();
  if (updateError || !completed) throw new MarketSynthesisPersistenceError("Ano could not complete the reviewed evidence synthesis.");
  await session.client.from("run_events").upsert({ workspace_id: session.workspace.id, graph_run_id: graphRunId, event_key: `phase-c-synthesis:${synthesisId}`, label: status === "ready_for_decision" ? "Market recommendation ready" : "Research insight report ready", detail: status === "ready_for_decision" ? `Ano produced a ${recommendationMode.replaceAll("_", " ")} market and industry route. A human target decision is still required before any company discovery.` : `Ano produced a ${recommendationMode.replaceAll("_", " ")} evidence report and retained the material unknowns. It did not create a route for company discovery.` }, { onConflict: "graph_run_id,event_key" });
  return { status };
}

export async function stopMarketSynthesis(session: WorkspaceSession, synthesisId: string, graphRunId: string, error: unknown) {
  requireLiveSession(session);
  const message =
    error instanceof MarketSynthesisPersistenceError ||
    error instanceof MarketSynthesisModelError ||
    (error instanceof Error && error.message.startsWith("Ano"))
      ? error.message
      : "Ano could not safely complete the evidence synthesis. No new web search, company lookup, or sales action was attempted.";
  await session.client.from("ano_research_syntheses").update({ status: "failed_safe", failure_message: text(message, 700), completed_at: new Date().toISOString(), heartbeat_at: null }).eq("workspace_id", session.workspace.id).eq("id", synthesisId).eq("status", "running");
  await session.client.from("run_events").upsert({ workspace_id: session.workspace.id, graph_run_id: graphRunId, event_key: `phase-c-stop:${synthesisId}`, label: "Evidence synthesis stopped safely", detail: message }, { onConflict: "graph_run_id,event_key" });
}

export async function lockTargetDecision(session: WorkspaceSession, conversationId: string, input: LockTargetDecisionInput) {
  requireLiveSession(session);
  const checked = lockTargetDecisionInputSchema.parse(input);
  const synthesis = await readMarketSynthesis(session, conversationId);
  const canSelectFromRoutes = Boolean(
    synthesis &&
      (synthesis.status === "ready_for_decision" || synthesis.status === "ready_for_review") &&
      (synthesis.decision || (synthesis.markets.length > 0 && synthesis.industries.length > 0)),
  );
  if (!synthesis || !canSelectFromRoutes) {
    throw new MarketSynthesisPersistenceError("Ano cannot lock a target route until the saved evidence is ready for comparison.", "DECISION_NOT_READY");
  }
  if (synthesis.decision?.status === "locked") return synthesis;
  const market = synthesis.markets.find((item) => item.id === checked.marketProfileId);
  const industry = synthesis.industries.find((item) => item.id === checked.industryProfileId);
  if (!market || !industry || (industry.marketProfileId && industry.marketProfileId !== market.id)) {
    throw new MarketSynthesisPersistenceError("Choose a market and an industry that belong to the same evidence-backed route.", "INVALID_TARGET_ROUTE");
  }

  const now = new Date().toISOString();
  let decisionId = synthesis.decision?.id ?? "";

  if (synthesis.decision) {
    const { data, error } = await session.client
      .from("target_decisions")
      .update({
        status: "locked",
        market_profile_id: market.id,
        industry_profile_id: industry.id,
        rationale: checked.rationale ?? null,
        selected_by: session.actorId,
        selected_at: now,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", synthesis.decision.id)
      .eq("status", "awaiting_selection")
      .select("id")
      .maybeSingle();
    if (error) throw new MarketSynthesisPersistenceError("Ano could not save the selected target route.");
    if (!data) return (await readMarketSynthesis(session, conversationId))!;
    decisionId = String(data.id);
  } else {
    const { data, error } = await session.client
      .from("target_decisions")
      .insert({
        workspace_id: session.workspace.id,
        conversation_id: conversationId,
        synthesis_id: synthesis.id,
        market_profile_id: market.id,
        industry_profile_id: industry.id,
        status: "locked",
        rationale: checked.rationale ?? null,
        selected_by: session.actorId,
        selected_at: now,
      })
      .select("id")
      .single();
    if (error || !data) throw new MarketSynthesisPersistenceError("Ano could not save the selected target route.");
    decisionId = String(data.id);

    await session.client
      .from("ano_research_syntheses")
      .update({ status: "ready_for_decision" })
      .eq("workspace_id", session.workspace.id)
      .eq("id", synthesis.id)
      .eq("status", "ready_for_review");
  }

  const run = await runForConversation(session, conversationId);
  await session.client.from("run_events").upsert({
    workspace_id: session.workspace.id,
    graph_run_id: String(run.graph_run_id),
    event_key: `phase-c-target:${decisionId}`,
    label: "Target route locked",
    detail: `You selected ${market.name} / ${industry.name}. Ano has not searched Prospeo, people, or contacts.`,
  }, { onConflict: "graph_run_id,event_key" });
  return (await readMarketSynthesis(session, conversationId))!;
}

export async function ensureAutopilotFallbackSynthesis(
  session: WorkspaceSession,
  conversationId: string,
  brief: ResearchBrief,
  plan: ResearchPlan,
): Promise<MarketSynthesis> {
  requireLiveSession(session);
  const existingView = await readMarketSynthesis(session, conversationId);
  if (existingView && existingView.markets.length > 0 && existingView.industries.length > 0) {
    return existingView;
  }

  const input = await loadSynthesisSources(session, conversationId);
  if (input.sources.length === 0) {
    throw new MarketSynthesisPersistenceError(
      "Ano needs at least one saved source before preparing a fallback market route.",
      "SOURCES_NOT_READY",
    );
  }

  const explicitTargetMarket = (brief.targetMarkets ?? []).find(
    (entry) => entry.trim().length > 0 && !isOpenMarketRecommendationIntent(entry),
  );
  const scopeMarket = plan.plannedScope.markets.find(
    (entry) => entry.trim().length > 0 && !isOpenMarketRecommendationIntent(entry),
  );
  const marketName = (
    explicitTargetMarket ??
    scopeMarket ??
    brief.businessLocation ??
    "Primary target market"
  )
    .trim()
    .slice(0, 140);

  const industryName = (
    plan.plannedScope.industries[0]?.trim() ||
    brief.marketHints[0]?.trim() ||
    "B2B & Service Organizations"
  ).slice(0, 140);

  const primarySource = input.sources[0];
  const claimId = existingView?.claims[0]?.id ?? crypto.randomUUID();
  const marketId = existingView?.markets[0]?.id ?? crypto.randomUUID();
  const industryId = crypto.randomUUID();
  const assessment = assessSourceLedger(input.sources, input.missionCoverage);
  const draft: MarketSynthesisDraft = {
    claims: [
      {
        id: claimId,
        kind: "hypothesis",
        statement:
          text(
            `Based on supplied product context: ${brief.offer} Aiming for ${brief.goal}.`,
            680,
          ) ?? "Product brief supplied by the workspace for outbound discovery.",
        sourceIds: [primarySource.id],
        comparisonBasis: null,
        evidenceStrength: "limited",
        citationStatus: "limited",
      },
    ],
    markets: [
      {
        id: marketId,
        name: marketName,
        summary:
          text(
            `Target geography derived from workspace intake (${marketName}) to evaluate buyer density and direct outreach fit.`,
            680,
          ) ?? `Target market: ${marketName}.`,
        evidenceStrength: "limited",
        claimIds: [claimId],
        unknowns: ["External market statistics were supplemented by product context."],
        nextResearchActions: ["Validate buyer responsiveness during initial outreach."],
      },
    ],
    industries: [
      {
        id: industryId,
        marketProfileId: marketId,
        name: industryName,
        summary:
          text(
            `Primary segment (${industryName}) aligned with the supplied product brief: ${brief.offer}`,
            680,
          ) ?? `Target industry segment: ${industryName}.`,
        operationalProblems: [
          text(`Workflow bottlenecks addressed by ${brief.offer}`, 260) ??
            "Operational workflow inefficiency",
        ],
        solutionFit: [
          text(brief.goal, 260) ?? "Direct value alignment with the product offering",
        ],
        buyerRoleHypotheses:
          plan.plannedScope.buyerRoles.length > 0
            ? plan.plannedScope.buyerRoles.slice(0, 5)
            : ["Founder / Managing Director", "Operations Manager"],
        evidenceStrength: "limited",
        claimIds: [claimId],
        unknowns: ["Confirm segment-specific adoption triggers during discovery."],
      },
    ],
    contradictions: [],
    gaps: assessment.gaps.slice(0, 6),
    summary:
      text(
        `Prepared market and segment route (${marketName} · ${industryName}) grounded in your product brief and uploaded sources.`,
        680,
      ) ?? "Prepared fallback market synthesis.",
  };

  let rawRow = await synthesisRow(session, conversationId);
  const now = new Date().toISOString();

  if (!rawRow || String(rawRow.ano_research_run_id) !== input.researchRunId) {
    const claim = await claimMarketSynthesis(
      session,
      conversationId,
      input.researchRunId,
      assessment,
    );
    if (!claim.claimed) {
      rawRow = await synthesisRow(session, conversationId);
    } else {
      await saveMarketSynthesis(session, claim.synthesisId, input.graphRunId, assessment, draft, input.sources);
      return (await readMarketSynthesis(session, conversationId))!;
    }
  }

  if (!rawRow) {
    throw new MarketSynthesisPersistenceError("Ano could not prepare the fallback market synthesis row.");
  }

  const synthesisId = String(rawRow.id);
  const partialExists = await hasPartialSynthesis(session, synthesisId);

  if (!partialExists) {
    await session.client
      .from("ano_research_syntheses")
      .update({
        status: "running",
        recommendation_mode: "pending",
        assessment_json: assessment,
        failure_message: null,
        started_at: now,
        completed_at: null,
        heartbeat_at: now,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", synthesisId);

    await saveMarketSynthesis(session, synthesisId, input.graphRunId, assessment, draft, input.sources);
    return (await readMarketSynthesis(session, conversationId))!;
  }

  if (!existingView?.claims.length) {
    await session.client.from("research_claims").insert({
      id: claimId,
      workspace_id: session.workspace.id,
      synthesis_id: synthesisId,
      ano_research_run_id: input.researchRunId,
      claim_kind: draft.claims[0].kind,
      statement: draft.claims[0].statement,
      source_ids: draft.claims[0].sourceIds,
      comparison_basis: null,
      evidence_strength: draft.claims[0].evidenceStrength,
      citation_status: draft.claims[0].citationStatus,
    });
  }
  if (!existingView?.markets.length) {
    await session.client.from("market_profiles").insert({
      id: marketId,
      workspace_id: session.workspace.id,
      synthesis_id: synthesisId,
      ano_research_run_id: input.researchRunId,
      name: draft.markets[0].name,
      summary: draft.markets[0].summary,
      evidence_strength: draft.markets[0].evidenceStrength,
      claim_ids: draft.markets[0].claimIds,
      unknowns_json: draft.markets[0].unknowns,
      next_research_actions_json: draft.markets[0].nextResearchActions,
    });
  }
  if (!existingView?.industries.length) {
    await session.client.from("industry_profiles").insert({
      id: industryId,
      workspace_id: session.workspace.id,
      synthesis_id: synthesisId,
      ano_research_run_id: input.researchRunId,
      market_profile_id: marketId,
      name: draft.industries[0].name,
      summary: draft.industries[0].summary,
      operational_problems_json: draft.industries[0].operationalProblems,
      solution_fit_json: draft.industries[0].solutionFit,
      buyer_role_hypotheses_json: draft.industries[0].buyerRoleHypotheses,
      evidence_strength: draft.industries[0].evidenceStrength,
      claim_ids: draft.industries[0].claimIds,
      unknowns_json: draft.industries[0].unknowns,
    });
  }
  if (!existingView?.decision) {
    await session.client.from("target_decisions").insert({
      workspace_id: session.workspace.id,
      conversation_id: conversationId,
      synthesis_id: synthesisId,
      status: "awaiting_selection",
    });
  }

  const fallbackReport = buildStructuredSynthesisReport({
    draft,
    assessment,
    recommendationMode: "exploratory",
    groupSummaries: [],
    totalSourcesAnalyzed: input.sources.length,
    directEvidenceCount: 0,
    comparableEvidenceCount: 0,
  });

  await session.client
    .from("ano_research_syntheses")
    .update({
      status: "ready_for_decision",
      recommendation_mode: "exploratory",
      assessment_json: {
        ...assessment,
        sourcesAnalyzedCount: input.sources.length,
        evidenceGroupCount: 0,
        summary: draft.summary,
      },
      group_summaries_json: [],
      report_json: fallbackReport,
      failure_message: null,
      completed_at: now,
      heartbeat_at: null,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", synthesisId);

  return (await readMarketSynthesis(session, conversationId))!;
}

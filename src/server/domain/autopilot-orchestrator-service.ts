import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  buildAutopilotExecutiveSummaryMarkdown,
  describeAutopilotStageProgress,
  formatAutopilotOutcomeMessage,
  isOpenMarketRecommendationIntent,
  rankAccountsForAutopilotShortlist,
  resolveAutopilotAuthorityScope,
  selectAutopilotTargetRoute,
  selectPriorityContactsForWaterfall,
  type AutopilotAuthorityScope,
  type AutopilotExecutableStage,
  type AutopilotRunView,
  type AutopilotStageSummary,
} from "@/lib/ano/autopilot";
import {
  deriveOsmTagFilters,
  deriveSearchKeywords,
  recommendDiscoveryProvider,
  type CompanySearchView,
} from "@/lib/ano/company-discovery";
import {
  MAX_ITERATIVE_RESEARCH_WAVES,
  resolveSourceProvenance,
  type EvidenceResearchView,
} from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type { OutreachTemplatePackView } from "@/lib/ano/outreach-templates";
import type { PeopleDiscoveryView } from "@/lib/ano/people-playbooks";
import {
  buildConversationMessageParts,
  type ResearchBrief,
  type ResearchConversationView,
  type ResearchPlan,
} from "@/lib/ano/research-conversation";
import { getActivePlannerConfig } from "@/server/agents/bedrock";
import { createAutopilotIntakePlanningModel } from "@/server/agents/research-planning-model";
import { dropcontactConfiguration } from "@/server/connectors/dropcontact/dropcontact-client";
import {
  getEvidenceResearchForConversation,
  prepareEvidenceResearchForConversation,
  startApprovedEvidenceResearch,
} from "@/server/domain/evidence-research-service";
import {
  analyseMarketSynthesisForConversation,
  getMarketSynthesisForConversation,
  lockMarketRouteForConversation,
} from "@/server/domain/market-synthesis-service";
import {
  getOutreachExecutionForConversation,
} from "@/server/domain/outreach-execution-service";
import {
  generateOutreachTemplatePackForConversation,
  getOutreachTemplatePackForConversation,
} from "@/server/domain/outreach-template-service";
import {
  approveContactVerificationForConversation,
  approvePersonSearchForConversation,
  generateAccountPlaybooksForConversation,
  getPeopleDiscoveryForConversation,
  prepareContactVerificationForConversation,
  proposeBuyerRolesForConversation,
  runWebsiteTeamDiscoveryForConversation,
} from "@/server/domain/people-playbook-service";
import { getResearchConversation } from "@/server/domain/research-conversation-service";
import {
  approveCompanySearchForConversation,
  getCompanySearchForConversation,
  prepareCompanySearchPreviewForConversation,
  runOpenStreetMapSearchForConversation,
  updateAccountStateForConversation,
} from "@/server/domain/target-account-discovery-service";
import { formatProductSourcesForPrompt } from "@/server/ingestion/product-source-ingestor";
import {
  AUTOPILOT_HEARTBEAT_INTERVAL_MS,
  AutopilotPersistenceError,
  cancelAutopilotRun,
  claimAutopilotStageLease,
  completeAutopilotStageLease,
  failAutopilotStageLease,
  readAutopilotRun,
  renewAutopilotStageLease,
  startOrResumeAutopilotRun,
} from "@/server/persistence/autopilot-store";
import { ensureAutopilotFallbackResearchRun } from "@/server/persistence/evidence-research-store";
import { ensureAutopilotFallbackSynthesis } from "@/server/persistence/market-synthesis-store";
import {
  readConversationProductSources,
  type StoredProductSource,
} from "@/server/persistence/product-source-store";
import {
  appendAssistantMessage,
  approveResearchPlanForAutopilot,
  syncResearchGraphSnapshot,
} from "@/server/persistence/research-conversation-store";
import { prospeoConfiguration } from "@/server/persistence/target-account-discovery-store";
import { searxngConfiguration } from "@/server/research/searxng-provider";
import {
  canExecutePaidProviderCall,
  checkInternalUsageBudget,
  runWithInternalUsageContext,
  type InternalApiProvider,
} from "@/server/telemetry/internal-api-usage";

export class AutopilotOrchestratorError extends Error {
  constructor(
    message: string,
    readonly code: string = "AUTOPILOT_UNAVAILABLE",
  ) {
    super(message);
    this.name = "AutopilotOrchestratorError";
  }
}

export type AutopilotStepResult = {
  autopilotRun: AutopilotRunView | null;
  executedStage: AutopilotExecutableStage | null;
  skippedBecauseInFlight: boolean;
};

export interface AutopilotOrchestratorDeps {
  readAutopilotRun: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<AutopilotRunView | null>;
  startOrResumeAutopilotRun: (
    session: WorkspaceSession,
    conversationId: string,
    options?: {
      fromStage?: AutopilotExecutableStage;
      explicitApproval?: boolean;
      authorityScope?: Partial<AutopilotAuthorityScope>;
    },
  ) => Promise<AutopilotRunView>;
  claimAutopilotStageLease: typeof claimAutopilotStageLease;
  renewAutopilotStageLease?: typeof renewAutopilotStageLease;
  completeAutopilotStageLease: typeof completeAutopilotStageLease;
  failAutopilotStageLease: typeof failAutopilotStageLease;
  cancelAutopilotRun: typeof cancelAutopilotRun;
  checkBudget: (session: WorkspaceSession, provider: InternalApiProvider) => Promise<boolean>;
  runWithUsageContext: typeof runWithInternalUsageContext;
  getConversation: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<ResearchConversationView>;
  readProductSources: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<StoredProductSource[]>;
  approvePlanForAutopilot: (
    session: WorkspaceSession,
    conversationId: string,
    planId: string,
  ) => Promise<ResearchConversationView>;
  generateAndSaveAutopilotPlan: (
    session: WorkspaceSession,
    conversationId: string,
    conversation: ResearchConversationView,
    productSources: StoredProductSource[],
  ) => Promise<ResearchConversationView>;
  isSearxngAvailable: () => boolean;
  getEvidenceResearch: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<EvidenceResearchView | null>;
  prepareEvidenceResearch: (
    session: WorkspaceSession,
    conversationId: string,
    options?: { maximumSearches?: number; maximumFetches?: number },
  ) => Promise<EvidenceResearchView | null>;
  startEvidenceResearch: (
    session: WorkspaceSession,
    conversationId: string,
    runId: string,
    options?: { maxWaves?: number },
  ) => Promise<EvidenceResearchView | null>;
  ensureFallbackResearchRun: (
    session: WorkspaceSession,
    conversation: ResearchConversationView,
    productSources: StoredProductSource[],
    warningReason: string,
  ) => Promise<EvidenceResearchView>;
  getMarketSynthesis: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<MarketSynthesis | null>;
  analyseMarketSynthesis: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<MarketSynthesis | null>;
  ensureFallbackSynthesis: (
    session: WorkspaceSession,
    conversationId: string,
    brief: ResearchBrief,
    plan: ResearchPlan,
  ) => Promise<MarketSynthesis>;
  lockMarketRoute: (
    session: WorkspaceSession,
    conversationId: string,
    input: { marketProfileId: string; industryProfileId: string; rationale?: string },
  ) => Promise<MarketSynthesis>;
  isProspeoAvailable: () => boolean;
  getCompanySearch: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<CompanySearchView | null>;
  runOsmSearch: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<CompanySearchView>;
  prepareProspeoCompanyPreview: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<CompanySearchView>;
  approveCompanySearch: (
    session: WorkspaceSession,
    conversationId: string,
    searchId: string,
  ) => Promise<CompanySearchView>;
  shortlistAccount: (
    session: WorkspaceSession,
    conversationId: string,
    accountId: string,
  ) => Promise<CompanySearchView>;
  isDropcontactAvailable: () => boolean;
  getPeopleDiscovery: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<PeopleDiscoveryView>;
  runWebsiteTeamDiscovery: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<PeopleDiscoveryView>;
  proposeProspeoPeople: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<PeopleDiscoveryView>;
  approvePersonSearch: (
    session: WorkspaceSession,
    conversationId: string,
    personSearchId: string,
  ) => Promise<PeopleDiscoveryView>;
  prepareContactVerification: (
    session: WorkspaceSession,
    conversationId: string,
    contactIds: string[],
    providerKey: "prospeo" | "dropcontact",
  ) => Promise<PeopleDiscoveryView>;
  approveContactVerification: (
    session: WorkspaceSession,
    conversationId: string,
    verificationRunId: string,
  ) => Promise<PeopleDiscoveryView>;
  generateAccountPlaybooks?: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<PeopleDiscoveryView>;
  getTemplatePack: (
    session: WorkspaceSession,
    conversationId: string,
  ) => Promise<OutreachTemplatePackView | null>;
  generateTemplatePack: (
    session: WorkspaceSession,
    conversationId: string,
    options?: { instruction?: string },
  ) => Promise<OutreachTemplatePackView>;
  appendExecutiveSummaryMessage: (
    session: WorkspaceSession,
    conversationId: string,
    text: string,
    dedupeKey: string,
  ) => Promise<void>;
}

async function defaultGenerateAndSaveAutopilotPlan(
  session: WorkspaceSession,
  conversationId: string,
  conversation: ResearchConversationView,
  productSources: StoredProductSource[],
): Promise<ResearchConversationView> {
  const brief = conversation.brief;
  if (!brief) {
    throw new AutopilotOrchestratorError(
      "Product brief is missing before plan creation.",
      "INTAKE_INCOMPLETE",
    );
  }
  const config = getActivePlannerConfig();
  const model = createAutopilotIntakePlanningModel(config, {
    productContextText: formatProductSourcesForPrompt(productSources),
    productSummary: productSources[0]?.summaryText ?? null,
  });
  const readyBrief: ResearchBrief = {
    ...brief,
    intakeComplete: true,
  };
  const draft = await model.createPlan(readyBrief);
  const nextPlan: ResearchPlan = {
    ...draft,
    id: crypto.randomUUID(),
    version: (conversation.plan?.version ?? 0) + 1,
    approvalStatus: "approved",
    createdAt: new Date().toISOString(),
  };

  return syncResearchGraphSnapshot(session, conversationId, {
    values: {
      workspaceId: session.workspace.id,
      conversationId,
      graphRunId: conversation.run.id,
      submittedMessage: null,
      contextMessages: conversation.messages
        .filter((m) => m.role === "user")
        .map((m) => ({ id: m.id, role: "user" as const, text: m.text })),
      brief: readyBrief,
      pendingQuestion: null,
      plan: nextPlan,
      status: "complete_without_research",
      currentNode: "intake_complete_autopilot_ready",
      lastError: null,
    },
    next: [],
    config: {
      configurable: {
        thread_id: conversation.conversation.threadId,
        checkpoint_id: crypto.randomUUID(),
      },
    },
    tasks: [],
  });
}

export function createDefaultAutopilotDeps(): AutopilotOrchestratorDeps {
  return {
    readAutopilotRun,
    startOrResumeAutopilotRun,
    claimAutopilotStageLease,
    renewAutopilotStageLease,
    completeAutopilotStageLease,
    failAutopilotStageLease,
    cancelAutopilotRun,
    checkBudget: (session, provider) =>
      provider === "prospeo" || provider === "dropcontact"
        ? canExecutePaidProviderCall(session, provider)
        : checkInternalUsageBudget(session, provider),
    runWithUsageContext: runWithInternalUsageContext,
    getConversation: getResearchConversation,
    readProductSources: async (session, conversationId) => {
      const { fullSources } = await readConversationProductSources(session, conversationId);
      return fullSources;
    },
    approvePlanForAutopilot: approveResearchPlanForAutopilot,
    generateAndSaveAutopilotPlan: defaultGenerateAndSaveAutopilotPlan,
    isSearxngAvailable: () => searxngConfiguration().available,
    getEvidenceResearch: getEvidenceResearchForConversation,
    prepareEvidenceResearch: prepareEvidenceResearchForConversation,
    startEvidenceResearch: startApprovedEvidenceResearch,
    ensureFallbackResearchRun: ensureAutopilotFallbackResearchRun,
    getMarketSynthesis: getMarketSynthesisForConversation,
    analyseMarketSynthesis: analyseMarketSynthesisForConversation,
    ensureFallbackSynthesis: ensureAutopilotFallbackSynthesis,
    lockMarketRoute: lockMarketRouteForConversation,
    isProspeoAvailable: () => prospeoConfiguration().available,
    getCompanySearch: async (session, conversationId) =>
      (await getCompanySearchForConversation(session, conversationId)).companySearch,
    runOsmSearch: async (session, conversationId) =>
      (await runOpenStreetMapSearchForConversation(session, conversationId)).companySearch,
    prepareProspeoCompanyPreview: async (session, conversationId) =>
      (
        await prepareCompanySearchPreviewForConversation(session, conversationId, {
          providerKey: "prospeo",
        })
      ).companySearch,
    approveCompanySearch: async (session, conversationId, searchId) =>
      (await approveCompanySearchForConversation(session, conversationId, searchId))
        .companySearch,
    shortlistAccount: (session, conversationId, accountId) =>
      updateAccountStateForConversation(session, conversationId, accountId, "shortlisted"),
    isDropcontactAvailable: () => dropcontactConfiguration().available,
    getPeopleDiscovery: async (session, conversationId) =>
      (await getPeopleDiscoveryForConversation(session, conversationId)).peopleDiscovery,
    runWebsiteTeamDiscovery: async (session, conversationId) =>
      (await runWebsiteTeamDiscoveryForConversation(session, conversationId)).peopleDiscovery,
    proposeProspeoPeople: async (session, conversationId) =>
      (
        await proposeBuyerRolesForConversation(session, conversationId, {
          providerKey: "prospeo",
        })
      ).peopleDiscovery,
    approvePersonSearch: async (session, conversationId, personSearchId) =>
      (await approvePersonSearchForConversation(session, conversationId, personSearchId))
        .peopleDiscovery,
    prepareContactVerification: async (session, conversationId, contactIds, providerKey) =>
      (
        await prepareContactVerificationForConversation(
          session,
          conversationId,
          contactIds,
          providerKey,
        )
      ).peopleDiscovery,
    approveContactVerification: async (session, conversationId, verificationRunId) =>
      (await approveContactVerificationForConversation(session, conversationId, verificationRunId))
        .peopleDiscovery,
    generateAccountPlaybooks: async (session, conversationId) =>
      (await generateAccountPlaybooksForConversation(session, conversationId)).peopleDiscovery,
    getTemplatePack: async (session, conversationId) =>
      (await getOutreachTemplatePackForConversation(session, conversationId)).templatePack,
    generateTemplatePack: async (session, conversationId, options) =>
      (await generateOutreachTemplatePackForConversation(session, conversationId, options))
        .templatePack,
    appendExecutiveSummaryMessage: async (session, conversationId, text, dedupeKey) => {
      await appendAssistantMessage(session, conversationId, text, dedupeKey);
    },
  };
}

type StageProgressReporter = (
  progressDetail: string,
  checkpoint?: Record<string, unknown>,
) => Promise<void>;

function nowIso(): string {
  return new Date().toISOString();
}

async function runStageBriefAndPlan(
  session: WorkspaceSession,
  conversationId: string,
  deps: AutopilotOrchestratorDeps,
): Promise<AutopilotStageSummary> {
  const [conversation, productSources] = await Promise.all([
    deps.getConversation(session, conversationId),
    deps.readProductSources(session, conversationId),
  ]);

  if (!conversation.brief || conversation.run.status === "awaiting_context") {
    throw new AutopilotOrchestratorError(
      "Answer Ano's business location and target market question first before starting autopilot.",
      "INTAKE_INCOMPLETE",
    );
  }

  let updated = conversation;
  if (!updated.plan) {
    updated = await deps.generateAndSaveAutopilotPlan(
      session,
      conversationId,
      updated,
      productSources,
    );
  } else if (updated.plan.approvalStatus !== "approved") {
    updated = await deps.approvePlanForAutopilot(session, conversationId, updated.plan.id);
  }

  const businessLocation = updated.brief?.businessLocation ?? "Unspecified";
  const rawTargets = updated.brief?.targetMarkets ?? [];
  const targets =
    rawTargets.length === 0 ||
    rawTargets.every((item) => isOpenMarketRecommendationIntent(item))
      ? "the strongest recommended market"
      : rawTargets.join(", ");

  return {
    stage: "brief_and_plan",
    status: "completed",
    headline: `Product brief & plan v${updated.plan?.version ?? 1} ready`,
    detail: `Configured research plan for ${businessLocation} targeting ${targets} (${productSources.length} product source${productSources.length === 1 ? "" : "s"}).`,
    metrics: {
      planVersion: updated.plan?.version ?? 1,
      productSourcesCount: productSources.length,
    },
    warnings: [],
    completedAt: nowIso(),
  };
}

async function runStageMarketResearch(
  session: WorkspaceSession,
  conversationId: string,
  deps: AutopilotOrchestratorDeps,
  authorityScope: AutopilotAuthorityScope,
  reportProgress?: StageProgressReporter,
): Promise<AutopilotStageSummary> {
  const existing = await deps.getEvidenceResearch(session, conversationId).catch(() => null);
  const existingFetched =
    existing?.sources.filter((s) => s.status === "fetched" && Boolean(s.excerpt)) ?? [];
  const existingPublic = existingFetched.filter(
    (s) => resolveSourceProvenance(s) !== "workspace_supplied",
  );
  const existingWorkspace = existingFetched.filter(
    (s) => resolveSourceProvenance(s) === "workspace_supplied",
  );
  const searxngAllowed =
    deps.isSearxngAvailable() && (await deps.checkBudget(session, "searxng"));

  if (
    existing &&
    existing.run.status === "sources_ready" &&
    existing.run.sourceCount > 0 &&
    (existingPublic.length > 0 || existingWorkspace.length === 0)
  ) {
    const publicCount = existingPublic.length || existing.run.sourceCount;
    return {
      stage: "market_research",
      status: "completed",
      headline: `Market research complete (${publicCount} saved sources)`,
      detail: `Reused ${publicCount} saved public research source${publicCount === 1 ? "" : "s"} for market synthesis.`,
      metrics: {
        sourceCount: publicCount,
        publicSourceCount: publicCount,
        workspaceSourceCount: existingWorkspace.length,
        consumedSearches: existing.run.consumedSearches,
        usedFallback: false,
      },
      warnings: [],
      completedAt: nowIso(),
    };
  }

  const warnings: string[] = [];
  let usedFallback = false;
  let view: EvidenceResearchView | null = null;

  if (searxngAllowed) {
    try {
      await reportProgress?.(
        describeAutopilotStageProgress("market_research", {
          wave: 1,
          maxWaves: MAX_ITERATIVE_RESEARCH_WAVES,
        }),
        {
          waveNumber: existing?.run.currentWave ?? 0,
          savedSources: existing?.run.sourceCount ?? 0,
        },
      );
      const prepared = await deps.prepareEvidenceResearch(session, conversationId, {
        maximumSearches: authorityScope.maxPublicSearches,
        maximumFetches: authorityScope.maxSourceFetches,
      });
      if (prepared) {
        if (
          prepared.run.status === "awaiting_provider_approval" ||
          prepared.run.status === "requires_manual_review"
        ) {
          if (prepared.run.status === "requires_manual_review") {
            await reportProgress?.(
              describeAutopilotStageProgress("market_research", { recovered: true }),
              {
                waveNumber: prepared.run.currentWave,
                savedSources: prepared.run.sourceCount,
                recovered: true,
              },
            );
          }
          view = await deps.startEvidenceResearch(session, conversationId, prepared.run.id, {
            maxWaves: MAX_ITERATIVE_RESEARCH_WAVES,
          });
        } else {
          view = prepared;
        }
      }
    } catch {
      warnings.push(
        "Live market web research paused; proceeding using your uploaded product brief and materials.",
      );
    }
  } else if (existing && existing.run.status === "sources_ready" && existingWorkspace.length > 0) {
    view = existing;
    usedFallback = true;
    warnings.push(
      "External market search was unavailable; proceeding directly from your workspace materials.",
    );
  } else {
    warnings.push(
      "External market search was unavailable; proceeding directly from your product materials.",
    );
  }

  const fetchedAfterSearch =
    view?.sources.filter((source) => source.status === "fetched" && Boolean(source.excerpt)) ?? [];
  const publicAfterSearch = fetchedAfterSearch.filter(
    (source) => resolveSourceProvenance(source) !== "workspace_supplied",
  );
  const hasUsablePublicSources = Boolean(
    view && view.run.status === "sources_ready" && publicAfterSearch.length > 0,
  );
  const hasUsableSources = Boolean(
    view && view.run.status === "sources_ready" && fetchedAfterSearch.length > 0,
  );

  if (!hasUsablePublicSources && !hasUsableSources) {
    usedFallback = true;
    if (warnings.length === 0) {
      warnings.push(
        "External web search returned limited public extracts; grounded synthesis in your supplied product context.",
      );
    }
    const [conversation, productSources] = await Promise.all([
      deps.getConversation(session, conversationId),
      deps.readProductSources(session, conversationId),
    ]);
    view = await deps.ensureFallbackResearchRun(
      session,
      conversation,
      productSources,
      warnings[0] ?? "fallback_product_sources",
    );
  } else if (!hasUsablePublicSources && hasUsableSources) {
    usedFallback = true;
  }

  const finalFetched =
    view?.sources.filter((source) => source.status === "fetched" && Boolean(source.excerpt)) ?? [];
  const publicCount = finalFetched.filter(
    (source) => resolveSourceProvenance(source) !== "workspace_supplied",
  ).length;
  const comparableCount = finalFetched.filter(
    (source) => resolveSourceProvenance(source) === "comparable_evidence",
  ).length;
  const workspaceCount = finalFetched.filter(
    (source) => resolveSourceProvenance(source) === "workspace_supplied",
  ).length;
  const sourceCount = usedFallback ? workspaceCount || finalFetched.length : publicCount || finalFetched.length;

  return {
    stage: "market_research",
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    headline: usedFallback
      ? `Market framing ready (${sourceCount} workspace source${sourceCount === 1 ? "" : "s"})`
      : `Market research complete (${sourceCount} public source${sourceCount === 1 ? "" : "s"})`,
    detail: usedFallback
      ? `Prepared ${sourceCount} workspace-supplied reference${sourceCount === 1 ? "" : "s"} for segment synthesis (not counted as public web research).`
      : `Collected ${sourceCount} public research excerpt${sourceCount === 1 ? "" : "s"} across ${view?.run.currentWave ?? 1} wave${(view?.run.currentWave ?? 1) === 1 ? "" : "s"}.`,
    metrics: {
      sourceCount,
      publicSourceCount: publicCount,
      comparableSourceCount: comparableCount,
      workspaceSourceCount: workspaceCount,
      consumedSearches: view?.run.consumedSearches ?? 0,
      usedFallback,
    },
    warnings,
    completedAt: nowIso(),
  };
}

async function runStageSynthesisAndLock(
  session: WorkspaceSession,
  conversationId: string,
  deps: AutopilotOrchestratorDeps,
): Promise<AutopilotStageSummary> {
  const [conversation, existingSynthesis] = await Promise.all([
    deps.getConversation(session, conversationId),
    deps.getMarketSynthesis(session, conversationId).catch(() => null),
  ]);

  if (existingSynthesis?.decision?.status === "locked") {
    const marketName =
      existingSynthesis.markets.find(
        (m) => m.id === existingSynthesis.decision?.marketProfileId,
      )?.name ?? "Target market";
    const industryName =
      existingSynthesis.industries.find(
        (i) => i.id === existingSynthesis.decision?.industryProfileId,
      )?.name ?? "Target industry";

    return {
      stage: "synthesis_and_lock",
      status: "completed",
      headline: `Target segment locked: ${marketName} · ${industryName}`,
      detail: `Using existing locked route (${marketName} / ${industryName}).`,
      metrics: {
        marketName,
        industryName,
        alreadyLocked: true,
      },
      warnings: [],
      completedAt: nowIso(),
    };
  }

  const warnings: string[] = [];
  let synthesis = existingSynthesis;

  if (!synthesis || synthesis.markets.length === 0 || synthesis.industries.length === 0) {
    try {
      synthesis = await deps.analyseMarketSynthesis(session, conversationId);
    } catch {
      warnings.push(
        "Detailed multi-market synthesis fell back to your primary brief segment so discovery could continue.",
      );
    }
  }

  if (!synthesis || synthesis.markets.length === 0 || synthesis.industries.length === 0) {
    if (!conversation.brief || !conversation.plan) {
      throw new AutopilotOrchestratorError(
        "Product brief and plan are required before locking a target segment.",
        "INTAKE_INCOMPLETE",
      );
    }
    if (warnings.length === 0) {
      warnings.push(
        "Used your stated product and market brief directly to lock the primary target segment.",
      );
    }
    synthesis = await deps.ensureFallbackSynthesis(
      session,
      conversationId,
      conversation.brief,
      conversation.plan,
    );
  }

  const selected = selectAutopilotTargetRoute(synthesis, conversation.brief);
  if (!selected) {
    throw new AutopilotOrchestratorError(
      "Ano could not identify a lockable market and industry pair from saved research.",
      "SYNTHESIS_ROUTE_UNAVAILABLE",
    );
  }

  const locked = await deps.lockMarketRoute(session, conversationId, {
    marketProfileId: selected.market.id,
    industryProfileId: selected.industry.id,
    rationale: selected.rationale,
  });

  return {
    stage: "synthesis_and_lock",
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    headline: `Selected target route: ${selected.market.name} · ${selected.industry.name}`,
    detail: selected.rationale,
    metrics: {
      marketName: selected.market.name,
      industryName: selected.industry.name,
      claimsCount: locked.claims.length,
    },
    warnings,
    completedAt: nowIso(),
  };
}

async function runStageCompanyDiscovery(
  session: WorkspaceSession,
  conversationId: string,
  deps: AutopilotOrchestratorDeps,
  authorityScope: AutopilotAuthorityScope,
): Promise<AutopilotStageSummary> {
  const [existing, conversation, synthesis] = await Promise.all([
    deps.getCompanySearch(session, conversationId).catch(() => null),
    deps.getConversation(session, conversationId),
    deps.getMarketSynthesis(session, conversationId),
  ]);
  const warnings: string[] = [];
  let companySearch: CompanySearchView | null = null;

  if (!synthesis?.decision || synthesis.decision.status !== "locked") {
    const msg = "Lock a target market and industry route before searching for matching companies.";
    return {
      stage: "company_discovery",
      status: "skipped",
      headline: "Skipped company search (target route not locked)",
      detail: msg,
      metrics: {
        discoveredCount: 0,
        shortlistedCount: 0,
      },
      warnings: [msg],
      completedAt: nowIso(),
    };
  }

  if (existing?.status === "completed" && existing.accounts.length > 0) {
    companySearch = existing;
  } else {
    const lockedIndustry = synthesis.industries.find(
      (item) => item.id === synthesis.decision?.industryProfileId,
    );
    const keywords = lockedIndustry
      ? deriveSearchKeywords(lockedIndustry, conversation.brief)
      : [];
    const osmTags = lockedIndustry
      ? deriveOsmTagFilters(lockedIndustry.name, keywords)
      : [];
    const primaryProvider = recommendDiscoveryProvider(
      lockedIndustry?.name ?? "",
      keywords,
    );
    const providerOrder: Array<"openstreetmap" | "prospeo"> =
      primaryProvider === "openstreetmap"
        ? ["openstreetmap", "prospeo"]
        : osmTags.length > 0
          ? ["prospeo", "openstreetmap"]
          : ["prospeo"];

    for (const provider of providerOrder) {
      if (companySearch && companySearch.accounts.length > 0) break;

      if (provider === "prospeo") {
        const prospeoAllowed =
          deps.isProspeoAvailable() && (await deps.checkBudget(session, "prospeo"));
        if (!prospeoAllowed) {
          continue;
        }
        try {
          const preview = await deps.prepareProspeoCompanyPreview(session, conversationId);
          if (preview.status === "awaiting_approval") {
            companySearch = await deps.approveCompanySearch(
              session,
              conversationId,
              preview.id,
            );
          } else {
            companySearch = preview;
          }
        } catch (error) {
          warnings.push(
            `Primary B2B company lookup had an issue (${formatAutopilotOutcomeMessage(error, { stage: "company_discovery", kind: "warning", fallback: "directory temporarily unavailable" })}).`,
          );
        }
      } else {
        try {
          companySearch = await deps.runOsmSearch(session, conversationId);
        } catch (error) {
          warnings.push(
            `Local map company lookup had an issue (${formatAutopilotOutcomeMessage(error, { stage: "company_discovery", kind: "warning", fallback: "local category unavailable" })}).`,
          );
        }
      }
    }
  }

  const allAccounts = (companySearch?.accounts ?? []).slice(
    0,
    authorityScope.maxCompanyCandidates,
  );
  const topAccounts = rankAccountsForAutopilotShortlist(allAccounts, 10);

  for (const account of topAccounts) {
    if (account.lifecycleState !== "shortlisted") {
      try {
        companySearch = await deps.shortlistAccount(session, conversationId, account.id);
      } catch {
        warnings.push(`Could not shortlist ${account.name} automatically.`);
      }
    }
  }

  const finalAccounts = (companySearch?.accounts ?? allAccounts).slice(
    0,
    authorityScope.maxCompanyCandidates,
  );
  const shortlistedCount = finalAccounts.filter(
    (account) => account.lifecycleState === "shortlisted",
  ).length;

  if (finalAccounts.length === 0) {
    if (warnings.length === 0) {
      warnings.push(
        "No matching companies were returned for the current filters. Try updating the location or keywords in chat.",
      );
    }
    return {
      stage: "company_discovery",
      status: "completed_with_warnings",
      headline: "No matching companies found yet",
      detail: warnings[0] ?? "Company discovery returned 0 candidates.",
      metrics: {
        discoveredCount: 0,
        shortlistedCount: 0,
      },
      warnings,
      completedAt: nowIso(),
    };
  }

  return {
    stage: "company_discovery",
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    headline: `Shortlisted top ${shortlistedCount} of ${finalAccounts.length} companies`,
    detail: `Matched ${finalAccounts.length} target accounts and shortlisted the top ${shortlistedCount} highest-fit candidates.`,
    metrics: {
      discoveredCount: finalAccounts.length,
      shortlistedCount,
      providerKey: companySearch?.providerKey ?? "unknown",
    },
    warnings,
    completedAt: nowIso(),
  };
}

async function runStagePeopleAndEmails(
  session: WorkspaceSession,
  conversationId: string,
  deps: AutopilotOrchestratorDeps,
  authorityScope: AutopilotAuthorityScope,
): Promise<AutopilotStageSummary> {
  const companySearch = await deps.getCompanySearch(session, conversationId).catch(() => null);
  const shortlistedCount =
    companySearch?.accounts.filter((acc) => acc.lifecycleState === "shortlisted").length ?? 0;

  if (shortlistedCount === 0) {
    const msg = "No shortlisted companies were available to search for decision-makers.";
    return {
      stage: "people_and_emails",
      status: "skipped",
      headline: "Skipped decision-maker lookup (no shortlisted companies)",
      detail: msg,
      metrics: {
        contactsFound: 0,
        verifiedEmails: 0,
        publicDirectEmails: 0,
        publicSharedEmails: 0,
        withAnyEmail: 0,
        withPhone: 0,
        tiersAttempted: "",
      },
      warnings: [msg],
      completedAt: nowIso(),
    };
  }

  const warnings: string[] = [];
  const tiersAttempted: string[] = [];
  let peopleView: PeopleDiscoveryView | null = await deps
    .getPeopleDiscovery(session, conversationId)
    .catch(() => null);

  // Tier 1: Company websites + sanitized public emails & phones.
  tiersAttempted.push("website_team");
  try {
    peopleView = await deps.runWebsiteTeamDiscovery(session, conversationId);
  } catch {
    warnings.push("Website team scan encountered partial site timeouts; continuing to next source.");
    peopleView = await deps.getPeopleDiscovery(session, conversationId).catch(() => peopleView);
  }

  let contacts = peopleView?.contacts ?? [];
  let contactsWithEmail = contacts.filter((c) =>
    Boolean(c.verifiedDetails?.email || c.publicEmail),
  ).length;

  // Tier 2: Prospeo directory search + selective enrichment under silent budget.
  let enrichmentsAttempted = 0;
  const prospeoAvailable = deps.isProspeoAvailable();
  const prospeoBudgetForSearch = prospeoAvailable && (await deps.checkBudget(session, "prospeo"));

  if (prospeoBudgetForSearch) {
    if (contacts.length < 10 || contactsWithEmail < 8) {
      tiersAttempted.push("prospeo_search");
      try {
        const preview = await deps.proposeProspeoPeople(session, conversationId);
        if (preview.personSearch?.status === "awaiting_approval") {
          peopleView = await deps.approvePersonSearch(
            session,
            conversationId,
            preview.personSearch.id,
          );
        } else {
          peopleView = preview;
        }
      } catch {
        warnings.push("B2B people directory lookup had a temporary issue; keeping website contacts.");
        peopleView = await deps.getPeopleDiscovery(session, conversationId).catch(() => peopleView);
      }
      contacts = peopleView?.contacts ?? [];
    }

    const prospeoVerifyTargets = selectPriorityContactsForWaterfall(
      contacts,
      authorityScope.maxNamedContactEnrichments,
    );
    if (prospeoVerifyTargets.length > 0 && (await deps.checkBudget(session, "prospeo"))) {
      tiersAttempted.push("prospeo_verify");
      enrichmentsAttempted += prospeoVerifyTargets.length;
      try {
        const verifyPreview = await deps.prepareContactVerification(
          session,
          conversationId,
          prospeoVerifyTargets.map((c) => c.id),
          "prospeo",
        );
        if (verifyPreview.verificationRun?.status === "awaiting_approval") {
          peopleView = await deps.approveContactVerification(
            session,
            conversationId,
            verifyPreview.verificationRun.id,
          );
        } else {
          peopleView = verifyPreview;
        }
      } catch {
        warnings.push("Primary email verification finished with partial matches.");
        peopleView = await deps.getPeopleDiscovery(session, conversationId).catch(() => peopleView);
      }
      contacts = peopleView?.contacts ?? [];
    }
  }

  // Tier 3: Dropcontact async verification fallback on remaining unverified named decision-makers.
  const remainingEnrichments = Math.max(
    0,
    authorityScope.maxNamedContactEnrichments - enrichmentsAttempted,
  );
  const dropcontactTargets =
    remainingEnrichments > 0 ? selectPriorityContactsForWaterfall(contacts, remainingEnrichments) : [];
  if (
    dropcontactTargets.length > 0 &&
    deps.isDropcontactAvailable() &&
    (await deps.checkBudget(session, "dropcontact"))
  ) {
    tiersAttempted.push("dropcontact_verify");
    try {
      const dcPreview = await deps.prepareContactVerification(
        session,
        conversationId,
        dropcontactTargets.map((c) => c.id),
        "dropcontact",
      );
      if (dcPreview.verificationRun?.status === "awaiting_approval") {
        peopleView = await deps.approveContactVerification(
          session,
          conversationId,
          dcPreview.verificationRun.id,
        );
      } else {
        peopleView = dcPreview;
      }
    } catch {
      warnings.push("Secondary email enrichment returned partial results.");
      peopleView = await deps.getPeopleDiscovery(session, conversationId).catch(() => peopleView);
    }
    contacts = peopleView?.contacts ?? [];
  }

  const verifiedEmails = contacts.filter(
    (c) => c.verificationStatus === "verified" && Boolean(c.verifiedDetails?.email),
  ).length;
  const publicDirectEmails = contacts.filter(
    (c) =>
      c.verificationStatus !== "verified" &&
      Boolean(c.publicEmail) &&
      c.publicEmailKind === "direct_public",
  ).length;
  const publicSharedEmails = contacts.filter(
    (c) =>
      c.verificationStatus !== "verified" &&
      Boolean(c.publicEmail) &&
      c.publicEmailKind !== "direct_public",
  ).length;
  const withAnyEmail = contacts.filter((c) =>
    Boolean(c.verifiedDetails?.email || c.publicEmail),
  ).length;
  const withPhone = contacts.filter((c) =>
    Boolean(c.verifiedDetails?.phone || c.publicPhone),
  ).length;

  if (deps.generateAccountPlaybooks) {
    try {
      peopleView = await deps.generateAccountPlaybooks(session, conversationId);
    } catch {
      warnings.push("Factual account and industry playbooks can be generated after reviewing shortlisted buyers.");
    }
  }

  const playbooksGenerated = peopleView?.playbooks.length ?? 0;

  return {
    stage: "people_and_emails",
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    headline: `Found ${contacts.length} decision-makers (${withAnyEmail} with email)`,
    detail: `Captured ${verifiedEmails} verified work email${verifiedEmails === 1 ? "" : "s"}, ${publicDirectEmails + publicSharedEmails} public website email${publicDirectEmails + publicSharedEmails === 1 ? "" : "s"}, and ${withPhone} phone number${withPhone === 1 ? "" : "s"} across ${shortlistedCount} shortlisted companies.`,
    metrics: {
      contactsFound: contacts.length,
      verifiedEmails,
      publicDirectEmails,
      publicSharedEmails,
      withAnyEmail,
      withPhone,
      playbooksGenerated,
      tiersAttempted: tiersAttempted.join(","),
    },
    warnings,
    completedAt: nowIso(),
  };
}

async function runStageOutreachTemplates(
  session: WorkspaceSession,
  conversationId: string,
  run: AutopilotRunView,
  deps: AutopilotOrchestratorDeps,
): Promise<AutopilotStageSummary> {
  const warnings: string[] = [];
  const [conversation, synthesis, companySearch, peopleDiscovery] = await Promise.all([
    deps.getConversation(session, conversationId),
    deps.getMarketSynthesis(session, conversationId).catch(() => null),
    deps.getCompanySearch(session, conversationId).catch(() => null),
    deps.getPeopleDiscovery(session, conversationId).catch(() => null),
  ]);

  let templatePack: OutreachTemplatePackView | null = null;
  if (synthesis?.decision?.status === "locked") {
    try {
      templatePack = await deps.generateTemplatePack(session, conversationId, {});
    } catch {
      warnings.push("Could not auto-generate email templates yet; open Template Studio anytime to generate them.");
      templatePack = await deps.getTemplatePack(session, conversationId).catch(() => null);
    }
  } else {
    warnings.push("Lock a target market and industry route first before generating outreach templates.");
    templatePack = await deps.getTemplatePack(session, conversationId).catch(() => null);
  }

  const lockedMarket = synthesis?.markets.find(
    (m) => m.id === synthesis.decision?.marketProfileId,
  );
  const lockedIndustry = synthesis?.industries.find(
    (i) => i.id === synthesis.decision?.industryProfileId,
  );
  const shortlistedAccounts = (companySearch?.accounts ?? []).filter(
    (a) => a.lifecycleState === "shortlisted",
  );
  const contacts = peopleDiscovery?.contacts ?? [];
  const verifiedEmailCount = contacts.filter(
    (c) => c.verificationStatus === "verified" && Boolean(c.verifiedDetails?.email),
  ).length;
  const publicEmailCount = contacts.filter(
    (c) => c.verificationStatus !== "verified" && Boolean(c.publicEmail),
  ).length;
  const withPhoneCount = contacts.filter((c) =>
    Boolean(c.verifiedDetails?.phone || c.publicPhone),
  ).length;

  const combinedWarnings = [...run.warnings, ...warnings];
  const summaryMarkdown = buildAutopilotExecutiveSummaryMarkdown({
    businessLocation: conversation.brief?.businessLocation ?? null,
    marketName: lockedMarket?.name ?? null,
    industryName: lockedIndustry?.name ?? null,
    topClaimStatement: synthesis?.claims[0]?.statement ?? null,
    discoveredCompanyCount: companySearch?.accounts.length ?? 0,
    shortlistedCompanyNames: shortlistedAccounts.map((a) => a.name),
    totalContacts: contacts.length,
    verifiedEmailCount,
    publicEmailCount,
    withPhoneCount,
    templatePack,
    warnings: combinedWarnings,
  });

  await deps.appendExecutiveSummaryMessage(
    session,
    conversationId,
    summaryMarkdown,
    `autopilot-summary:${run.id}:${run.startedAt ?? "v1"}`,
  );

  const passedCount = templatePack
    ? templatePack.steps.filter((s) => s.lint.passed).length
    : 0;

  return {
    stage: "outreach_templates",
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    headline: templatePack
      ? `Email templates v${templatePack.version} ready (${passedCount}/${templatePack.steps.length} clean)`
      : "Autopilot summary ready",
    detail: templatePack
      ? `Prepared ${templatePack.steps.length}-step sequence and posted executive summary in chat.`
      : "Posted executive summary in chat with current leads ready for export.",
    metrics: {
      templateVersion: templatePack?.version ?? 0,
      stepsCount: templatePack?.steps.length ?? 0,
      passedLintCount: passedCount,
    },
    warnings,
    completedAt: nowIso(),
  };
}

export async function executeAutopilotStepWithDeps(
  session: WorkspaceSession,
  conversationId: string,
  deps: AutopilotOrchestratorDeps,
  options?: {
    workerId?: string;
    leaseDurationMs?: number;
    heartbeatIntervalMs?: number;
    now?: () => number;
  },
): Promise<AutopilotStepResult> {
  const claimOptions = options
    ? {
        workerId: options.workerId,
        leaseDurationMs: options.leaseDurationMs,
        now: options.now?.(),
      }
    : undefined;
  const claim = claimOptions
    ? await deps.claimAutopilotStageLease(session, conversationId, claimOptions)
    : await deps.claimAutopilotStageLease(session, conversationId);

  if (!claim.claimed || !claim.run || !claim.leaseToken) {
    if (claim.reason === "not_found") {
      throw new AutopilotOrchestratorError(
        "Start autopilot before executing pipeline stages.",
        "AUTOPILOT_NOT_STARTED",
      );
    }
    return {
      autopilotRun: claim.run,
      executedStage: null,
      skippedBecauseInFlight: claim.reason === "in_flight",
    };
  }

  if (claim.stage === "done") {
    return {
      autopilotRun: claim.run,
      executedStage: null,
      skippedBecauseInFlight: false,
    };
  }

  const stage = claim.stage;
  const run = claim.run;
  const leaseToken = claim.leaseToken;
  const authorityScope = resolveAutopilotAuthorityScope(run.authorityScope);

  const reportProgress: StageProgressReporter = async (progressDetail, checkpoint) => {
    if (!deps.renewAutopilotStageLease) return;
    await deps
      .renewAutopilotStageLease(session, {
        runId: run.id,
        conversationId,
        leaseToken,
        leaseDurationMs: options?.leaseDurationMs,
        progressDetail,
        checkpoint,
        now: options?.now?.(),
      })
      .catch(() => undefined);
  };

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  if (deps.renewAutopilotStageLease) {
    const intervalMs = Math.max(
      100,
      options?.heartbeatIntervalMs ?? AUTOPILOT_HEARTBEAT_INTERVAL_MS,
    );
    heartbeatTimer = setInterval(() => {
      void deps
        .renewAutopilotStageLease?.(session, {
          runId: run.id,
          conversationId,
          leaseToken,
          leaseDurationMs: options?.leaseDurationMs,
          now: options?.now?.(),
        })
        .catch(() => undefined);
    }, intervalMs);
    heartbeatTimer.unref?.();
  }

  try {
    const summary = await deps.runWithUsageContext(
      { session, conversationId, autopilotRunId: run.id },
      async () => {
        switch (stage) {
          case "brief_and_plan":
            return runStageBriefAndPlan(session, conversationId, deps);
          case "market_research":
            return runStageMarketResearch(
              session,
              conversationId,
              deps,
              authorityScope,
              reportProgress,
            );
          case "synthesis_and_lock":
            return runStageSynthesisAndLock(session, conversationId, deps);
          case "company_discovery":
            return runStageCompanyDiscovery(session, conversationId, deps, authorityScope);
          case "people_and_emails":
            return runStagePeopleAndEmails(session, conversationId, deps, authorityScope);
          case "outreach_templates":
            return runStageOutreachTemplates(session, conversationId, run, deps);
        }
      },
    );

    const updatedRun = await deps.completeAutopilotStageLease(session, {
      runId: run.id,
      conversationId,
      leaseToken,
      stage,
      summary,
      warnings: summary.warnings,
    });

    return {
      autopilotRun: updatedRun,
      executedStage: stage,
      skippedBecauseInFlight: false,
    };
  } catch (error) {
    const message = formatAutopilotOutcomeMessage(error, {
      stage,
      kind: "error",
    });
    await deps
      .failAutopilotStageLease(session, {
        runId: run.id,
        conversationId,
        leaseToken,
        errorMessage: message,
      })
      .catch(() => undefined);

    if (
      error instanceof AutopilotOrchestratorError ||
      error instanceof AutopilotPersistenceError
    ) {
      throw error;
    }
    throw new AutopilotOrchestratorError(message, "AUTOPILOT_STAGE_FAILED");
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
  }
}

export async function getAutopilotStatusSnapshotForConversation(
  session: WorkspaceSession,
  conversationId: string,
) {
  const [
    autopilotRun,
    conversation,
    research,
    synthesis,
    companyRes,
    peopleRes,
    outreachRes,
    templateRes,
  ] = await Promise.all([
    readAutopilotRun(session, conversationId).catch(() => null),
    getResearchConversation(session, conversationId),
    getEvidenceResearchForConversation(session, conversationId).catch(() => null),
    getMarketSynthesisForConversation(session, conversationId).catch(() => null),
    getCompanySearchForConversation(session, conversationId).catch(() => ({
      companySearch: null,
    })),
    getPeopleDiscoveryForConversation(session, conversationId).catch(() => ({
      peopleDiscovery: null,
    })),
    getOutreachExecutionForConversation(session, conversationId).catch(() => ({
      outreachExecution: null,
    })),
    getOutreachTemplatePackForConversation(session, conversationId).catch(() => ({
      templatePack: null,
    })),
  ]);

  const messageParts = buildConversationMessageParts(
    conversation,
    research,
    synthesis,
    companyRes.companySearch,
    peopleRes.peopleDiscovery,
    outreachRes.outreachExecution,
    templateRes.templatePack,
  );

  return {
    autopilotRun,
    conversation,
    research,
    synthesis,
    companySearch: companyRes.companySearch,
    peopleDiscovery: peopleRes.peopleDiscovery,
    outreachExecution: outreachRes.outreachExecution,
    templatePack: templateRes.templatePack,
    messageParts,
  };
}

export async function getAutopilotRunForConversation(
  session: WorkspaceSession,
  conversationId: string,
): Promise<AutopilotRunView | null> {
  return readAutopilotRun(session, conversationId);
}

export async function startAutopilotForConversation(
  session: WorkspaceSession,
  conversationId: string,
  options?: {
    fromStage?: AutopilotExecutableStage;
    explicitApproval?: boolean;
    authorityScope?: Partial<AutopilotAuthorityScope>;
  },
): Promise<AutopilotRunView> {
  if (options?.explicitApproval !== true) {
    throw new AutopilotOrchestratorError(
      "Explicit user approval is required before starting Autopilot.",
      "EXPLICIT_APPROVAL_REQUIRED",
    );
  }
  const conversation = await getResearchConversation(session, conversationId);
  if (!conversation.brief || conversation.run.status === "awaiting_context") {
    throw new AutopilotOrchestratorError(
      "Tell Ano your business location and target market before starting the autonomous pipeline.",
      "INTAKE_INCOMPLETE",
    );
  }
  const authorityScope = resolveAutopilotAuthorityScope(options.authorityScope);
  return startOrResumeAutopilotRun(session, conversationId, {
    fromStage: options.fromStage,
    explicitApproval: true,
    authorityScope,
  });
}

export async function stepAutopilotForConversation(
  session: WorkspaceSession,
  conversationId: string,
) {
  const stepResult = await executeAutopilotStepWithDeps(
    session,
    conversationId,
    createDefaultAutopilotDeps(),
  );

  const [
    conversation,
    research,
    synthesis,
    companyRes,
    peopleRes,
    templateRes,
  ] = await Promise.all([
    getResearchConversation(session, conversationId),
    getEvidenceResearchForConversation(session, conversationId).catch(() => null),
    getMarketSynthesisForConversation(session, conversationId).catch(() => null),
    getCompanySearchForConversation(session, conversationId).catch(() => ({
      companySearch: null,
    })),
    getPeopleDiscoveryForConversation(session, conversationId).catch(() => ({
      peopleDiscovery: null,
    })),
    getOutreachTemplatePackForConversation(session, conversationId).catch(() => ({
      templatePack: null,
    })),
  ]);

  return {
    ...stepResult,
    conversation,
    research,
    synthesis,
    companySearch: companyRes.companySearch,
    peopleDiscovery: peopleRes.peopleDiscovery,
    templatePack: templateRes.templatePack,
  };
}

export async function cancelAutopilotForConversation(
  session: WorkspaceSession,
  conversationId: string,
  mode: "paused" | "cancelled" = "paused",
): Promise<AutopilotRunView> {
  await getResearchConversation(session, conversationId);
  return cancelAutopilotRun(session, conversationId, mode);
}

import "server-only";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type {
  CompanyDiscoveryProvider,
  CompanySearchStatus,
  CompanySearchView,
  OsmResolvedArea,
  OsmTagFilter,
} from "@/lib/ano/company-discovery";
import type { IndustryProfile, MarketProfile } from "@/lib/ano/market-synthesis";

export const TARGET_TO_ACCOUNT_GRAPH_NAME = "target-to-account-discovery";
export const TARGET_TO_ACCOUNT_GRAPH_VERSION = "phase-d-v2";

export type TargetToAccountStage = "preview" | "execute";

export type TargetToAccountExecutor = {
  canonicalizeLocations: (requestedLocations: string[]) => Promise<string[]>;
  canonicalizeIndustries?: (requestedIndustries: string[]) => Promise<string[]>;
  resolveOsmPreview?: (
    requestedLocations: string[],
    tags: OsmTagFilter[],
  ) => Promise<OsmResolvedArea[]>;
  savePreview: (input: {
    conversationId: string;
    targetDecisionId: string;
    market: MarketProfile;
    industry: IndustryProfile;
    providerKey: CompanyDiscoveryProvider;
    requestedLocations: string[];
    canonicalLocations: string[];
    canonicalIndustries: string[];
    searchKeywords: string[];
    excludedCategories: string[];
    osmAreas?: OsmResolvedArea[];
    osmTags?: OsmTagFilter[];
    resolveWebsites?: boolean;
  }) => Promise<CompanySearchView>;
  executeApprovedSearch: (input: {
    conversationId: string;
    searchId: string;
  }) => Promise<CompanySearchView>;
};

export const TargetToAccountGraphState = Annotation.Root({
  stage: Annotation<TargetToAccountStage>(),
  conversationId: Annotation<string>(),
  targetDecisionId: Annotation<string>(),
  targetMarket: Annotation<MarketProfile | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  targetIndustry: Annotation<IndustryProfile | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  providerKey: Annotation<CompanyDiscoveryProvider>({
    reducer: (_left, right) => right,
    default: () => "prospeo",
  }),
  resolveWebsites: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => true,
  }),
  osmTags: Annotation<OsmTagFilter[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  requestedLocations: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  requestedIndustries: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  searchKeywords: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  excludedCategories: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  searchId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  search: Annotation<CompanySearchView | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  status: Annotation<CompanySearchStatus>(),
  currentNode: Annotation<string>(),
});

export type TargetToAccountGraphStateValue = typeof TargetToAccountGraphState.State;

/**
 * Phase D subflow anchored strictly to a locked Phase C target decision.
 * Preview canonicalization calls only Prospeo's free suggestion endpoint or
 * OpenStreetMap Nominatim and terminates before any search execution. Execution
 * requires a persisted awaiting_approval preview and runs strictly one bounded batch (25 max).
 */
export function createTargetToAccountGraph(
  executor: TargetToAccountExecutor,
  checkpointer: BaseCheckpointSaver,
) {
  const verifyLockedTarget = async (state: TargetToAccountGraphStateValue) => {
    if (!state.targetDecisionId || !state.targetMarket || !state.targetIndustry) {
      throw new Error("Lock a Phase C target route before starting Phase D company discovery.");
    }
    if (
      state.targetIndustry.marketProfileId &&
      state.targetIndustry.marketProfileId !== state.targetMarket.id
    ) {
      throw new Error("Selected market and industry do not belong to the same locked route.");
    }
    if (state.stage === "preview") {
      if (state.requestedLocations.length === 0) {
        throw new Error("At least one target location is required before generating a company-search preview.");
      }
      return {
        currentNode: "prepare_canonical_preview",
      };
    }
    if (!state.searchId) {
      throw new Error("A saved Prospeo preview ID is required before company search approval can execute.");
    }
    return {
      currentNode: "execute_approved_company_search",
    };
  };

  const prepareCanonicalPreview = async (state: TargetToAccountGraphStateValue) => {
    if (!state.targetMarket || !state.targetIndustry) {
      throw new Error("Locked market and industry profiles are required.");
    }

    const providerKey = state.providerKey ?? "prospeo";
    let canonicalLocations: string[];
    let canonicalIndustries: string[] = [];
    let osmAreas: OsmResolvedArea[] | undefined;

    if (providerKey === "openstreetmap" && executor.resolveOsmPreview) {
      osmAreas = await executor.resolveOsmPreview(state.requestedLocations, state.osmTags);
      canonicalLocations = osmAreas.map((area) => area.requestedQuery);
    } else {
      const [resolvedLocations, resolvedIndustries] = await Promise.all([
        executor.canonicalizeLocations(state.requestedLocations),
        executor.canonicalizeIndustries && state.requestedIndustries.length > 0
          ? executor.canonicalizeIndustries(state.requestedIndustries)
          : Promise.resolve([]),
      ]);
      canonicalLocations = resolvedLocations;
      canonicalIndustries = resolvedIndustries;
    }

    const search = await executor.savePreview({
      conversationId: state.conversationId,
      targetDecisionId: state.targetDecisionId,
      market: state.targetMarket,
      industry: state.targetIndustry,
      providerKey,
      requestedLocations: state.requestedLocations,
      canonicalLocations,
      canonicalIndustries,
      searchKeywords: state.searchKeywords,
      excludedCategories: state.excludedCategories,
      osmAreas,
      osmTags: providerKey === "openstreetmap" ? state.osmTags : undefined,
      resolveWebsites: providerKey === "openstreetmap" ? state.resolveWebsites : undefined,
    });
    return {
      search,
      searchId: search.id,
      status: search.status,
      currentNode: "await_company_search_approval",
    };
  };

  const executeApprovedCompanySearch = async (state: TargetToAccountGraphStateValue) => {
    if (!state.searchId) {
      throw new Error("A saved company search preview is required before execution.");
    }
    const search = await executor.executeApprovedSearch({
      conversationId: state.conversationId,
      searchId: state.searchId,
    });
    return {
      search,
      status: search.status,
      currentNode:
        search.status === "completed" ? "company_cohort_ready" : "review_company_search",
    };
  };

  const routeStage = (state: TargetToAccountGraphStateValue) =>
    state.stage === "preview"
      ? "prepare_canonical_preview"
      : "execute_approved_company_search";

  return new StateGraph(TargetToAccountGraphState)
    .addNode("verify_locked_target", verifyLockedTarget)
    .addNode("prepare_canonical_preview", prepareCanonicalPreview)
    .addNode("execute_approved_company_search", executeApprovedCompanySearch)
    .addEdge(START, "verify_locked_target")
    .addConditionalEdges("verify_locked_target", routeStage)
    .addEdge("prepare_canonical_preview", END)
    .addEdge("execute_approved_company_search", END)
    .compile({ checkpointer });
}

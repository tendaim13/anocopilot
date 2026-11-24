import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  deriveOsmTagFilters,
  deriveProspeoIndustryCandidates,
  deriveRequestedLocations,
  deriveSearchKeywords,
  recommendDiscoveryProvider,
  type AccountLifecycleState,
  type CompanyDiscoveryProvider,
  type CompanySearchView,
  type WorkspaceAccountDirectoryItem,
} from "@/lib/ano/company-discovery";
import {
  OsmClientError,
  resolveOsmLocationsSequentially,
} from "@/server/connectors/openstreetmap/osm-client";
import {
  ProspeoClientError,
  suggestProspeoIndustries,
  suggestProspeoLocations,
} from "@/server/connectors/prospeo/prospeo-client";
import {
  buildLocationQueryCandidates,
  CompanyDiscoveryBoundaryError,
  normalizeLocationQuery,
  selectCanonicalLocation,
} from "@/server/domain/prospeo-company-discovery";
import { getResearchCheckpointer } from "@/server/langgraph/checkpointer";
import { createTargetToAccountGraph } from "@/server/langgraph/target-to-account-graph";
import {
  executeApprovedProspeoSearch,
  listWorkspaceAccounts,
  loadLockedTargetContext,
  prospeoConfiguration,
  readCompanySearchForConversation,
  saveCompanySearchPreview,
  TargetAccountDiscoveryPersistenceError,
  updateAccountCandidateLifecycleState,
} from "@/server/persistence/target-account-discovery-store";
import { canExecutePaidProviderCall } from "@/server/telemetry/internal-api-usage";

export class TargetAccountDiscoveryServiceError extends Error {
  constructor(message: string, readonly code: string = "COMPANY_DISCOVERY_UNAVAILABLE") {
    super(message);
    this.name = "TargetAccountDiscoveryServiceError";
  }
}

export async function getCompanySearchForConversation(
  session: WorkspaceSession,
  conversationId: string,
): Promise<{
  companySearch: CompanySearchView | null;
  prospeo: ReturnType<typeof prospeoConfiguration>;
}> {
  if (session.kind === "demo") {
    return {
      companySearch: null,
      prospeo: prospeoConfiguration(),
    };
  }
  const companySearch = await readCompanySearchForConversation(session, conversationId);
  return {
    companySearch,
    prospeo: prospeoConfiguration(),
  };
}

export async function prepareCompanySearchPreviewForConversation(
  session: WorkspaceSession,
  conversationId: string,
  options?: {
    providerKey?: CompanyDiscoveryProvider;
    resolveWebsites?: boolean;
    locationOverrides?: string[];
    keywordOverrides?: string[];
    industryOverrides?: string[];
    excludedCategories?: string[];
  },
): Promise<{
  companySearch: CompanySearchView;
  prospeo: ReturnType<typeof prospeoConfiguration>;
}> {
  const context = await loadLockedTargetContext(session, conversationId);
  const requestedLocations = deriveRequestedLocations(
    context.market,
    context.brief,
    options?.locationOverrides,
  );
  const searchKeywords = deriveSearchKeywords(
    context.industry,
    context.brief,
    options?.keywordOverrides,
  );
  const providerKey: CompanyDiscoveryProvider =
    options?.providerKey ?? recommendDiscoveryProvider(context.industry.name, searchKeywords);

  if (providerKey === "prospeo" && !prospeoConfiguration().available) {
    throw new TargetAccountDiscoveryServiceError(
      "B2B company directory discovery is not configured on this server.",
      "PROSPEO_NOT_CONFIGURED",
    );
  }

  const osmTags =
    providerKey === "openstreetmap"
      ? deriveOsmTagFilters(context.industry.name, searchKeywords)
      : [];
  if (providerKey === "openstreetmap" && osmTags.length === 0) {
    throw new TargetAccountDiscoveryServiceError(
      "Local business discovery needs a physical business category (for example: dentist, medical clinic, veterinary, plumber, restaurant, or salon). Add a local category keyword or switch to B2B company directory search.",
      "OSM_TAGS_UNRESOLVED",
    );
  }

  const explicitIndustries = Boolean(options?.industryOverrides);
  const requestedIndustries = explicitIndustries
    ? (options?.industryOverrides ?? []).map((item) => item.trim()).filter(Boolean)
    : deriveProspeoIndustryCandidates(context.industry.name, searchKeywords);
  const checkpointer = await getResearchCheckpointer();

  const graph = createTargetToAccountGraph(
    {
      canonicalizeLocations: async (locations) => {
        try {
          return await Promise.all(
            locations.map(async (location) => {
              const candidates = buildLocationQueryCandidates(location);
              let canonical: string | undefined;

              for (const candidate of candidates) {
                const suggestions = await suggestProspeoLocations(candidate);
                canonical = selectCanonicalLocation(candidate, suggestions);
                if (canonical) break;
              }

              if (!canonical) {
                throw new CompanyDiscoveryBoundaryError(
                  `Could not verify "${location}" as a geographic location. Enter a country, state, or city (for example, Australia, United Kingdom, or United States).`,
                );
              }
              return canonical;
            }),
          );
        } catch (error) {
          if (
            error instanceof ProspeoClientError ||
            error instanceof CompanyDiscoveryBoundaryError
          ) {
            throw new TargetAccountDiscoveryServiceError(
              error.message,
              error instanceof ProspeoClientError ? error.code : "LOCATION_UNRESOLVED",
            );
          }
          throw error;
        }
      },
      canonicalizeIndustries: async (industries) => {
        try {
          const resolved: string[] = [];
          for (const entry of industries) {
            const suggestions = await suggestProspeoIndustries(entry);
            const normalizedEntry = entry.trim().toLowerCase();
            const match =
              suggestions.find((item) => item.toLowerCase() === normalizedEntry) ??
              suggestions.find((item) => item.toLowerCase().includes(normalizedEntry)) ??
              suggestions[0];
            if (!match) {
              if (explicitIndustries) {
                throw new CompanyDiscoveryBoundaryError(
                  `Could not verify "${entry}" in the B2B industry taxonomy. Leave the industry field blank to search using company keywords instead, or try a standard category like "Medical Practices".`,
                );
              }
              continue;
            }
            if (!resolved.includes(match)) {
              resolved.push(match);
            }
          }
          return resolved;
        } catch (error) {
          if (
            error instanceof ProspeoClientError ||
            error instanceof CompanyDiscoveryBoundaryError
          ) {
            throw new TargetAccountDiscoveryServiceError(
              error.message,
              error instanceof ProspeoClientError ? error.code : "INDUSTRY_UNRESOLVED",
            );
          }
          throw error;
        }
      },
      resolveOsmPreview: async (locations) => {
        try {
          return await resolveOsmLocationsSequentially(locations.map(normalizeLocationQuery));
        } catch (error) {
          if (error instanceof OsmClientError) {
            throw new TargetAccountDiscoveryServiceError(error.message, error.code);
          }
          throw error;
        }
      },
      savePreview: async (previewInput) =>
        saveCompanySearchPreview(session, {
          context,
          providerKey: previewInput.providerKey,
          requestedLocations: previewInput.requestedLocations,
          canonicalLocations: previewInput.canonicalLocations,
          canonicalIndustries: previewInput.canonicalIndustries,
          searchKeywords: previewInput.searchKeywords,
          excludedCategories: previewInput.excludedCategories,
          osmAreas: previewInput.osmAreas,
          osmTags: previewInput.osmTags,
          resolveWebsites: previewInput.resolveWebsites,
        }),
      executeApprovedSearch: async () => {
        throw new TargetAccountDiscoveryPersistenceError(
          "Company search execution cannot run during preview preparation.",
        );
      },
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "preview",
      conversationId,
      targetDecisionId: context.targetDecisionId,
      targetMarket: context.market,
      targetIndustry: context.industry,
      providerKey,
      resolveWebsites: options?.resolveWebsites ?? true,
      osmTags,
      requestedLocations,
      requestedIndustries,
      searchKeywords,
      excludedCategories: options?.excludedCategories ?? [],
      searchId: null,
      status: "awaiting_approval",
      currentNode: "verify_locked_target",
    },
    {
      configurable: {
        thread_id: `ano:target-to-account:${context.targetDecisionId}`,
      },
    },
  );

  if (!result.search) {
    throw new TargetAccountDiscoveryServiceError(
      `Ano could not prepare the ${providerKey === "openstreetmap" ? "local business" : "B2B directory"} company-search preview.`,
    );
  }

  return {
    companySearch: result.search,
    prospeo: prospeoConfiguration(),
  };
}

export async function approveCompanySearchForConversation(
  session: WorkspaceSession,
  conversationId: string,
  searchId: string,
): Promise<{
  companySearch: CompanySearchView;
  prospeo: ReturnType<typeof prospeoConfiguration>;
}> {
  const existingSearch = await readCompanySearchForConversation(session, conversationId);
  const providerKey = existingSearch?.providerKey ?? "prospeo";
  if (providerKey === "prospeo") {
    const budgetOk = await canExecutePaidProviderCall(session, "prospeo");
    if (!budgetOk) {
      throw new TargetAccountDiscoveryServiceError(
        "Company search is temporarily paused because workspace usage safeguards could not be verified.",
        "BUDGET_GUARD_BLOCKED",
      );
    }
  }

  const context = await loadLockedTargetContext(session, conversationId);
  const checkpointer = await getResearchCheckpointer();

  const graph = createTargetToAccountGraph(
    {
      canonicalizeLocations: async (locations) => locations,
      savePreview: async () => {
        throw new TargetAccountDiscoveryPersistenceError(
          "Preview generation cannot overwrite an approved execution.",
        );
      },
      executeApprovedSearch: async (execInput) =>
        executeApprovedProspeoSearch(session, {
          context,
          searchId: execInput.searchId,
        }),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "execute",
      conversationId,
      targetDecisionId: context.targetDecisionId,
      targetMarket: context.market,
      targetIndustry: context.industry,
      requestedLocations: [],
      excludedCategories: [],
      searchId,
      status: "running",
      currentNode: "verify_locked_target",
    },
    {
      configurable: {
        thread_id: `ano:target-to-account:${context.targetDecisionId}:execute:${searchId}`,
      },
    },
  );

  if (!result.search) {
    throw new TargetAccountDiscoveryServiceError(
      "Ano could not retrieve the matching company cohort.",
    );
  }

  return {
    companySearch: result.search,
    prospeo: prospeoConfiguration(),
  };
}

export async function runOpenStreetMapSearchForConversation(
  session: WorkspaceSession,
  conversationId: string,
  options?: {
    resolveWebsites?: boolean;
    locationOverrides?: string[];
    keywordOverrides?: string[];
    excludedCategories?: string[];
  },
): Promise<{
  companySearch: CompanySearchView;
  prospeo: ReturnType<typeof prospeoConfiguration>;
}> {
  const prepared = await prepareCompanySearchPreviewForConversation(session, conversationId, {
    ...options,
    providerKey: "openstreetmap",
  });
  return approveCompanySearchForConversation(
    session,
    conversationId,
    prepared.companySearch.id,
  );
}

export async function updateAccountStateForConversation(
  session: WorkspaceSession,
  conversationId: string,
  accountId: string,
  state: Exclude<AccountLifecycleState, "discovered" | "review">,
): Promise<CompanySearchView> {
  return updateAccountCandidateLifecycleState(session, conversationId, accountId, state);
}

export async function listWorkspaceDiscoveredAccounts(
  session: WorkspaceSession,
): Promise<WorkspaceAccountDirectoryItem[]> {
  return listWorkspaceAccounts(session);
}

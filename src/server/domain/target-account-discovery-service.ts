import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  deriveRequestedLocations,
  type AccountLifecycleState,
  type CompanySearchView,
  type WorkspaceAccountDirectoryItem,
} from "@/lib/ano/company-discovery";
import {
  ProspeoClientError,
  suggestProspeoLocations,
} from "@/server/connectors/prospeo/prospeo-client";
import {
  CompanyDiscoveryBoundaryError,
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
    locationOverrides?: string[];
    excludedCategories?: string[];
  },
): Promise<{
  companySearch: CompanySearchView;
  prospeo: ReturnType<typeof prospeoConfiguration>;
}> {
  if (!prospeoConfiguration().available) {
    throw new TargetAccountDiscoveryServiceError(
      "Add PROSPEO_KEY on the server before preparing Prospeo company discovery previews.",
      "PROSPEO_NOT_CONFIGURED",
    );
  }

  const context = await loadLockedTargetContext(session, conversationId);
  const requestedLocations = deriveRequestedLocations(
    context.market,
    context.brief,
    options?.locationOverrides,
  );
  const checkpointer = await getResearchCheckpointer();

  const graph = createTargetToAccountGraph(
    {
      canonicalizeLocations: async (locations) => {
        try {
          return await Promise.all(
            locations.map(async (location) => {
              const suggestions = await suggestProspeoLocations(location);
              const canonical = selectCanonicalLocation(location, suggestions);
              if (!canonical) {
                throw new CompanyDiscoveryBoundaryError(
                  `Prospeo could not verify the location "${location}".`,
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
      savePreview: async (previewInput) =>
        saveCompanySearchPreview(session, {
          context,
          requestedLocations: previewInput.requestedLocations,
          canonicalLocations: previewInput.canonicalLocations,
          excludedCategories: previewInput.excludedCategories,
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
      requestedLocations,
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
      "Ano could not prepare the Prospeo company-search preview.",
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
  if (!prospeoConfiguration().available) {
    throw new TargetAccountDiscoveryServiceError(
      "Add PROSPEO_KEY on the server before running Prospeo company discovery.",
      "PROSPEO_NOT_CONFIGURED",
    );
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
      "Ano could not retrieve the Prospeo company cohort.",
    );
  }

  return {
    companySearch: result.search,
    prospeo: prospeoConfiguration(),
  };
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

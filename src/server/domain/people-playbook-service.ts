import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  deriveBuyerRoleRecommendations,
  deriveBuyingCommitteeCriteria,
  recommendPersonDiscoveryProvider,
  selectAppropriateVerificationProvider,
  type CompanyArchetype,
  type ContactVerificationProvider,
  type DropcontactProviderState,
  type PeopleDiscoveryView,
  type PersonDiscoveryProvider,
  type WorkspaceContactDirectoryItem,
  type WorkspacePlaybookDirectoryItem,
} from "@/lib/ano/people-playbooks";
import { dropcontactConfiguration } from "@/server/connectors/dropcontact/dropcontact-client";
import { getResearchCheckpointer } from "@/server/langgraph/checkpointer";
import { createAccountToPeopleGraph } from "@/server/langgraph/account-to-people-graph";
import {
  compileAndSaveAccountPlaybooks,
  executeApprovedDropcontactVerification,
  executeApprovedProspeoPersonSearch,
  listWorkspaceContacts,
  listWorkspacePlaybooks,
  loadShortlistedContext,
  PeoplePlaybookPersistenceError,
  readPeopleDiscoveryForConversation,
  saveDropcontactVerificationPreview,
  saveRoleProposalAndPersonSearchPreview,
} from "@/server/persistence/people-playbook-store";
import { prospeoConfiguration } from "@/server/persistence/target-account-discovery-store";
import { canExecutePaidProviderCall } from "@/server/telemetry/internal-api-usage";

export class PeoplePlaybookServiceError extends Error {
  constructor(message: string, readonly code: string = "PEOPLE_DISCOVERY_UNAVAILABLE") {
    super(message);
    this.name = "PeoplePlaybookServiceError";
  }
}

function makeNoopExecutor() {
  return {
    proposeRolesPreview: async () => {
      throw new PeoplePlaybookPersistenceError("Role proposal node not active in this stage.");
    },
    executeApprovedPersonSearch: async () => {
      throw new PeoplePlaybookPersistenceError("Person search node not active in this stage.");
    },
    prepareVerificationPreview: async () => {
      throw new PeoplePlaybookPersistenceError("Verification preview node not active in this stage.");
    },
    executeApprovedVerification: async () => {
      throw new PeoplePlaybookPersistenceError("Verification execute node not active in this stage.");
    },
    generatePlaybooks: async () => {
      throw new PeoplePlaybookPersistenceError("Playbook compile node not active in this stage.");
    },
  };
}

export async function getPeopleDiscoveryForConversation(
  session: WorkspaceSession,
  conversationId: string,
): Promise<{
  peopleDiscovery: PeopleDiscoveryView;
  dropcontact: DropcontactProviderState;
}> {
  const peopleDiscovery = await readPeopleDiscoveryForConversation(session, conversationId);
  return {
    peopleDiscovery,
    dropcontact: dropcontactConfiguration(),
  };
}

export type BuyerRoleProposalOptions = {
  providerKey?: PersonDiscoveryProvider;
  roleOverrides?: string[];
  departments?: string[];
  seniorities?: string[];
  excludeTitles?: string[];
  archetype?: CompanyArchetype;
};

export async function proposeBuyerRolesForConversation(
  session: WorkspaceSession,
  conversationId: string,
  optionsInput?: string[] | BuyerRoleProposalOptions,
) {
  const options: BuyerRoleProposalOptions = Array.isArray(optionsInput)
    ? { roleOverrides: optionsInput }
    : optionsInput ?? {};

  const context = await loadShortlistedContext(session, conversationId);
  const checkpointer = await getResearchCheckpointer();
  const buyingCommittee = deriveBuyingCommitteeCriteria({
    industry: context.industry,
    brief: context.brief,
    shortlistedAccounts: context.shortlistedAccounts,
    overrides: {
      archetype: options.archetype,
      departments: options.departments,
      seniorities: options.seniorities,
      roleOverrides: options.roleOverrides,
      excludeTitles: options.excludeTitles,
    },
  });
  const providerKey =
    options.providerKey ??
    recommendPersonDiscoveryProvider(context.shortlistedAccounts, context.industry.name);
  const roleRecommendations = deriveBuyerRoleRecommendations(
    context.industry,
    context.brief,
    buyingCommittee.includeTitles,
    buyingCommittee,
  );

  const graph = createAccountToPeopleGraph(
    {
      ...makeNoopExecutor(),
      proposeRolesPreview: async (input) =>
        saveRoleProposalAndPersonSearchPreview(session, {
          context: { ...context, shortlistedAccounts: input.shortlistedAccounts },
          roleRecommendations,
          providerKey,
          buyingCommittee,
        }),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "propose_roles",
      conversationId,
      shortlistedAccounts: context.shortlistedAccounts,
      roleOverrides: buyingCommittee.includeTitles,
      currentNode: "verify_shortlisted_accounts",
    },
    {
      configurable: {
        thread_id: `ano:account-to-people:${context.targetDecisionId}:${Date.now()}`,
      },
    },
  );

  if (!result.view) {
    throw new PeoplePlaybookServiceError(
      "Ano could not prepare buyer-role recommendations and person search preview.",
    );
  }

  return {
    peopleDiscovery: result.view,
    dropcontact: dropcontactConfiguration(),
  };
}

export async function approvePersonSearchForConversation(
  session: WorkspaceSession,
  conversationId: string,
  personSearchId: string,
) {
  const context = await loadShortlistedContext(session, conversationId);
  const existingView = await readPeopleDiscoveryForConversation(session, conversationId);
  const targetProvider = existingView.personSearch?.providerKey ?? "prospeo";
  if (targetProvider === "prospeo" && !prospeoConfiguration().available) {
    throw new PeoplePlaybookServiceError(
      "Decision-maker directory discovery is not configured on this server.",
      "PROSPEO_NOT_CONFIGURED",
    );
  }
  if (targetProvider === "prospeo") {
    const budgetOk = await canExecutePaidProviderCall(session, "prospeo");
    if (!budgetOk) {
      throw new PeoplePlaybookServiceError(
        "Decision-maker lookup is temporarily paused because workspace usage safeguards could not be verified.",
        "BUDGET_GUARD_BLOCKED",
      );
    }
  }

  const checkpointer = await getResearchCheckpointer();

  const graph = createAccountToPeopleGraph(
    {
      ...makeNoopExecutor(),
      executeApprovedPersonSearch: async (input) =>
        executeApprovedProspeoPersonSearch(session, {
          context,
          personSearchId: input.personSearchId,
        }),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "execute_person_search",
      conversationId,
      shortlistedAccounts: context.shortlistedAccounts,
      personSearchId,
      currentNode: "verify_shortlisted_accounts",
    },
    {
      configurable: {
        thread_id: `ano:account-to-people:${context.targetDecisionId}:person:${personSearchId}:${Date.now()}`,
      },
    },
  );

  if (!result.view) {
    throw new PeoplePlaybookServiceError("Ano could not complete person search.");
  }

  return {
    peopleDiscovery: result.view,
    dropcontact: dropcontactConfiguration(),
  };
}

export async function runWebsiteTeamDiscoveryForConversation(
  session: WorkspaceSession,
  conversationId: string,
  options?: Omit<BuyerRoleProposalOptions, "providerKey">,
) {
  const preview = await proposeBuyerRolesForConversation(session, conversationId, {
    ...options,
    providerKey: "website_team",
  });
  const personSearch = preview.peopleDiscovery.personSearch;
  if (!personSearch) {
    return preview;
  }
  if (personSearch.status !== "awaiting_approval") {
    return preview;
  }
  return approvePersonSearchForConversation(session, conversationId, personSearch.id);
}

export async function prepareContactVerificationForConversation(
  session: WorkspaceSession,
  conversationId: string,
  selectedContactIds: string[],
  requestedProvider?: ContactVerificationProvider,
) {
  const context = await loadShortlistedContext(session, conversationId);
  const existingView = await readPeopleDiscoveryForConversation(session, conversationId);
  const selectedSet = new Set(selectedContactIds);
  const selectedContacts = existingView.contacts.filter((contact) => selectedSet.has(contact.id));
  const providerKey = selectAppropriateVerificationProvider(
    selectedContacts,
    {
      prospeo: prospeoConfiguration().available,
      dropcontact: dropcontactConfiguration().available,
    },
    requestedProvider,
  );
  const checkpointer = await getResearchCheckpointer();

  const graph = createAccountToPeopleGraph(
    {
      ...makeNoopExecutor(),
      prepareVerificationPreview: async (input) =>
        saveDropcontactVerificationPreview(session, {
          context,
          selectedContactIds: input.selectedContactIds,
          providerKey: input.providerKey ?? providerKey,
        }),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "prepare_verification",
      conversationId,
      shortlistedAccounts: context.shortlistedAccounts,
      selectedContactIds,
      verificationProvider: providerKey,
      currentNode: "verify_shortlisted_accounts",
    },
    {
      configurable: {
        thread_id: `ano:account-to-people:${context.targetDecisionId}:verify-preview:${Date.now()}`,
      },
    },
  );

  if (!result.view) {
    throw new PeoplePlaybookServiceError(
      "Ano could not prepare the email verification preview.",
    );
  }

  return {
    peopleDiscovery: result.view,
    dropcontact: dropcontactConfiguration(),
    prospeo: prospeoConfiguration(),
  };
}

export async function approveContactVerificationForConversation(
  session: WorkspaceSession,
  conversationId: string,
  verificationRunId: string,
) {
  const context = await loadShortlistedContext(session, conversationId);
  const existingView = await readPeopleDiscoveryForConversation(session, conversationId);
  const providerKey = existingView.verificationRun?.providerKey ?? "dropcontact";
  if (providerKey === "prospeo" && !prospeoConfiguration().available) {
    throw new PeoplePlaybookServiceError(
      "Work email verification is not configured on this server.",
      "PROSPEO_NOT_CONFIGURED",
    );
  }
  if (providerKey === "dropcontact" && !dropcontactConfiguration().available) {
    throw new PeoplePlaybookServiceError(
      "Work email verification is temporarily paused because this capability is not configured on this server.",
      "DROPCONTACT_NOT_CONFIGURED",
    );
  }
  const budgetOk = await canExecutePaidProviderCall(session, providerKey);
  if (!budgetOk) {
    throw new PeoplePlaybookServiceError(
      "Work email verification is temporarily paused because workspace usage safeguards could not be verified.",
      "BUDGET_GUARD_BLOCKED",
    );
  }

  const checkpointer = await getResearchCheckpointer();

  const graph = createAccountToPeopleGraph(
    {
      ...makeNoopExecutor(),
      executeApprovedVerification: async (input) =>
        executeApprovedDropcontactVerification(session, {
          context,
          verificationRunId: input.verificationRunId,
        }),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "execute_verification",
      conversationId,
      shortlistedAccounts: context.shortlistedAccounts,
      verificationRunId,
      currentNode: "verify_shortlisted_accounts",
    },
    {
      configurable: {
        thread_id: `ano:account-to-people:${context.targetDecisionId}:dc-exec:${verificationRunId}:${Date.now()}`,
      },
    },
  );

  if (!result.view) {
    throw new PeoplePlaybookServiceError(
      "Ano could not complete work email verification.",
    );
  }

  return {
    peopleDiscovery: result.view,
    dropcontact: dropcontactConfiguration(),
    prospeo: prospeoConfiguration(),
  };
}

export async function generateAccountPlaybooksForConversation(
  session: WorkspaceSession,
  conversationId: string,
) {
  const context = await loadShortlistedContext(session, conversationId);
  const checkpointer = await getResearchCheckpointer();

  const graph = createAccountToPeopleGraph(
    {
      ...makeNoopExecutor(),
      generatePlaybooks: async () =>
        compileAndSaveAccountPlaybooks(session, { context }),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "generate_playbooks",
      conversationId,
      shortlistedAccounts: context.shortlistedAccounts,
      currentNode: "verify_shortlisted_accounts",
    },
    {
      configurable: {
        thread_id: `ano:account-to-people:${context.targetDecisionId}:playbooks`,
      },
    },
  );

  if (!result.view) {
    throw new PeoplePlaybookServiceError("Ano could not compile factual account playbooks.");
  }

  return {
    peopleDiscovery: result.view,
    dropcontact: dropcontactConfiguration(),
  };
}

export async function listWorkspaceDiscoveredPeople(
  session: WorkspaceSession,
): Promise<WorkspaceContactDirectoryItem[]> {
  return listWorkspaceContacts(session);
}

export async function listWorkspaceAccountPlaybooks(
  session: WorkspaceSession,
): Promise<WorkspacePlaybookDirectoryItem[]> {
  return listWorkspacePlaybooks(session);
}

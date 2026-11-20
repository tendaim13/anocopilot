import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  deriveBuyerRoleRecommendations,
  type DropcontactProviderState,
  type PeopleDiscoveryView,
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

export async function proposeBuyerRolesForConversation(
  session: WorkspaceSession,
  conversationId: string,
  roleOverrides?: string[],
) {
  const context = await loadShortlistedContext(session, conversationId);
  const checkpointer = await getResearchCheckpointer();
  const roleRecommendations = deriveBuyerRoleRecommendations(
    context.industry,
    context.brief,
    roleOverrides,
  );

  const graph = createAccountToPeopleGraph(
    {
      ...makeNoopExecutor(),
      proposeRolesPreview: async (input) =>
        saveRoleProposalAndPersonSearchPreview(session, {
          context: { ...context, shortlistedAccounts: input.shortlistedAccounts },
          roleRecommendations,
        }),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "propose_roles",
      conversationId,
      shortlistedAccounts: context.shortlistedAccounts,
      roleOverrides: roleOverrides ?? [],
      currentNode: "verify_shortlisted_accounts",
    },
    { configurable: { thread_id: `ano:account-to-people:${context.targetDecisionId}` } },
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
  if (!prospeoConfiguration().available) {
    throw new PeoplePlaybookServiceError(
      "Add PROSPEO_KEY on the server before running Prospeo person discovery.",
      "PROSPEO_NOT_CONFIGURED",
    );
  }

  const context = await loadShortlistedContext(session, conversationId);
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
        thread_id: `ano:account-to-people:${context.targetDecisionId}:person:${personSearchId}`,
      },
    },
  );

  if (!result.view) {
    throw new PeoplePlaybookServiceError("Ano could not complete Prospeo person search.");
  }

  return {
    peopleDiscovery: result.view,
    dropcontact: dropcontactConfiguration(),
  };
}

export async function prepareContactVerificationForConversation(
  session: WorkspaceSession,
  conversationId: string,
  selectedContactIds: string[],
) {
  const context = await loadShortlistedContext(session, conversationId);
  const checkpointer = await getResearchCheckpointer();

  const graph = createAccountToPeopleGraph(
    {
      ...makeNoopExecutor(),
      prepareVerificationPreview: async (input) =>
        saveDropcontactVerificationPreview(session, {
          context,
          selectedContactIds: input.selectedContactIds,
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
      currentNode: "verify_shortlisted_accounts",
    },
    {
      configurable: {
        thread_id: `ano:account-to-people:${context.targetDecisionId}:dc-preview`,
      },
    },
  );

  if (!result.view) {
    throw new PeoplePlaybookServiceError(
      "Ano could not prepare the selective Dropcontact preview.",
    );
  }

  return {
    peopleDiscovery: result.view,
    dropcontact: dropcontactConfiguration(),
  };
}

export async function approveContactVerificationForConversation(
  session: WorkspaceSession,
  conversationId: string,
  verificationRunId: string,
) {
  if (!dropcontactConfiguration().available) {
    throw new PeoplePlaybookServiceError(
      "Add DROPCONTACT_API_KEY on the server before running selective Dropcontact verification.",
      "DROPCONTACT_NOT_CONFIGURED",
    );
  }

  const context = await loadShortlistedContext(session, conversationId);
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
        thread_id: `ano:account-to-people:${context.targetDecisionId}:dc-exec:${verificationRunId}`,
      },
    },
  );

  if (!result.view) {
    throw new PeoplePlaybookServiceError("Ano could not run selective Dropcontact verification.");
  }

  return {
    peopleDiscovery: result.view,
    dropcontact: dropcontactConfiguration(),
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

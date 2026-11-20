import "server-only";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type { AccountCandidateDossier } from "@/lib/ano/company-discovery";
import type {
  AccountPlaybookView,
  ContactVerificationRunView,
  PeopleDiscoveryView,
  PersonSearchView,
} from "@/lib/ano/people-playbooks";

export const ACCOUNT_TO_PEOPLE_GRAPH_NAME = "account-to-people-and-playbooks";
export const ACCOUNT_TO_PEOPLE_GRAPH_VERSION = "phase-e-v1";

export type AccountToPeopleStage =
  | "propose_roles"
  | "execute_person_search"
  | "prepare_verification"
  | "execute_verification"
  | "generate_playbooks";

export type AccountToPeopleExecutor = {
  proposeRolesPreview: (input: {
    conversationId: string;
    shortlistedAccounts: AccountCandidateDossier[];
    roleOverrides?: string[];
  }) => Promise<PeopleDiscoveryView>;
  executeApprovedPersonSearch: (input: {
    conversationId: string;
    personSearchId: string;
    shortlistedAccounts: AccountCandidateDossier[];
  }) => Promise<PeopleDiscoveryView>;
  prepareVerificationPreview: (input: {
    conversationId: string;
    selectedContactIds: string[];
  }) => Promise<PeopleDiscoveryView>;
  executeApprovedVerification: (input: {
    conversationId: string;
    verificationRunId: string;
  }) => Promise<PeopleDiscoveryView>;
  generatePlaybooks: (input: {
    conversationId: string;
    shortlistedAccounts: AccountCandidateDossier[];
  }) => Promise<PeopleDiscoveryView>;
};

export const AccountToPeopleGraphState = Annotation.Root({
  stage: Annotation<AccountToPeopleStage>(),
  conversationId: Annotation<string>(),
  shortlistedAccounts: Annotation<AccountCandidateDossier[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  roleOverrides: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  personSearchId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  selectedContactIds: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  verificationRunId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  view: Annotation<PeopleDiscoveryView | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  personSearch: Annotation<PersonSearchView | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  verificationRun: Annotation<ContactVerificationRunView | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  playbooks: Annotation<AccountPlaybookView[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  currentNode: Annotation<string>(),
});

export type AccountToPeopleGraphStateValue = typeof AccountToPeopleGraphState.State;

/**
 * Bounded Phase E subflow requiring at least one shortlisted Phase D company.
 * Enforces explicit human approval before Prospeo person search AND a separate
 * approval before selective Dropcontact verification.
 */
export function createAccountToPeopleGraph(
  executor: AccountToPeopleExecutor,
  checkpointer: BaseCheckpointSaver,
) {
  const verifyShortlistedAccounts = async (state: AccountToPeopleGraphStateValue) => {
    if (!state.shortlistedAccounts.length) {
      throw new Error(
        "Shortlist at least one company in Phase D before discovering people or compiling playbooks.",
      );
    }
    if (state.stage === "propose_roles") {
      return { currentNode: "propose_buyer_roles" };
    }
    if (state.stage === "execute_person_search") {
      if (!state.personSearchId) {
        throw new Error("A saved person-search preview ID is required before execution.");
      }
      return { currentNode: "execute_approved_person_search" };
    }
    if (state.stage === "prepare_verification") {
      if (!state.selectedContactIds.length) {
        throw new Error("Select at least one named person before preparing Dropcontact verification.");
      }
      return { currentNode: "prepare_dropcontact_preview" };
    }
    if (state.stage === "execute_verification") {
      if (!state.verificationRunId) {
        throw new Error("A saved Dropcontact verification preview ID is required before execution.");
      }
      return { currentNode: "execute_approved_contact_verification" };
    }
    return { currentNode: "compile_factual_playbooks" };
  };

  const proposeBuyerRoles = async (state: AccountToPeopleGraphStateValue) => {
    const view = await executor.proposeRolesPreview({
      conversationId: state.conversationId,
      shortlistedAccounts: state.shortlistedAccounts,
      roleOverrides: state.roleOverrides,
    });
    return {
      view,
      personSearch: view.personSearch,
      personSearchId: view.personSearch?.id ?? null,
      currentNode: "await_person_search_approval",
    };
  };

  const executeApprovedPersonSearch = async (state: AccountToPeopleGraphStateValue) => {
    if (!state.personSearchId) {
      throw new Error("A saved person-search preview ID is required.");
    }
    const view = await executor.executeApprovedPersonSearch({
      conversationId: state.conversationId,
      personSearchId: state.personSearchId,
      shortlistedAccounts: state.shortlistedAccounts,
    });
    const status = view.personSearch?.status;
    return {
      view,
      personSearch: view.personSearch,
      currentNode:
        status === "completed" ? "await_verification_selection" : "review_person_search",
    };
  };

  const prepareDropcontactPreview = async (state: AccountToPeopleGraphStateValue) => {
    const view = await executor.prepareVerificationPreview({
      conversationId: state.conversationId,
      selectedContactIds: state.selectedContactIds,
    });
    return {
      view,
      verificationRun: view.verificationRun,
      verificationRunId: view.verificationRun?.id ?? null,
      currentNode: "await_contact_verification_approval",
    };
  };

  const executeApprovedContactVerification = async (state: AccountToPeopleGraphStateValue) => {
    if (!state.verificationRunId) {
      throw new Error("A saved verification preview ID is required.");
    }
    const view = await executor.executeApprovedVerification({
      conversationId: state.conversationId,
      verificationRunId: state.verificationRunId,
    });
    const status = view.verificationRun?.status;
    return {
      view,
      verificationRun: view.verificationRun,
      currentNode:
        status === "completed" ? "verification_completed" : "review_contact_verification",
    };
  };

  const compileFactualPlaybooks = async (state: AccountToPeopleGraphStateValue) => {
    const view = await executor.generatePlaybooks({
      conversationId: state.conversationId,
      shortlistedAccounts: state.shortlistedAccounts,
    });
    return {
      view,
      playbooks: view.playbooks,
      currentNode: "playbooks_ready",
    };
  };

  const routeAfterVerify = (state: AccountToPeopleGraphStateValue) => {
    if (state.stage === "propose_roles") return "propose_buyer_roles";
    if (state.stage === "execute_person_search") return "execute_approved_person_search";
    if (state.stage === "prepare_verification") return "prepare_dropcontact_preview";
    if (state.stage === "execute_verification") return "execute_approved_contact_verification";
    return "compile_factual_playbooks";
  };

  return new StateGraph(AccountToPeopleGraphState)
    .addNode("verify_shortlisted_accounts", verifyShortlistedAccounts)
    .addNode("propose_buyer_roles", proposeBuyerRoles)
    .addNode("execute_approved_person_search", executeApprovedPersonSearch)
    .addNode("prepare_dropcontact_preview", prepareDropcontactPreview)
    .addNode("execute_approved_contact_verification", executeApprovedContactVerification)
    .addNode("compile_factual_playbooks", compileFactualPlaybooks)
    .addEdge(START, "verify_shortlisted_accounts")
    .addConditionalEdges("verify_shortlisted_accounts", routeAfterVerify)
    .addEdge("propose_buyer_roles", END)
    .addEdge("execute_approved_person_search", END)
    .addEdge("prepare_dropcontact_preview", END)
    .addEdge("execute_approved_contact_verification", END)
    .addEdge("compile_factual_playbooks", END)
    .compile({ checkpointer });
}

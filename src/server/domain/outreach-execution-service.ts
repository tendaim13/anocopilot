import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import type {
  ExecutionProposalType,
  MercuryConnectorState,
  OutreachExecutionView,
} from "@/lib/ano/outreach-execution";
import { mercuryConfiguration } from "@/server/connectors/mercury/mercury-read-connector";
import { getResearchCheckpointer } from "@/server/langgraph/checkpointer";
import { createOutreachExecutionGraph } from "@/server/langgraph/outreach-execution-graph";
import {
  decideAndExecuteProposal,
  generateOutreachDrafts,
  OutreachExecutionPersistenceError,
  readOutreachExecutionForConversation,
  saveEditedOutreachDraftVersion,
  stageExecutionProposalFromDraft,
} from "@/server/persistence/outreach-execution-store";
import {
  loadShortlistedContext,
  readPeopleDiscoveryForConversation,
} from "@/server/persistence/people-playbook-store";

export class OutreachExecutionServiceError extends Error {
  constructor(message: string, readonly code: string = "OUTREACH_EXECUTION_UNAVAILABLE") {
    super(message);
    this.name = "OutreachExecutionServiceError";
  }
}

function makeNoopExecutor() {
  return {
    compileOutreachDrafts: async () => {
      throw new OutreachExecutionPersistenceError("Draft compilation not active in this stage.");
    },
    saveEditedDraftVersion: async () => {
      throw new OutreachExecutionPersistenceError("Draft editing not active in this stage.");
    },
    stageExecutionProposal: async () => {
      throw new OutreachExecutionPersistenceError("Proposal staging not active in this stage.");
    },
    recordDecisionAndExecute: async () => {
      throw new OutreachExecutionPersistenceError("Proposal execution not active in this stage.");
    },
  };
}

export async function getOutreachExecutionForConversation(
  session: WorkspaceSession,
  conversationId: string,
): Promise<{
  outreachExecution: OutreachExecutionView;
  mercury: MercuryConnectorState;
}> {
  const outreachExecution = await readOutreachExecutionForConversation(
    session,
    conversationId,
  );
  return {
    outreachExecution,
    mercury: mercuryConfiguration(),
  };
}

export async function generateOutreachDraftsForConversation(
  session: WorkspaceSession,
  conversationId: string,
  playbookId?: string,
) {
  const [context, peopleDiscovery, checkpointer] = await Promise.all([
    loadShortlistedContext(session, conversationId),
    readPeopleDiscoveryForConversation(session, conversationId),
    getResearchCheckpointer(),
  ]);

  const graph = createOutreachExecutionGraph(
    {
      ...makeNoopExecutor(),
      compileOutreachDrafts: async (input) =>
        generateOutreachDrafts(session, input.conversationId, input.playbookId),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "generate_drafts",
      conversationId,
      playbooks: peopleDiscovery.playbooks,
      playbookId: playbookId ?? null,
      currentNode: "verify_approved_playbooks",
    },
    { configurable: { thread_id: `ano:outreach:${context.targetDecisionId}:drafts` } },
  );

  if (!result.view) {
    throw new OutreachExecutionServiceError("Ano could not compile outreach drafts.");
  }

  return {
    outreachExecution: result.view,
    mercury: mercuryConfiguration(),
  };
}

export async function editOutreachDraftForConversation(
  session: WorkspaceSession,
  conversationId: string,
  draftId: string,
  subject: string,
  body: string,
) {
  const [context, peopleDiscovery, checkpointer] = await Promise.all([
    loadShortlistedContext(session, conversationId),
    readPeopleDiscoveryForConversation(session, conversationId),
    getResearchCheckpointer(),
  ]);

  const graph = createOutreachExecutionGraph(
    {
      ...makeNoopExecutor(),
      saveEditedDraftVersion: async (input) =>
        saveEditedOutreachDraftVersion(
          session,
          input.conversationId,
          input.draftId,
          input.subject,
          input.body,
        ),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "edit_draft",
      conversationId,
      playbooks: peopleDiscovery.playbooks,
      draftId,
      subject,
      body,
      currentNode: "verify_approved_playbooks",
    },
    { configurable: { thread_id: `ano:outreach:${context.targetDecisionId}:edit:${draftId}` } },
  );

  if (!result.view) {
    throw new OutreachExecutionServiceError("Ano could not save the edited outreach draft.");
  }

  return {
    outreachExecution: result.view,
    mercury: mercuryConfiguration(),
  };
}

export async function createProposalFromDraftForConversation(
  session: WorkspaceSession,
  conversationId: string,
  draftId: string,
  proposalType: ExecutionProposalType,
  scheduledFor?: string,
  note?: string,
) {
  const [context, peopleDiscovery, checkpointer] = await Promise.all([
    loadShortlistedContext(session, conversationId),
    readPeopleDiscoveryForConversation(session, conversationId),
    getResearchCheckpointer(),
  ]);

  const graph = createOutreachExecutionGraph(
    {
      ...makeNoopExecutor(),
      stageExecutionProposal: async (input) =>
        stageExecutionProposalFromDraft(session, input),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "create_proposal",
      conversationId,
      playbooks: peopleDiscovery.playbooks,
      draftId,
      proposalType,
      scheduledFor: scheduledFor ?? null,
      note: note ?? null,
      currentNode: "verify_approved_playbooks",
    },
    {
      configurable: {
        thread_id: `ano:outreach:${context.targetDecisionId}:stage:${draftId}:${proposalType}`,
      },
    },
  );

  if (!result.view) {
    throw new OutreachExecutionServiceError("Ano could not stage that execution proposal.");
  }

  return {
    outreachExecution: result.view,
    mercury: mercuryConfiguration(),
  };
}

export async function decideExecutionProposalForConversation(
  session: WorkspaceSession,
  conversationId: string,
  proposalId: string,
  decision: "approved" | "rejected" | "dismissed",
  rationale?: string,
) {
  const [context, peopleDiscovery, checkpointer] = await Promise.all([
    loadShortlistedContext(session, conversationId),
    readPeopleDiscoveryForConversation(session, conversationId),
    getResearchCheckpointer(),
  ]);

  const graph = createOutreachExecutionGraph(
    {
      ...makeNoopExecutor(),
      recordDecisionAndExecute: async (input) =>
        decideAndExecuteProposal(session, input),
    },
    checkpointer,
  );

  const result = await graph.invoke(
    {
      stage: "decide_proposal",
      conversationId,
      playbooks: peopleDiscovery.playbooks,
      proposalId,
      decision,
      rationale: rationale ?? null,
      currentNode: "verify_approved_playbooks",
    },
    {
      configurable: {
        thread_id: `ano:outreach:${context.targetDecisionId}:decide:${proposalId}`,
      },
    },
  );

  if (!result.view) {
    throw new OutreachExecutionServiceError("Ano could not record that proposal decision.");
  }

  return {
    outreachExecution: result.view,
    mercury: mercuryConfiguration(),
  };
}

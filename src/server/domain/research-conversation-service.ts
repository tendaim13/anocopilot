import "server-only";

import { Command } from "@langchain/langgraph";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  conversationPatchSchema,
  graphResumeSchema,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import { BedrockConfigurationError, getAnoAgentMode, getBedrockPlannerConfig } from "@/server/agents/bedrock";
import { createBedrockResearchPlanningModel, ResearchPlanningModelError } from "@/server/agents/research-planning-model";
import { getResearchCheckpointer } from "@/server/langgraph/checkpointer";
import { createResearchGraph } from "@/server/langgraph/research-graph";
import {
  appendUserMessage,
  archiveResearchConversation,
  createResearchConversation,
  failResearchConversation,
  listResearchConversationSummaries,
  readLatestResearchConversation,
  readResearchConversation,
  readWorkspaceWorkQueue,
  recordGraphDecision,
  renameResearchConversation,
  ResearchConversationPersistenceError,
  syncResearchGraphSnapshot,
} from "@/server/persistence/research-conversation-store";

export class ResearchConversationServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchConversationServiceError";
  }
}

function requireBedrock() {
  if (getAnoAgentMode() !== "bedrock") {
    throw new ResearchConversationServiceError("Ano’s research conversation needs Bedrock mode enabled. It will not substitute a mock plan for a real one.");
  }
  try {
    return getBedrockPlannerConfig();
  } catch (error) {
    if (error instanceof BedrockConfigurationError) throw new ResearchConversationServiceError(error.message);
    throw error;
  }
}

async function graphForPhaseA() {
  const config = requireBedrock();
  const [checkpointer] = await Promise.all([getResearchCheckpointer()]);
  return createResearchGraph(createBedrockResearchPlanningModel(config), checkpointer);
}

function graphConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

async function advance(
  session: WorkspaceSession,
  view: ResearchConversationView,
  input: Record<string, unknown> | Command,
) {
  try {
    const graph = await graphForPhaseA();
    const config = graphConfig(view.conversation.threadId);
    await graph.invoke(input as never, config);
    return syncResearchGraphSnapshot(session, view.conversation.id, await graph.getState(config));
  } catch (error) {
    const message = error instanceof ResearchPlanningModelError || error instanceof ResearchConversationServiceError || error instanceof ResearchConversationPersistenceError
      ? error.message
      : "Ano stopped safely while preparing this research conversation. No research, provider, contact, email, schedule, or call action was attempted.";
    await failResearchConversation(session, view.conversation.id, message).catch(() => undefined);
    throw new ResearchConversationServiceError(message);
  }
}

export async function startResearchConversation(session: WorkspaceSession, message: string, idempotencyKey: string) {
  const created = await createResearchConversation(session, message);
  const appended = await appendUserMessage(session, created.conversationId, message, idempotencyKey);
  const view = await readResearchConversation(session, created.conversationId);
  if (!appended.created) return view;
  return advance(session, view, {
    workspaceId: session.workspace.id,
    conversationId: created.conversationId,
    graphRunId: view.run.id,
    submittedMessage: { id: appended.id, text: message },
  });
}

export async function continueResearchConversation(session: WorkspaceSession, conversationId: string, message: string, idempotencyKey: string) {
  const view = await readResearchConversation(session, conversationId);
  if (view.run.status !== "draft" && view.run.status !== "complete_without_research") {
    throw new ResearchConversationServiceError("Ano is waiting for your current question or plan decision. Answer that first so it can keep the conversation coherent.");
  }
  const appended = await appendUserMessage(session, conversationId, message, idempotencyKey);
  if (!appended.created) return readResearchConversation(session, conversationId);
  return advance(session, view, {
    workspaceId: session.workspace.id,
    conversationId,
    graphRunId: view.run.id,
    submittedMessage: { id: appended.id, text: message },
  });
}

export async function resumeResearchConversation(session: WorkspaceSession, conversationId: string, input: unknown, idempotencyKey: string) {
  const response = graphResumeSchema.safeParse(input);
  if (!response.success) throw new ResearchConversationServiceError("Ano could not understand that response. Please answer the current question or choose a plan decision.");
  const view = await readResearchConversation(session, conversationId);
  if (view.run.status !== "awaiting_context" && view.run.status !== "awaiting_plan_approval") {
    throw new ResearchConversationServiceError("Ano is not currently waiting for a response in this conversation.");
  }
  let resume = response.data;
  if (resume.kind === "clarification") {
    const message = await appendUserMessage(session, conversationId, resume.answer, idempotencyKey);
    resume = { ...resume, messageId: message.id };
  }
  if (resume.kind === "edit") {
    const message = await appendUserMessage(session, conversationId, resume.instruction, idempotencyKey);
    resume = { ...resume, messageId: message.id };
  }
  const recorded = await recordGraphDecision(session, conversationId, resume, idempotencyKey);
  if (!recorded) return readResearchConversation(session, conversationId);
  return advance(session, view, new Command({ resume }));
}

export async function getCurrentResearchConversation(session: WorkspaceSession) {
  return readLatestResearchConversation(session);
}

export async function listResearchConversations(
  session: WorkspaceSession,
  options: { cursor?: string | null; limit?: number } = {},
) {
  return listResearchConversationSummaries(session, options);
}

export async function getWorkspaceWorkQueue(session: WorkspaceSession) {
  return readWorkspaceWorkQueue(session);
}

export async function getResearchConversation(session: WorkspaceSession, conversationId: string) {
  return readResearchConversation(session, conversationId);
}

export async function updateResearchConversationTitle(
  session: WorkspaceSession,
  conversationId: string,
  title: string,
) {
  return renameResearchConversation(session, conversationId, title);
}

export async function patchResearchConversation(
  session: WorkspaceSession,
  conversationId: string,
  input: unknown,
): Promise<{ conversation: ResearchConversationView; archived: boolean }> {
  const parsed = conversationPatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new ResearchConversationServiceError(
      parsed.error.issues[0]?.message ?? "Provide a valid conversation title or archive action.",
    );
  }
  if (parsed.data.title !== undefined) {
    await renameResearchConversation(session, conversationId, parsed.data.title);
  }
  if (parsed.data.archived === true) {
    await archiveResearchConversation(session, conversationId);
  }
  return {
    conversation: await readResearchConversation(session, conversationId),
    archived: Boolean(parsed.data.archived),
  };
}

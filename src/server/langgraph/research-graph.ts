import "server-only";

import { Annotation, Command, END, interrupt, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type { Clarification, GraphResume, GraphRunStatus, ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import { clarificationResumeSchema, graphResumeSchema, planResumeSchema } from "@/lib/ano/research-conversation";
import type { ResearchPlanningMessage, ResearchPlanningModel } from "@/server/agents/research-planning-model";

export const RESEARCH_GRAPH_NAME = "research";
export const RESEARCH_GRAPH_VERSION = "phase-a-v1";

type GraphMessage = ResearchPlanningMessage;

export const ResearchGraphState = Annotation.Root({
  workspaceId: Annotation<string>(),
  conversationId: Annotation<string>(),
  graphRunId: Annotation<string>(),
  submittedMessage: Annotation<{ id: string; text: string } | null>(),
  contextMessages: Annotation<GraphMessage[]>({
    reducer: (left, right) => [...(left ?? []), ...(right ?? [])],
    default: () => [],
  }),
  brief: Annotation<ResearchBrief | null>(),
  pendingQuestion: Annotation<Clarification | null>(),
  plan: Annotation<ResearchPlan | null>(),
  status: Annotation<GraphRunStatus>(),
  currentNode: Annotation<string>(),
  lastError: Annotation<string | null>(),
});

export type ResearchGraphStateValue = typeof ResearchGraphState.State;

const latestUserMessage = (messages: GraphMessage[]) => messages.at(-1);

function userMessage(id: string, text: string): GraphMessage {
  return { id, role: "user", text };
}

function readyRoute(state: ResearchGraphStateValue) {
  return state.pendingQuestion ? "ask_clarifying_question" : "create_research_plan";
}

/**
 * Builds Ano's Phase A graph. Nodes may call Bedrock only; no search, fetch,
 * provider, contact, CRM, email, schedule, or calling capability is exposed.
 */
export function createResearchGraph(
  model: ResearchPlanningModel,
  checkpointer: BaseCheckpointSaver,
  options: { autopilotIntake?: boolean } = {},
) {
  const captureMessage = (state: ResearchGraphStateValue) => {
    if (!state.submittedMessage?.text.trim()) throw new Error("Ano needs a message before it can prepare a research brief.");
    return {
      contextMessages: [userMessage(state.submittedMessage.id, state.submittedMessage.text.trim())],
      submittedMessage: null,
      status: "planning" as const,
      currentNode: "validate_message",
      lastError: null,
    };
  };

  const validateMessage = (state: ResearchGraphStateValue) => {
    const message = latestUserMessage(state.contextMessages);
    if (!message?.text.trim()) throw new Error("Ano needs a message before it can prepare a research brief.");
    return { status: "planning" as const, currentNode: "interpret_brief" };
  };

  const interpretBrief = async (state: ResearchGraphStateValue) => {
    const interpretation = await model.interpret(state.contextMessages);
    const brief: ResearchBrief = {
      ...interpretation.brief,
      sourceMessageIds: state.contextMessages.map((message) => message.id),
    };
    const pendingQuestion = interpretation.outcome === "needs_context" && interpretation.clarification
      ? { id: crypto.randomUUID(), ...interpretation.clarification }
      : null;
    return {
      brief,
      pendingQuestion,
      status: pendingQuestion ? "awaiting_context" as const : "planning" as const,
      currentNode: pendingQuestion ? "ask_clarifying_question" : "create_research_plan",
    };
  };

  const askClarifyingQuestion = (state: ResearchGraphStateValue) => {
    if (!state.pendingQuestion) return new Command({ goto: "interpret_brief" });
    const response = clarificationResumeSchema.parse(interrupt({
      kind: "clarification",
      question: state.pendingQuestion.question,
      purpose: state.pendingQuestion.purpose,
    }, { responseSchema: clarificationResumeSchema }));
    return new Command({
      update: {
        contextMessages: [userMessage(response.messageId, response.answer)],
        pendingQuestion: null,
        status: "planning" as const,
        currentNode: "interpret_brief",
      },
      goto: "interpret_brief",
    });
  };

  const createResearchPlan = async (state: ResearchGraphStateValue) => {
    if (!state.brief) throw new Error("Ano could not create a plan before it had a research brief.");
    const editInstruction = state.plan?.userEditInstruction;
    const draft = await model.createPlan(state.brief, editInstruction);
    const plan: ResearchPlan = {
      ...draft,
      id: crypto.randomUUID(),
      version: (state.plan?.version ?? 0) + 1,
      approvalStatus: "awaiting_approval",
      createdAt: new Date().toISOString(),
      ...(editInstruction ? { userEditInstruction: editInstruction } : {}),
    };
    return { plan, status: "awaiting_plan_approval" as const, currentNode: "await_plan_approval" };
  };

  const awaitPlanApproval = (state: ResearchGraphStateValue) => {
    if (!state.plan) throw new Error("Ano could not request plan approval before creating a plan.");
    const response = planResumeSchema.parse(interrupt({
      kind: "research_plan",
      plan: state.plan,
      note: "No research, provider request, company discovery, contact lookup, email, schedule, or call will start in Phase A.",
    }, { responseSchema: planResumeSchema }));

    if (response.kind === "approve") {
      return {
        plan: { ...state.plan, approvalStatus: "approved" as const },
        status: "complete_without_research" as const,
        currentNode: "plan_approved",
      };
    }
    if (response.kind === "decline") {
      return {
        plan: { ...state.plan, approvalStatus: "declined" as const },
        status: "complete_without_research" as const,
        currentNode: "plan_declined",
      };
    }
    return new Command({
      update: {
        plan: { ...state.plan, userEditInstruction: response.instruction },
        contextMessages: [userMessage(response.messageId, response.instruction)],
        status: "planning" as const,
        currentNode: "create_research_plan",
      },
      goto: "create_research_plan",
    });
  };

  const approveAutopilotPlan = (state: ResearchGraphStateValue) => {
    if (!state.plan) throw new Error("Ano could not finalize autopilot plan before creating a plan.");
    return {
      plan: { ...state.plan, approvalStatus: "approved" as const },
      status: "complete_without_research" as const,
      currentNode: "intake_complete_autopilot_ready",
    };
  };

  const planRoute = (state: ResearchGraphStateValue) =>
    options.autopilotIntake && state.brief?.intakeComplete
      ? "approve_autopilot_plan"
      : "await_plan_approval";

  return new StateGraph(ResearchGraphState)
    .addNode("capture_message", captureMessage)
    .addNode("validate_message", validateMessage)
    .addNode("interpret_brief", interpretBrief, { retryPolicy: { maxAttempts: 2, initialInterval: 0.25 } })
    .addNode("ask_clarifying_question", askClarifyingQuestion)
    .addNode("create_research_plan", createResearchPlan, { retryPolicy: { maxAttempts: 2, initialInterval: 0.25 } })
    .addNode("await_plan_approval", awaitPlanApproval)
    .addNode("approve_autopilot_plan", approveAutopilotPlan)
    .addEdge(START, "capture_message")
    .addEdge("capture_message", "validate_message")
    .addEdge("validate_message", "interpret_brief")
    .addConditionalEdges("interpret_brief", readyRoute, ["ask_clarifying_question", "create_research_plan"])
    .addEdge("ask_clarifying_question", END)
    .addConditionalEdges("create_research_plan", planRoute, [
      "await_plan_approval",
      "approve_autopilot_plan",
    ])
    .addEdge("await_plan_approval", END)
    .addEdge("approve_autopilot_plan", END)
    .compile({ checkpointer });
}

export function parseGraphResume(value: unknown): GraphResume {
  return graphResumeSchema.parse(value);
}

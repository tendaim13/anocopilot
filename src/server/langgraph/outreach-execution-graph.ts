import "server-only";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type { AccountPlaybookView } from "@/lib/ano/people-playbooks";
import type {
  ExecutionProposalType,
  OutreachExecutionView,
} from "@/lib/ano/outreach-execution";

export const OUTREACH_EXECUTION_GRAPH_NAME = "outreach-and-mercury-proposals";
export const OUTREACH_EXECUTION_GRAPH_VERSION = "phase-f-v1";

export type OutreachExecutionStage =
  | "generate_drafts"
  | "edit_draft"
  | "create_proposal"
  | "decide_proposal";

export type OutreachExecutionExecutor = {
  compileOutreachDrafts: (input: {
    conversationId: string;
    playbookId?: string;
  }) => Promise<OutreachExecutionView>;
  saveEditedDraftVersion: (input: {
    conversationId: string;
    draftId: string;
    subject: string;
    body: string;
  }) => Promise<OutreachExecutionView>;
  stageExecutionProposal: (input: {
    conversationId: string;
    draftId: string;
    proposalType: ExecutionProposalType;
    scheduledFor?: string;
    note?: string;
  }) => Promise<OutreachExecutionView>;
  recordDecisionAndExecute: (input: {
    conversationId: string;
    proposalId: string;
    decision: "approved" | "rejected" | "dismissed";
    rationale?: string;
  }) => Promise<OutreachExecutionView>;
};

export const OutreachExecutionGraphState = Annotation.Root({
  stage: Annotation<OutreachExecutionStage>(),
  conversationId: Annotation<string>(),
  playbooks: Annotation<AccountPlaybookView[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  playbookId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  draftId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  subject: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  body: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  proposalType: Annotation<ExecutionProposalType | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  scheduledFor: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  note: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  proposalId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  decision: Annotation<"approved" | "rejected" | "dismissed" | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  rationale: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  view: Annotation<OutreachExecutionView | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  currentNode: Annotation<string>(),
});

export type OutreachExecutionGraphStateValue = typeof OutreachExecutionGraphState.State;

/**
 * Phase F controlled execution graph. Compiles outreach drafts only from factual
 * Phase E playbooks, stages every external or Mercury action as an awaiting_approval
 * proposal, and executes only after an explicit human decision is recorded.
 */
export function createOutreachExecutionGraph(
  executor: OutreachExecutionExecutor,
  checkpointer: BaseCheckpointSaver,
) {
  const verifyApprovedPlaybooks = async (state: OutreachExecutionGraphStateValue) => {
    if (!state.playbooks.length) {
      throw new Error(
        "Compile at least one factual Phase E account playbook before preparing outreach drafts or proposals.",
      );
    }
    if (state.stage === "edit_draft" && !state.draftId) {
      throw new Error("A saved outreach draft ID is required before editing.");
    }
    if (state.stage === "create_proposal" && (!state.draftId || !state.proposalType)) {
      throw new Error("A draft ID and proposal type are required to stage an approval proposal.");
    }
    if (state.stage === "decide_proposal" && (!state.proposalId || !state.decision)) {
      throw new Error("A proposal ID and explicit user decision are required.");
    }
    return {
      currentNode: `route_${state.stage}`,
    };
  };

  const compileOutreachDraftsNode = async (state: OutreachExecutionGraphStateValue) => {
    const view = await executor.compileOutreachDrafts({
      conversationId: state.conversationId,
      playbookId: state.playbookId ?? undefined,
    });
    return {
      view,
      currentNode: "await_draft_review_or_proposal",
    };
  };

  const saveEditedDraftVersionNode = async (state: OutreachExecutionGraphStateValue) => {
    if (!state.draftId || !state.subject || !state.body) {
      throw new Error("Subject and body are required when saving a new outreach draft version.");
    }
    const view = await executor.saveEditedDraftVersion({
      conversationId: state.conversationId,
      draftId: state.draftId,
      subject: state.subject,
      body: state.body,
    });
    return {
      view,
      currentNode: "await_draft_review_or_proposal",
    };
  };

  const stageExecutionProposalNode = async (state: OutreachExecutionGraphStateValue) => {
    if (!state.draftId || !state.proposalType) {
      throw new Error("Draft ID and proposal type are required.");
    }
    const view = await executor.stageExecutionProposal({
      conversationId: state.conversationId,
      draftId: state.draftId,
      proposalType: state.proposalType,
      scheduledFor: state.scheduledFor ?? undefined,
      note: state.note ?? undefined,
    });
    return {
      view,
      currentNode: "await_proposal_approval",
    };
  };

  const recordDecisionAndExecuteNode = async (state: OutreachExecutionGraphStateValue) => {
    if (!state.proposalId || !state.decision) {
      throw new Error("Proposal ID and explicit decision are required.");
    }
    const view = await executor.recordDecisionAndExecute({
      conversationId: state.conversationId,
      proposalId: state.proposalId,
      decision: state.decision,
      rationale: state.rationale ?? undefined,
    });
    return {
      view,
      currentNode: state.decision === "approved" ? "proposal_executed" : "proposal_closed",
    };
  };

  const routeAfterVerify = (state: OutreachExecutionGraphStateValue) => {
    if (state.stage === "generate_drafts") return "compile_outreach_drafts";
    if (state.stage === "edit_draft") return "save_edited_draft_version";
    if (state.stage === "create_proposal") return "stage_execution_proposal";
    return "record_decision_and_execute";
  };

  return new StateGraph(OutreachExecutionGraphState)
    .addNode("verify_approved_playbooks", verifyApprovedPlaybooks)
    .addNode("compile_outreach_drafts", compileOutreachDraftsNode)
    .addNode("save_edited_draft_version", saveEditedDraftVersionNode)
    .addNode("stage_execution_proposal", stageExecutionProposalNode)
    .addNode("record_decision_and_execute", recordDecisionAndExecuteNode)
    .addEdge(START, "verify_approved_playbooks")
    .addConditionalEdges("verify_approved_playbooks", routeAfterVerify)
    .addEdge("compile_outreach_drafts", END)
    .addEdge("save_edited_draft_version", END)
    .addEdge("stage_execution_proposal", END)
    .addEdge("record_decision_and_execute", END)
    .compile({ checkpointer });
}

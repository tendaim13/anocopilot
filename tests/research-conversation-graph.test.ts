import assert from "node:assert/strict";
import test from "node:test";

import { Command, MemorySaver } from "@langchain/langgraph";

import type { ResearchBrief, ResearchInterpretation, ResearchPlanDraft } from "@/lib/ano/research-conversation";
import type { ResearchPlanningMessage, ResearchPlanningModel } from "@/server/agents/research-planning-model";
import { createResearchGraph } from "@/server/langgraph/research-graph";

const openingId = "00000000-0000-4000-8000-000000000001";
const answerId = "00000000-0000-4000-8000-000000000002";

const brief = (sourceMessageIds: string[]): ResearchBrief => ({
  offer: "AI workflows that turn quotes into jobs",
  goal: "Find the first outbound market",
  marketHints: [],
  locationHints: [],
  buyerHints: [],
  constraints: [],
  unknowns: [],
  sourceMessageIds,
});

const plan: ResearchPlanDraft = {
  summary: "Compare candidate service-business markets by workflow complexity and reachable demand.",
  researchQuestions: ["Which markets show a large service-business base?", "Which industries have quote-to-job workflow friction?"],
  comparisonCriteria: ["Evidence of workflow complexity", "Reachable market size"],
  intendedSourceClasses: ["Government and official statistics", "Industry bodies and primary research"],
  plannedScope: { markets: [], industries: ["Service businesses"], buyerRoles: [] },
  budget: { maximumSearches: 12, maximumFetches: 30, providerSpend: "not_available_in_phase_a" },
  uncertainties: ["No location preference was supplied."],
};

function model(mode: "ready" | "clarify"): ResearchPlanningModel {
  return {
    async interpret(messages: ResearchPlanningMessage[]): Promise<ResearchInterpretation> {
      if (mode === "clarify" && messages.length === 1) {
        return {
          outcome: "needs_context",
          brief: { ...brief([]), unknowns: ["Whether to optimise for speed or willingness to pay"] },
          clarification: { question: "Should Ano optimise for the fastest first sales or strongest willingness to pay?", purpose: "That choice changes the market-comparison criteria." },
        };
      }
      return { outcome: "ready", brief: { ...brief([]), unknowns: [] } };
    },
    async createPlan() { return plan; },
  };
}

function input() {
  return {
    workspaceId: "workspace-1",
    conversationId: "00000000-0000-4000-8000-000000000010",
    graphRunId: "00000000-0000-4000-8000-000000000011",
    submittedMessage: { id: openingId, text: "I sell AI workflows that turn quotes into jobs. Help me find a first outbound market." },
  };
}

test("a sufficient sentence produces a persisted, approval-gated plan", async () => {
  const graph = createResearchGraph(model("ready"), new MemorySaver());
  const config = { configurable: { thread_id: "sufficient" } };
  await graph.invoke(input(), config);
  const state = await graph.getState(config);
  assert.equal(state.values.status, "awaiting_plan_approval", JSON.stringify(state.values));
  assert.equal(state.values.plan.approvalStatus, "awaiting_approval");
  assert.equal(state.tasks[0]?.interrupts[0]?.value.kind, "research_plan");

  await graph.invoke(new Command({ resume: { kind: "approve" } }), config);
  const approved = await graph.getState(config);
  assert.equal(approved.values.status, "complete_without_research");
  assert.equal(approved.values.plan.approvalStatus, "approved");
});

test("an ambiguous message pauses for exactly one decision-changing clarification and resumes the same thread", async () => {
  const graph = createResearchGraph(model("clarify"), new MemorySaver());
  const config = { configurable: { thread_id: "clarification" } };
  await graph.invoke(input(), config);
  const paused = await graph.getState(config);
  assert.equal(paused.values.status, "awaiting_context");
  assert.equal(paused.tasks[0]?.interrupts[0]?.value.kind, "clarification");

  await graph.invoke(new Command({ resume: { kind: "clarification", answer: "Fast first sales.", messageId: answerId } }), config);
  const resumed = await graph.getState(config);
  assert.equal(resumed.values.status, "awaiting_plan_approval");
  assert.equal(resumed.values.contextMessages.length, 2);
});

test("an edit creates a new plan version instead of starting research", async () => {
  const graph = createResearchGraph(model("ready"), new MemorySaver());
  const config = { configurable: { thread_id: "plan-edit" } };
  await graph.invoke(input(), config);
  await graph.invoke(new Command({ resume: { kind: "edit", instruction: "Focus on Australia first.", messageId: answerId } }), config);
  const state = await graph.getState(config);
  assert.equal(state.values.status, "awaiting_plan_approval");
  assert.equal(state.values.plan.version, 2);
  assert.equal(state.values.plan.approvalStatus, "awaiting_approval");
});

test("a declined plan stops before any future research stage", async () => {
  const graph = createResearchGraph(model("ready"), new MemorySaver());
  const config = { configurable: { thread_id: "plan-decline" } };
  await graph.invoke(input(), config);
  await graph.invoke(new Command({ resume: { kind: "decline", reason: "Different direction." } }), config);
  const state = await graph.getState(config);
  assert.equal(state.values.status, "complete_without_research");
  assert.equal(state.values.plan.approvalStatus, "declined");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConversationMessageParts,
  conversationPatchSchema,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";

const convId = "00000000-0000-4000-8000-000000000101";
const runId = "00000000-0000-4000-8000-000000000102";
const msgId = "00000000-0000-4000-8000-000000000103";
const planId = "00000000-0000-4000-8000-000000000104";
const researchRunId = "00000000-0000-4000-8000-000000000105";
const synthesisId = "00000000-0000-4000-8000-000000000106";
const decisionId = "00000000-0000-4000-8000-000000000107";
const now = "2026-11-21T03:00:00.000Z";

function baseConversation(approvalStatus: "awaiting_approval" | "approved"): ResearchConversationView {
  return {
    conversation: {
      id: convId,
      title: "Service workflow outbound market",
      status: approvalStatus === "approved" ? "complete_without_research" : "awaiting_plan_approval",
      threadId: `ano:ws:${convId}`,
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: runId,
      status: approvalStatus === "approved" ? "complete_without_research" : "awaiting_plan_approval",
      graphVersion: "phase-a-v1",
      currentNode: "await_plan_approval",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [
      {
        id: msgId,
        role: "user",
        kind: "message",
        text: "Help me find an outbound market.",
        createdAt: now,
      },
    ],
    brief: null,
    pendingQuestion: null,
    plan: {
      id: planId,
      version: 1,
      approvalStatus,
      createdAt: now,
      summary: "Compare markets",
      researchQuestions: ["Which market has urgency?", "Which segment has density?"],
      comparisonCriteria: ["Problem urgency", "Market density"],
      intendedSourceClasses: ["Government and official statistics"],
      plannedScope: { markets: ["Malaysia"], industries: ["Trades"], buyerRoles: ["Owner"] },
      budget: {
        maximumSearches: 12,
        maximumFetches: 30,
        providerSpend: "not_available_in_phase_a",
      },
      uncertainties: [],
    },
    events: [],
  };
}

test("buildConversationMessageParts builds Phase A awaiting_approval parts", () => {
  const parts = buildConversationMessageParts(baseConversation("awaiting_approval"), null, null);
  assert.deepEqual(parts, [
    { type: "text", markdown: "Help me find an outbound market." },
    { type: "artifact", artifactType: "research_plan", artifactId: planId },
    { type: "status", state: "awaiting_approval" },
  ]);
});

test("buildConversationMessageParts builds Phase B and Phase C artifact parts", () => {
  const research: EvidenceResearchView = {
    run: {
      id: researchRunId,
      conversationId: convId,
      threadId: `ano:research:${researchRunId}`,
      attemptNumber: 1,
      provider: "searxng",
      status: "sources_ready",
      maximumSearches: 50,
      maximumFetches: 100,
      consumedSearches: 5,
      consumedFetches: 8,
      currentWave: 1,
      sourceCount: 4,
      failureMessage: null,
      createdAt: now,
      updatedAt: now,
    },
    actions: [],
    queries: [],
    sources: [],
  };

  const synthesis: MarketSynthesis = {
    id: synthesisId,
    conversationId: convId,
    researchRunId,
    status: "ready_for_decision",
    recommendationMode: "directly_supported",
    assessment: {
      fetchedSourceCount: 4,
      sourceClassCount: 2,
      coverageStrength: "moderate",
      comparisonReady: true,
      contradictions: [],
      gaps: [],
      summary: "Comparable evidence across Malaysia and Singapore.",
    },
    claims: [],
    markets: [],
    industries: [],
    decision: {
      id: decisionId,
      status: "awaiting_selection",
      marketProfileId: null,
      industryProfileId: null,
      rationale: null,
      selectedAt: null,
    },
    failureMessage: null,
    createdAt: now,
    updatedAt: now,
  };

  const parts = buildConversationMessageParts(baseConversation("approved"), research, synthesis);
  assert.deepEqual(parts, [
    { type: "text", markdown: "Help me find an outbound market." },
    { type: "artifact", artifactType: "research_plan", artifactId: planId },
    { type: "artifact", artifactType: "provider_scope", artifactId: researchRunId },
    { type: "artifact", artifactType: "research_progress", artifactId: researchRunId },
    { type: "artifact", artifactType: "evidence_report", artifactId: synthesisId },
    { type: "artifact", artifactType: "target_decision", artifactId: decisionId },
    { type: "status", state: "awaiting_approval" },
  ]);
});

test("conversationPatchSchema enforces title or archive action", () => {
  assert.equal(conversationPatchSchema.safeParse({}).success, false);
  assert.equal(conversationPatchSchema.safeParse({ title: "   " }).success, false);
  assert.equal(conversationPatchSchema.safeParse({ title: "a".repeat(161) }).success, false);
  assert.equal(conversationPatchSchema.safeParse({ title: "Malaysia trades study" }).success, true);
  assert.equal(conversationPatchSchema.safeParse({ archived: true }).success, true);
});

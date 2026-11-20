import assert from "node:assert/strict";
import test from "node:test";

import { classifyConversationWorkItem } from "@/lib/ano/work-queue";
import type { ResearchConversationSummary } from "@/lib/ano/research-conversation";

const convId = "00000000-0000-4000-8000-000000000201";
const now = "2026-11-21T03:20:00.000Z";

function summary(
  status: ResearchConversationSummary["status"],
): ResearchConversationSummary {
  return {
    id: convId,
    title: "Malaysia commercial trades",
    status,
    createdAt: now,
    updatedAt: now,
  };
}

test("classifyConversationWorkItem identifies Phase A clarification and plan approval", () => {
  const clarification = classifyConversationWorkItem({
    conversation: summary("awaiting_context"),
  });
  assert.equal(clarification?.category, "needs_clarification");
  assert.equal(clarification?.bucket, "needs_review");

  const planReview = classifyConversationWorkItem({
    conversation: summary("awaiting_plan_approval"),
  });
  assert.equal(planReview?.category, "plan_approval_required");
  assert.equal(planReview?.bucket, "needs_review");
});

test("classifyConversationWorkItem identifies Phase B provider approval, running wave, and manual review", () => {
  const approval = classifyConversationWorkItem({
    conversation: summary("complete_without_research"),
    planApprovalStatus: "approved",
    researchRun: {
      status: "awaiting_provider_approval",
      maximumSearches: 50,
      maximumFetches: 100,
    },
  });
  assert.equal(approval?.category, "provider_scope_approval_required");
  assert.equal(approval?.bucket, "needs_review");

  const running = classifyConversationWorkItem({
    conversation: summary("complete_without_research"),
    planApprovalStatus: "approved",
    researchRun: {
      status: "running",
      currentWave: 2,
      consumedSearches: 7,
      maximumSearches: 50,
    },
  });
  assert.equal(running?.category, "active_running");
  assert.equal(running?.bucket, "active_research");

  const manual = classifyConversationWorkItem({
    conversation: summary("complete_without_research"),
    planApprovalStatus: "approved",
    researchRun: {
      status: "requires_manual_review",
      failureMessage: "Search request was excluded without retry.",
    },
  });
  assert.equal(manual?.category, "manual_review_required");
  assert.equal(manual?.bucket, "needs_review");
});

test("classifyConversationWorkItem identifies Phase C target decision and clears when locked", () => {
  const awaitingTarget = classifyConversationWorkItem({
    conversation: summary("complete_without_research"),
    planApprovalStatus: "approved",
    researchRun: { status: "sources_ready" },
    synthesis: { status: "ready_for_decision" },
    targetDecision: { status: "awaiting_selection" },
  });
  assert.equal(awaitingTarget?.category, "target_decision_required");
  assert.equal(awaitingTarget?.bucket, "needs_review");

  const locked = classifyConversationWorkItem({
    conversation: summary("complete_without_research"),
    planApprovalStatus: "approved",
    researchRun: { status: "sources_ready" },
    synthesis: { status: "ready_for_decision" },
    targetDecision: { status: "locked" },
  });
  assert.equal(locked, null);
});

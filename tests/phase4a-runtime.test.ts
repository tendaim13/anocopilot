import assert from "node:assert/strict";
import test from "node:test";

import type { ResearchInput } from "@/lib/ano/types";
import { AgentRuntimeError, runBoundedMockSalesResearch } from "@/server/agents/runtime";
import { evaluateToolIntent } from "@/server/policy/tool-guard";

const input: ResearchInput = {
  objective: "Find Australian service firms likely to benefit from a clearer quote-to-job and follow-up workflow.",
  industry: "Fire protection and facilities services",
  geography: "Australia",
  targetRole: "Operations Director or Service Manager",
  exclusions: "Solo operators, residential-only work",
  maxResults: 3,
};

test("Phase 4A executes only the five bounded mock tools and records their trace", () => {
  const run = runBoundedMockSalesResearch({ input, idempotencyKey: "1a111111-1111-4111-8111-111111111111" });
  const execution = run.result.run.execution;

  assert.ok(execution);
  assert.equal(execution.engine, "bounded_mock_tool_loop");
  assert.equal(execution.usage.toolCalls, 5);
  assert.equal(execution.usage.turns, 5);
  assert.equal(execution.usage.evidenceItems, 9);
  assert.equal(execution.policy.externalConnections, "disabled");
  assert.equal(execution.policy.externalActions, "disabled");
  assert.deepEqual(run.result.toolTrail.map((event) => event.tool), [
    "search_companies",
    "search_people",
    "get_account_evidence",
    "compute_score",
    "build_today_plan",
  ]);
  assert.ok(run.result.toolTrail.every((event) => event.simulated && event.status === "completed"));
  assert.ok(run.result.candidates.every((candidate) => candidate.evidence.every((item) => item.simulated && Boolean(item.id))));
});

test("Phase 4A stops before executing beyond its tool limit", () => {
  assert.throws(
    () => runBoundedMockSalesResearch({ input, idempotencyKey: "2a222222-2222-4222-8222-222222222222", limits: { maxToolCalls: 4 } }),
    (error: unknown) => {
      assert.ok(error instanceof AgentRuntimeError);
      assert.equal(error.code, "TOOL_LIMIT");
      assert.equal(error.checkpoint.phase, "failed");
      assert.equal(error.checkpoint.toolCalls, 4);
      return true;
    },
  );
});

test("future provider and Mercury requests have no executable path in Phase 4A", () => {
  assert.equal(
    evaluateToolIntent({ tool: "get_mercury_activity", initiatedBy: "agent", payload: {} }).disposition,
    "deny",
  );
  assert.equal(
    evaluateToolIntent({ tool: "provider_search", initiatedBy: "agent", payload: {} }).disposition,
    "ask",
  );
  assert.equal(
    evaluateToolIntent({ tool: "propose_mercury_draft", initiatedBy: "agent", payload: {} }).disposition,
    "ask",
  );
});

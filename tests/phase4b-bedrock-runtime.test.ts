import assert from "node:assert/strict";
import test from "node:test";

import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

import type { ResearchInput } from "@/lib/ano/types";
import type { BedrockConverse, BedrockPlannerConfig } from "@/server/agents/bedrock-contracts";
import { runBedrockSalesResearch } from "@/server/agents/bedrock-runtime";
import { AgentRuntimeError } from "@/server/agents/runtime";

const input: ResearchInput = {
  objective: "Find Australian service firms likely to benefit from a clearer quote-to-job and follow-up workflow.",
  industry: "Fire protection and facilities services",
  geography: "Australia",
  targetRole: "Operations Director or Service Manager",
  exclusions: "Solo operators, residential-only work",
  maxResults: 3,
};

const config: BedrockPlannerConfig = {
  region: "ap-southeast-2",
  modelId: "test-model",
  guardrailIdentifier: "test-guardrail",
  guardrailVersion: "1",
};

function response(value: unknown): ConverseCommandOutput {
  return value as ConverseCommandOutput;
}

function toolUse(name: string, toolUseId: string, toolInput: Record<string, unknown> = {}) {
  return response({
    stopReason: "tool_use",
    output: { message: { role: "assistant", content: [{ toolUse: { name, toolUseId, input: toolInput } }] } },
  });
}

function plannedConverse(responses: ConverseCommandOutput[]) {
  const requests: Parameters<BedrockConverse>[0][] = [];
  const converse: BedrockConverse = async (request) => {
    requests.push(structuredClone(request));
    const next = responses.shift();
    if (!next) throw new Error("Unexpected extra Bedrock planner turn.");
    return next;
  };
  return { converse, requests };
}

test("Phase 4B matches every Bedrock tool request to Ano’s bounded mock executor", async () => {
  const planned = plannedConverse([
    toolUse("search_companies", "use-1"),
    toolUse("search_people", "use-2"),
    toolUse("get_account_evidence", "use-3"),
    toolUse("compute_score", "use-4"),
    toolUse("build_today_plan", "use-5"),
    response({
      stopReason: "end_turn",
      output: {
        message: {
          role: "assistant",
          content: [{ text: JSON.stringify({
            summary: "Harbor Facilities Group is the strongest simulated account for review.",
            evidenceIds: ["E-101", "E-102"],
            inferences: ["The buying timeline remains uncertain until a human validates it."],
          }) }],
        },
      },
    }),
  ]);

  const run = await runBedrockSalesResearch({ input, idempotencyKey: "3a333333-3333-4333-8333-333333333333" }, config, planned.converse);

  assert.equal(planned.requests.length, 6);
  assert.equal(run.result.run.mode, "bedrock_mock_tools");
  assert.equal(run.result.run.execution?.planner?.kind, "bedrock");
  assert.equal(run.result.run.execution?.planner?.modelTurns, 6);
  assert.equal(run.result.run.agentAnswer?.source, "bedrock");
  assert.deepEqual(run.result.run.agentAnswer?.evidenceIds, ["E-101", "E-102"]);
  assert.equal(run.result.toolTrail.length, 5);

  const secondRequest = planned.requests[1];
  const toolResult = secondRequest.messages.at(-1)?.content?.[0]?.toolResult;
  const toolResultData = toolResult?.content?.[0]?.json as { simulated?: unknown } | undefined;
  assert.equal(toolResult?.toolUseId, "use-1");
  assert.equal(toolResultData?.simulated, true);
});

test("Phase 4B rejects tool inputs that Bedrock guardrails do not inspect", async () => {
  const planned = plannedConverse([toolUse("search_companies", "use-invalid", { ignored: "not allowed" })]);

  await assert.rejects(
    () => runBedrockSalesResearch({ input, idempotencyKey: "4a444444-4444-4444-8444-444444444444" }, config, planned.converse),
    (error: unknown) => {
      assert.ok(error instanceof AgentRuntimeError);
      assert.equal(error.code, "MALFORMED_TOOL_INPUT");
      assert.equal(error.checkpoint.toolCalls, 0);
      return true;
    },
  );
});

test("Phase 4B surfaces a Bedrock guardrail intervention without executing a tool", async () => {
  const planned = plannedConverse([response({ stopReason: "guardrail_intervened" })]);

  await assert.rejects(
    () => runBedrockSalesResearch({ input, idempotencyKey: "5a555555-5555-4555-8555-555555555555" }, config, planned.converse),
    (error: unknown) => {
      assert.ok(error instanceof AgentRuntimeError);
      assert.equal(error.code, "MODEL_GUARDRAIL");
      assert.equal(error.checkpoint.toolCalls, 0);
      return true;
    },
  );
});

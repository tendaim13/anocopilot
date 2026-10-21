import assert from "node:assert/strict";
import test from "node:test";

import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

import type { StandaloneBriefInput } from "../src/lib/ano/standalone";
import { BedrockAdapterError, type BedrockConverse, type BedrockPlannerConfig } from "../src/server/agents/bedrock-contracts";
import { AgentRuntimeError } from "../src/server/agents/runtime";
import { runStandaloneBrief } from "../src/server/agents/standalone-brief-runtime";

const input: StandaloneBriefInput = {
  companyName: "Northstar Fire Services",
  companyIndustry: "Fire protection",
  companyLocation: "Sydney, Australia",
  contactName: "Alex Kim",
  contactRole: "Operations Director",
  accountContext: "The team has described an inconsistent handoff between field inspections, quotes, and follow-up. They want a clearer workflow before their next operational review.",
  salesObjective: "Prepare a focused first conversation about improving quote-to-job follow-up.",
};

const config: BedrockPlannerConfig = {
  region: "test-region",
  modelId: "test-model",
  guardrailIdentifier: "test-guardrail",
  guardrailVersion: "1",
};

function completedBrief(overrides: Record<string, unknown> = {}): ConverseCommandOutput {
  return {
    stopReason: "end_turn",
    output: {
      message: {
        role: "assistant",
        content: [{ text: JSON.stringify({
          summary: "The supplied account context supports a focused workflow conversation, subject to confirming the operational owner’s priorities.",
          rationale: "The workspace notes identify a handoff problem and a specific operational review, so Ano should keep the first conversation focused on the current process.",
          knownFacts: [{ text: "The workspace notes describe an inconsistent inspection-to-follow-up handoff.", evidenceIds: ["M-002"] }],
          questions: ["Which part of the handoff creates the most delay today?"],
          assumptions: ["The operations review is still upcoming."],
          evidenceIds: ["M-001", "M-002", "M-003", "M-004"],
          outreach: { subject: "A clearer inspection-to-follow-up handoff", body: "Hi Alex,\n\nBased on the workflow context you shared, I thought it could be useful to compare where inspection, quote, and follow-up handoffs become inconsistent. Would a short conversation before the operational review be useful?" },
          plan: [{ title: "Review the workflow context", action: "Review context", priority: "Now", reason: "Use the recorded handoff issue to prepare the first discussion.", evidenceIds: ["M-002"] }],
          ...overrides,
        }) }],
      },
    },
  } as ConverseCommandOutput;
}

test("standalone brief sends no tool schema and grounds output in workspace evidence", async () => {
  const requests: Array<Parameters<BedrockConverse>[0]> = [];
  const converse: BedrockConverse = async (request) => {
    requests.push(structuredClone(request));
    return completedBrief();
  };

  const result = await runStandaloneBrief(input, config, converse);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].toolConfig, undefined);
  assert.equal(result.run.mode, "bedrock");
  assert.equal(result.evidence.every((item) => item.id.startsWith("M-")), true);
  assert.equal(result.readiness.components.some((component) => component.label === "Contact context"), true);
  assert.match(result.brief.outreach.body, /workflow context/i);
});

test("standalone brief rejects a model citation that was not supplied by the workspace", async () => {
  const converse: BedrockConverse = async () => completedBrief({ evidenceIds: ["M-999"] });
  await assert.rejects(
    () => runStandaloneBrief(input, config, converse),
    (error: unknown) => error instanceof AgentRuntimeError && error.code === "MODEL_MALFORMED",
  );
});

test("standalone brief exposes a missing AWS credential category without returning a mock result", async () => {
  const converse: BedrockConverse = async () => {
    throw new BedrockAdapterError("Ano’s server has no AWS credentials.", "CREDENTIALS_UNAVAILABLE");
  };
  await assert.rejects(
    () => runStandaloneBrief(input, config, converse),
    (error: unknown) => error instanceof AgentRuntimeError && error.code === "BEDROCK_CREDENTIALS_UNAVAILABLE",
  );
});

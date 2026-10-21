import assert from "node:assert/strict";
import test from "node:test";

import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

import type { IcpProfileInput } from "../src/lib/ano/icp";
import { BedrockAdapterError, type BedrockConverse, type BedrockPlannerConfig } from "../src/server/agents/bedrock-contracts";
import { AgentRuntimeError } from "../src/server/agents/runtime";
import { runIcpProfile } from "../src/server/agents/icp-profile-runtime";

const input: IcpProfileInput = {
  productName: "Quote-to-job workflow software",
  productDescription: "A workflow system for field-service teams that connects site inspections, quotes, approvals, scheduled work, and customer follow-up in one operational flow.",
  valueProposition: "Reduce lost time and revenue caused by manual handoffs between technical field work, quoting, and follow-up.",
  targetMarket: "Commercial fire protection and facilities service businesses",
  targetLocations: "Australia and New Zealand",
  idealCustomerProfile: "Growing field-service businesses with recurring inspections, quoting volume, and multiple handoffs between technical and sales teams.",
  buyerRoles: "Operations Director, Service Manager, Founder",
  salesObjective: "Define the first outbound segment and the research criteria Ano should apply later.",
  exclusions: "Residential-only providers and companies without field-service teams.",
  contextNotes: "The first campaign should favour teams where quote follow-up is operationally important.",
};

const config: BedrockPlannerConfig = { region: "test-region", modelId: "test-model", guardrailIdentifier: "test-guardrail", guardrailVersion: "1" };

function completedIcp(overrides: Record<string, unknown> = {}): ConverseCommandOutput {
  return {
    stopReason: "end_turn",
    output: {
      message: {
        role: "assistant",
        content: [{ text: JSON.stringify({
          positioning: "Position the offer around operational continuity between inspections, quotes, and follow-up rather than generic sales automation.",
          idealCustomerSummary: "Prioritise growing commercial fire protection and facilities service businesses with recurring inspections and complex cross-team handoffs.",
          knownFacts: [{ text: "The workspace offer connects inspection, quoting, scheduled work, and customer follow-up.", evidenceIds: ["M-001"] }],
          questions: ["Which company-size band has the clearest operational need today?"],
          assumptions: ["Quote follow-up is a meaningful source of operational leakage for the intended segment."],
          evidenceIds: ["M-001", "M-002", "M-003", "M-004", "M-005"],
          plan: [{ title: "Define the first account segment", action: "Define segment", priority: "Now", reason: "Use the supplied target market, locations, and operating pattern to state the first research segment.", evidenceIds: ["M-003", "M-004"] }],
          ...overrides,
        }) }],
      },
    },
  } as ConverseCommandOutput;
}

test("ICP setup sends no tool schema and produces a source-bound market profile", async () => {
  const requests: Array<Parameters<BedrockConverse>[0]> = [];
  const converse: BedrockConverse = async (request) => {
    requests.push(structuredClone(request));
    return completedIcp();
  };

  const result = await runIcpProfile(input, config, converse);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].toolConfig, undefined);
  assert.equal(result.run.mode, "bedrock");
  assert.equal(result.evidence.every((item) => item.id.startsWith("M-")), true);
  assert.equal(result.readiness.components.some((component) => component.label === "Buyer context"), true);
  assert.equal("account" in result, false);
  assert.match(result.brief.idealCustomerSummary, /fire protection/i);
});

test("ICP setup rejects a model citation that was not supplied by the workspace", async () => {
  const converse: BedrockConverse = async () => completedIcp({ evidenceIds: ["M-999"] });
  await assert.rejects(
    () => runIcpProfile(input, config, converse),
    (error: unknown) => error instanceof AgentRuntimeError && error.code === "MODEL_MALFORMED",
  );
});

test("ICP setup exposes missing AWS credentials without returning a mock result", async () => {
  const converse: BedrockConverse = async () => { throw new BedrockAdapterError("Ano’s server has no AWS credentials.", "CREDENTIALS_UNAVAILABLE"); };
  await assert.rejects(
    () => runIcpProfile(input, config, converse),
    (error: unknown) => error instanceof AgentRuntimeError && error.code === "BEDROCK_CREDENTIALS_UNAVAILABLE",
  );
});

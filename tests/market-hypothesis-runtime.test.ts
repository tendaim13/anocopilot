import assert from "node:assert/strict";
import test from "node:test";

import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

import { productBriefInputSchema, type ProductBriefInput } from "../src/lib/ano/market-discovery";
import { BedrockAdapterError, type BedrockConverse, type BedrockPlannerConfig } from "../src/server/agents/bedrock-contracts";
import { runMarketHypothesis } from "../src/server/agents/market-hypothesis-runtime";
import { AgentRuntimeError } from "../src/server/agents/runtime";

const input: ProductBriefInput = {
  offer: "AI workflows that turn quotes into scheduled jobs for operational teams.",
  objective: "Find a credible first outbound market.",
  marketHunch: "Service businesses",
  locationPreference: "",
  buyerHunch: "Operations leaders",
  customerExamples: "",
  exclusions: "",
  additionalContext: "",
};

const config: BedrockPlannerConfig = { region: "test-region", modelId: "test-model", guardrailIdentifier: "test-guardrail", guardrailVersion: "1" };

function completedMarketHypothesis(overrides: Record<string, unknown> = {}): ConverseCommandOutput {
  return {
    stopReason: "end_turn",
    output: {
      message: {
        role: "assistant",
        content: [{ text: `\`\`\`json\n${JSON.stringify({
          marketMap: "The offer may fit service businesses where quoted work moves across operational handoffs and the stated objective is to test an outbound market.",
          hypotheses: [
            { title: "Operational handoff hypothesis", statement: "Service businesses with frequent handoffs between quoting and delivery may be worth testing because the offer focuses on turning quotes into scheduled jobs.", evidenceIds: ["B-001"] },
            { title: "Buyer hypothesis", statement: "Operations leaders could be a useful initial buyer hypothesis because that is the only buyer context supplied by the user.", evidenceIds: ["B-004"] },
          ],
          assumptions: ["The stated service-business hunch should be validated before it is used as a targeting rule."],
          questions: ["Is there a specific service workflow or job type where slow quote follow-up is most costly?"],
          ...overrides,
        })}\n\`\`\`` }],
      },
    },
  } as ConverseCommandOutput;
}

test("product briefs only require an offer and objective", () => {
  assert.equal(productBriefInputSchema.safeParse({ offer: "AI workflows", objective: "Find buyers" }).success, true);
  assert.equal(productBriefInputSchema.safeParse({ offer: "", objective: "Find buyers" }).success, false);
});

test("market hypothesis runtime performs no provider or tool call and labels its result as a decision gate", async () => {
  const requests: Array<Parameters<BedrockConverse>[0]> = [];
  const result = await runMarketHypothesis(input, config, async (request) => {
    requests.push(structuredClone(request));
    return completedMarketHypothesis();
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].toolConfig, undefined);
  assert.equal(requests[0].maxTokens, 1_100);
  assert.equal(result.run.status, "awaiting_scope_decision");
  assert.equal(result.locationDecision.type, "choose_research_path");
  assert.equal(result.evidence.every((item) => item.id.startsWith("B-")), true);
  assert.equal(result.hypothesis.hypotheses.every((item) => item.evidenceIds.every((id) => id.startsWith("B-"))), true);
  assert.equal("companies" in result, false);
});

test("market hypothesis runtime derives a location confirmation from user input rather than treating it as a market conclusion", async () => {
  const result = await runMarketHypothesis({ ...input, locationPreference: "Malaysia" }, config, async () => completedMarketHypothesis({
    hypotheses: [
      { title: "Operational handoff hypothesis", statement: "Operational teams may be worth testing because the stated offer links quotes to scheduled jobs.", evidenceIds: ["B-001"] },
      { title: "Location is a preference", statement: "Malaysia should be treated as a user preference that still needs research validation.", evidenceIds: ["B-004"] },
    ],
  }));
  assert.equal(result.locationDecision.type, "confirm_preference");
  assert.match(result.locationDecision.prompt, /Malaysia/);
  assert.equal(result.locationDecision.options[0].key, "lock_location");
});

test("market hypothesis runtime rejects a citation outside the user brief", async () => {
  await assert.rejects(
    () => runMarketHypothesis(input, config, async () => completedMarketHypothesis({ hypotheses: [{ title: "Bad citation", statement: "This is not grounded in the product brief.", evidenceIds: ["B-999"] }, { title: "Second", statement: "This is also not grounded in the product brief.", evidenceIds: ["B-001"] }] })),
    (error: unknown) => error instanceof AgentRuntimeError && error.code === "MODEL_MALFORMED",
  );
});

test("market hypothesis runtime exposes Bedrock credential failures without a fallback", async () => {
  const converse: BedrockConverse = async () => { throw new BedrockAdapterError("Ano’s server has no AWS credentials.", "CREDENTIALS_UNAVAILABLE"); };
  await assert.rejects(
    () => runMarketHypothesis(input, config, converse),
    (error: unknown) => error instanceof AgentRuntimeError && error.code === "BEDROCK_CREDENTIALS_UNAVAILABLE",
  );
});

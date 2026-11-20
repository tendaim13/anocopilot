import assert from "node:assert/strict";
import test from "node:test";

import { createBedrockResearchPlanningModel, fallbackOfferInterpretation } from "@/server/agents/research-planning-model";

const modelConfig = {
  region: "us-east-1",
  modelId: "unused-for-local-offer-clarification",
  guardrailIdentifier: "unused-for-local-offer-clarification",
  guardrailVersion: "1",
};

test("an offer-only first message is clarified locally without invoking Bedrock", async () => {
  const model = createBedrockResearchPlanningModel(modelConfig);
  const interpretation = await model.interpret([
    { id: "00000000-0000-4000-8000-000000000001", role: "user", text: "sales outreach platform that combines email, calling and leads enrichment" },
  ]);

  assert.equal(interpretation.outcome, "needs_context");
  assert.equal(interpretation.brief.offer, "sales outreach platform that combines email, calling and leads enrichment");
  assert.match(interpretation.clarification?.question ?? "", /What should Ano help you decide first/);
});

test("an offer-only message becomes one focused clarification when Bedrock output is unusable", () => {
  const interpretation = fallbackOfferInterpretation([
    { id: "00000000-0000-4000-8000-000000000001", role: "user", text: "sales outreach platform that combines email, calling and leads enrichment" },
  ]);

  assert.equal(interpretation?.outcome, "needs_context");
  assert.equal(interpretation?.brief.offer, "sales outreach platform that combines email, calling and leads enrichment");
  assert.match(interpretation?.clarification?.question ?? "", /What should Ano help you decide first/);
});

test("the answer to Ano's focused question makes the local fallback brief ready", () => {
  const interpretation = fallbackOfferInterpretation([
    { id: "00000000-0000-4000-8000-000000000001", role: "user", text: "sales outreach platform that combines email, calling and leads enrichment" },
    { id: "00000000-0000-4000-8000-000000000002", role: "user", text: "Help me decide where to sell it first." },
  ]);

  assert.equal(interpretation?.outcome, "ready");
  assert.equal(interpretation?.brief.goal, "Help me decide where to sell it first.");
  assert.equal(interpretation?.clarification, undefined);
});

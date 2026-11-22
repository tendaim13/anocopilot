import assert from "node:assert/strict";
import test from "node:test";

import { researchPlanDraftSchema, type ResearchBrief } from "@/lib/ano/research-conversation";
import {
  createBedrockResearchPlanningModel,
  extractJsonCandidate,
  fallbackOfferInterpretation,
  fallbackResearchPlan,
  normalizePlanShape,
  ResearchPlanningModelError,
  type InvokableBedrockModel,
} from "@/server/agents/research-planning-model";

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

test("single message with an explicit research decision becomes ready immediately without redundant clarification", () => {
  const interpretation = fallbackOfferInterpretation([
    {
      id: "00000000-0000-4000-8000-000000000001",
      role: "user",
      text: "We build automated patient-recall software for multi-chair dental practices. Which country and segment should we target first?",
    },
  ]);

  assert.equal(interpretation?.outcome, "ready");
  assert.equal(
    interpretation?.brief.offer,
    "We build automated patient-recall software for multi-chair dental practices. Which country and segment should we target first?",
  );
  assert.equal(interpretation?.clarification, undefined);
});

test("extractJsonCandidate and normalizePlanShape recover prose-wrapped small-model JSON", () => {
  const rawOutput = [
    "Here is the research plan JSON you requested:",
    "```json",
    JSON.stringify({
      summary: "Compare dental recall demand across candidate countries.",
      researchQuestions: ["Which country has higher multi-chair dental density?"],
      comparisonCriteria: ["Patient recall volume"],
      intendedSourceClasses: ["Official stats & dental registries", "Independent media"],
      plannedScope: { markets: ["Australia", "UK"] },
      uncertainties: [],
    }),
    "```",
  ].join("\n");

  const extracted = JSON.parse(extractJsonCandidate(rawOutput));
  const brief: ResearchBrief = {
    offer: "Automated patient-recall software for multi-chair dental practices",
    goal: "Which country and segment should we target first?",
    marketHints: ["Dental practices"],
    locationHints: [],
    buyerHints: ["Practice Manager"],
    constraints: [],
    unknowns: [],
    sourceMessageIds: ["00000000-0000-4000-8000-000000000001"],
  };

  const normalized = normalizePlanShape(extracted, brief);
  const parsed = researchPlanDraftSchema.parse(normalized);

  assert.equal(parsed.budget.maximumSearches, 50);
  assert.equal(parsed.budget.maximumFetches, 100);
  assert.equal(parsed.budget.providerSpend, "not_available_in_phase_a");
  assert.ok(parsed.researchQuestions.length >= 2);
  assert.ok(parsed.comparisonCriteria.length >= 2);
  assert.deepEqual(parsed.intendedSourceClasses, [
    "Government and official statistics",
    "Independent reporting",
  ]);
  assert.deepEqual(parsed.plannedScope.markets, ["Australia", "UK"]);
  assert.deepEqual(parsed.plannedScope.industries, []);
});

test("fallbackResearchPlan produces a valid grounded Phase A draft on unusable model output", async () => {
  const brief: ResearchBrief = {
    offer: "Automated patient-recall software for multi-chair dental practices",
    goal: "Which country and segment should we target first?",
    marketHints: ["Multi-chair dental practices"],
    locationHints: ["Australia", "United Kingdom"],
    buyerHints: ["Dental Practice Owner"],
    constraints: [],
    unknowns: ["Patient recall software penetration is unverified."],
    sourceMessageIds: ["00000000-0000-4000-8000-000000000001"],
  };

  const brokenJsonModel: InvokableBedrockModel = {
    async invoke() {
      return { content: "Sorry, I cannot output pure JSON right now." } as never;
    },
  };

  const direct = fallbackResearchPlan(brief, "Include regional DSOs");
  assert.equal(direct.budget.maximumSearches, 50);
  assert.equal(direct.budget.maximumFetches, 100);
  assert.equal(direct.budget.providerSpend, "not_available_in_phase_a");
  assert.match(direct.summary, /Include regional DSOs/);

  const adapter = createBedrockResearchPlanningModel(modelConfig, brokenJsonModel);
  const recovered = await adapter.createPlan(brief);
  assert.equal(recovered.budget.maximumSearches, 50);
  assert.equal(recovered.intendedSourceClasses.length, 4);
});

test("fatal AWS Bedrock errors are surfaced with reason and not swallowed by local fallbacks", async () => {
  const deniedModel: InvokableBedrockModel = {
    async invoke() {
      const err = new Error("User is not authorized to perform bedrock:InvokeModel");
      err.name = "AccessDeniedException";
      throw err;
    },
  };

  const adapter = createBedrockResearchPlanningModel(modelConfig, deniedModel);
  await assert.rejects(
    () =>
      adapter.interpret([
        {
          id: "00000000-0000-4000-8000-000000000001",
          role: "user",
          text: "We build dental software. Which market should we target first?",
        },
      ]),
    (err: unknown) =>
      err instanceof ResearchPlanningModelError &&
      err.fatal === true &&
      /AWS identity cannot invoke/i.test(err.message) &&
      /AccessDeniedException/.test(err.reason ?? ""),
  );
});

test("models rejecting SystemMessage automatically retry using a single HumanMessage", async () => {
  const calls: number[] = [];
  const gemmaLikeModel: InvokableBedrockModel = {
    async invoke(messages) {
      const list = Array.isArray(messages) ? messages : [];
      calls.push(list.length);
      if (list.length > 1) {
        const err = new Error("ValidationException: This model doesn't support the system message.");
        err.name = "ValidationException";
        throw err;
      }
      return {
        content: JSON.stringify({
          outcome: "ready",
          brief: {
            offer: "Automated patient-recall software for multi-chair dental practices",
            goal: "Decide which country and segment to target first",
            marketHints: ["Multi-chair dental practices"],
            locationHints: [],
            buyerHints: [],
            constraints: [],
            unknowns: [],
          },
        }),
      } as never;
    },
  };

  const adapter = createBedrockResearchPlanningModel(modelConfig, gemmaLikeModel);
  const result = await adapter.interpret([
    {
      id: "00000000-0000-4000-8000-000000000001",
      role: "user",
      text: "We build automated patient-recall software for multi-chair dental practices. Which country and segment should we target first?",
    },
  ]);

  assert.deepEqual(calls, [2, 1]);
  assert.equal(result.outcome, "ready");
  assert.equal(result.brief.offer, "Automated patient-recall software for multi-chair dental practices");
});

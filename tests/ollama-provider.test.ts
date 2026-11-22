import assert from "node:assert/strict";
import test from "node:test";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { getActivePlannerConfig, getAnoAgentMode } from "@/server/agents/bedrock";
import {
  createOllamaChatModel,
  OllamaConnectionError,
  OllamaModelNotFoundError,
} from "@/server/agents/ollama-chat-model";
import {
  createBedrockResearchPlanningModel,
  ResearchPlanningModelError,
} from "@/server/agents/research-planning-model";

test("ANO_AGENT_MODE switches cleanly between ollama, bedrock, and disabled", () => {
  const savedEnv = { ...process.env };
  try {
    process.env.ANO_AGENT_MODE = "ollama";
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434/";
    process.env.OLLAMA_MODEL = "qwen2.5-coder:14b";

    assert.equal(getAnoAgentMode(), "ollama");
    const ollama = getActivePlannerConfig();
    assert.deepEqual(ollama, {
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      modelId: "qwen2.5-coder:14b",
    });

    process.env.ANO_AGENT_MODE = "bedrock";
    process.env.AWS_REGION = "us-east-1";
    process.env.BEDROCK_MODEL_ID = "google.gemma-3-4b-it";
    process.env.BEDROCK_GUARDRAIL_ID = "guard-1";
    process.env.BEDROCK_GUARDRAIL_VERSION = "1";

    assert.equal(getAnoAgentMode(), "bedrock");
    const bedrock = getActivePlannerConfig();
    assert.equal(bedrock.provider, "bedrock");
    assert.equal(bedrock.modelId, "google.gemma-3-4b-it");

    process.env.ANO_AGENT_MODE = "disabled";
    assert.equal(getAnoAgentMode(), "disabled");
    assert.throws(() => getActivePlannerConfig(), /disabled/i);
  } finally {
    process.env = savedEnv;
  }
});

test("createOllamaChatModel calls local /api/chat in JSON mode and drives Phase A interpret + createPlan", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let turn = 0;

  const mockFetch: typeof fetch = async (input, init) => {
    turn += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url: String(input), body });

    if (turn === 1) {
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              outcome: "ready",
              brief: {
                offer: "Automated patient-recall software for multi-chair dental practices",
                goal: "Identify which country and segment to target first",
                marketHints: ["Multi-chair dental clinics"],
                locationHints: [],
                buyerHints: ["Practice Manager", "Principal Dentist"],
                constraints: [],
                unknowns: ["Country-level PMS adoption rates"],
              },
            }),
          },
        }),
        { status: 200 },
      );
    }

    return new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            summary: "Compare candidate English-speaking dental markets using public healthcare statistics.",
            researchQuestions: [
              "Which countries have the highest concentration of multi-chair private dental practices?",
              "Where do recall inefficiency and missed-appointment costs show strong public reporting?",
            ],
            comparisonCriteria: [
              "Multi-chair dental clinic density",
              "Documented patient-recall inefficiency",
            ],
            intendedSourceClasses: [
              "Government and official statistics",
              "Industry bodies and primary research",
            ],
            plannedScope: {
              markets: ["Australia", "United Kingdom"],
              industries: ["Multi-chair dental practices"],
              buyerRoles: ["Practice Manager"],
            },
            budget: {
              maximumSearches: 50,
              maximumFetches: 100,
              providerSpend: "not_available_in_phase_a",
            },
            uncertainties: ["Direct PMS integration share is unverified."],
          }),
        },
      }),
      { status: 200 },
    );
  };

  const ollamaConfig = {
    provider: "ollama" as const,
    baseUrl: "http://127.0.0.1:11434",
    modelId: "qwen2.5-coder:14b",
  };
  const chatModel = createOllamaChatModel(ollamaConfig, { maxTokens: 1200, fetcher: mockFetch });
  const planningModel = createBedrockResearchPlanningModel(ollamaConfig, chatModel);

  const interpretation = await planningModel.interpret([
    {
      id: "00000000-0000-4000-8000-000000000001",
      role: "user",
      text: "We build automated patient-recall software for multi-chair dental practices. Which country and segment should we target first?",
    },
  ]);

  assert.equal(interpretation.outcome, "ready");
  assert.equal(requests[0]?.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(requests[0]?.body.format, "json");
  assert.equal(requests[0]?.body.stream, false);

  const plan = await planningModel.createPlan({
    ...interpretation.brief,
    sourceMessageIds: ["00000000-0000-4000-8000-000000000001"],
  });
  assert.equal(plan.budget.maximumSearches, 50);
  assert.deepEqual(plan.plannedScope.markets, ["Australia", "United Kingdom"]);
});

test("Ollama connection and missing-model errors surface directly without being swallowed", async () => {
  const missingModelFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "model 'missing:latest' not found" }), { status: 404 });

  const chatModel = createOllamaChatModel(
    { provider: "ollama", baseUrl: "http://127.0.0.1:11434", modelId: "missing:latest" },
    { fetcher: missingModelFetch },
  );

  await assert.rejects(
    () => chatModel.invoke([new SystemMessage("sys"), new HumanMessage("hi")]),
    (err: unknown) =>
      err instanceof OllamaModelNotFoundError && /ollama pull missing:latest/i.test(err.message),
  );

  const offlineChatModel = createOllamaChatModel(
    { provider: "ollama", baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5-coder:14b" },
    {
      fetcher: async () => {
        throw new TypeError("fetch failed");
      },
    },
  );

  const planningModel = createBedrockResearchPlanningModel(
    { provider: "ollama", baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5-coder:14b" },
    offlineChatModel,
  );

  await assert.rejects(
    () =>
      planningModel.interpret([
        {
          id: "00000000-0000-4000-8000-000000000001",
          role: "user",
          text: "We sell recall software. Which market should we target?",
        },
      ]),
    (err: unknown) =>
      err instanceof ResearchPlanningModelError &&
      err.fatal === true &&
      /could not reach Ollama/i.test(err.message) &&
      !(err instanceof OllamaConnectionError),
  );
});

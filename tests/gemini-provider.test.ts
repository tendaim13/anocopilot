import assert from "node:assert/strict";
import test from "node:test";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_FALLBACK_MODELS,
  DEFAULT_GEMINI_MODEL,
  getActivePlannerConfig,
  getAnoAgentMode,
} from "@/server/agents/bedrock";
import {
  createGeminiChatModel,
  GeminiApiError,
  resolveGeminiThinkingConfig,
} from "@/server/agents/gemini-chat-model";
import {
  OllamaConnectionError,
  OllamaModelNotFoundError,
} from "@/server/agents/ollama-chat-model";
import {
  createBedrockResearchPlanningModel,
  ResearchPlanningModelError,
} from "@/server/agents/research-planning-model";
import {
  formatConversationChatError,
  ResearchConversationServiceError,
} from "@/server/domain/research-conversation-service";

test("ANO_AGENT_MODE=gemini resolves token-conserving defaults and rejects missing API key", () => {
  const savedEnv = { ...process.env };
  try {
    process.env.ANO_AGENT_MODE = "gemini";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODELS;
    delete process.env.GEMINI_BASE_URL;
    delete process.env.GEMINI_THINKING_LEVEL;
    delete process.env.GEMINI_THINKING_BUDGET;

    assert.equal(getAnoAgentMode(), "gemini");
    assert.throws(() => getActivePlannerConfig(), /GEMINI_API_KEY/i);

    process.env.GEMINI_API_KEY = "test-gemini-key";
    const defaultConfig = getActivePlannerConfig();
    assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
    assert.deepEqual(defaultConfig, {
      provider: "gemini",
      apiKey: "test-gemini-key",
      modelId: DEFAULT_GEMINI_MODEL,
      fallbackModelIds: [...DEFAULT_GEMINI_FALLBACK_MODELS],
      baseUrl: DEFAULT_GEMINI_BASE_URL,
    });

    process.env.GEMINI_MODEL = "gemini-3.1-flash-lite";
    process.env.GEMINI_THINKING_LEVEL = "minimal";
    process.env.GEMINI_THINKING_BUDGET = "1024";
    const overrideConfig = getActivePlannerConfig();
    assert.equal(overrideConfig.provider, "gemini");
    if (overrideConfig.provider === "gemini") {
      assert.equal(overrideConfig.modelId, "gemini-3.1-flash-lite");
      assert.equal(overrideConfig.thinkingLevel, "minimal");
      // Never retain both thinkingLevel and thinkingBudget simultaneously
      assert.equal(overrideConfig.thinkingBudget, undefined);
    }
  } finally {
    process.env = savedEnv;
  }
});

test("resolveGeminiThinkingConfig conserves thinking tokens across Gemini 2.5 and 3.x models", () => {
  assert.deepEqual(resolveGeminiThinkingConfig({ modelId: DEFAULT_GEMINI_MODEL }), {
    thinkingLevel: "minimal",
  });
  assert.deepEqual(resolveGeminiThinkingConfig({ modelId: "gemini-3.5-flash-lite" }), {
    thinkingLevel: "minimal",
  });
  assert.deepEqual(resolveGeminiThinkingConfig({ modelId: "gemini-2.5-flash-lite" }), {
    thinkingBudget: 0,
  });
  assert.deepEqual(resolveGeminiThinkingConfig({ modelId: "gemini-3.1-flash-lite" }), {
    thinkingLevel: "minimal",
  });
  assert.equal(resolveGeminiThinkingConfig({ modelId: "gemini-2.0-flash-lite" }), undefined);
  assert.deepEqual(
    resolveGeminiThinkingConfig({
      modelId: "gemini-2.5-flash-lite",
      thinkingLevel: "low",
      thinkingBudget: 2048,
    }),
    { thinkingLevel: "low" },
  );
  assert.deepEqual(
    resolveGeminiThinkingConfig({
      modelId: "gemini-2.5-flash-lite",
      thinkingBudget: 512,
    }),
    { thinkingBudget: 512 },
  );
});

test("createGeminiChatModel uses header auth, skips thought parts, and drives Phase A interpret + createPlan", async () => {
  const requests: Array<{ url: string; headers: HeadersInit | undefined; body: Record<string, unknown> }> = [];
  let turn = 0;

  const mockFetch: typeof fetch = async (input, init) => {
    turn += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url: String(input), headers: init?.headers, body });

    if (turn === 1) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "internal reasoning should be skipped", thought: true },
                  {
                    text: JSON.stringify({
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
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
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
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const geminiConfig = {
    provider: "gemini" as const,
    apiKey: "secret-ai-studio-key",
    modelId: "gemini-2.5-flash-lite",
    baseUrl: DEFAULT_GEMINI_BASE_URL,
  };
  const chatModel = createGeminiChatModel(geminiConfig, { maxTokens: 1200, fetcher: mockFetch });
  const planningModel = createBedrockResearchPlanningModel(geminiConfig, chatModel);

  const interpretation = await planningModel.interpret([
    {
      id: "00000000-0000-4000-8000-000000000011",
      role: "user",
      text: "We build automated patient-recall software for multi-chair dental practices. Which country and segment should we target first?",
    },
  ]);

  assert.equal(interpretation.outcome, "ready");
  assert.equal(
    requests[0]?.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
  );
  assert.ok(!requests[0]?.url.includes("secret-ai-studio-key"));
  assert.equal(
    (requests[0]?.headers as Record<string, string>)["x-goog-api-key"],
    "secret-ai-studio-key",
  );
  const genCfg = requests[0]?.body.generationConfig as Record<string, unknown>;
  assert.equal(genCfg.responseMimeType, "application/json");
  assert.equal(genCfg.temperature, 0);
  assert.deepEqual(genCfg.thinkingConfig, { thinkingBudget: 0 });

  const plan = await planningModel.createPlan({
    ...interpretation.brief,
    sourceMessageIds: ["00000000-0000-4000-8000-000000000011"],
  });
  assert.equal(plan.plannedScope.markets[0], "Australia");
});

test("createGeminiChatModel surfaces sanitized 429, 401, and 404 errors immediately with zero retries and redacts API key", async () => {
  const geminiConfig = {
    provider: "gemini" as const,
    apiKey: "super-secret-gemini-key",
    modelId: "gemini-2.5-flash-lite",
    fallbackModelIds: [] as string[],
    baseUrl: DEFAULT_GEMINI_BASE_URL,
  };

  let rateCalls = 0;
  const rateLimitModel = createGeminiChatModel(geminiConfig, {
    fetcher: async () => {
      rateCalls += 1;
      return new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 });
    },
  });

  await assert.rejects(
    () => rateLimitModel.invoke([new SystemMessage("json"), new HumanMessage("hi")]),
    (err: unknown) =>
      err instanceof GeminiApiError &&
      err.code === "RATE_LIMITED" &&
      !/google ai studio|gemini-|429/i.test(err.message) &&
      (err.technicalDetail ?? "").includes("429"),
  );
  assert.equal(rateCalls, 1);

  const authFailModel = createGeminiChatModel(geminiConfig, {
    fetcher: async () =>
      new Response(JSON.stringify({ error: { message: "API key invalid: super-secret-gemini-key" } }), {
        status: 401,
      }),
  });
  const planningModel = createBedrockResearchPlanningModel(geminiConfig, authFailModel);
  await assert.rejects(
    () =>
      planningModel.createPlan({
        offer: "B2B billing software",
        goal: "Pick first market",
        marketHints: ["Construction"],
        locationHints: [],
        buyerHints: [],
        constraints: [],
        unknowns: [],
        sourceMessageIds: [],
      }),
    (err: unknown) =>
      err instanceof ResearchPlanningModelError &&
      err.fatal === true &&
      !err.message.includes("super-secret-gemini-key") &&
      !/google ai studio|gemini-|401/i.test(err.message),
  );

  let notFoundCalls = 0;
  const notFoundModel = createGeminiChatModel(geminiConfig, {
    fetcher: async () => {
      notFoundCalls += 1;
      return new Response(
        JSON.stringify({
          error: {
            message:
              "Model gemini-2.5-flash-lite is no longer available to new users; key super-secret-gemini-key.",
          },
        }),
        { status: 404 },
      );
    },
  });
  await assert.rejects(
    () => notFoundModel.invoke([new HumanMessage("hi")]),
    (err: unknown) =>
      err instanceof GeminiApiError &&
      err.code === "MODEL_NOT_FOUND" &&
      !/google ai studio|gemini-|404/i.test(err.message) &&
      (err.technicalDetail ?? "").includes("no longer available to new users") &&
      !(err.technicalDetail ?? "").includes("super-secret-gemini-key") &&
      !err.message.includes("super-secret-gemini-key"),
  );
  assert.equal(notFoundCalls, 1);
});

test("createGeminiChatModel retries once on transient HTTP 503 spikes and surfaces sanitized error if persistent", async () => {
  const geminiConfig = {
    provider: "gemini" as const,
    apiKey: "test-503-key",
    modelId: "gemini-3.5-flash-lite",
    fallbackModelIds: [] as string[],
    baseUrl: DEFAULT_GEMINI_BASE_URL,
  };

  let recoveryCalls = 0;
  const recoveringModel = createGeminiChatModel(geminiConfig, {
    retryDelayMs: 0,
    fetcher: async () => {
      recoveryCalls += 1;
      if (recoveryCalls === 1) {
        return new Response(
          JSON.stringify({ error: { code: 503, message: "High demand" } }),
          { status: 503 },
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] } }],
        }),
        { status: 200 },
      );
    },
  });

  const recovered = await recoveringModel.invoke([
    new SystemMessage("json"),
    new HumanMessage("ping"),
  ]);
  assert.equal(recovered.content, "{\"ok\":true}");
  assert.equal(recoveryCalls, 2);

  let persistentCalls = 0;
  const persistent503Model = createGeminiChatModel(geminiConfig, {
    retryDelayMs: 0,
    cooldownMs: 0,
    fetcher: async () => {
      persistentCalls += 1;
      return new Response(
        JSON.stringify({ error: { code: 503, message: "High demand" } }),
        { status: 503 },
      );
    },
  });

  await assert.rejects(
    () => persistent503Model.invoke([new HumanMessage("ping")]),
    (err: unknown) =>
      err instanceof GeminiApiError &&
      err.code === "UNAVAILABLE" &&
      !/google ai studio|gemini-|503/i.test(err.message) &&
      (err.technicalDetail ?? "").includes("503"),
  );
  assert.equal(persistentCalls, 2);
});

test("formatConversationChatError masks internal LLM vendor messages and preserves safe product errors", () => {
  const geminiErr = new GeminiApiError(
    "Ano is experiencing brief high demand right now. Please try again in a moment.",
    "MODEL_NOT_FOUND",
    "Google AI Studio model unavailable",
  );
  assert.equal(formatConversationChatError(geminiErr), geminiErr.message);

  const ollamaConnErr = new OllamaConnectionError("Ano could not reach Ollama at http://127.0.0.1:11434.");
  assert.ok(!/ollama/i.test(formatConversationChatError(ollamaConnErr)));

  const ollamaModelErr = new OllamaModelNotFoundError("Ano: Ollama model \"foo\" is not installed.");
  assert.ok(!/ollama/i.test(formatConversationChatError(ollamaModelErr)));

  const serviceErr = new ResearchConversationServiceError("Add more detail about what you sell.");
  assert.equal(formatConversationChatError(serviceErr), serviceErr.message);

  assert.equal(
    formatConversationChatError(new Error("raw stack or internal db message")),
    "Ano could not respond right now. Please try again in a moment.",
  );
});

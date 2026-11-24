import assert from "node:assert/strict";
import test from "node:test";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  formatDisplayErrorMessage,
  graphResumeSchema,
} from "@/lib/ano/research-conversation";
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_FALLBACK_MODELS,
  resolveGeminiFallbackModels,
} from "@/server/agents/bedrock";
import {
  createGeminiChatModel,
  GeminiApiError,
  isGeminiModelCoolingDown,
  resetGeminiModelCooldowns,
  sanitizeLlmErrorForUser,
  USER_HIGH_DEMAND_LLM_MESSAGE,
  USER_UNAVAILABLE_LLM_MESSAGE,
} from "@/server/agents/gemini-chat-model";

test("resolveGeminiFallbackModels parses defaults, custom CSV, deduplication, and disable keywords", () => {
  assert.deepEqual(
    resolveGeminiFallbackModels("gemini-3.5-flash-lite", undefined),
    [...DEFAULT_GEMINI_FALLBACK_MODELS],
  );
  assert.deepEqual(
    resolveGeminiFallbackModels("gemini-3.1-flash-lite", undefined),
    ["gemini-3.6-flash", "gemini-2.5-flash-lite"],
  );
  assert.deepEqual(
    resolveGeminiFallbackModels(
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash-lite, gemini-3.6-flash , gemini-2.5-flash-lite, gemini-3.6-flash",
    ),
    ["gemini-3.6-flash", "gemini-2.5-flash-lite"],
  );
  assert.deepEqual(resolveGeminiFallbackModels("gemini-3.5-flash-lite", "none"), []);
  assert.deepEqual(resolveGeminiFallbackModels("gemini-3.5-flash-lite", "OFF"), []);
});

test("createGeminiChatModel fails over from HTTP 503 primary to fallback with model-appropriate thinkingConfig", async () => {
  resetGeminiModelCooldowns();
  const requests: Array<{ url: string; thinkingConfig: unknown }> = [];

  const model = createGeminiChatModel(
    {
      provider: "gemini",
      apiKey: "test-failover-key",
      modelId: "gemini-3.5-flash-lite",
      fallbackModelIds: ["gemini-2.5-flash-lite"],
      baseUrl: DEFAULT_GEMINI_BASE_URL,
      thinkingLevel: "minimal",
    },
    {
      retryDelayMs: 0,
      fetcher: async (input, init) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          generationConfig?: { thinkingConfig?: unknown };
        };
        requests.push({
          url,
          thinkingConfig: body.generationConfig?.thinkingConfig,
        });

        if (url.includes("gemini-3.5-flash-lite")) {
          return new Response(
            JSON.stringify({ error: { code: 503, message: "High demand" } }),
            { status: 503 },
          );
        }

        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "{\"recovered\":true}" }] } }],
          }),
          { status: 200 },
        );
      },
    },
  );

  const result = await model.invoke([new SystemMessage("json"), new HumanMessage("hi")]);
  assert.equal(result.content, "{\"recovered\":true}");

  // Primary retried once (2 calls), then fell back immediately to 2.5-flash-lite with thinkingBudget: 0
  assert.equal(requests.length, 3);
  assert.ok(requests[0].url.includes("gemini-3.5-flash-lite"));
  assert.deepEqual(requests[0].thinkingConfig, { thinkingLevel: "minimal" });
  assert.ok(requests[1].url.includes("gemini-3.5-flash-lite"));
  assert.ok(requests[2].url.includes("gemini-2.5-flash-lite"));
  assert.deepEqual(requests[2].thinkingConfig, { thinkingBudget: 0 });
  resetGeminiModelCooldowns();
});

test("createGeminiChatModel honors 60s cooldown circuit breaker and fast-fails on 401 auth error", async () => {
  resetGeminiModelCooldowns();
  let fakeClock = 1_000_000;
  const calledUrls: string[] = [];

  const model = createGeminiChatModel(
    {
      provider: "gemini",
      apiKey: "test-cooldown-key",
      modelId: "gemini-3.5-flash-lite",
      fallbackModelIds: ["gemini-3.1-flash-lite"],
      baseUrl: DEFAULT_GEMINI_BASE_URL,
    },
    {
      retryDelayMs: 0,
      cooldownMs: 60_000,
      now: () => fakeClock,
      fetcher: async (input) => {
        const url = String(input);
        calledUrls.push(url);
        if (url.includes("gemini-3.5-flash-lite") && fakeClock < 1_060_000) {
          return new Response(JSON.stringify({ error: { message: "Quota limit" } }), {
            status: 429,
          });
        }
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] } }],
          }),
          { status: 200 },
        );
      },
    },
  );

  // First call: 429 on primary fails over immediately (1 call on primary, 1 on secondary)
  await model.invoke([new HumanMessage("step 1")]);
  assert.equal(calledUrls.length, 2);
  assert.equal(isGeminiModelCoolingDown("gemini-3.5-flash-lite", fakeClock), true);

  // Second call within 60s skips primary cleanly
  fakeClock += 10_000;
  await model.invoke([new HumanMessage("step 2")]);
  assert.equal(calledUrls.length, 3);
  assert.ok(calledUrls[2].includes("gemini-3.1-flash-lite"));

  // After 60s cooldown expires, primary is attempted and succeeds
  fakeClock += 60_000;
  assert.equal(isGeminiModelCoolingDown("gemini-3.5-flash-lite", fakeClock), false);
  await model.invoke([new HumanMessage("step 3")]);
  assert.equal(calledUrls.length, 4);
  assert.ok(calledUrls[3].includes("gemini-3.5-flash-lite"));

  // 401 auth failure stops immediately without hammering fallback models
  const authUrls: string[] = [];
  const authModel = createGeminiChatModel(
    {
      provider: "gemini",
      apiKey: "secret-bad-key",
      modelId: "gemini-3.5-flash-lite",
      fallbackModelIds: ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite"],
      baseUrl: DEFAULT_GEMINI_BASE_URL,
    },
    {
      fetcher: async (input) => {
        authUrls.push(String(input));
        return new Response(
          JSON.stringify({ error: { message: "Invalid key secret-bad-key" } }),
          { status: 401 },
        );
      },
    },
  );
  await assert.rejects(
    () => authModel.invoke([new HumanMessage("hi")]),
    (err: unknown) =>
      err instanceof GeminiApiError &&
      err.code === "AUTH_FAILED" &&
      err.message === USER_UNAVAILABLE_LLM_MESSAGE &&
      !err.message.includes("secret-bad-key"),
  );
  assert.equal(authUrls.length, 1);
  resetGeminiModelCooldowns();
});

test("sanitizeLlmErrorForUser, formatDisplayErrorMessage, and graphResumeSchema handle retry and masking cleanly", () => {
  const legacyPersistedError =
    'Ano: Google AI Studio model "gemini-3.5-flash-lite" is temporarily experiencing high demand (HTTP 503). Wait a moment and try again.';
  assert.equal(formatDisplayErrorMessage(legacyPersistedError), USER_HIGH_DEMAND_LLM_MESSAGE);
  assert.equal(
    sanitizeLlmErrorForUser(new Error(legacyPersistedError)),
    USER_HIGH_DEMAND_LLM_MESSAGE,
  );
  assert.ok(
    !/google ai studio|gemini-|http 503|bedrock|ollama|gemini_api_key/i.test(
      formatDisplayErrorMessage("BedrockCredentialsError: missing AWS credentials"),
    ),
  );
  assert.equal(
    formatDisplayErrorMessage("Tell Ano where your business is located."),
    "Tell Ano where your business is located.",
  );

  const retryParsed = graphResumeSchema.safeParse({ kind: "retry" });
  assert.equal(retryParsed.success, true);
});

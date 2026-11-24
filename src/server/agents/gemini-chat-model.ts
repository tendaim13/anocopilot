import "server-only";

import type { BaseMessage } from "@langchain/core/messages";

import type {
  GeminiPlannerConfig,
  GeminiThinkingLevel,
  InvokableChatModel,
} from "@/server/agents/bedrock-contracts";
import { recordInternalApiUsage } from "@/server/telemetry/internal-api-usage";

const DEFAULT_GEMINI_TIMEOUT_MS = 60_000;
const DEFAULT_GEMINI_503_RETRY_DELAY_MS = 900;
const DEFAULT_GEMINI_COOLDOWN_MS = 60_000;

export const USER_HIGH_DEMAND_LLM_MESSAGE =
  "Ano is experiencing brief high demand right now. Please try again in a moment.";
export const USER_TIMEOUT_LLM_MESSAGE =
  "Ano took longer than expected to respond. Please try again.";
export const USER_UNAVAILABLE_LLM_MESSAGE =
  "Ano's research service is temporarily unavailable. Please try again shortly.";

export type GeminiApiErrorCode =
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "MODEL_NOT_FOUND"
  | "TIMEOUT"
  | "UNAVAILABLE";

export class GeminiApiError extends Error {
  constructor(
    message: string,
    readonly code: GeminiApiErrorCode = "UNAVAILABLE",
    readonly technicalDetail?: string,
  ) {
    super(message);
    this.name = "GeminiApiError";
  }
}

const modelCooldownUntil = new Map<string, number>();

export function resetGeminiModelCooldowns(): void {
  modelCooldownUntil.clear();
}

export function isGeminiModelCoolingDown(
  modelId: string,
  nowMs: number = Date.now(),
): boolean {
  const until = modelCooldownUntil.get(modelId);
  if (until === undefined) return false;
  if (nowMs >= until) {
    modelCooldownUntil.delete(modelId);
    return false;
  }
  return true;
}

function markModelCoolingDown(
  modelId: string,
  cooldownMs: number,
  nowMs: number,
): void {
  if (cooldownMs <= 0) return;
  modelCooldownUntil.set(modelId, nowMs + cooldownMs);
}

function clearModelCooldown(modelId: string): void {
  modelCooldownUntil.delete(modelId);
}

export function userMessageForGeminiCode(code: GeminiApiErrorCode): string {
  switch (code) {
    case "TIMEOUT":
      return USER_TIMEOUT_LLM_MESSAGE;
    case "RATE_LIMITED":
    case "UNAVAILABLE":
      return USER_HIGH_DEMAND_LLM_MESSAGE;
    case "AUTH_FAILED":
    case "MODEL_NOT_FOUND":
      return USER_UNAVAILABLE_LLM_MESSAGE;
  }
}

export function isTransientLlmError(error: unknown): boolean {
  if (error instanceof GeminiApiError) {
    return (
      error.code === "UNAVAILABLE" ||
      error.code === "RATE_LIMITED" ||
      error.code === "TIMEOUT" ||
      error.code === "MODEL_NOT_FOUND"
    );
  }
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /\b(?:503|429|timeout|timed out|high demand|temporarily unavailable|rate limit)\b/i.test(
    msg,
  );
}

export function sanitizeLlmErrorForUser(error: unknown): string {
  if (error instanceof GeminiApiError) {
    return error.message;
  }
  const name = error instanceof Error ? error.name : "";
  const msg = error instanceof Error ? error.message : String(error ?? "");

  if (
    name === "OllamaConnectionError" ||
    name === "OllamaModelNotFoundError" ||
    name === "BedrockAdapterError" ||
    name === "BedrockConfigurationError"
  ) {
    return /\b(?:timeout|timed out)\b/i.test(msg)
      ? USER_TIMEOUT_LLM_MESSAGE
      : USER_UNAVAILABLE_LLM_MESSAGE;
  }

  if (
    /google ai studio|gemini-|bedrock|ollama|http\s*(?:503|429|404|401|403)|gemini_api_key|ano_agent_mode|aws credentials|high demand|quota exceeded|rate limit/i.test(
      msg,
    )
  ) {
    if (/\btimed?\s*out\b/i.test(msg)) {
      return USER_TIMEOUT_LLM_MESSAGE;
    }
    if (/\b(?:503|429|high demand|rate limit|quota)\b/i.test(msg)) {
      return USER_HIGH_DEMAND_LLM_MESSAGE;
    }
    return USER_UNAVAILABLE_LLM_MESSAGE;
  }

  return msg.trim() || USER_UNAVAILABLE_LLM_MESSAGE;
}

export function resolveGeminiThinkingConfig(
  config: Pick<GeminiPlannerConfig, "modelId" | "thinkingBudget" | "thinkingLevel">,
): { thinkingBudget: number } | { thinkingLevel: GeminiThinkingLevel } | undefined {
  if (config.thinkingLevel) {
    return { thinkingLevel: config.thinkingLevel };
  }
  if (typeof config.thinkingBudget === "number" && Number.isFinite(config.thinkingBudget)) {
    return { thinkingBudget: Math.max(0, Math.round(config.thinkingBudget)) };
  }
  if (/^gemini-3/i.test(config.modelId)) {
    return { thinkingLevel: "minimal" };
  }
  if (/^gemini-2\.5/i.test(config.modelId)) {
    return { thinkingBudget: 0 };
  }
  return undefined;
}

function toMessageRole(message: BaseMessage): "system" | "user" | "model" {
  const candidate = message as BaseMessage & {
    _getType?: () => string;
    getType?: () => string;
    role?: string;
  };
  const kind =
    typeof candidate._getType === "function"
      ? candidate._getType()
      : typeof candidate.getType === "function"
        ? candidate.getType()
        : candidate.role;

  if (kind === "system") return "system";
  if (kind === "ai" || kind === "assistant" || kind === "model") return "model";
  return "user";
}

function toMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .flatMap((part) => {
        if (typeof part === "string") return [part];
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return [part.text];
        }
        return [];
      })
      .join("\n");
  }
  return content == null ? "" : String(content);
}

function extractGeminiErrorDetail(rawBody: string, apiKey: string): string {
  let raw = rawBody;
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: unknown } };
    if (parsed && typeof parsed.error?.message === "string" && parsed.error.message.trim()) {
      raw = parsed.error.message;
    }
  } catch {
    // Keep rawBody fallback when response is not JSON.
  }
  const redacted = apiKey ? raw.replaceAll(apiKey, "[REDACTED]") : raw;
  return redacted.replace(/\s+/g, " ").trim().slice(0, 200);
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function computeJitteredBackoff(baseDelayMs: number, retryIndex: number): number {
  if (baseDelayMs <= 0) return 0;
  const raw = baseDelayMs * Math.pow(2, retryIndex);
  const jittered = Math.round(raw * (0.85 + Math.random() * 0.3));
  return Math.min(jittered, 4_000);
}

function buildOrderedCandidateModels(
  primaryModelId: string,
  fallbackModelIds: readonly string[],
  nowMs: number,
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of [primaryModelId, ...fallbackModelIds]) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(trimmed);
    }
  }

  const healthy: string[] = [];
  const cooling: Array<{ modelId: string; until: number }> = [];
  for (const modelId of unique) {
    if (isGeminiModelCoolingDown(modelId, nowMs)) {
      cooling.push({ modelId, until: modelCooldownUntil.get(modelId) ?? nowMs });
    } else {
      healthy.push(modelId);
    }
  }
  cooling.sort((left, right) => left.until - right.until);
  return [...healthy, ...cooling.map((item) => item.modelId)];
}

function buildPayloadForModel(
  modelId: string,
  config: GeminiPlannerConfig,
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>,
  systemTexts: string[],
  maxOutputTokens: number,
): string {
  const isPrimary = modelId.toLowerCase() === config.modelId.toLowerCase();
  const thinkingConfig = isPrimary
    ? resolveGeminiThinkingConfig(config)
    : resolveGeminiThinkingConfig({ modelId });

  const generationConfig: Record<string, unknown> = {
    temperature: 0,
    maxOutputTokens,
    responseMimeType: "application/json",
  };
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  const bodyPayload: Record<string, unknown> = {
    contents,
    generationConfig,
  };
  if (systemTexts.length > 0 && contents.some((c) => c.role === "user")) {
    bodyPayload.systemInstruction = {
      parts: [{ text: systemTexts.join("\n\n") }],
    };
  }
  return JSON.stringify(bodyPayload);
}

/**
 * Lightweight, resilient Google AI Studio REST adapter implementing Ano's
 * `InvokableChatModel` contract via header authentication (`x-goog-api-key`),
 * jittered exponential backoff, multi-model failover, and congestion cooldown
 * while masking internal model/status errors from public responses.
 */
export function createGeminiChatModel(
  config: GeminiPlannerConfig,
  options: {
    maxTokens?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
    cooldownMs?: number;
    now?: () => number;
    fetcher?: typeof fetch;
  } = {},
): InvokableChatModel {
  const maxOutputTokens = Math.min(Math.max(options.maxTokens ?? 1_200, 128), 4_096);
  const timeoutMs = options.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_GEMINI_503_RETRY_DELAY_MS);
  const cooldownMs = Math.max(0, options.cooldownMs ?? DEFAULT_GEMINI_COOLDOWN_MS);
  const now = options.now ?? (() => Date.now());
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  return {
    async invoke(messages: BaseMessage[]) {
      const systemTexts: string[] = [];
      const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

      for (const msg of messages) {
        const role = toMessageRole(msg);
        const text = toMessageText(msg.content).trim();
        if (!text) continue;
        if (role === "system") {
          systemTexts.push(text);
        } else {
          contents.push({ role, parts: [{ text }] });
        }
      }

      if (contents.length === 0) {
        contents.push({
          role: "user",
          parts: [{ text: systemTexts.join("\n\n") || "Return valid JSON." }],
        });
      }

      const candidateModels = buildOrderedCandidateModels(
        config.modelId,
        config.fallbackModelIds ?? [],
        now(),
      );
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();
      let totalAttempts = 0;
      let lastHttpStatus: number | undefined;
      let lastError: GeminiApiError | null = null;
      const modelsAttempted: string[] = [];

      try {
        for (const modelId of candidateModels) {
          if (controller.signal.aborted) {
            lastError = new GeminiApiError(
              USER_TIMEOUT_LLM_MESSAGE,
              "TIMEOUT",
              `Gemini request timed out before trying ${modelId} (${Math.round(timeoutMs / 1000)}s).`,
            );
            break;
          }

          modelsAttempted.push(modelId);
          const endpoint = `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent`;
          const serializedBody = buildPayloadForModel(
            modelId,
            config,
            contents,
            systemTexts,
            maxOutputTokens,
          );

          for (let attempt = 0; attempt < 2; attempt += 1) {
            totalAttempts += 1;
            let response: Response;
            try {
              response = await fetcher(endpoint, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-goog-api-key": config.apiKey,
                },
                signal: controller.signal,
                body: serializedBody,
              });
            } catch {
              if (controller.signal.aborted) {
                lastError = new GeminiApiError(
                  USER_TIMEOUT_LLM_MESSAGE,
                  "TIMEOUT",
                  `Gemini request to "${modelId}" timed out after ${Math.round(timeoutMs / 1000)}s.`,
                );
              } else {
                markModelCoolingDown(modelId, cooldownMs, now());
                lastError = new GeminiApiError(
                  USER_UNAVAILABLE_LLM_MESSAGE,
                  "UNAVAILABLE",
                  `Network error reaching Google AI Studio model "${modelId}".`,
                );
              }
              break;
            }

            lastHttpStatus = response.status;
            const rawBody = await response.text().catch(() => "");

            if (!response.ok) {
              const detail = extractGeminiErrorDetail(rawBody, config.apiKey);

              if (response.status === 401 || response.status === 403) {
                throw new GeminiApiError(
                  USER_UNAVAILABLE_LLM_MESSAGE,
                  "AUTH_FAILED",
                  `Google AI Studio rejected API key for "${modelId}" (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
                );
              }

              if (response.status === 429) {
                markModelCoolingDown(modelId, cooldownMs, now());
                lastError = new GeminiApiError(
                  USER_HIGH_DEMAND_LLM_MESSAGE,
                  "RATE_LIMITED",
                  `Google AI Studio rate limit / quota reached on "${modelId}" (HTTP 429)${detail ? `: ${detail}` : ""}`,
                );
                break;
              }

              if (response.status === 404) {
                markModelCoolingDown(modelId, cooldownMs, now());
                lastError = new GeminiApiError(
                  USER_UNAVAILABLE_LLM_MESSAGE,
                  "MODEL_NOT_FOUND",
                  `Google AI Studio model "${modelId}" unavailable (HTTP 404)${detail ? `: ${detail}` : ""}`,
                );
                break;
              }

              if (
                response.status === 503 ||
                response.status === 500 ||
                response.status === 502 ||
                response.status === 504
              ) {
                lastError = new GeminiApiError(
                  USER_HIGH_DEMAND_LLM_MESSAGE,
                  "UNAVAILABLE",
                  `Google AI Studio model "${modelId}" returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
                );
                if (attempt === 0) {
                  const delayMs = computeJitteredBackoff(retryDelayMs, attempt);
                  await sleepWithAbort(delayMs, controller.signal);
                  if (controller.signal.aborted) {
                    lastError = new GeminiApiError(
                      USER_TIMEOUT_LLM_MESSAGE,
                      "TIMEOUT",
                      `Google AI Studio timed out while waiting to retry "${modelId}".`,
                    );
                    break;
                  }
                  continue;
                }
                markModelCoolingDown(modelId, cooldownMs, now());
                break;
              }

              markModelCoolingDown(modelId, cooldownMs, now());
              lastError = new GeminiApiError(
                USER_UNAVAILABLE_LLM_MESSAGE,
                "UNAVAILABLE",
                `Google AI Studio model "${modelId}" returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
              );
              break;
            }

            const parsed = JSON.parse(rawBody) as {
              candidates?: Array<{
                content?: { parts?: Array<{ text?: string; thought?: boolean }> };
              }>;
              promptFeedback?: { blockReason?: string };
              usageMetadata?: {
                promptTokenCount?: number;
                candidatesTokenCount?: number;
                thoughtsTokenCount?: number;
                totalTokenCount?: number;
              };
            };

            if (parsed.promptFeedback?.blockReason) {
              lastError = new GeminiApiError(
                USER_UNAVAILABLE_LLM_MESSAGE,
                "UNAVAILABLE",
                `Google AI Studio model "${modelId}" blocked prompt (${parsed.promptFeedback.blockReason}).`,
              );
              break;
            }

            const parts = parsed.candidates?.[0]?.content?.parts ?? [];
            const text = parts
              .filter((part) => part.thought !== true && typeof part.text === "string")
              .map((part) => part.text ?? "")
              .join("\n")
              .trim();

            if (!text) {
              markModelCoolingDown(modelId, cooldownMs, now());
              lastError = new GeminiApiError(
                USER_UNAVAILABLE_LLM_MESSAGE,
                "UNAVAILABLE",
                `Google AI Studio model "${modelId}" returned empty output.`,
              );
              break;
            }

            clearModelCooldown(modelId);
            const inputTokens = parsed.usageMetadata?.promptTokenCount ?? 0;
            const outputTokens =
              (parsed.usageMetadata?.candidatesTokenCount ?? 0) +
              (parsed.usageMetadata?.thoughtsTokenCount ?? 0);
            recordInternalApiUsage({
              provider: "gemini",
              operation: "generate_content",
              modelOrEndpoint: modelId,
              status: "success",
              httpStatus: response.status,
              requestCount: totalAttempts,
              inputTokens,
              outputTokens,
              durationMs: Date.now() - startedAt,
              metadata: {
                attempts: totalAttempts,
                primaryModel: config.modelId,
                fallbackUsed: modelId.toLowerCase() !== config.modelId.toLowerCase(),
                modelsAttempted,
              },
            });

            return { content: text };
          }
        }

        throw (
          lastError ??
          new GeminiApiError(
            USER_HIGH_DEMAND_LLM_MESSAGE,
            "UNAVAILABLE",
            `Google AI Studio exhausted candidate models: ${modelsAttempted.join(", ")}`,
          )
        );
      } catch (error) {
        const mappedError =
          error instanceof GeminiApiError
            ? error
            : controller.signal.aborted
              ? new GeminiApiError(
                  USER_TIMEOUT_LLM_MESSAGE,
                  "TIMEOUT",
                  `Google AI Studio timed out after ${Math.round(timeoutMs / 1000)}s.`,
                )
              : new GeminiApiError(
                  USER_UNAVAILABLE_LLM_MESSAGE,
                  "UNAVAILABLE",
                  "Could not reach Google AI Studio. Check network connectivity and GEMINI_BASE_URL.",
                );

        console.error("[ano:llm] Gemini request failed", {
          code: mappedError.code,
          primaryModel: config.modelId,
          modelsAttempted,
          attempts: Math.max(1, totalAttempts),
          httpStatus: lastHttpStatus ?? null,
          detail: mappedError.technicalDetail ?? mappedError.message,
        });

        recordInternalApiUsage({
          provider: "gemini",
          operation: "generate_content",
          modelOrEndpoint: modelsAttempted.at(-1) ?? config.modelId,
          status:
            mappedError.code === "RATE_LIMITED"
              ? "rate_limited"
              : mappedError.code === "TIMEOUT"
                ? "timeout"
                : "error",
          httpStatus: lastHttpStatus ?? null,
          requestCount: Math.max(1, totalAttempts),
          durationMs: Date.now() - startedAt,
          metadata: {
            attempts: Math.max(1, totalAttempts),
            errorCode: mappedError.code,
            primaryModel: config.modelId,
            modelsAttempted,
          },
        });

        throw mappedError;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

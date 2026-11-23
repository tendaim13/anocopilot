import "server-only";

import type { BaseMessage } from "@langchain/core/messages";

import type {
  GeminiPlannerConfig,
  GeminiThinkingLevel,
  InvokableChatModel,
} from "@/server/agents/bedrock-contracts";
import { recordInternalApiUsage } from "@/server/telemetry/internal-api-usage";

const DEFAULT_GEMINI_TIMEOUT_MS = 60_000;
const DEFAULT_GEMINI_503_RETRY_DELAY_MS = 600;

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
  ) {
    super(message);
    this.name = "GeminiApiError";
  }
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

/**
 * Lightweight, token-conserving Google AI Studio REST adapter implementing Ano's
 * `InvokableChatModel` contract via header authentication (`x-goog-api-key`),
 * zero retries on quota/auth/404 errors, and at most one bounded retry on transient 503 spikes.
 */
export function createGeminiChatModel(
  config: GeminiPlannerConfig,
  options: {
    maxTokens?: number;
    timeoutMs?: number;
    retryDelayMs?: number;
    fetcher?: typeof fetch;
  } = {},
): InvokableChatModel {
  const maxOutputTokens = Math.min(Math.max(options.maxTokens ?? 1_200, 128), 4_096);
  const timeoutMs = options.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_GEMINI_503_RETRY_DELAY_MS);
  const fetcher = options.fetcher ?? fetch;
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(config.modelId)}:generateContent`;
  const thinkingConfig = resolveGeminiThinkingConfig(config);

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

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();
      let attempts = 0;
      let lastHttpStatus: number | undefined;

      try {
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
        const serializedBody = JSON.stringify(bodyPayload);

        for (let attempt = 0; attempt < 2; attempt += 1) {
          attempts = attempt + 1;
          const response = await fetcher(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": config.apiKey,
            },
            signal: controller.signal,
            body: serializedBody,
          });
          lastHttpStatus = response.status;

          const rawBody = await response.text().catch(() => "");

          if (!response.ok) {
            if (response.status === 503 && attempt === 0) {
              await sleepWithAbort(retryDelayMs, controller.signal);
              if (controller.signal.aborted) {
                throw new GeminiApiError(
                  `Ano: Google AI Studio timed out after ${Math.round(timeoutMs / 1000)}s.`,
                  "TIMEOUT",
                );
              }
              continue;
            }
            if (response.status === 401 || response.status === 403) {
              throw new GeminiApiError(
                "Ano: Google AI Studio rejected GEMINI_API_KEY. Verify the server key in .env.local or Vercel.",
                "AUTH_FAILED",
              );
            }
            if (response.status === 429) {
              throw new GeminiApiError(
                "Ano: Google AI Studio rate limit or free-tier quota reached (HTTP 429). Wait briefly before retrying.",
                "RATE_LIMITED",
              );
            }
            if (response.status === 404) {
              const detail = extractGeminiErrorDetail(rawBody, config.apiKey);
              throw new GeminiApiError(
                detail
                  ? `Ano: Google AI Studio model "${config.modelId}" is unavailable: ${detail} Check GEMINI_MODEL.`
                  : `Ano: Google AI Studio model "${config.modelId}" was not found. Check GEMINI_MODEL.`,
                "MODEL_NOT_FOUND",
              );
            }
            if (response.status === 503) {
              throw new GeminiApiError(
                `Ano: Google AI Studio model "${config.modelId}" is temporarily experiencing high demand (HTTP 503). Wait a moment and try again.`,
                "UNAVAILABLE",
              );
            }
            const sanitizedBody = extractGeminiErrorDetail(rawBody, config.apiKey);
            throw new GeminiApiError(
              `Ano: Google AI Studio returned HTTP ${response.status}${sanitizedBody ? `: ${sanitizedBody}` : "."}`,
              "UNAVAILABLE",
            );
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
            throw new GeminiApiError(
              `Ano: Google AI Studio blocked the prompt (${parsed.promptFeedback.blockReason}).`,
              "UNAVAILABLE",
            );
          }

          const parts = parsed.candidates?.[0]?.content?.parts ?? [];
          const text = parts
            .filter((part) => part.thought !== true && typeof part.text === "string")
            .map((part) => part.text ?? "")
            .join("\n")
            .trim();

          if (!text) {
            throw new GeminiApiError(
              "Ano: Google AI Studio returned no output tokens.",
              "UNAVAILABLE",
            );
          }

          const inputTokens = parsed.usageMetadata?.promptTokenCount ?? 0;
          const outputTokens =
            (parsed.usageMetadata?.candidatesTokenCount ?? 0) +
            (parsed.usageMetadata?.thoughtsTokenCount ?? 0);
          recordInternalApiUsage({
            provider: "gemini",
            operation: "generate_content",
            modelOrEndpoint: config.modelId,
            status: "success",
            httpStatus: response.status,
            requestCount: attempts,
            inputTokens,
            outputTokens,
            durationMs: Date.now() - startedAt,
            metadata: { attempts },
          });

          return { content: text };
        }

        throw new GeminiApiError(
          `Ano: Google AI Studio model "${config.modelId}" could not respond.`,
          "UNAVAILABLE",
        );
      } catch (error) {
        const mappedError =
          error instanceof GeminiApiError
            ? error
            : controller.signal.aborted
              ? new GeminiApiError(
                  `Ano: Google AI Studio timed out after ${Math.round(timeoutMs / 1000)}s.`,
                  "TIMEOUT",
                )
              : new GeminiApiError(
                  "Ano could not reach Google AI Studio. Check network connectivity and GEMINI_BASE_URL.",
                  "UNAVAILABLE",
                );

        recordInternalApiUsage({
          provider: "gemini",
          operation: "generate_content",
          modelOrEndpoint: config.modelId,
          status:
            mappedError.code === "RATE_LIMITED"
              ? "rate_limited"
              : mappedError.code === "TIMEOUT"
                ? "timeout"
                : "error",
          httpStatus: lastHttpStatus ?? null,
          requestCount: Math.max(1, attempts),
          durationMs: Date.now() - startedAt,
          metadata: { attempts, errorCode: mappedError.code },
        });

        throw mappedError;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

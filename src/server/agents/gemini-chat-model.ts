import "server-only";

import type { BaseMessage } from "@langchain/core/messages";

import type {
  GeminiPlannerConfig,
  GeminiThinkingLevel,
  InvokableChatModel,
} from "@/server/agents/bedrock-contracts";

const DEFAULT_GEMINI_TIMEOUT_MS = 60_000;

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

/**
 * Lightweight, token-conserving Google AI Studio REST adapter implementing Ano's
 * `InvokableChatModel` contract via header authentication (`x-goog-api-key`) and
 * zero automatic retries on quota/auth errors.
 */
export function createGeminiChatModel(
  config: GeminiPlannerConfig,
  options: { maxTokens?: number; timeoutMs?: number; fetcher?: typeof fetch } = {},
): InvokableChatModel {
  const maxOutputTokens = Math.min(Math.max(options.maxTokens ?? 1_200, 128), 4_096);
  const timeoutMs = options.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
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

        const response = await fetcher(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": config.apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify(bodyPayload),
        });

        const rawBody = await response.text().catch(() => "");

        if (!response.ok) {
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
            throw new GeminiApiError(
              `Ano: Google AI Studio model "${config.modelId}" was not found. Check GEMINI_MODEL.`,
              "MODEL_NOT_FOUND",
            );
          }
          const sanitizedBody = rawBody.replaceAll(config.apiKey, "[REDACTED]").slice(0, 220);
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

        return { content: text };
      } catch (error) {
        if (error instanceof GeminiApiError) {
          throw error;
        }
        if (controller.signal.aborted) {
          throw new GeminiApiError(
            `Ano: Google AI Studio timed out after ${Math.round(timeoutMs / 1000)}s.`,
            "TIMEOUT",
          );
        }
        throw new GeminiApiError(
          "Ano could not reach Google AI Studio. Check network connectivity and GEMINI_BASE_URL.",
          "UNAVAILABLE",
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

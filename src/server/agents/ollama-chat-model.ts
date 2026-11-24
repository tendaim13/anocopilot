import "server-only";

import { ChatBedrockConverse } from "@langchain/aws";
import type { BaseMessage } from "@langchain/core/messages";

import type {
  BedrockPlannerConfig,
  InvokableChatModel,
  LlmPlannerConfig,
  OllamaPlannerConfig,
} from "@/server/agents/bedrock-contracts";
import { getFallbackBedrockPlannerConfig } from "@/server/agents/bedrock";
import {
  createGeminiChatModel,
  GeminiApiError,
  isTransientLlmError,
} from "@/server/agents/gemini-chat-model";
import { recordInternalApiUsage } from "@/server/telemetry/internal-api-usage";

const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000;

export class OllamaConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaConnectionError";
  }
}

export class OllamaModelNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaModelNotFoundError";
  }
}

type OllamaRole = "system" | "user" | "assistant";

function toOllamaRole(message: BaseMessage): OllamaRole {
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
  if (kind === "ai" || kind === "assistant") return "assistant";
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
 * Lightweight local Ollama `/api/chat` adapter implementing Ano's bounded
 * `InvokableChatModel` interface without requiring external API keys or fees.
 */
export function createOllamaChatModel(
  config: OllamaPlannerConfig,
  options: { maxTokens?: number; numCtx?: number; timeoutMs?: number; fetcher?: typeof fetch } = {},
): InvokableChatModel {
  const maxTokens = options.maxTokens ?? 1_200;
  const numCtx = options.numCtx ?? 8_192;
  const timeoutMs = options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS;
  const fetcher = options.fetcher ?? fetch;
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/api/chat`;

  return {
    async invoke(messages: BaseMessage[]) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();
      let lastHttpStatus: number | undefined;

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (config.apiKey) {
          headers.Authorization = `Bearer ${config.apiKey}`;
        }

        const response = await fetcher(endpoint, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: config.modelId,
            messages: messages.map((msg) => ({
              role: toOllamaRole(msg),
              content: toMessageText(msg.content),
            })),
            stream: false,
            format: "json",
            keep_alive: "15m",
            options: {
              temperature: 0,
              num_predict: maxTokens,
              num_ctx: numCtx,
            },
          }),
        });
        lastHttpStatus = response.status;

        const rawBody = await response.text().catch(() => "");

        if (!response.ok) {
          if (response.status === 404 || /not found|pull/i.test(rawBody)) {
            throw new OllamaModelNotFoundError(
              `Ano: Ollama model "${config.modelId}" is not installed. Run: ollama pull ${config.modelId}`,
            );
          }
          throw new OllamaConnectionError(
            `Ano: Ollama returned HTTP ${response.status}: ${rawBody.slice(0, 300) || response.statusText}`,
          );
        }

        const parsed = JSON.parse(rawBody) as {
          message?: { content?: unknown };
          response?: unknown;
          error?: unknown;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        if (typeof parsed.error === "string" && parsed.error) {
          if (/not found|pull/i.test(parsed.error)) {
            throw new OllamaModelNotFoundError(
              `Ano: Ollama model "${config.modelId}" is not installed. Run: ollama pull ${config.modelId}`,
            );
          }
          throw new OllamaConnectionError(`Ano: ${parsed.error}`);
        }

        recordInternalApiUsage({
          provider: "ollama",
          operation: "chat",
          modelOrEndpoint: config.modelId,
          status: "success",
          httpStatus: response.status,
          inputTokens: parsed.prompt_eval_count ?? 0,
          outputTokens: parsed.eval_count ?? 0,
          durationMs: Date.now() - startedAt,
        });

        return {
          content: toMessageText(parsed.message?.content ?? parsed.response ?? ""),
        };
      } catch (error) {
        const mappedError =
          error instanceof OllamaConnectionError || error instanceof OllamaModelNotFoundError
            ? error
            : controller.signal.aborted
              ? new OllamaConnectionError(
                  `Ano: Ollama at ${config.baseUrl} timed out after ${Math.round(timeoutMs / 1000)}s.`,
                )
              : new OllamaConnectionError(
                  `Ano could not reach Ollama at ${config.baseUrl}. Make sure Ollama is running locally.`,
                );

        recordInternalApiUsage({
          provider: "ollama",
          operation: "chat",
          modelOrEndpoint: config.modelId,
          status: controller.signal.aborted ? "timeout" : "error",
          httpStatus: lastHttpStatus ?? null,
          durationMs: Date.now() - startedAt,
          metadata: { errorName: mappedError.name },
        });

        throw mappedError;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function createBedrockPlannerModel(
  config: BedrockPlannerConfig,
  maxTokens: number,
): InvokableChatModel {
  const bedrockModel = new ChatBedrockConverse({
    model: config.modelId,
    region: config.region,
    temperature: 0,
    maxTokens,
    maxRetries: 0,
    guardrailConfig: {
      guardrailIdentifier: config.guardrailIdentifier,
      guardrailVersion: config.guardrailVersion,
      trace: "enabled",
    },
  });

  return {
    async invoke(messages: BaseMessage[]) {
      const startedAt = Date.now();
      try {
        const result = await bedrockModel.invoke(messages);
        const usageCarrier = result as unknown as {
          content: unknown;
          usage_metadata?: { input_tokens?: number; output_tokens?: number };
          response_metadata?: { usage?: { inputTokens?: number; outputTokens?: number } };
        };
        const inputTokens =
          usageCarrier.usage_metadata?.input_tokens ??
          usageCarrier.response_metadata?.usage?.inputTokens ??
          0;
        const outputTokens =
          usageCarrier.usage_metadata?.output_tokens ??
          usageCarrier.response_metadata?.usage?.outputTokens ??
          0;

        recordInternalApiUsage({
          provider: "bedrock",
          operation: "converse",
          modelOrEndpoint: config.modelId,
          status: "success",
          inputTokens,
          outputTokens,
          durationMs: Date.now() - startedAt,
        });

        return { content: result.content };
      } catch (error) {
        recordInternalApiUsage({
          provider: "bedrock",
          operation: "converse",
          modelOrEndpoint: config.modelId,
          status: "error",
          durationMs: Date.now() - startedAt,
          metadata: { errorName: error instanceof Error ? error.name : "Error" },
        });
        throw error;
      }
    },
  };
}

/**
 * Builds the active reasoning adapter (Gemini with optional cross-provider
 * Bedrock fallback, local Ollama, or Amazon Bedrock) strictly from server configuration.
 */
export function createPlannerChatModel(
  config: LlmPlannerConfig,
  options: { maxTokens: number },
): InvokableChatModel {
  if (config.provider === "gemini") {
    const primary = createGeminiChatModel(config, { maxTokens: options.maxTokens });
    const bedrockFallback = getFallbackBedrockPlannerConfig();
    if (!bedrockFallback) {
      return primary;
    }
    const fallbackModel = createBedrockPlannerModel(bedrockFallback, options.maxTokens);
    return {
      async invoke(messages: BaseMessage[]) {
        try {
          return await primary.invoke(messages);
        } catch (error) {
          if (error instanceof GeminiApiError && isTransientLlmError(error)) {
            console.warn(
              "[ano:llm] Gemini candidate chain exhausted; failing over to configured Bedrock fallback.",
              { primaryModel: config.modelId, code: error.code },
            );
            return fallbackModel.invoke(messages);
          }
          throw error;
        }
      },
    };
  }
  if (config.provider === "ollama") {
    return createOllamaChatModel(config, { maxTokens: options.maxTokens });
  }

  return createBedrockPlannerModel(config, options.maxTokens);
}

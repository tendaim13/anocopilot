import "server-only";

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

import {
  BedrockAdapterError,
  type BedrockConverse,
  type BedrockPlannerConfig,
  type GeminiPlannerConfig,
  type GeminiThinkingLevel,
  type LlmPlannerConfig,
  type OllamaPlannerConfig,
} from "@/server/agents/bedrock-contracts";

export type AnoAgentMode = "disabled" | "bedrock" | "ollama" | "gemini";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export { BedrockAdapterError } from "@/server/agents/bedrock-contracts";
export type {
  BedrockConverse,
  BedrockPlannerConfig,
  GeminiPlannerConfig,
  GeminiThinkingLevel,
  LlmPlannerConfig,
  OllamaPlannerConfig,
} from "@/server/agents/bedrock-contracts";

export class BedrockConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BedrockConfigurationError";
  }
}

function value(name: "AWS_REGION" | "BEDROCK_MODEL_ID" | "BEDROCK_GUARDRAIL_ID" | "BEDROCK_GUARDRAIL_VERSION") {
  return process.env[name]?.trim() ?? "";
}

/** Defaults to disabled so Ano never substitutes simulated research for real work. */
export function getAnoAgentMode(): AnoAgentMode {
  const configured = process.env.ANO_AGENT_MODE?.trim().toLowerCase();
  if (!configured || configured === "disabled") return "disabled";
  if (configured === "bedrock") return "bedrock";
  if (configured === "ollama") return "ollama";
  if (configured === "gemini") return "gemini";
  throw new BedrockConfigurationError("ANO_AGENT_MODE must be disabled, bedrock, ollama, or gemini.");
}

export function getBedrockPlannerConfig(): BedrockPlannerConfig {
  const config = {
    region: value("AWS_REGION"),
    modelId: value("BEDROCK_MODEL_ID"),
    guardrailIdentifier: value("BEDROCK_GUARDRAIL_ID"),
    guardrailVersion: value("BEDROCK_GUARDRAIL_VERSION"),
  };

  if (Object.values(config).some((entry) => !entry)) {
    throw new BedrockConfigurationError("Bedrock mode requires complete server-side model and guardrail configuration.");
  }
  return config;
}

export function getOllamaPlannerConfig(): OllamaPlannerConfig {
  const rawBaseUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  const modelId = process.env.OLLAMA_MODEL?.trim() ?? "";
  const apiKey = process.env.OLLAMA_API_KEY?.trim() || undefined;

  if (!modelId) {
    throw new BedrockConfigurationError(
      "Ollama mode requires OLLAMA_MODEL (for example, qwen2.5-coder:14b) in .env.local.",
    );
  }

  return {
    provider: "ollama",
    baseUrl,
    modelId,
    ...(apiKey ? { apiKey } : {}),
  };
}

export function getGeminiPlannerConfig(): GeminiPlannerConfig {
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new BedrockConfigurationError(
      "Gemini mode requires GEMINI_API_KEY (from Google AI Studio) in server environment variables.",
    );
  }

  const modelId = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const rawBaseUrl = process.env.GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL;
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");

  const rawLevel = process.env.GEMINI_THINKING_LEVEL?.trim().toLowerCase();
  const thinkingLevel: GeminiThinkingLevel | undefined =
    rawLevel === "minimal" ||
    rawLevel === "low" ||
    rawLevel === "medium" ||
    rawLevel === "high"
      ? rawLevel
      : undefined;

  const rawBudget = process.env.GEMINI_THINKING_BUDGET?.trim();
  const parsedBudget =
    !thinkingLevel && rawBudget !== undefined && rawBudget !== "" && /^\d+$/.test(rawBudget)
      ? Number(rawBudget)
      : undefined;

  return {
    provider: "gemini",
    apiKey,
    modelId,
    baseUrl,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(parsedBudget !== undefined ? { thinkingBudget: parsedBudget } : {}),
  };
}

export function getActivePlannerConfig(): LlmPlannerConfig {
  const mode = getAnoAgentMode();
  if (mode === "ollama") {
    return getOllamaPlannerConfig();
  }
  if (mode === "gemini") {
    return getGeminiPlannerConfig();
  }
  if (mode === "bedrock") {
    return { provider: "bedrock", ...getBedrockPlannerConfig() };
  }
  throw new BedrockConfigurationError(
    "Ano’s reasoning agent is disabled. Set ANO_AGENT_MODE=gemini, ollama, or bedrock.",
  );
}

/**
 * Uses the default AWS SDK credential provider chain. Credentials and model
 * configuration remain server-only and are never included in API responses.
 */
export function createBedrockConverse(config: BedrockPlannerConfig): BedrockConverse {
  const client = new BedrockRuntimeClient({ region: config.region, maxAttempts: 1 });

  return async ({ messages, system, toolConfig, timeoutMs, maxTokens }) => {
    if (timeoutMs <= 0) {
      throw new BedrockAdapterError("Bedrock planning exceeded Ano’s configured runtime limit.", "TIMEOUT");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await client.send(new ConverseCommand({
        modelId: config.modelId,
        messages,
        system,
        ...(toolConfig ? { toolConfig } : {}),
        guardrailConfig: {
          guardrailIdentifier: config.guardrailIdentifier,
          guardrailVersion: config.guardrailVersion,
          trace: "enabled",
        },
        // The caller may request a larger structured response, but never an
        // unbounded one. This keeps each Bedrock request predictable.
        inferenceConfig: { maxTokens: Math.min(Math.max(maxTokens ?? 600, 128), 1_400), temperature: 0 },
        requestMetadata: { application: "ano", runtime: "phase4b" },
      }), { abortSignal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new BedrockAdapterError("Bedrock planning exceeded Ano’s configured runtime limit.", "TIMEOUT");
      }
      const name = error instanceof Error ? error.name : "";
      if (name === "CredentialsProviderError") {
        throw new BedrockAdapterError("Ano’s server has no AWS credentials. Configure a server-side IAM role, profile, or AWS access-key pair before using Bedrock.", "CREDENTIALS_UNAVAILABLE");
      }
      if (name === "AccessDeniedException" || name === "UnauthorizedException") {
        throw new BedrockAdapterError("Ano’s AWS identity is not allowed to invoke the configured Bedrock model or guardrail.", "ACCESS_DENIED");
      }
      if (name === "ResourceNotFoundException" || name === "ValidationException") {
        throw new BedrockAdapterError("Ano’s configured Bedrock model or guardrail could not be used in this AWS region.", "INVALID_CONFIGURATION");
      }
      throw new BedrockAdapterError("Bedrock planning is unavailable. No Ano connector or external action was attempted.", "UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  };
}

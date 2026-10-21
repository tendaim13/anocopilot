import "server-only";

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

import { BedrockAdapterError, type BedrockConverse, type BedrockPlannerConfig } from "@/server/agents/bedrock-contracts";

export type AnoAgentMode = "mock" | "bedrock";
export { BedrockAdapterError } from "@/server/agents/bedrock-contracts";
export type { BedrockConverse, BedrockPlannerConfig } from "@/server/agents/bedrock-contracts";

export class BedrockConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BedrockConfigurationError";
  }
}

function value(name: "AWS_REGION" | "BEDROCK_MODEL_ID" | "BEDROCK_GUARDRAIL_ID" | "BEDROCK_GUARDRAIL_VERSION") {
  return process.env[name]?.trim() ?? "";
}

/** Defaults to mock when unset so development never consumes model capacity by accident. */
export function getAnoAgentMode(): AnoAgentMode {
  const configured = process.env.ANO_AGENT_MODE?.trim().toLowerCase();
  if (!configured || configured === "mock") return "mock";
  if (configured === "bedrock") return "bedrock";
  throw new BedrockConfigurationError("ANO_AGENT_MODE must be either mock or bedrock.");
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

/**
 * Uses the default AWS SDK credential provider chain. Credentials and model
 * configuration remain server-only and are never included in API responses.
 */
export function createBedrockConverse(config: BedrockPlannerConfig): BedrockConverse {
  const client = new BedrockRuntimeClient({ region: config.region, maxAttempts: 1 });

  return async ({ messages, system, toolConfig, timeoutMs }) => {
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
        toolConfig,
        guardrailConfig: {
          guardrailIdentifier: config.guardrailIdentifier,
          guardrailVersion: config.guardrailVersion,
          trace: "enabled",
        },
        inferenceConfig: { maxTokens: 600, temperature: 0 },
        requestMetadata: { application: "ano", runtime: "phase4b" },
      }), { abortSignal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new BedrockAdapterError("Bedrock planning exceeded Ano’s configured runtime limit.", "TIMEOUT");
      }
      throw new BedrockAdapterError("Bedrock planning is unavailable. No Ano connector or external action was attempted.", "UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  };
}

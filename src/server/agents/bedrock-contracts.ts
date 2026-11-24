import type { ConverseCommandOutput, Message, SystemContentBlock, ToolConfiguration } from "@aws-sdk/client-bedrock-runtime";
import type { BaseMessage } from "@langchain/core/messages";

import type { ResearchInput } from "@/lib/ano/types";
import { salesResearchRole, salesResearchSystemInstructions } from "@/server/agents/roles/sales-research";
import { toolRegistry } from "@/server/agents/tools/registry";

export type BedrockPlannerConfig = {
  region: string;
  modelId: string;
  guardrailIdentifier: string;
  guardrailVersion: string;
};

export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

export type GeminiPlannerConfig = {
  provider: "gemini";
  apiKey: string;
  modelId: string;
  fallbackModelIds?: string[];
  baseUrl: string;
  thinkingBudget?: number;
  thinkingLevel?: GeminiThinkingLevel;
};

export type OllamaPlannerConfig = {
  provider: "ollama";
  baseUrl: string;
  modelId: string;
  apiKey?: string;
};

export type LlmPlannerConfig =
  | ({ provider?: "bedrock" } & BedrockPlannerConfig)
  | OllamaPlannerConfig
  | GeminiPlannerConfig;

export type InvokableChatModel = {
  invoke(messages: BaseMessage[]): Promise<{ content: unknown }>;
};

export type BedrockConverseRequest = {
  messages: Message[];
  system: SystemContentBlock[];
  toolConfig?: ToolConfiguration;
  timeoutMs: number;
  /** Optional, bounded per-call response budget. The adapter enforces its ceiling. */
  maxTokens?: number;
};

export type BedrockConverse = (request: BedrockConverseRequest) => Promise<ConverseCommandOutput>;

export class BedrockAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: "TIMEOUT" | "CREDENTIALS_UNAVAILABLE" | "ACCESS_DENIED" | "INVALID_CONFIGURATION" | "UNAVAILABLE",
  ) {
    super(message);
    this.name = "BedrockAdapterError";
  }
}

export const mockResearchToolConfig: ToolConfiguration = {
  tools: toolRegistry
    .filter((tool) => tool.tier === "mock_read" || tool.tier === "deterministic")
    .map((tool) => ({
      toolSpec: {
        name: tool.name,
        description: `${tool.description} This Ano Phase 4B tool takes no input and returns simulated, read-only data only.`,
        inputSchema: {
          json: {
            type: "object",
            additionalProperties: false,
          },
        },
      },
    })),
};

export function salesResearchBedrockSystemPrompt(): SystemContentBlock[] {
  return [{
    text: [
      `You are ${salesResearchRole.name}.`,
      ...salesResearchSystemInstructions,
      "This is a simulated research workflow. All available tool data is simulated and read-only.",
      "Use each available tool exactly once and in this order: search_companies, search_people, get_account_evidence, compute_score, build_today_plan.",
      "Every tool accepts an empty JSON object. Never invent tool input fields.",
      "After all five tool results, return only one JSON object with this exact shape: {\"summary\": string, \"evidenceIds\": string[], \"inferences\": string[]}.",
      "The summary may only rely on returned tool data. Cite the supporting evidence IDs in evidenceIds. Put any uncertainty in inferences.",
      "Do not include Markdown, prose outside the JSON object, URLs, contact details beyond returned simulated data, or instructions to take external action.",
    ].join("\n"),
  }];
}

export function salesResearchBedrockPrompt(input: ResearchInput) {
  return [
    "Run the approved Ano simulated sales research workflow for this brief.",
    "All connector, provider, browser, HTTP, SQL, email, call, and Mercury actions are disabled.",
    JSON.stringify({
      objective: input.objective,
      industry: input.industry,
      geography: input.geography,
      targetRole: input.targetRole,
      exclusions: input.exclusions,
      maxResults: input.maxResults,
    }),
  ].join("\n\n");
}

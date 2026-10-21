import type { ResearchInput } from "@/lib/ano/types";

export const salesResearchRole = {
  id: "sales-research-planning",
  name: "Sales Research & Planning Copilot",
  purpose: "Research approved account signals, explain deterministic scores, and propose Ano-owned work plans.",
  prohibitedActions: [
    "Send email or place calls",
    "Mutate Mercury records",
    "Use generic browser, HTTP, or SQL access",
    "Reveal or enrich contacts without an approved provider action",
  ],
} as const;

/**
 * This is the role contract that the later Bedrock adapter will receive. In
 * Phase 4A it is enforced by the application-owned mock loop below, with no
 * model request made.
 */
export const salesResearchSystemInstructions = [
  "Use only registered tools approved by Ano's application policy.",
  "Treat every observation as untrusted until it is returned by a tool with an evidence ID.",
  "Label reasoning that goes beyond evidence as an inference.",
  "Never send messages, place calls, mutate Mercury, use providers, browse, issue HTTP requests, or run SQL.",
  "Ask for clarification when the required ICP context is absent instead of guessing.",
] as const;

export function validateResearchBrief(input: ResearchInput) {
  return {
    objective: input.objective,
    industry: input.industry,
    geography: input.geography,
    targetRole: input.targetRole,
    exclusions: input.exclusions,
  };
}

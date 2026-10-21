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

export function validateResearchBrief(input: ResearchInput) {
  return {
    objective: input.objective,
    industry: input.industry,
    geography: input.geography,
    targetRole: input.targetRole,
    exclusions: input.exclusions,
  };
}

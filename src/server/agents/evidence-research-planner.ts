import "server-only";

import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import { researchQueryPlanSchema, type ResearchQueryPlan } from "@/lib/ano/evidence-research";
import type { LlmPlannerConfig } from "@/server/agents/bedrock-contracts";
import { createPlannerChatModel } from "@/server/agents/ollama-chat-model";
import { extractJsonCandidate, invokeBedrockPrompt } from "@/server/agents/research-planning-model";

export class EvidenceResearchPlannerError extends Error {
  constructor(message: string, public readonly reason?: string) {
    super(message);
    this.name = "EvidenceResearchPlannerError";
  }
}

/** Generates only bounded search intents. It cannot search, fetch, or evaluate sources. */
export function createEvidenceResearchPlanner(config: LlmPlannerConfig) {
  const model = createPlannerChatModel(config, { maxTokens: 1_000 });

  return {
    async planQueries(brief: ResearchBrief, plan: ResearchPlan): Promise<ResearchQueryPlan> {
      const prompt = [
        "You are Ano's research-query planner.",
        "Create 2 to 5 short public-evidence search queries from the approved research plan below.",
        "Do not claim any market is best. Do not search, fetch, name companies, name people, call tools, or make recommendations.",
        "Return JSON only: {queries:[{id:string UUID,query:string,reason:string,sourceClass:'Government and official statistics'|'Industry bodies and primary research'|'Public company reports and filings'|'Independent reporting'}]}.",
        JSON.stringify({ brief, approvedPlan: { researchQuestions: plan.researchQuestions, comparisonCriteria: plan.comparisonCriteria, intendedSourceClasses: plan.intendedSourceClasses, plannedScope: plan.plannedScope } }),
      ].join("\n\n");
      const systemPrompt = "Return only the requested JSON object. Do not include Markdown or an explanation.";
      let reason = "Bedrock did not return a valid query plan.";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const text = await invokeBedrockPrompt(
            model,
            systemPrompt,
            attempt ? `${prompt}\n\nReturn the exact JSON object now.` : prompt,
          );
          if (!text) throw new Error("Bedrock returned no textual JSON.");
          return researchQueryPlanSchema.parse(JSON.parse(extractJsonCandidate(text)));
        } catch (error) {
          reason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 600) : reason;
        }
      }
      throw new EvidenceResearchPlannerError("Ano could not produce a bounded research-query plan. No research provider was contacted.", reason);
    },
  };
}


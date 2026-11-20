import "server-only";

import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import { researchQueryPlanSchema, type ResearchQueryPlan } from "@/lib/ano/evidence-research";
import type { BedrockPlannerConfig } from "@/server/agents/bedrock-contracts";

export class EvidenceResearchPlannerError extends Error {
  constructor(message: string, public readonly reason?: string) {
    super(message);
    this.name = "EvidenceResearchPlannerError";
  }
}

function contentText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.flatMap((item) => typeof item === "string" ? [item] : item && typeof item === "object" && "text" in item && typeof item.text === "string" ? [item.text] : []).join("\n").trim();
}

function jsonCandidate(value: string) {
  return value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
}

/** Generates only bounded search intents. It cannot search, fetch, or evaluate sources. */
export function createEvidenceResearchPlanner(config: BedrockPlannerConfig) {
  const model = new ChatBedrockConverse({
    model: config.modelId,
    region: config.region,
    temperature: 0,
    maxTokens: 1_000,
    maxRetries: 0,
    guardrailConfig: { guardrailIdentifier: config.guardrailIdentifier, guardrailVersion: config.guardrailVersion, trace: "enabled" },
  });

  return {
    async planQueries(brief: ResearchBrief, plan: ResearchPlan): Promise<ResearchQueryPlan> {
      const prompt = [
        "You are Ano's research-query planner.",
        "Create 2 to 5 short public-evidence search queries from the approved research plan below.",
        "Do not claim any market is best. Do not search, fetch, name companies, name people, call tools, or make recommendations.",
        "Return JSON only: {queries:[{id:string UUID,query:string,reason:string,sourceClass:'Government and official statistics'|'Industry bodies and primary research'|'Public company reports and filings'|'Independent reporting'}]}.",
        JSON.stringify({ brief, approvedPlan: { researchQuestions: plan.researchQuestions, comparisonCriteria: plan.comparisonCriteria, intendedSourceClasses: plan.intendedSourceClasses, plannedScope: plan.plannedScope } }),
      ].join("\n\n");
      let reason = "Bedrock did not return a valid query plan.";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await model.invoke([
            new SystemMessage("Return only the requested JSON object. Do not include Markdown or an explanation."),
            new HumanMessage(attempt ? `${prompt}\n\nReturn the exact JSON object now.` : prompt),
          ]);
          const text = contentText(response.content);
          if (!text) throw new Error("Bedrock returned no textual JSON.");
          return researchQueryPlanSchema.parse(JSON.parse(jsonCandidate(text)));
        } catch (error) {
          reason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 600) : reason;
        }
      }
      throw new EvidenceResearchPlannerError("Ano could not produce a bounded research-query plan. No research provider was contacted.", reason);
    },
  };
}


import "server-only";

import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { researchQuerySchema, type ResearchQuery } from "@/lib/ano/evidence-research";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import type { ResearchCoverage } from "@/server/research/deep-research-assessment";
import type { BedrockPlannerConfig } from "@/server/agents/bedrock-contracts";

const text = z.string().trim().min(1).max(500);
// Ano, not Bedrock, owns durable identifiers and wave sequencing. Keeping them
// out of the model contract prevents a harmless formatting mistake from
// rejecting an otherwise usable research query.
const modelResearchQuerySchema = researchQuerySchema.omit({ id: true, waveNumber: true });
export const iterativeResearchWavePlanSchema = z.object({
  objective: text,
  candidateMarkets: z.array(z.string().trim().min(1).max(140)).min(2).max(5),
  // A follow-up planner is allowed to conclude that the saved evidence does
  // not justify another novel query. Ano then ends public collection rather
  // than treating that honest zero-query result as a model failure.
  queries: z.array(modelResearchQuerySchema).max(12),
});
export type IterativeResearchWavePlan = {
  objective: string;
  candidateMarkets: string[];
  queries: ResearchQuery[];
};

export class IterativeResearchPlannerError extends Error {
  constructor(message: string, readonly reason?: string) {
    super(message);
    this.name = "IterativeResearchPlannerError";
  }
}

function contentText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.flatMap((item) => typeof item === "string" ? [item] : item && typeof item === "object" && "text" in item && typeof item.text === "string" ? [item.text] : []).join("\n").trim();
}

function jsonCandidate(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  return first >= 0 && last > first ? value.slice(first, last + 1) : value.trim();
}

function planInput(brief: ResearchBrief, plan: ResearchPlan) {
  return {
    approvedBrief: {
      offer: brief.offer,
      goal: brief.goal,
      marketHints: brief.marketHints,
      locationHints: brief.locationHints,
      buyerHints: brief.buyerHints,
      constraints: brief.constraints,
    },
    approvedPlan: {
      researchQuestions: plan.researchQuestions,
      comparisonCriteria: plan.comparisonCriteria,
      intendedSourceClasses: plan.intendedSourceClasses,
      plannedScope: plan.plannedScope,
    },
  };
}

function priorQueryContext(priorQueries: string[]) {
  return priorQueries.length
    ? { alreadySearched: priorQueries.slice(0, 50) }
    : { alreadySearched: [] };
}

function promptForInitialWave(brief: ResearchBrief, plan: ResearchPlan, maximumQueries: number, priorQueries: string[]) {
  return [
    "You are Ano's iterative public-research planner. You plan searches but cannot browse, fetch, use a provider, name companies, name people, or make a market recommendation.",
    "Design the first evidence wave for a comparative market study. The purpose is to form a small, testable set of 2 to 5 candidate markets and collect evidence for the same decision dimensions, not to answer with generic industry articles.",
    "Use these comparison dimensions exactly: problem_urgency, market_density, buyer_conditions, market_access, solution_fit, counter_evidence.",
    `Return 6 to ${Math.min(12, maximumQueries)} short, non-duplicative queries. Every query must identify a candidateMarket and one comparisonDimension. Spread queries across at least two candidates and seek the listed source classes. Candidate markets are hypotheses to be tested, never recommendations. If no novel query is justified, return an empty queries array.`,
    "Avoid generic queries such as 'AI workflow adoption'. Anchor each query to the offer, outcome, candidate, and evidence gap. Include at least one counter_evidence query. Do not repeat or lightly rephrase any query in alreadySearched.",
    "Return JSON only: {objective:string,candidateMarkets:string[],queries:[{query:string,reason:string,sourceClass:'Government and official statistics'|'Industry bodies and primary research'|'Public company reports and filings'|'Independent reporting',candidateMarket:string|null,comparisonDimension:'problem_urgency'|'market_density'|'buyer_conditions'|'market_access'|'solution_fit'|'counter_evidence',priority:number}]}. Do not return IDs or wave numbers; Ano assigns them.",
    JSON.stringify({ ...planInput(brief, plan), ...priorQueryContext(priorQueries) }),
  ].join("\n\n");
}

function promptForFollowUpWave(brief: ResearchBrief, plan: ResearchPlan, coverage: ResearchCoverage, waveNumber: number, maximumQueries: number, priorQueries: string[]) {
  return [
    "You are Ano's iterative public-research planner. You plan the next bounded research wave but cannot browse, fetch, use a provider, name companies, name people, or make a market recommendation.",
    "Use the saved coverage ledger below to close the highest-impact comparison gaps. Do not repeat broad queries or search a candidate simply because it is familiar. Do not repeat or lightly rephrase any query in alreadySearched.",
    `This is wave ${waveNumber}. Return up to ${Math.min(12, maximumQueries)} targeted, non-duplicative queries. Preserve the candidateMarkets exactly; every query must name one candidateMarket and one comparisonDimension. Prioritize missing direct evidence, source-class diversity, dated evidence, and counter-evidence for an apparent leader. If none can be formed without repeating alreadySearched, return an empty queries array.`,
    "Return JSON only: {objective:string,candidateMarkets:string[],queries:[{query:string,reason:string,sourceClass:'Government and official statistics'|'Industry bodies and primary research'|'Public company reports and filings'|'Independent reporting',candidateMarket:string|null,comparisonDimension:'problem_urgency'|'market_density'|'buyer_conditions'|'market_access'|'solution_fit'|'counter_evidence',priority:number}]}. Do not return IDs or wave numbers; Ano assigns them.",
    JSON.stringify({ ...planInput(brief, plan), coverage, ...priorQueryContext(priorQueries) }),
  ].join("\n\n");
}

function normalisedQueryKey(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function normalizeIterativeResearchWave(value: unknown, waveNumber: number, maximumQueries: number, expectedCandidates?: string[], priorQueries: string[] = []) {
  const parsed = iterativeResearchWavePlanSchema.parse(value);
  const candidateMarkets = expectedCandidates?.length ? expectedCandidates : parsed.candidateMarkets;
  const allowedCandidates = new Set(candidateMarkets);
  const knownQueries = new Set(priorQueries.map(normalisedQueryKey));
  const queries: ResearchQuery[] = parsed.queries
    .filter((query) => !expectedCandidates?.length || (typeof query.candidateMarket === "string" && allowedCandidates.has(query.candidateMarket)))
    .slice(0, Math.min(12, maximumQueries))
    .filter((query) => {
      const key = normalisedQueryKey(query.query);
      if (knownQueries.has(key)) return false;
      knownQueries.add(key);
      return true;
    })
    .map((query) => researchQuerySchema.parse({ ...query, id: crypto.randomUUID(), candidateMarket: query.candidateMarket ?? candidateMarkets[0] ?? null, comparisonDimension: query.comparisonDimension ?? "problem_urgency", priority: query.priority ?? 50, waveNumber }));
  return { objective: parsed.objective, candidateMarkets, queries };
}

/** Bedrock proposes only the next bounded question set. Ano owns all provider access and stopping conditions. */
export function createIterativeResearchPlanner(config: BedrockPlannerConfig) {
  const model = new ChatBedrockConverse({
    model: config.modelId,
    region: config.region,
    temperature: 0,
    maxTokens: 2_000,
    maxRetries: 0,
    guardrailConfig: { guardrailIdentifier: config.guardrailIdentifier, guardrailVersion: config.guardrailVersion, trace: "enabled" },
  });

  async function invoke(prompt: string, waveNumber: number, maximumQueries: number, expectedCandidates?: string[], priorQueries: string[] = []) {
    let reason = "Bedrock did not return a valid iterative query plan.";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await model.invoke([
          new SystemMessage("Return only the requested JSON object. Do not include Markdown, recommendations, or explanatory text."),
          new HumanMessage(attempt ? `${prompt}\n\nReturn the exact JSON object now.` : prompt),
        ]);
        const output = contentText(response.content);
        if (!output) throw new Error("Bedrock returned no textual JSON.");
        return normalizeIterativeResearchWave(JSON.parse(jsonCandidate(output)), waveNumber, maximumQueries, expectedCandidates, priorQueries);
      } catch (error) {
        reason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 600) : reason;
      }
    }
    throw new IterativeResearchPlannerError("Ano could not plan the next bounded research wave. No additional provider request was attempted.", reason);
  }

  return {
    planInitialWave: (brief: ResearchBrief, plan: ResearchPlan, maximumQueries: number, priorQueries: string[] = []) => invoke(promptForInitialWave(brief, plan, maximumQueries, priorQueries), 1, maximumQueries, undefined, priorQueries),
    planFollowUpWave: (brief: ResearchBrief, plan: ResearchPlan, coverage: ResearchCoverage, waveNumber: number, maximumQueries: number, priorQueries: string[] = []) => invoke(promptForFollowUpWave(brief, plan, coverage, waveNumber, maximumQueries, priorQueries), waveNumber, maximumQueries, coverage.candidateMarkets, priorQueries),
  };
}

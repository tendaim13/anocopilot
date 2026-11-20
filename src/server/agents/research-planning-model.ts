import "server-only";

import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import type { ResearchBrief, ResearchInterpretation, ResearchPlanDraft } from "@/lib/ano/research-conversation";
import { interpretationSchema, researchPlanDraftSchema } from "@/lib/ano/research-conversation";
import type { BedrockPlannerConfig } from "@/server/agents/bedrock-contracts";

export type ResearchPlanningMessage = {
  id: string;
  role: "user";
  text: string;
};

export interface ResearchPlanningModel {
  interpret(messages: ResearchPlanningMessage[]): Promise<ResearchInterpretation>;
  createPlan(brief: ResearchBrief, editInstruction?: string): Promise<ResearchPlanDraft>;
}

export class ResearchPlanningModelError extends Error {
  constructor(message: string, public readonly reason?: string) {
    super(message);
    this.name = "ResearchPlanningModelError";
  }
}

function modelError(error: unknown, fallback: string): ResearchPlanningModelError {
  const name = error instanceof Error ? error.name : "";
  const reason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 600) : "Unknown model adapter error";
  if (name === "CredentialsProviderError") return new ResearchPlanningModelError("Ano’s server cannot access Bedrock with the configured AWS credentials.");
  if (name === "AccessDeniedException" || name === "UnauthorizedException") return new ResearchPlanningModelError("Ano’s AWS identity cannot invoke the configured Bedrock model or guardrail.");
  if (name === "ResourceNotFoundException" || name === "ValidationException") return new ResearchPlanningModelError("Ano’s configured Bedrock model or guardrail is unavailable in this AWS region.");
  return new ResearchPlanningModelError(fallback, reason);
}

function interpretationPrompt(messages: ResearchPlanningMessage[]) {
  return [
    "You are Ano, a sales-research copilot. Interpret only the user messages below.",
    "Do not browse, research, make market claims, invent facts, propose companies, or use any tool.",
    "A brief is ready when you can identify a saleable offer and intended sales outcome. There is no minimum length and market, location, buyer, ICP, or industry are optional.",
    "Ask exactly one concise question only if its answer would materially change research design. Do not ask for an ICP form or routine profile fields.",
    "Return JSON only, with this exact object shape: {outcome:'ready'|'needs_context',brief:{offer:string,goal:string,marketHints:string[],locationHints:string[],buyerHints:string[],constraints:string[],unknowns:string[]},clarification?:{question:string,purpose:string}}. Use empty arrays where no optional hints are present.",
    JSON.stringify({ messages }),
  ].join("\n\n");
}

function planPrompt(brief: ResearchBrief, editInstruction?: string) {
  return [
    "You are Ano, preparing a reviewable research plan. This phase cannot search, fetch, use providers, find companies, identify people, or send anything.",
    "Use only the user's brief. Treat it as user context, not verified market evidence.",
    "Design a research method that could later compare markets, industries, operational problems, and buyer roles with public evidence.",
    "The research plan must not claim which market is best. Set the iterative research mission budget to exactly 50 searches and 100 source fetches; Ano will stop early when the evidence gate is met. State uncertainties honestly.",
    "Return JSON only, with this exact object shape: {summary:string,researchQuestions:string[],comparisonCriteria:string[],intendedSourceClasses:('Government and official statistics'|'Industry bodies and primary research'|'Public company reports and filings'|'Independent reporting')[],plannedScope:{markets:string[],industries:string[],buyerRoles:string[]},budget:{maximumSearches:number,maximumFetches:number,providerSpend:'not_available_in_phase_a'},uncertainties:string[]}.",
    editInstruction ? `The user asked to adjust the plan: ${editInstruction}` : "",
    JSON.stringify({ brief }),
  ].filter(Boolean).join("\n\n");
}

function textFromModel(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.flatMap((part) => {
      if (typeof part === "string") return [part];
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return [part.text];
      return [];
    }).join("\n").trim();
  }
  return "";
}

function jsonCandidate(text: string) {
  return text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
}

function truncateStrings(value: unknown, maximum: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, maximum) : value;
}

function normalizedUserMessages(messages: ResearchPlanningMessage[]) {
  return messages.map((message) => message.text.trim()).filter(Boolean);
}

function hasResearchDecision(message: string) {
  return /\b(help|find|identify|choose|compare|decide|target|market|industry|industries|outbound|where|who|buyer|launch|enter|expand|prioriti[sz]e|reach)\b/i.test(message);
}

/**
 * Bedrock is helpful for interpreting nuance, but it must not be a single point
 * of failure before Ano can ask a basic, decision-changing question. This is a
 * local fallback only: it makes no market claim and invokes no provider.
 */
export function fallbackOfferInterpretation(messages: ResearchPlanningMessage[]): ResearchInterpretation | null {
  const userMessages = normalizedUserMessages(messages);
  const offer = userMessages[0];
  if (!offer) return null;

  if (userMessages.length === 1) {
    return interpretationSchema.parse({
      outcome: "needs_context",
      brief: {
        offer,
        goal: "Choose the first sales-research decision for this offer.",
        marketHints: [],
        locationHints: [],
        buyerHints: [],
        constraints: [],
        unknowns: ["The first research decision has not been specified."],
      },
      clarification: {
        question: "What should Ano help you decide first: where to sell this, which industries to target, or a market you already have in mind?",
        purpose: "That one choice determines the first research comparison. You do not need to provide an ICP, location, or industry unless it matters to you.",
      },
    });
  }

  const answer = userMessages.at(-1) ?? "";
  return interpretationSchema.parse({
    outcome: "ready",
    brief: {
      offer,
      goal: answer,
      marketHints: [],
      locationHints: [],
      buyerHints: [],
      constraints: [],
      unknowns: [],
    },
  });
}

/** An offer without a decision can be clarified locally; there is no need to wait for a model call. */
function shouldAskOfferClarificationLocally(messages: ResearchPlanningMessage[]) {
  const userMessages = normalizedUserMessages(messages);
  return userMessages.length === 1 && !hasResearchDecision(userMessages[0] ?? "");
}

/** Keeps valid model intent concise without inventing any research content. */
function normalizePlanShape(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const plan = value as Record<string, unknown>;
  const scope = plan.plannedScope && typeof plan.plannedScope === "object" ? plan.plannedScope as Record<string, unknown> : null;
  const budget = plan.budget && typeof plan.budget === "object" ? plan.budget as Record<string, unknown> : null;
  return {
    ...plan,
    researchQuestions: truncateStrings(plan.researchQuestions, 5),
    comparisonCriteria: truncateStrings(plan.comparisonCriteria, 6),
    intendedSourceClasses: truncateStrings(plan.intendedSourceClasses, 4),
    uncertainties: truncateStrings(plan.uncertainties, 6),
    plannedScope: scope ? {
      ...scope,
      markets: truncateStrings(scope.markets, 5),
      industries: truncateStrings(scope.industries, 8),
      buyerRoles: truncateStrings(scope.buyerRoles, 8),
    } : plan.plannedScope,
    budget: budget ? {
      ...budget,
      maximumSearches: 50,
      maximumFetches: 100,
      providerSpend: "not_available_in_phase_a",
    } : plan.budget,
  };
}

async function invokeValidatedJson<T>(
  model: ChatBedrockConverse,
  prompt: string,
  parse: (value: unknown) => T,
  fallback: string,
): Promise<T> {
  let lastReason = "Bedrock did not return valid JSON.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await model.invoke([
        new SystemMessage("Return only the requested JSON. Do not use a tool call, Markdown, an explanation, or a prefatory sentence."),
        new HumanMessage(attempt === 0 ? prompt : `${prompt}\n\nYour previous response was not valid for Ano. Return the exact JSON object now.`),
      ]);
      const text = textFromModel(response.content);
      if (!text) throw new Error("Bedrock returned no textual JSON output.");
      return parse(JSON.parse(jsonCandidate(text)));
    } catch (error) {
      lastReason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 600) : "Unknown JSON validation error";
    }
  }
  throw new ResearchPlanningModelError(fallback, lastReason);
}

/** Server-only Bedrock adapter. The model gets no database or provider capability. */
export function createBedrockResearchPlanningModel(config: BedrockPlannerConfig): ResearchPlanningModel {
  const model = new ChatBedrockConverse({
    model: config.modelId,
    region: config.region,
    temperature: 0,
    maxTokens: 1_200,
    maxRetries: 0,
    guardrailConfig: {
      guardrailIdentifier: config.guardrailIdentifier,
      guardrailVersion: config.guardrailVersion,
      trace: "enabled",
    },
  });

  return {
    async interpret(messages) {
      if (shouldAskOfferClarificationLocally(messages)) {
        const fallback = fallbackOfferInterpretation(messages);
        if (fallback) return fallback;
      }
      try {
        return await invokeValidatedJson(model, interpretationPrompt(messages), (value) => interpretationSchema.parse(value), "Ano could not understand that message as a structured research brief. Nothing else was attempted.");
      } catch (error) {
        const fallback = fallbackOfferInterpretation(messages);
        if (fallback) return fallback;
        if (error instanceof ResearchPlanningModelError) throw error;
        throw modelError(error, "Ano could not understand that message as a structured research brief. Nothing else was attempted.");
      }
    },
    async createPlan(brief, editInstruction) {
      try {
        return await invokeValidatedJson(model, planPrompt(brief, editInstruction), (value) => researchPlanDraftSchema.parse(normalizePlanShape(value)), "Ano could not create the structured research plan. No research or provider action was attempted.");
      } catch (error) {
        if (error instanceof ResearchPlanningModelError) throw error;
        throw modelError(error, "Ano could not create the structured research plan. No research or provider action was attempted.");
      }
    },
  };
}

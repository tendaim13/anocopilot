import "server-only";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import type { ResearchBrief, ResearchInterpretation, ResearchPlanDraft } from "@/lib/ano/research-conversation";
import { interpretationSchema, researchPlanDraftSchema } from "@/lib/ano/research-conversation";
import type { InvokableChatModel, LlmPlannerConfig } from "@/server/agents/bedrock-contracts";
import { createPlannerChatModel } from "@/server/agents/ollama-chat-model";

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
  constructor(
    message: string,
    public readonly reason?: string,
    public readonly fatal: boolean = false,
  ) {
    super(message);
    this.name = "ResearchPlanningModelError";
  }
}

export type InvokableBedrockModel = InvokableChatModel;

const FATAL_BEDROCK_ERROR_NAMES = new Set([
  "CredentialsProviderError",
  "AccessDeniedException",
  "UnauthorizedException",
  "ResourceNotFoundException",
  "ValidationException",
  "OllamaConnectionError",
  "OllamaModelNotFoundError",
  "GeminiApiError",
]);

function isFatalBedrockError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (FATAL_BEDROCK_ERROR_NAMES.has(error.name)) return true;
  return /CredentialsProviderError|AccessDeniedException|ResourceNotFoundException|ValidationException|OllamaConnectionError|OllamaModelNotFoundError|GeminiApiError/i.test(
    error.message ?? "",
  );
}

function isUnsupportedSystemMessageError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /system\s+message|doesn't support system|does not support system|unsupported.*system/i.test(
    error.message ?? "",
  );
}

function modelError(error: unknown, fallback: string): ResearchPlanningModelError {
  const name = error instanceof Error ? error.name : "";
  const reason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 600) : "Unknown model adapter error";
  if (
    name === "OllamaConnectionError" ||
    name === "OllamaModelNotFoundError" ||
    name === "GeminiApiError"
  ) {
    return new ResearchPlanningModelError(error instanceof Error ? error.message : fallback, reason, true);
  }
  if (name === "CredentialsProviderError") {
    return new ResearchPlanningModelError(
      "Ano’s server cannot access Bedrock with the configured AWS credentials.",
      reason,
      true,
    );
  }
  if (name === "AccessDeniedException" || name === "UnauthorizedException") {
    return new ResearchPlanningModelError(
      "Ano’s AWS identity cannot invoke the configured Bedrock model or guardrail.",
      reason,
      true,
    );
  }
  if (name === "ResourceNotFoundException" || name === "ValidationException") {
    return new ResearchPlanningModelError(
      "Ano’s configured Bedrock model or guardrail is unavailable in this AWS region.",
      reason,
      true,
    );
  }
  return new ResearchPlanningModelError(fallback, reason, isFatalBedrockError(error));
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

/**
 * Extracts JSON from fenced markdown blocks or from the outermost `{...}` span
 * so small models that emit prose around JSON remain parseable.
 */
export function extractJsonCandidate(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  return first >= 0 && last > first ? candidate.slice(first, last + 1) : candidate;
}

/**
 * Invokes Bedrock Converse and retries once with a merged HumanMessage when a
 * configured model (such as Gemma 3) rejects system instructions.
 */
export async function invokeBedrockPrompt(
  model: InvokableBedrockModel,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  try {
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);
    return textFromModel(response.content);
  } catch (error) {
    if (isUnsupportedSystemMessageError(error)) {
      const response = await model.invoke([
        new HumanMessage(`${systemPrompt}\n\n${userPrompt}`),
      ]);
      return textFromModel(response.content);
    }
    throw error;
  }
}

function truncateStrings(value: unknown, maximum: number) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, maximum)
    : [];
}

function normalizedUserMessages(messages: ResearchPlanningMessage[]) {
  return messages.map((message) => message.text.trim()).filter(Boolean);
}

function hasResearchDecision(message: string) {
  return /\b(help|find|identify|choose|compare|decide|target|market|industry|industries|outbound|where|who|buyer|launch|enter|expand|prioriti[sz]e|reach)\b/i.test(message);
}

/**
 * Bedrock is helpful for interpreting nuance, but it must not be a single point
 * of failure before Ano can clarify or advance a clear request. This is a local
 * fallback only: it makes no market claim and invokes no provider.
 */
export function fallbackOfferInterpretation(messages: ResearchPlanningMessage[]): ResearchInterpretation | null {
  const userMessages = normalizedUserMessages(messages);
  const offer = userMessages[0];
  if (!offer) return null;

  if (userMessages.length === 1 && !hasResearchDecision(offer)) {
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

  const answer = userMessages.at(-1) ?? offer;
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

/**
 * Deterministic Phase A fallback plan derived strictly from the user's brief.
 * Makes zero market recommendations and invokes zero external providers.
 */
export function fallbackResearchPlan(brief: ResearchBrief, editInstruction?: string): ResearchPlanDraft {
  const focus = brief.locationHints.length
    ? brief.locationHints.join(", ")
    : brief.marketHints.length
      ? brief.marketHints.join(", ")
      : "candidate target markets";
  const editNote = editInstruction?.trim()
    ? `Adjusted to prioritize: ${editInstruction.trim().slice(0, 180)}. `
    : "";

  return researchPlanDraftSchema.parse({
    summary: `${editNote}Compare ${focus} for "${brief.offer.slice(0, 220)}" using public evidence to support: ${brief.goal.slice(0, 220)}.`.slice(0, 900),
    researchQuestions: [
      `Which markets or sub-segments show documented operational demand and scale aligned with "${brief.offer.slice(0, 140)}"?`,
      `What buyer conditions, adoption friction, or regulatory factors distinguish candidate segments for "${brief.goal.slice(0, 140)}"?`,
    ],
    comparisonCriteria: [
      "Documented operational urgency",
      "Reachable buyer density and market scale",
      "Evidence of budget or buyer readiness",
    ],
    intendedSourceClasses: [
      "Government and official statistics",
      "Industry bodies and primary research",
      "Public company reports and filings",
      "Independent reporting",
    ],
    plannedScope: {
      markets: brief.locationHints.slice(0, 5),
      industries: brief.marketHints.slice(0, 8),
      buyerRoles: brief.buyerHints.slice(0, 8),
    },
    budget: {
      maximumSearches: 50,
      maximumFetches: 100,
      providerSpend: "not_available_in_phase_a",
    },
    uncertainties: brief.unknowns.length
      ? brief.unknowns.slice(0, 6)
      : ["Relative conversion potential across candidate segments remains untested until Phase B public evidence is collected."],
  });
}

/** An offer without a decision can be clarified locally; there is no need to wait for a model call. */
function shouldAskOfferClarificationLocally(messages: ResearchPlanningMessage[]) {
  const userMessages = normalizedUserMessages(messages);
  return userMessages.length === 1 && !hasResearchDecision(userMessages[0] ?? "");
}

const ALLOWED_SOURCE_CLASSES = [
  "Government and official statistics",
  "Industry bodies and primary research",
  "Public company reports and filings",
  "Independent reporting",
] as const;

export type SourceClassLiteral = (typeof ALLOWED_SOURCE_CLASSES)[number];

export function mapSourceClass(raw: string): SourceClassLiteral | null {
  const trimmed = raw.trim();
  const exact = ALLOWED_SOURCE_CLASSES.find((item) => item.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  if (/gov|official|stat|census|ministry|regulat/i.test(trimmed)) return "Government and official statistics";
  if (/industr|primary|assoc|trade|benchmark|survey/i.test(trimmed)) return "Industry bodies and primary research";
  if (/company|filing|annual|report|sec|10-k|earning/i.test(trimmed)) return "Public company reports and filings";
  if (/independen|news|journal|media|press|analys/i.test(trimmed)) return "Independent reporting";
  return null;
}

/** Coerces optional arrays and strips stray clarifications when outcome is ready. */
export function normalizeInterpretationShape(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  const briefObj = raw.brief && typeof raw.brief === "object" ? (raw.brief as Record<string, unknown>) : {};
  const outcome = raw.outcome === "needs_context" ? "needs_context" : "ready";
  const clarificationObj =
    outcome === "needs_context" && raw.clarification && typeof raw.clarification === "object"
      ? (raw.clarification as Record<string, unknown>)
      : undefined;

  return {
    outcome,
    brief: {
      offer: typeof briefObj.offer === "string" ? briefObj.offer.trim().slice(0, 1000) : "",
      goal: typeof briefObj.goal === "string" ? briefObj.goal.trim().slice(0, 1000) : "",
      ...(typeof briefObj.businessLocation === "string" && briefObj.businessLocation.trim()
        ? { businessLocation: briefObj.businessLocation.trim().slice(0, 200) }
        : {}),
      ...(truncateStrings(briefObj.targetMarkets, 6).length > 0
        ? { targetMarkets: truncateStrings(briefObj.targetMarkets, 6) }
        : {}),
      ...(typeof briefObj.intakeComplete === "boolean"
        ? { intakeComplete: briefObj.intakeComplete }
        : {}),
      marketHints: truncateStrings(briefObj.marketHints, 6),
      locationHints: truncateStrings(briefObj.locationHints, 6),
      buyerHints: truncateStrings(briefObj.buyerHints, 6),
      constraints: truncateStrings(briefObj.constraints, 8),
      unknowns: truncateStrings(briefObj.unknowns, 8),
    },
    ...(clarificationObj
      ? {
          clarification: {
            question: typeof clarificationObj.question === "string" ? clarificationObj.question.trim().slice(0, 360) : "",
            purpose: typeof clarificationObj.purpose === "string" ? clarificationObj.purpose.trim().slice(0, 360) : "",
          },
        }
      : {}),
  };
}

/** Keeps valid model intent concise and schema-safe without inventing market evidence. */
export function normalizePlanShape(value: unknown, brief?: ResearchBrief) {
  if (!value || typeof value !== "object") return value;
  const plan = value as Record<string, unknown>;
  const scope = plan.plannedScope && typeof plan.plannedScope === "object" ? (plan.plannedScope as Record<string, unknown>) : null;
  const mappedSources = Array.from(
    new Set(
      truncateStrings(plan.intendedSourceClasses, 8)
        .map(mapSourceClass)
        .filter((item): item is SourceClassLiteral => item !== null),
    ),
  ).slice(0, 4);

  const questions = truncateStrings(plan.researchQuestions, 5).map((q) => q.slice(0, 360));
  if (questions.length < 2) {
    questions.push(
      `What verifiable public evidence differentiates target markets for ${brief?.offer?.slice(0, 100) || "this offer"}?`,
      `Which operational indicators and buyer conditions affect adoption readiness for ${brief?.goal?.slice(0, 100) || "this outcome"}?`,
    );
  }

  const criteria = truncateStrings(plan.comparisonCriteria, 6).map((c) => c.slice(0, 180));
  if (criteria.length < 2) {
    criteria.push("Documented operational urgency", "Reachable target segment density");
  }

  const rawSummary = typeof plan.summary === "string" && plan.summary.trim()
    ? plan.summary.trim().slice(0, 900)
    : brief
      ? `Compare candidate segments for ${brief.offer.slice(0, 200)} toward: ${brief.goal.slice(0, 200)}.`.slice(0, 900)
      : "Structured comparative market research plan.";

  return {
    ...plan,
    summary: rawSummary,
    researchQuestions: questions.slice(0, 5),
    comparisonCriteria: criteria.slice(0, 6),
    intendedSourceClasses: mappedSources.length > 0 ? mappedSources : [...ALLOWED_SOURCE_CLASSES],
    uncertainties: truncateStrings(plan.uncertainties, 6).map((u) => u.slice(0, 360)),
    plannedScope: scope
      ? {
          markets: truncateStrings(scope.markets, 5),
          industries: truncateStrings(scope.industries, 8),
          buyerRoles: truncateStrings(scope.buyerRoles, 8),
        }
      : {
          markets: brief?.locationHints.slice(0, 5) ?? [],
          industries: brief?.marketHints.slice(0, 8) ?? [],
          buyerRoles: brief?.buyerHints.slice(0, 8) ?? [],
        },
    budget: {
      maximumSearches: 50,
      maximumFetches: 100,
      providerSpend: "not_available_in_phase_a",
    },
  };
}

async function invokeValidatedJson<T>(
  model: InvokableBedrockModel,
  prompt: string,
  parse: (value: unknown) => T,
  fallback: string,
): Promise<T> {
  const systemPrompt =
    "Return only the requested JSON. Do not use a tool call, Markdown, an explanation, or a prefatory sentence.";
  let lastReason = "Bedrock did not return valid JSON.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const userPrompt =
        attempt === 0
          ? prompt
          : `${prompt}\n\nYour previous response was not valid for Ano. Return the exact JSON object now.`;
      const text = await invokeBedrockPrompt(model, systemPrompt, userPrompt);
      if (!text) throw new Error("Bedrock returned no textual JSON output.");
      return parse(JSON.parse(extractJsonCandidate(text)));
    } catch (error) {
      if (isFatalBedrockError(error)) {
        throw modelError(error, fallback);
      }
      lastReason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 600) : "Unknown JSON validation error";
    }
  }
  throw new ResearchPlanningModelError(fallback, lastReason, false);
}

/** Server-only reasoning adapter (Ollama or Bedrock). No database or provider tools. */
export function createBedrockResearchPlanningModel(
  config: LlmPlannerConfig,
  modelOverride?: InvokableBedrockModel,
): ResearchPlanningModel {
  const model: InvokableBedrockModel =
    modelOverride ?? createPlannerChatModel(config, { maxTokens: 1_200 });

  return {
    async interpret(messages) {
      if (shouldAskOfferClarificationLocally(messages)) {
        const fallback = fallbackOfferInterpretation(messages);
        if (fallback) return fallback;
      }
      try {
        return await invokeValidatedJson(
          model,
          interpretationPrompt(messages),
          (value) => interpretationSchema.parse(normalizeInterpretationShape(value)),
          "Ano could not understand that message as a structured research brief. Nothing else was attempted.",
        );
      } catch (error) {
        if (error instanceof ResearchPlanningModelError && error.fatal) {
          throw error;
        }
        if (isFatalBedrockError(error)) {
          throw modelError(error, "Ano could not understand that message as a structured research brief. Nothing else was attempted.");
        }
        const fallback = fallbackOfferInterpretation(messages);
        if (fallback) return fallback;
        if (error instanceof ResearchPlanningModelError) throw error;
        throw modelError(error, "Ano could not understand that message as a structured research brief. Nothing else was attempted.");
      }
    },
    async createPlan(brief, editInstruction) {
      try {
        return await invokeValidatedJson(
          model,
          planPrompt(brief, editInstruction),
          (value) => researchPlanDraftSchema.parse(normalizePlanShape(value, brief)),
          "Ano could not create the structured research plan. No research or provider action was attempted.",
        );
      } catch (error) {
        if (error instanceof ResearchPlanningModelError && error.fatal) {
          throw error;
        }
        if (isFatalBedrockError(error)) {
          throw modelError(error, "Ano could not create the structured research plan. No research or provider action was attempted.");
        }
        return fallbackResearchPlan(brief, editInstruction);
      }
    },
  };
}

const BUSINESS_LOCATION_REGEX =
  /(?:we(?:'re|\s+are)?\s+(?:based|located)\s+in|i(?:'m|\s+am)?\s+(?:based|located)\s+in|our\s+(?:company|business|office|practice|clinic|hq)\s+is\s+(?:in|based\s+in|located\s+in)|based\s+in|located\s+in|headquartered\s+in)\s+([A-Za-z][A-Za-z\s,'-]{1,60}?)(?=[.;\n]|(?:\s+(?:and|but|selling|sell|target(?:ing)?|looking|want(?:ing)?\s+to\s+sell|to\s+sell)\b)|$)/i;

const TARGET_MARKETS_REGEX =
  /(?:sell(?:ing)?\s+(?:in|to|into)|expand(?:ing)?\s+(?:in|to|into)|target(?:ing)?\s+(?:markets?\s+(?:in|are)?|companies\s+in|businesses\s+in)?|launch(?:ing)?\s+in|go[\s-]*to[\s-]*market\s+in|want(?:ing)?\s+to\s+sell\s+(?:in|to|into)|interested\s+in\s+selling\s+(?:in|to|into))\s+([A-Za-z][A-Za-z\s,&/-]{1,80}?)(?=[.?!;\n]|$)/i;

const WANTS_MARKET_RECOMMENDATION_REGEX =
  /\b(recommend(?:\s+the)?(?:\s+best)?\s+(?:market|markets|country|countries|region)|you\s+(?:choose|pick|recommend)|where\s+should\s+(?:we|i)\s+(?:sell|target)|which\s+(?:country|countries|market|markets)|open\s+to\s+any|best\s+market(?:\s+for\s+(?:me|us))?|anywhere)\b/i;

function splitMarketList(raw: string): string[] {
  return raw
    .split(/,|&|\band\b|\//i)
    .map((item) => item.replace(/^\s*(?:in|to|into)\s+/i, "").trim())
    .filter((item) => item.length >= 2 && item.length <= 60)
    .slice(0, 5);
}

export function extractIntakeHintsFromText(text: string): {
  businessLocation: string | null;
  targetMarkets: string[];
  wantsRecommendation: boolean;
} {
  const clean = text.replace(/\r\n/g, "\n").trim();
  let businessLocation: string | null = null;
  const targetMarkets: string[] = [];

  const numbered1 = clean.match(/(?:^|\n)\s*1[.):]\s*([^\n]+)/);
  const numbered2 = clean.match(/(?:^|\n)\s*2[.):]\s*([^\n]+)/);
  if (numbered1 && numbered2) {
    const locCand = numbered1[1].replace(/^(?:located|based)\s+in\s+/i, "").trim();
    if (locCand.length >= 2 && locCand.length <= 80) {
      businessLocation = locCand;
    }
    const marketLine = numbered2[1].trim();
    if (WANTS_MARKET_RECOMMENDATION_REGEX.test(marketLine)) {
      targetMarkets.push("Recommend best market");
    } else {
      targetMarkets.push(...splitMarketList(marketLine));
    }
  }

  const locMatch = clean.match(BUSINESS_LOCATION_REGEX);
  if (!businessLocation && locMatch?.[1]?.trim()) {
    businessLocation = locMatch[1].replace(/[,;\s]+$/, "").trim();
  }

  const targetMatch = clean.match(TARGET_MARKETS_REGEX);
  if (targetMatch?.[1]?.trim() && !WANTS_MARKET_RECOMMENDATION_REGEX.test(targetMatch[1])) {
    for (const m of splitMarketList(targetMatch[1])) {
      if (!targetMarkets.some((prev) => prev.toLowerCase() === m.toLowerCase())) {
        targetMarkets.push(m);
      }
    }
  }

  const wantsRecommendation = WANTS_MARKET_RECOMMENDATION_REGEX.test(clean);
  return { businessLocation, targetMarkets, wantsRecommendation };
}

function looksLikeBarePlaceAnswer(raw: string): boolean {
  const trimmed = raw.replace(/[.?]+$/, "").trim();
  if (!trimmed || trimmed.length < 2 || trimmed.length > 80) return false;
  if (/\b(?:what|how|why|which|sell|software|platform|app|pdf|doc)\b/i.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= 7;
}

export function evaluateTwoQuestionIntake(input: {
  offer: string;
  brief: Omit<ResearchBrief, "sourceMessageIds">;
  userMessages: string[];
  productSummary?: string | null;
}): {
  intakeComplete: boolean;
  businessLocation: string | null;
  targetMarkets: string[];
  clarification: { question: string; purpose: string } | null;
} {
  let businessLocation = input.brief.businessLocation?.trim() || null;
  const targetMarkets = [...(input.brief.targetMarkets ?? [])];
  let wantsRecommendation = false;

  for (let i = 0; i < input.userMessages.length; i += 1) {
    const msg = input.userMessages[i] ?? "";
    const parsed = extractIntakeHintsFromText(msg);

    const hadLocationBefore = Boolean(businessLocation);
    const hadMarketsBefore = targetMarkets.length > 0 || wantsRecommendation;

    if (!businessLocation && parsed.businessLocation) {
      businessLocation = parsed.businessLocation;
    }
    for (const market of parsed.targetMarkets) {
      if (!targetMarkets.some((prev) => prev.toLowerCase() === market.toLowerCase())) {
        targetMarkets.push(market);
      }
    }
    if (parsed.wantsRecommendation) {
      wantsRecommendation = true;
    }

    if (i > 0) {
      if (!hadLocationBefore && hadMarketsBefore && !businessLocation && looksLikeBarePlaceAnswer(msg)) {
        businessLocation = msg.replace(/^(?:in|from)\s+/i, "").replace(/[.?!]+$/, "").trim();
      } else if (
        hadLocationBefore &&
        !hadMarketsBefore &&
        targetMarkets.length === 0 &&
        !wantsRecommendation &&
        looksLikeBarePlaceAnswer(msg)
      ) {
        targetMarkets.push(...splitMarketList(msg));
      }
    }
  }

  if (wantsRecommendation && targetMarkets.length === 0) {
    targetMarkets.push("Recommend best market");
  }

  const hasLocation = Boolean(businessLocation);
  const hasTargets = targetMarkets.length > 0 || wantsRecommendation;

  if (hasLocation && hasTargets) {
    return {
      intakeComplete: true,
      businessLocation,
      targetMarkets,
      clarification: null,
    };
  }

  const shortOffer = (input.productSummary || input.offer || "your product")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  let question: string;
  let purpose: string;
  if (!hasLocation && !hasTargets) {
    question = `Got it — I understand your offer (${shortOffer}). Before I run market research and gather decision-maker emails: 1. Where is your business located? 2. Where do you want to sell (or should I recommend the best market)?`;
    purpose =
      "These two answers let Ano automatically run market research, pick the right companies, find decision-maker emails, and draft your outreach templates.";
  } else if (!hasLocation) {
    question = `Got it on where you want to sell (${targetMarkets.join(", ")}). One quick detail before I start: where is your business located?`;
    purpose =
      "Your operating base helps Ano tailor compliance, timezone, and positioning in research and outreach.";
  } else {
    question = `Got it — based in ${businessLocation} (${shortOffer}). Where do you want to sell (specific countries/regions, or tell me to recommend the best market)?`;
    purpose =
      "Once I know your target market (or that you want me to choose), Ano runs the full pipeline automatically.";
  }

  return {
    intakeComplete: false,
    businessLocation,
    targetMarkets,
    clarification: { question, purpose },
  };
}

function intakeInterpretationPrompt(
  messages: ResearchPlanningMessage[],
  productContextText?: string | null,
) {
  return [
    "You are Ano, an autonomous sales-research copilot. Interpret the product information and user messages below.",
    "Do not invent company lists, emails, or external research facts.",
    "Extract: brief.offer (clear 1-2 sentence summary of what the user sells), brief.goal (sales objective), brief.businessLocation (where the user's business is located, or null if unknown), brief.targetMarkets (where the user wants to sell, or ['Recommend best market'] if they ask Ano to choose, else []).",
    "Return JSON only matching: {outcome:'ready'|'needs_context',brief:{offer:string,goal:string,businessLocation:string|null,targetMarkets:string[],marketHints:string[],locationHints:string[],buyerHints:string[],constraints:string[],unknowns:string[]},clarification?:{question:string,purpose:string}}.",
    productContextText ? `PRODUCT DOCUMENTS & WEBSITE EXCERPTS:\n${productContextText}` : "",
    JSON.stringify({ messages }),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Streamlined 2-question Phase A planning adapter for multi-format product ingestion:
 * understands product link/PDF/DOCX/TXT + chat text and asks only for business location
 * and where the user wants to sell before automatically unlocking execution.
 */
export function createAutopilotIntakePlanningModel(
  config: LlmPlannerConfig,
  options: {
    productContextText?: string | null;
    productSummary?: string | null;
    modelOverride?: InvokableBedrockModel;
  } = {},
): ResearchPlanningModel {
  const baseModel = createBedrockResearchPlanningModel(config, options.modelOverride);
  const llmModel: InvokableBedrockModel =
    options.modelOverride ?? createPlannerChatModel(config, { maxTokens: 1_200 });

  return {
    async interpret(messages) {
      const userTexts = normalizedUserMessages(messages);
      const fallbackOffer =
        userTexts[0] ||
        options.productSummary?.slice(0, 300) ||
        "Product from uploaded source";

      let rawBrief: Omit<ResearchBrief, "sourceMessageIds"> = {
        offer: fallbackOffer,
        goal: "Identify the highest-potential outbound markets, companies, decision-maker emails, and outreach templates.",
        businessLocation: null,
        targetMarkets: [],
        intakeComplete: false,
        marketHints: [],
        locationHints: [],
        buyerHints: [],
        constraints: [],
        unknowns: [],
      };

      try {
        const parsed = await invokeValidatedJson(
          llmModel,
          intakeInterpretationPrompt(messages, options.productContextText),
          (value) => interpretationSchema.parse(normalizeInterpretationShape(value)),
          "Ano could not interpret your product brief.",
        );
        rawBrief = parsed.brief;
      } catch (error) {
        if (error instanceof ResearchPlanningModelError && error.fatal) {
          throw error;
        }
        if (isFatalBedrockError(error)) {
          throw modelError(error, "Ano could not interpret your product brief.");
        }
      }

      const intake = evaluateTwoQuestionIntake({
        offer: rawBrief.offer || fallbackOffer,
        brief: rawBrief,
        userMessages: userTexts,
        productSummary: options.productSummary,
      });

      const mergedBrief: Omit<ResearchBrief, "sourceMessageIds"> = {
        ...rawBrief,
        offer: (rawBrief.offer || fallbackOffer).slice(0, 1_000),
        goal: (
          rawBrief.goal ||
          "Find target companies, verified decision-maker emails, and ready-to-send outreach templates."
        ).slice(0, 1_000),
        businessLocation: intake.businessLocation,
        targetMarkets: intake.targetMarkets,
        intakeComplete: intake.intakeComplete,
        locationHints: Array.from(
          new Set([
            ...rawBrief.locationHints,
            ...intake.targetMarkets.filter((m) => !/recommend/i.test(m)),
          ]),
        ).slice(0, 6),
      };

      return interpretationSchema.parse({
        outcome: intake.intakeComplete ? "ready" : "needs_context",
        brief: mergedBrief,
        ...(intake.clarification ? { clarification: intake.clarification } : {}),
      });
    },
    async createPlan(brief, editInstruction) {
      return await baseModel.createPlan(brief, editInstruction);
    },
  };
}

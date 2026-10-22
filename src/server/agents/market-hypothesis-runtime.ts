import type { Message, SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";

import type { BriefEvidence, LocationDecision, MarketBriefResult, MarketHypothesis, ProductBriefInput } from "@/lib/ano/market-discovery";
import type { BedrockConverse, BedrockPlannerConfig } from "@/server/agents/bedrock-contracts";
import { BedrockAdapterError } from "@/server/agents/bedrock-contracts";
import { createCheckpoint } from "@/server/agents/resume";
import { AgentRuntimeError } from "@/server/agents/runtime";

const hypothesisSchema = z.object({
  title: z.string().trim().min(3).max(120),
  statement: z.string().trim().min(8).max(420),
  evidenceIds: z.array(z.string().trim().regex(/^B-\d{3}$/)).min(1).max(4),
});

const modelAnswerSchema = z.object({
  marketMap: z.string().trim().min(8).max(620),
  hypotheses: z.array(hypothesisSchema).min(2).max(4),
  assumptions: z.array(z.string().trim().min(4).max(260)).max(4),
  questions: z.array(z.string().trim().min(4).max(260)).max(4),
});

function checkpoint() {
  return createCheckpoint("failed", 1, 0);
}

function runtimeFailure(message: string, code: ConstructorParameters<typeof AgentRuntimeError>[1]): never {
  throw new AgentRuntimeError(message, code, checkpoint());
}

function textFrom(message: Message) {
  return (message.content ?? []).flatMap((block) => block.text ? [block.text] : []).join("\n").trim();
}

function jsonCandidate(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  return first >= 0 && last > first ? value.slice(first, last + 1) : value;
}

function isUncertain(value: string) {
  return /^(?:not sure|unknown|unsure|tbd|n\/?a)$/i.test(value.trim());
}

export function evidenceFromProductBrief(input: ProductBriefInput): BriefEvidence[] {
  const evidence: BriefEvidence[] = [
    { id: "B-001", label: "Offer", observation: input.offer, source: "workspace_input" },
    { id: "B-002", label: "Sales objective", observation: input.objective, source: "workspace_input" },
  ];
  const optional: Array<[keyof ProductBriefInput, string]> = [
    ["marketHunch", "Market or industry hunch"],
    ["locationPreference", "Location preference"],
    ["buyerHunch", "Buyer hunch"],
    ["customerExamples", "Customer examples"],
    ["exclusions", "Exclusions"],
    ["additionalContext", "Additional context"],
  ];
  optional.forEach(([field, label]) => {
    const observation = input[field];
    if (observation && !isUncertain(observation)) {
      evidence.push({ id: `B-${String(evidence.length + 1).padStart(3, "0")}`, label, observation, source: "workspace_input" });
    }
  });
  return evidence;
}

export function locationDecisionFromProductBrief(input: ProductBriefInput): LocationDecision {
  if (input.locationPreference && !isUncertain(input.locationPreference)) {
    return {
      id: crypto.randomUUID(),
      type: "confirm_preference",
      prompt: `You mentioned ${input.locationPreference}. Should Ano use this as the initial market scope?`,
      status: "awaiting_choice",
      options: [
        { key: "lock_location", label: "Use this location", description: "Keep this preference as the starting scope for future provider research." },
        { key: "compare_markets", label: "Compare markets first", description: "Ask Ano to compare candidate locations before any company discovery." },
        { key: "set_preference", label: "Change location", description: "Return to the brief and enter a different location preference." },
      ],
    };
  }
  return {
    id: crypto.randomUUID(),
    type: "choose_research_path",
    prompt: "Do you have a preferred location, or should Ano compare candidate markets first?",
    status: "awaiting_choice",
    options: [
      { key: "set_preference", label: "Set a location", description: "Add a country, region, or city you want to prioritise." },
      { key: "compare_markets", label: "Compare markets", description: "Use external research later to compare candidate locations before company discovery." },
      { key: "continue_without_location", label: "No preference yet", description: "Keep location open until there is enough research evidence to decide." },
    ],
  };
}

function systemPrompt(): SystemContentBlock[] {
  return [{
    text: [
      "You are Ano, a standalone sales copilot helping a user decide where to sell a product.",
      "The only evidence is the user's own product brief. You have no web, provider, company, contact, connector, or CRM access in this request.",
      "Generate hypotheses, not market facts. Do not say a country, industry, company, buyer, or problem is verified or best. Do not name companies or people.",
      "Use the phrase hypothesis-style language: may, could, worth testing, or should be validated. Keep it useful and specific to the stated offer and objective.",
      "If an input says Not sure, unknown, or similar, treat it as missing rather than evidence.",
      "Every hypothesis must cite one or more supplied B-### evidence IDs. Do not cite any other identifier. Assumptions and questions must be clearly framed as unverified.",
      "Do not create an ICP score, market ranking, company list, outreach, provider call, connector action, browser action, or any sales action.",
      "Return only JSON with exactly: {marketMap, hypotheses:[{title,statement,evidenceIds}], assumptions, questions}.",
      "Return 2-4 hypotheses, at most 4 assumptions and 4 questions. Do not include URLs or markdown.",
    ].join("\n"),
  }];
}

function userPrompt(input: ProductBriefInput, evidence: BriefEvidence[]) {
  return [
    "Turn this minimal product brief into a preliminary, unverified market hypothesis map. The location decision is handled by Ano, not by you.",
    JSON.stringify({ input, evidence }),
  ].join("\n\n");
}

function hasExternalReference(value: string) {
  return /\b(?:https?:\/\/|www\.)/i.test(value);
}

export async function runMarketHypothesis(
  input: ProductBriefInput,
  _config: BedrockPlannerConfig,
  converse: BedrockConverse,
): Promise<MarketBriefResult> {
  const evidence = evidenceFromProductBrief(input);
  const allowedEvidenceIds = new Set(evidence.map((item) => item.id));
  const messages: Message[] = [{ role: "user", content: [{ text: userPrompt(input, evidence) }] }];

  let response;
  try {
    response = await converse({ messages, system: systemPrompt(), timeoutMs: 24_000, maxTokens: 1_100 });
  } catch (error) {
    if (error instanceof BedrockAdapterError) {
      const codes = {
        TIMEOUT: "MODEL_TIMEOUT",
        CREDENTIALS_UNAVAILABLE: "BEDROCK_CREDENTIALS_UNAVAILABLE",
        ACCESS_DENIED: "BEDROCK_ACCESS_DENIED",
        INVALID_CONFIGURATION: "BEDROCK_INVALID_CONFIGURATION",
        UNAVAILABLE: "BEDROCK_UNAVAILABLE",
      } as const;
      runtimeFailure(error.message, codes[error.code]);
    }
    runtimeFailure("Ano could not reach Bedrock. No provider, connector, or sales action was attempted.", "BEDROCK_UNAVAILABLE");
  }

  if (response.stopReason === "guardrail_intervened" || response.stopReason === "content_filtered") {
    runtimeFailure("Ano stopped because the configured Bedrock guardrail intervened. Refine the product brief and try again.", "MODEL_GUARDRAIL");
  }
  if (response.stopReason === "max_tokens") runtimeFailure("Ano reached its bounded Bedrock output limit before it completed the market hypotheses. Try again; no external action was taken.", "MODEL_OUTPUT_LIMIT");
  if (response.stopReason === "model_context_window_exceeded") runtimeFailure("Ano’s product brief was too long for Bedrock to complete the market hypotheses. Shorten the optional context and try again.", "MODEL_CONTEXT_WINDOW");
  if (response.stopReason !== "end_turn" && response.stopReason !== "stop_sequence") {
    runtimeFailure(`Ano stopped before completing the market hypotheses (Bedrock: ${response.stopReason ?? "unknown"}). No external action was taken.`, "MODEL_MALFORMED");
  }

  const assistant = response.output?.message;
  if (!assistant || assistant.role !== "assistant") runtimeFailure("Ano stopped because Bedrock returned no usable market hypotheses.", "MODEL_MALFORMED");
  let raw: unknown;
  try {
    raw = JSON.parse(jsonCandidate(textFrom(assistant)));
  } catch {
    runtimeFailure("Ano stopped because Bedrock did not return valid JSON for the market hypotheses.", "MODEL_MALFORMED");
  }
  const parsed = modelAnswerSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "root"))].slice(0, 4).join(", ");
    runtimeFailure(`Ano received an incomplete market-hypothesis structure (${fields}). Nothing was saved; try again.`, "MODEL_MALFORMED");
  }

  const answer = parsed.data;
  const allText = [answer.marketMap, ...answer.hypotheses.flatMap((item) => [item.title, item.statement]), ...answer.assumptions, ...answer.questions];
  if (answer.hypotheses.some((item) => item.evidenceIds.some((id) => !allowedEvidenceIds.has(id))) || allText.some(hasExternalReference)) {
    runtimeFailure("Ano stopped because its market hypotheses referenced information outside the product brief.", "MODEL_MALFORMED");
  }

  const runId = crypto.randomUUID();
  const hypotheses: MarketHypothesis[] = answer.hypotheses.map((item, index) => ({ ...item, id: `hypothesis-${index + 1}` }));
  const locationDecision = locationDecisionFromProductBrief(input);
  return {
    run: { id: runId, status: "awaiting_scope_decision", mode: "bedrock", message: "Ano prepared unverified market hypotheses. Choose the location path before any future research is considered.", modelTurns: 1 },
    productBrief: { id: `brief-${runId}`, offer: input.offer, objective: input.objective },
    evidence,
    hypothesis: { marketMap: answer.marketMap, hypotheses, assumptions: answer.assumptions, questions: answer.questions },
    locationDecision,
  };
}

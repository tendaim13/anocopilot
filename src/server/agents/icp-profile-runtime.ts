import type { Message, SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";

import type { IcpPlanItem, IcpProfileInput, IcpProfileResult } from "@/lib/ano/icp";
import type { BedrockConverse, BedrockPlannerConfig } from "@/server/agents/bedrock-contracts";
import { BedrockAdapterError } from "@/server/agents/bedrock-contracts";
import { AgentRuntimeError } from "@/server/agents/runtime";
import { createCheckpoint } from "@/server/agents/resume";

function normaliseLabel(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z]+/g, " ").trim() : value;
}

function normalisePlanAction(value: unknown) {
  const label = normaliseLabel(value);
  if (typeof label !== "string") return value;
  if (label.includes("segment")) return "Define segment";
  if (label.includes("market") || label.includes("validat")) return "Validate market";
  if (label.includes("research") || label.includes("prepare")) return "Prepare research";
  if (label.includes("profile") || label.includes("icp") || label.includes("refine")) return "Refine profile";
  return value;
}

function normalisePriority(value: unknown) {
  const label = normaliseLabel(value);
  if (typeof label !== "string") return value;
  if (["now", "immediate", "high", "urgent"].includes(label)) return "Now";
  if (["today", "medium"].includes(label)) return "Today";
  if (["this week", "week", "low"].includes(label)) return "This week";
  return value;
}

const planItemSchema = z.object({
  title: z.string().trim().min(3).max(160),
  action: z.preprocess(normalisePlanAction, z.enum(["Refine profile", "Validate market", "Define segment", "Prepare research"])),
  priority: z.preprocess(normalisePriority, z.enum(["Now", "Today", "This week"])),
  reason: z.string().trim().min(8).max(320),
  evidenceIds: z.array(z.string().trim().regex(/^M-\d{3}$/)).min(1).max(4),
});

const modelIcpSchema = z.object({
  positioning: z.string().trim().min(12).max(700),
  idealCustomerSummary: z.string().trim().min(12).max(700),
  knownFacts: z.array(z.object({
    text: z.string().trim().min(3).max(240),
    evidenceIds: z.array(z.string().trim().regex(/^M-\d{3}$/)).min(1).max(3),
  })).min(1).max(4),
  questions: z.array(z.string().trim().min(4).max(220)).max(3),
  assumptions: z.array(z.string().trim().min(4).max(220)).max(3),
  evidenceIds: z.array(z.string().trim().regex(/^M-\d{3}$/)).min(1).max(6),
  plan: z.array(planItemSchema).min(1).max(3),
});

function checkpoint(phase: "failed" | "completed") {
  return createCheckpoint(phase, 1, 0);
}

function textFrom(message: Message) {
  return (message.content ?? []).flatMap((block) => block.text ? [block.text] : []).join("\n").trim();
}

function manualEvidence(input: IcpProfileInput) {
  const evidence = [
    { id: "M-001", label: "Offer", observation: `${input.productName}: ${input.productDescription}` },
    { id: "M-002", label: "Value proposition", observation: input.valueProposition },
    { id: "M-003", label: "Target market", observation: `${input.targetMarket} in ${input.targetLocations}.` },
    { id: "M-004", label: "Ideal customer and buyers", observation: `${input.idealCustomerProfile} Buyer roles: ${input.buyerRoles}.` },
    { id: "M-005", label: "Sales objective", observation: input.salesObjective },
  ];

  if (input.exclusions) evidence.push({ id: "M-006", label: "Exclusions", observation: input.exclusions });
  if (input.contextNotes) evidence.push({ id: "M-007", label: "Additional workspace context", observation: input.contextNotes });
  return evidence;
}

function isUncertain(value: string) {
  return /\b(?:not sure|unknown|unsure|tbd|n\/a)\b/i.test(value);
}

function readiness(input: IcpProfileInput): IcpProfileResult["readiness"] {
  const offerScore = input.productDescription.length >= 160 ? 30 : 22;
  const marketScore = isUncertain(input.targetMarket) || isUncertain(input.targetLocations)
    ? 0
    : input.targetMarket.length >= 30 && input.targetLocations.length >= 8 ? 25 : 17;
  const buyerScore = isUncertain(input.idealCustomerProfile) || isUncertain(input.buyerRoles)
    ? 0
    : input.idealCustomerProfile.length >= 80 && input.buyerRoles.length >= 12 ? 20 : 12;
  const objectiveScore = 15;
  const boundariesScore = input.exclusions || input.contextNotes ? 10 : 0;
  const score = offerScore + marketScore + buyerScore + objectiveScore + boundariesScore;

  return {
    score,
    label: buyerScore < 20 ? "Needs buyer context" : marketScore < 25 ? "Needs market detail" : "Ready to plan research",
    components: [
      { label: "Offer", score: offerScore, maximum: 30, explanation: "Ano has a product and the value it is intended to create.", tone: offerScore === 30 ? "emerald" : "amber" },
      { label: "Target market", score: marketScore, maximum: 25, explanation: "Market and location define where future research should be focused.", tone: marketScore === 25 ? "emerald" : "amber" },
      { label: "Buyer context", score: buyerScore, maximum: 20, explanation: "Ideal customer and buyer roles guide future account selection.", tone: buyerScore === 20 ? "emerald" : "amber" },
      { label: "Objective", score: objectiveScore, maximum: 15, explanation: "Ano has a stated outcome to plan toward.", tone: "emerald" },
      { label: "Boundaries", score: boundariesScore, maximum: 10, explanation: boundariesScore ? "Exclusions or additional context were supplied." : "Add exclusions or context when they are known.", tone: boundariesScore ? "emerald" : "slate" },
    ],
  };
}

function systemPrompt(): SystemContentBlock[] {
  return [{
    text: [
      "You are Ano, a standalone sales copilot operating only on information a workspace member entered.",
      "Create an ICP and a research plan for the workspace's own offer. Do not create, name, infer, or research prospect accounts or contacts. Do not draft outreach.",
      "Do not browse, search, call tools, use connectors, claim public research, invent facts, or recommend any automatic action.",
      "Treat every supplied record as unverified workspace context. Separate known facts from assumptions and ask concise questions when details are missing.",
      "When a supplied field explicitly says it is unknown, such as 'Not sure', treat it as missing context rather than a fact and add a clarification question.",
      "Every known fact and proposed plan item must cite M-### evidence IDs supplied in the user input.",
      "Keep the response concise: at most 4 known facts, 3 questions, 3 assumptions, and 3 plan items. Keep positioning and the ideal-customer summary to two short sentences each.",
      "For each plan item, action must be exactly one of: Refine profile, Validate market, Define segment, Prepare research. Priority must be exactly one of: Now, Today, This week.",
      "Return only JSON with this exact shape: {positioning, idealCustomerSummary, knownFacts:[{text,evidenceIds}], questions, assumptions, evidenceIds, plan:[{title,action,priority,reason,evidenceIds}]}",
      "Do not include URLs, external citations, named companies, named contacts, email copy, or information absent from the supplied evidence.",
    ].join("\n"),
  }];
}

function userPrompt(input: IcpProfileInput, evidence: ReturnType<typeof manualEvidence>) {
  return [
    "Build an ICP and a future research plan from these workspace records. Do not use information beyond them.",
    JSON.stringify({
      offer: { productName: input.productName, productDescription: input.productDescription, valueProposition: input.valueProposition },
      market: { targetMarket: input.targetMarket, targetLocations: input.targetLocations, idealCustomerProfile: input.idealCustomerProfile, buyerRoles: input.buyerRoles },
      objective: input.salesObjective,
      exclusions: input.exclusions || null,
      additionalContext: input.contextNotes || null,
      evidence,
    }),
  ].join("\n\n");
}

function hasUnknownEvidence(ids: string[], allowed: Set<string>) {
  return ids.some((id) => !allowed.has(id));
}

function containsExternalReference(value: string) {
  return /\b(?:https?:\/\/|www\.)/i.test(value);
}

function modelFailure(message: string, code: ConstructorParameters<typeof AgentRuntimeError>[1]): never {
  throw new AgentRuntimeError(message, code, checkpoint("failed"));
}

export async function runIcpProfile(
  input: IcpProfileInput,
  _config: BedrockPlannerConfig,
  converse: BedrockConverse,
): Promise<IcpProfileResult> {
  const evidence = manualEvidence(input);
  const knownEvidenceIds = new Set(evidence.map((item) => item.id));
  const messages: Message[] = [{ role: "user", content: [{ text: userPrompt(input, evidence) }] }];

  let response;
  try {
    response = await converse({ messages, system: systemPrompt(), timeoutMs: 24_000, maxTokens: 1_200 });
  } catch (error) {
    if (error instanceof BedrockAdapterError) {
      const codes = {
        TIMEOUT: "MODEL_TIMEOUT",
        CREDENTIALS_UNAVAILABLE: "BEDROCK_CREDENTIALS_UNAVAILABLE",
        ACCESS_DENIED: "BEDROCK_ACCESS_DENIED",
        INVALID_CONFIGURATION: "BEDROCK_INVALID_CONFIGURATION",
        UNAVAILABLE: "BEDROCK_UNAVAILABLE",
      } as const;
      modelFailure(error.message, codes[error.code]);
    }
    modelFailure("Ano could not reach Bedrock. No connector or external action was attempted.", "BEDROCK_UNAVAILABLE");
  }

  if (response.stopReason === "guardrail_intervened" || response.stopReason === "content_filtered") {
    modelFailure("Ano stopped because the configured Bedrock guardrail intervened. Refine the workspace context and try again.", "MODEL_GUARDRAIL");
  }
  if (response.stopReason === "max_tokens") {
    modelFailure("Ano reached its bounded Bedrock output limit before the ICP was complete. Please try again; no prospect or external action was created.", "MODEL_OUTPUT_LIMIT");
  }
  if (response.stopReason === "model_context_window_exceeded") {
    modelFailure("Ano’s workspace context was too long for Bedrock to complete the ICP. Shorten the additional context and try again.", "MODEL_CONTEXT_WINDOW");
  }
  if (response.stopReason !== "end_turn" && response.stopReason !== "stop_sequence") {
    modelFailure(`Ano stopped before completing the ICP (Bedrock: ${response.stopReason ?? "unknown"}). No connector or external action was attempted.`, "MODEL_MALFORMED");
  }

  const assistant = response.output?.message;
  if (!assistant || assistant.role !== "assistant") modelFailure("Ano stopped because Bedrock returned no usable ICP.", "MODEL_MALFORMED");
  const candidate = textFrom(assistant).replace(/^```json\s*/i, "").replace(/\s*```$/i, "");

  let rawModelAnswer: unknown;
  try {
    rawModelAnswer = JSON.parse(candidate);
  } catch {
    modelFailure("Ano stopped because Bedrock did not return valid JSON for the ICP.", "MODEL_MALFORMED");
  }
  const parsed = modelIcpSchema.safeParse(rawModelAnswer);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "root"))].slice(0, 4).join(", ");
    modelFailure(`Ano received an incomplete ICP structure (${fields}). No market profile was saved; please try again.`, "MODEL_MALFORMED");
  }

  const answer = parsed.data;
  const citedIds = [...answer.evidenceIds, ...answer.knownFacts.flatMap((fact) => fact.evidenceIds), ...answer.plan.flatMap((item) => item.evidenceIds)];
  const generatedText = [
    answer.positioning,
    answer.idealCustomerSummary,
    ...answer.knownFacts.map((fact) => fact.text),
    ...answer.questions,
    ...answer.assumptions,
    ...answer.plan.flatMap((item) => [item.title, item.reason]),
  ];
  if (hasUnknownEvidence(citedIds, knownEvidenceIds) || generatedText.some(containsExternalReference)) {
    modelFailure("Ano stopped because the generated ICP referenced information outside the workspace records.", "MODEL_MALFORMED");
  }

  const runId = crypto.randomUUID();
  const plan: IcpPlanItem[] = answer.plan.map((item, index) => ({ ...item, id: `icp-plan-${index + 1}` }));
  const knownFacts = answer.knownFacts.map((fact) => `${fact.text} [${fact.evidenceIds.join(", ")}]`);

  return {
    run: { id: runId, status: "completed", mode: "bedrock", message: `Ano prepared an ICP and research plan for ${input.productName}.`, modelTurns: 1 },
    profile: {
      id: `icp-${runId}`,
      productName: input.productName,
      targetMarket: input.targetMarket,
      targetLocations: input.targetLocations,
      idealCustomerProfile: input.idealCustomerProfile,
      buyerRoles: input.buyerRoles,
      salesObjective: input.salesObjective,
    },
    evidence,
    readiness: readiness(input),
    brief: {
      positioning: answer.positioning,
      idealCustomerSummary: answer.idealCustomerSummary,
      knownFacts,
      questions: answer.questions,
      assumptions: answer.assumptions,
      evidenceIds: answer.evidenceIds,
    },
    plan,
  };
}

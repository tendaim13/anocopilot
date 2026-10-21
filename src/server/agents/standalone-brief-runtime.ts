import type { Message, SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";

import type { StandaloneBriefInput, StandaloneBriefPlanItem, StandaloneBriefResult } from "@/lib/ano/standalone";
import type { BedrockConverse, BedrockPlannerConfig } from "@/server/agents/bedrock-contracts";
import { BedrockAdapterError } from "@/server/agents/bedrock-contracts";
import { AgentRuntimeError } from "@/server/agents/runtime";
import { createCheckpoint } from "@/server/agents/resume";

const planItemSchema = z.object({
  title: z.string().trim().min(3).max(160),
  action: z.enum(["Review context", "Draft outreach", "Prepare call", "Confirm next step"]),
  priority: z.enum(["Now", "Today", "This week"]),
  reason: z.string().trim().min(8).max(320),
  evidenceIds: z.array(z.string().trim().regex(/^M-\d{3}$/)).min(1).max(4),
}).strict();

const modelBriefSchema = z.object({
  summary: z.string().trim().min(12).max(700),
  rationale: z.string().trim().min(12).max(700),
  knownFacts: z.array(z.object({
    text: z.string().trim().min(3).max(240),
    evidenceIds: z.array(z.string().trim().regex(/^M-\d{3}$/)).min(1).max(3),
  }).strict()).min(1).max(6),
  questions: z.array(z.string().trim().min(4).max(220)).max(5),
  assumptions: z.array(z.string().trim().min(4).max(220)).max(4),
  evidenceIds: z.array(z.string().trim().regex(/^M-\d{3}$/)).min(1).max(4),
  outreach: z.object({
    subject: z.string().trim().min(3).max(140),
    body: z.string().trim().min(24).max(2_400),
  }).strict(),
  plan: z.array(planItemSchema).min(1).max(4),
}).strict();

function checkpoint(phase: "failed" | "completed") {
  return createCheckpoint(phase, 1, 0);
}

function textFrom(message: Message) {
  return (message.content ?? [])
    .flatMap((block) => block.text ? [block.text] : [])
    .join("\n")
    .trim();
}

function manualEvidence(input: StandaloneBriefInput) {
  const evidence = [
    {
      id: "M-001",
      label: "Workspace account record",
      observation: `${input.companyName} is recorded as a ${input.companyIndustry} business in ${input.companyLocation}.`,
    },
    {
      id: "M-002",
      label: "User-supplied account context",
      observation: input.accountContext,
    },
    {
      id: "M-003",
      label: "Sales objective",
      observation: input.salesObjective,
    },
  ];

  if (input.contactName || input.contactRole) {
    evidence.splice(1, 0, {
      id: "M-004",
      label: "Workspace contact record",
      observation: [input.contactName || "Unnamed contact", input.contactRole || "Role not yet recorded"].join(" — "),
    });
  }

  return evidence;
}

function readiness(input: StandaloneBriefInput): StandaloneBriefResult["readiness"] {
  const accountScore = 20;
  const contextScore = input.accountContext.length >= 180 ? 45 : input.accountContext.length >= 80 ? 32 : 22;
  const contactScore = input.contactName && input.contactRole ? 20 : input.contactName || input.contactRole ? 10 : 0;
  const objectiveScore = 15;
  const score = accountScore + contextScore + contactScore + objectiveScore;

  return {
    score,
    label: score >= 75 ? "Ready" : contactScore === 0 ? "Needs a contact" : "Needs context",
    components: [
      { label: "Account record", score: accountScore, maximum: 20, explanation: "A named account, industry, and location were supplied by the workspace.", tone: "emerald" },
      { label: "Account context", score: contextScore, maximum: 45, explanation: "Readiness reflects how much decision-relevant context was entered, not buying intent.", tone: contextScore >= 32 ? "emerald" : "amber" },
      { label: "Contact context", score: contactScore, maximum: 20, explanation: contactScore === 20 ? "A contact name and role were supplied." : "Add a contact name and role when they are known.", tone: contactScore === 20 ? "emerald" : "amber" },
      { label: "Sales objective", score: objectiveScore, maximum: 15, explanation: "Ano has a specific outcome to plan toward.", tone: "emerald" },
    ],
  };
}

function systemPrompt(): SystemContentBlock[] {
  return [{
    text: [
      "You are Ano, a standalone sales copilot operating only on information a workspace member entered.",
      "Do not browse, search, call tools, use connectors, claim public research, invent facts, infer a person’s intent, or recommend sending any message automatically.",
      "Treat every input record as unverified workspace context. Separate facts from assumptions. When context is insufficient, ask concise questions rather than filling gaps.",
      "Every known fact and every proposed task must cite one or more M-### evidence IDs provided by the user input.",
      "Return only JSON with this exact shape: {summary, rationale, knownFacts:[{text,evidenceIds}], questions, assumptions, evidenceIds, outreach:{subject,body}, plan:[{title,action,priority,reason,evidenceIds}]}",
      "The outreach body is a human-review draft only. Never include URLs, an external citation, or a claim that is absent from the supplied evidence.",
    ].join("\n"),
  }];
}

function userPrompt(input: StandaloneBriefInput, evidence: ReturnType<typeof manualEvidence>) {
  return [
    "Create a workspace-only account brief from these records. Do not use information beyond them.",
    JSON.stringify({
      account: { name: input.companyName, industry: input.companyIndustry, location: input.companyLocation },
      contact: input.contactName || input.contactRole ? { name: input.contactName || null, role: input.contactRole || null } : null,
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

/**
 * Produces one real Bedrock brief strictly from user-supplied Ano records. It
 * exposes neither a simulated discovery tool nor a connector capability.
 */
export async function runStandaloneBrief(
  input: StandaloneBriefInput,
  _config: BedrockPlannerConfig,
  converse: BedrockConverse,
): Promise<StandaloneBriefResult> {
  const evidence = manualEvidence(input);
  const knownEvidenceIds = new Set(evidence.map((item) => item.id));
  const messages: Message[] = [{ role: "user", content: [{ text: userPrompt(input, evidence) }] }];

  let response;
  try {
    response = await converse({ messages, system: systemPrompt(), timeoutMs: 24_000 });
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
  if (response.stopReason !== "end_turn" && response.stopReason !== "stop_sequence") {
    modelFailure("Ano stopped because Bedrock did not return a completed brief. No connector or external action was attempted.", "MODEL_MALFORMED");
  }

  const assistant = response.output?.message;
  if (!assistant || assistant.role !== "assistant") {
    modelFailure("Ano stopped because Bedrock returned no usable brief.", "MODEL_MALFORMED");
  }

  const candidate = textFrom(assistant).replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  let rawModelAnswer: unknown;
  try {
    rawModelAnswer = JSON.parse(candidate);
  } catch {
    modelFailure("Ano stopped because Bedrock did not return valid JSON for the workspace brief.", "MODEL_MALFORMED");
  }
  const parsed = modelBriefSchema.safeParse(rawModelAnswer);
  if (!parsed.success) {
    modelFailure("Ano stopped because Bedrock did not return the required structured brief.", "MODEL_MALFORMED");
  }

  const answer = parsed.data;
  const citedIds = [
    ...answer.evidenceIds,
    ...answer.knownFacts.flatMap((fact) => fact.evidenceIds),
    ...answer.plan.flatMap((item) => item.evidenceIds),
  ];
  if (hasUnknownEvidence(citedIds, knownEvidenceIds) || [answer.summary, answer.rationale, answer.outreach.subject, answer.outreach.body].some(containsExternalReference)) {
    modelFailure("Ano stopped because the generated brief referenced information outside the workspace records.", "MODEL_MALFORMED");
  }

  const runId = crypto.randomUUID();
  const plan: StandaloneBriefPlanItem[] = answer.plan.map((item, index) => ({
    ...item,
    id: `plan-${index + 1}`,
  }));
  const knownFacts = answer.knownFacts.map((fact) => `${fact.text} [${fact.evidenceIds.join(", ")}]`);

  return {
    run: { id: runId, status: "completed", mode: "bedrock", message: `Ano prepared a workspace-only brief for ${input.companyName}.`, modelTurns: 1 },
    account: {
      id: `manual-${runId}`,
      name: input.companyName,
      industry: input.companyIndustry,
      location: input.companyLocation,
      contact: input.contactName || input.contactRole ? { name: input.contactName, role: input.contactRole } : null,
    },
    evidence,
    readiness: readiness(input),
    brief: {
      summary: answer.summary,
      rationale: answer.rationale,
      knownFacts,
      questions: answer.questions,
      assumptions: answer.assumptions,
      outreach: answer.outreach,
      evidenceIds: answer.evidenceIds,
    },
    plan,
  };
}

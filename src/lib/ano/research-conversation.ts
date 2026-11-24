import { z } from "zod";

import {
  buildFriendlyConversationTitle,
  DEFAULT_CONVERSATION_TITLE,
  needsFriendlyTitleRefresh,
  type FriendlyConversationTitleInput,
} from "./conversation-title";
import type { CompanySearchView } from "./company-discovery";
import type { EvidenceResearchView } from "./evidence-research";
import type { MarketSynthesis } from "./market-synthesis";
import type { OutreachExecutionView } from "./outreach-execution";
import type { OutreachTemplatePackView } from "./outreach-templates";
import type { PeopleDiscoveryView } from "./people-playbooks";

export const graphRunStatusSchema = z.enum([
  "draft",
  "awaiting_context",
  "planning",
  "awaiting_plan_approval",
  "complete_without_research",
  "failed_safe",
  "requires_manual_review",
]);

export type GraphRunStatus = z.infer<typeof graphRunStatusSchema>;

export const conversationMessageMetadataSchema = z.object({
  companySearchUpdated: z.boolean().optional(),
  companySearchProvider: z.enum(["prospeo", "openstreetmap"]).optional(),
  companySearchId: z.string().uuid().optional(),
  companySearchResultCount: z.number().int().min(0).optional(),
  awaitingCreditApproval: z.boolean().optional(),
  shortlistedUpdated: z.boolean().optional(),
  shortlistedCount: z.number().int().min(0).optional(),
  peopleSearchUpdated: z.boolean().optional(),
  peopleSearchProvider: z.enum(["website_team", "prospeo"]).optional(),
  peopleSearchId: z.string().uuid().optional(),
  peopleResultCount: z.number().int().min(0).optional(),
  awaitingPersonCreditApproval: z.boolean().optional(),
  verificationUpdated: z.boolean().optional(),
  verificationProvider: z.enum(["prospeo", "dropcontact"]).optional(),
  verificationRunId: z.string().uuid().optional(),
  awaitingVerificationApproval: z.boolean().optional(),
  verifiedEmailCount: z.number().int().min(0).optional(),
  templatePackUpdated: z.boolean().optional(),
  templatePackVersion: z.number().int().positive().optional(),
  lintPassedCount: z.number().int().min(0).optional(),
  autopilotRerunTriggered: z.boolean().optional(),
  autopilotRerunStages: z.array(z.string().max(40)).max(6).optional(),
  actionSummary: z.string().max(400).optional(),
});
export type ConversationMessageMetadata = z.infer<typeof conversationMessageMetadataSchema>;

export const conversationMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  kind: z.enum(["message", "clarifying_question", "research_plan", "decision"]),
  text: z.string().trim().min(1).max(8_000),
  createdAt: z.string().datetime(),
  metadata: conversationMessageMetadataSchema.optional(),
});

export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export type ChronologicalThreadEntry<K extends string = string> = {
  id: string;
  kind: K;
  timestamp: string;
  orderHint: number;
};

export function sortChronologicalThreadEntries<
  T extends { id: string; timestamp: string; orderHint: number },
>(entries: T[]): T[] {
  return [...entries].sort((left, right) => {
    const leftMs = new Date(left.timestamp).getTime();
    const rightMs = new Date(right.timestamp).getTime();
    const safeLeft = Number.isFinite(leftMs) ? leftMs : 0;
    const safeRight = Number.isFinite(rightMs) ? rightMs : 0;
    if (safeLeft !== safeRight) {
      return safeLeft - safeRight;
    }
    return left.orderHint - right.orderHint;
  });
}

const conciseText = z.string().trim().min(1).max(1_000);

export const productSourceTypeSchema = z.enum(["website_url", "pdf", "docx", "txt"]);
export type ProductSourceType = z.infer<typeof productSourceTypeSchema>;

export const productSourceSummarySchema = z.object({
  id: z.string().uuid(),
  sourceType: productSourceTypeSchema,
  label: z.string().trim().min(1).max(200),
  sourceUrl: z.string().trim().max(1_000).nullable(),
  mimeType: z.string().trim().max(160).nullable(),
  byteSize: z.number().int().min(0),
  charCount: z.number().int().min(0),
  summaryText: z.string().trim().max(1_000).nullable(),
  extractionStatus: z.enum(["ready", "failed"]),
  errorMessage: z.string().trim().max(400).nullable(),
  createdAt: z.string().datetime(),
});
export type ProductSourceSummary = z.infer<typeof productSourceSummarySchema>;

export const researchBriefSchema = z.object({
  offer: conciseText.describe("What the user sells."),
  goal: conciseText.describe("The sales outcome the user wants."),
  businessLocation: z.string().trim().max(200).nullable().optional(),
  targetMarkets: z.array(conciseText).max(6).optional(),
  intakeComplete: z.boolean().optional(),
  marketHints: z.array(conciseText).max(6).default([]),
  locationHints: z.array(conciseText).max(6).default([]),
  buyerHints: z.array(conciseText).max(6).default([]),
  constraints: z.array(conciseText).max(8).default([]),
  unknowns: z.array(conciseText).max(8).default([]),
  sourceMessageIds: z.array(z.string().uuid()).min(1).max(20),
});

export type ResearchBrief = z.infer<typeof researchBriefSchema>;

export const clarificationSchema = z.object({
  id: z.string().uuid(),
  question: conciseText.max(360),
  purpose: conciseText.max(360),
});

export type Clarification = z.infer<typeof clarificationSchema>;

export const researchPlanDraftSchema = z.object({
  summary: conciseText.max(900),
  researchQuestions: z.array(conciseText.max(360)).min(2).max(5),
  comparisonCriteria: z.array(conciseText.max(180)).min(2).max(6),
  intendedSourceClasses: z.array(z.enum([
    "Government and official statistics",
    "Industry bodies and primary research",
    "Public company reports and filings",
    "Independent reporting",
  ])).min(1).max(4),
  plannedScope: z.object({
    markets: z.array(conciseText).max(5),
    industries: z.array(conciseText).max(8),
    buyerRoles: z.array(conciseText).max(8),
  }),
  budget: z.object({
    maximumSearches: z.number().int().min(1).max(50),
    maximumFetches: z.number().int().min(1).max(100),
    providerSpend: z.literal("not_available_in_phase_a"),
  }),
  uncertainties: z.array(conciseText.max(360)).max(6),
});

export type ResearchPlanDraft = z.infer<typeof researchPlanDraftSchema>;

export const researchPlanSchema = researchPlanDraftSchema.extend({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  approvalStatus: z.enum(["awaiting_approval", "approved", "declined"]),
  createdAt: z.string().datetime(),
  userEditInstruction: z.string().trim().min(1).max(2_000).optional(),
});

export type ResearchPlan = z.infer<typeof researchPlanSchema>;

/** Flat object schema passed to Bedrock's structured-output adapter. */
export const interpretationOutputSchema = z.object({
  outcome: z.enum(["ready", "needs_context"]),
  brief: researchBriefSchema.omit({ sourceMessageIds: true }),
  clarification: z.object({
    question: conciseText.max(360),
    purpose: conciseText.max(360),
  }).optional(),
});

/** Application-level validation adds the outcome/clarification dependency. */
export const interpretationSchema = interpretationOutputSchema.superRefine((value, context) => {
  if (value.outcome === "needs_context" && !value.clarification) {
    context.addIssue({ code: "custom", message: "A clarification is required when the brief is not ready." });
  }
  if (value.outcome === "ready" && value.clarification) {
    context.addIssue({ code: "custom", message: "Do not ask a clarification when the brief is ready." });
  }
});

export type ResearchInterpretation = z.infer<typeof interpretationSchema>;

export const clarificationResumeSchema = z.object({
  kind: z.literal("clarification"),
  answer: z.string().trim().min(1).max(4_000),
  messageId: z.string().uuid(),
});

export const planResumeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approve") }),
  z.object({ kind: z.literal("decline"), reason: z.string().trim().max(1_000).optional() }),
  z.object({ kind: z.literal("edit"), instruction: z.string().trim().min(1).max(2_000), messageId: z.string().uuid() }),
]);

export const retryResumeSchema = z.object({
  kind: z.literal("retry"),
});

export const graphResumeSchema = z.union([
  clarificationResumeSchema,
  planResumeSchema,
  retryResumeSchema,
]);
export type GraphResume = z.infer<typeof graphResumeSchema>;

export const researchConversationSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: graphRunStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ResearchConversationSummary = z.infer<typeof researchConversationSummarySchema>;

export const researchConversationViewSchema = z.object({
  conversation: z.object({
    id: z.string().uuid(),
    title: z.string(),
    status: graphRunStatusSchema,
    threadId: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
  run: z.object({
    id: z.string().uuid(),
    status: graphRunStatusSchema,
    graphVersion: z.string(),
    currentNode: z.string(),
    checkpointRef: z.string().nullable(),
    failureMessage: z.string().nullable(),
  }),
  messages: z.array(conversationMessageSchema),
  productSources: z.array(productSourceSummarySchema).optional(),
  brief: researchBriefSchema.nullable(),
  pendingQuestion: clarificationSchema.nullable(),
  plan: researchPlanSchema.nullable(),
  events: z.array(z.object({ id: z.string().uuid(), label: z.string(), detail: z.string(), at: z.string().datetime() })),
});

export type ResearchConversationView = z.infer<typeof researchConversationViewSchema>;

export const artifactTypeSchema = z.enum([
  "research_plan",
  "provider_scope",
  "research_progress",
  "evidence_report",
  "target_decision",
  "company_search_preview",
  "account_cohort",
  "account_dossier",
  "people_discovery",
  "contact_verification",
  "account_playbook",
  "outreach_template_pack",
  "outreach_drafts",
  "execution_proposals",
]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const messagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), markdown: z.string().min(1) }),
  z.object({
    type: z.literal("artifact"),
    artifactType: artifactTypeSchema,
    artifactId: z.string().min(1),
  }),
  z.object({
    type: z.literal("status"),
    state: z.enum([
      "thinking",
      "awaiting_approval",
      "running",
      "completed",
      "stopped_safely",
    ]),
  }),
]);
export type MessagePart = z.infer<typeof messagePartSchema>;

export const conversationPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    archived: z.boolean().optional(),
  })
  .refine((val) => val.title !== undefined || val.archived !== undefined, {
    message: "Specify a title change or archive action.",
  });
export type ConversationPatchInput = z.infer<typeof conversationPatchSchema>;

export function buildConversationMessageParts(
  conversation: ResearchConversationView,
  research: EvidenceResearchView | null,
  synthesis: MarketSynthesis | null,
  companySearch: CompanySearchView | null = null,
  peopleDiscovery: PeopleDiscoveryView | null = null,
  outreachExecution: OutreachExecutionView | null = null,
  templatePack: OutreachTemplatePackView | null = null,
): MessagePart[] {
  const parts: MessagePart[] = [];

  for (const message of conversation.messages) {
    parts.push({ type: "text", markdown: message.text });
  }

  if (conversation.plan) {
    parts.push({
      type: "artifact",
      artifactType: "research_plan",
      artifactId: conversation.plan.id,
    });
  }

  if (conversation.plan?.approvalStatus === "approved") {
    parts.push({
      type: "artifact",
      artifactType: "provider_scope",
      artifactId: research?.run.id ?? conversation.plan.id,
    });
  }

  if (research) {
    parts.push({
      type: "artifact",
      artifactType: "research_progress",
      artifactId: research.run.id,
    });
  }

  if (synthesis) {
    parts.push({
      type: "artifact",
      artifactType: "evidence_report",
      artifactId: synthesis.id,
    });
  }

  if (synthesis?.status === "ready_for_decision") {
    parts.push({
      type: "artifact",
      artifactType: "target_decision",
      artifactId: synthesis.decision?.id ?? synthesis.id,
    });
  }

  if (synthesis?.decision?.status === "locked") {
    parts.push({
      type: "artifact",
      artifactType: "company_search_preview",
      artifactId: companySearch?.id ?? synthesis.decision.id,
    });
  }

  if (companySearch?.status === "completed") {
    parts.push({
      type: "artifact",
      artifactType: "account_cohort",
      artifactId: companySearch.id,
    });
    for (const account of companySearch.accounts) {
      parts.push({
        type: "artifact",
        artifactType: "account_dossier",
        artifactId: account.id,
      });
    }
  }

  if (peopleDiscovery && (peopleDiscovery.shortlistedCount > 0 || peopleDiscovery.personSearch)) {
    parts.push({
      type: "artifact",
      artifactType: "people_discovery",
      artifactId: peopleDiscovery.personSearch?.id ?? conversation.conversation.id,
    });
  }

  if (peopleDiscovery?.verificationRun) {
    parts.push({
      type: "artifact",
      artifactType: "contact_verification",
      artifactId: peopleDiscovery.verificationRun.id,
    });
  }

  for (const playbook of peopleDiscovery?.playbooks ?? []) {
    parts.push({
      type: "artifact",
      artifactType: "account_playbook",
      artifactId: playbook.id,
    });
  }

  if (templatePack) {
    parts.push({
      type: "artifact",
      artifactType: "outreach_template_pack",
      artifactId: templatePack.id,
    });
  }

  if (outreachExecution && outreachExecution.drafts.length > 0) {
    parts.push({
      type: "artifact",
      artifactType: "outreach_drafts",
      artifactId: outreachExecution.drafts[0].accountPlaybookId,
    });
  }

  if (outreachExecution && outreachExecution.proposals.length > 0) {
    parts.push({
      type: "artifact",
      artifactType: "execution_proposals",
      artifactId: outreachExecution.proposals[0].id,
    });
  }

  let state: Extract<MessagePart, { type: "status" }>["state"] = "completed";
  if (
    research?.run.status === "running" ||
    synthesis?.status === "running" ||
    companySearch?.status === "running" ||
    peopleDiscovery?.personSearch?.status === "running" ||
    peopleDiscovery?.verificationRun?.status === "running"
  ) {
    state = "running";
  } else if (
    conversation.run.status === "failed_safe" ||
    conversation.run.status === "requires_manual_review" ||
    research?.run.status === "failed_safe" ||
    research?.run.status === "requires_manual_review" ||
    synthesis?.status === "failed_safe" ||
    synthesis?.status === "requires_manual_review" ||
    companySearch?.status === "failed_safe" ||
    companySearch?.status === "requires_manual_review" ||
    peopleDiscovery?.personSearch?.status === "failed_safe" ||
    peopleDiscovery?.personSearch?.status === "requires_manual_review" ||
    peopleDiscovery?.verificationRun?.status === "failed_safe" ||
    peopleDiscovery?.verificationRun?.status === "requires_manual_review"
  ) {
    state = "stopped_safely";
  } else if (
    conversation.run.status === "awaiting_context" ||
    conversation.run.status === "awaiting_plan_approval" ||
    research?.run.status === "awaiting_provider_approval" ||
    synthesis?.decision?.status === "awaiting_selection" ||
    companySearch?.status === "awaiting_approval" ||
    peopleDiscovery?.personSearch?.status === "awaiting_approval" ||
    peopleDiscovery?.verificationRun?.status === "awaiting_approval" ||
    (outreachExecution?.proposals.some((proposal) => proposal.status === "awaiting_approval") ?? false)
  ) {
    state = "awaiting_approval";
  } else if (conversation.run.status === "planning") {
    state = "thinking";
  }

  parts.push({ type: "status", state });
  return parts;
}

export {
  buildFriendlyConversationTitle,
  DEFAULT_CONVERSATION_TITLE,
  needsFriendlyTitleRefresh,
  type FriendlyConversationTitleInput,
};

export function conversationTitle(message: string) {
  return buildFriendlyConversationTitle({ openingMessage: message });
}

/**
 * Normalizes backend/persisted error text into clean, branded product copy so
 * upstream LLM vendor names, model IDs, API keys, or raw HTTP codes never
 * surface in browser banners (including legacy persisted `failed_safe` rows).
 */
export function formatDisplayErrorMessage(
  raw: string | null | undefined,
  fallback = "Ano could not complete that step right now. Please try again.",
): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return fallback;

  if (
    /google ai studio|gemini-|bedrock|ollama|http\s*(?:503|429|404|401|403)|gemini_api_key|ano_agent_mode|aws identity|aws credentials|high demand|quota exceeded|rate limit|free-tier quota/i.test(
      trimmed,
    )
  ) {
    if (/\btimed?\s*out\b/i.test(trimmed)) {
      return "Ano took longer than expected to respond. Please try again.";
    }
    if (/\b(?:503|429|high demand|rate limit|quota)\b/i.test(trimmed)) {
      return "Ano is experiencing brief high demand right now. Please try again in a moment.";
    }
    return "Ano's research service is temporarily unavailable. Please try again shortly.";
  }

  return trimmed;
}

/**
 * Masks backend vendor, search-engine, model, and environment variable names
 * from user-facing text (including legacy persisted records and chat replies).
 */
export function maskVendorNamesForDisplay(
  raw: string | null | undefined,
): string {
  const input = raw ?? "";
  if (!input) return input;

  return input
    .replace(/\s*\((?:OpenStreetMap|OSM|Prospeo|Dropcontact|SearXNG)\)\s*/gi, " ")
    .replace(/\bOpenStreetMap(?:\s+Nominatim)?\b/gi, "Local business directory")
    .replace(/\b(?:Nominatim|Overpass|OSM)\b/gi, "local business directory")
    .replace(/\b(?:Private\s+)?SearXNG\b/gi, "web research")
    .replace(/\bTavily\b/gi, "web research")
    .replace(
      /\b(?:Prospeo\s+(?:or|and|\/)\s+Dropcontact|Dropcontact\s+(?:or|and|\/)\s+Prospeo)\b/gi,
      "work email verification",
    )
    .replace(/\bProspeo\b/gi, "B2B directory")
    .replace(/\bDropcontact\b/gi, "email verification")
    .replace(/\bMercury(?:\s+CRM)?\b/gi, "CRM")
    .replace(/\bSupabase(?:\s+Auth)?\b/gi, "authentication service")
    .replace(/\b(?:Google AI Studio(?:\s+Gemini)?|Gemini|Amazon Bedrock|Bedrock|Ollama|LangGraph)\b/gi, "Ano")
    .replace(
      /\b(?:PROSPEO_KEY|DROPCONTACT_API_KEY|SEARXNG_BASE_URL|SEARXNG_GATEWAY_TOKEN|GEMINI_API_KEY|ANO_AGENT_MODE|OVERPASS_API_URL)\b/g,
      "server configuration",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

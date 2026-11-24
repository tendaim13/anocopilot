import { z } from "zod";

import type { GraphRunStatus, ResearchConversationSummary } from "./research-conversation";

export const workQueueCategorySchema = z.enum([
  "needs_clarification",
  "plan_approval_required",
  "provider_scope_approval_required",
  "manual_review_required",
  "target_decision_required",
  "active_running",
]);
export type WorkQueueCategory = z.infer<typeof workQueueCategorySchema>;

export const workQueueBucketSchema = z.enum(["needs_review", "active_research"]);
export type WorkQueueBucket = z.infer<typeof workQueueBucketSchema>;

export const workQueueItemSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().uuid(),
  conversationTitle: z.string(),
  category: workQueueCategorySchema,
  bucket: workQueueBucketSchema,
  label: z.string(),
  detail: z.string(),
  updatedAt: z.string().datetime(),
});
export type WorkQueueItem = z.infer<typeof workQueueItemSchema>;

export const workQueueSummarySchema = z.object({
  needsReviewCount: z.number().int().min(0),
  activeResearchCount: z.number().int().min(0),
  items: z.array(workQueueItemSchema),
});
export type WorkQueueSummary = z.infer<typeof workQueueSummarySchema>;

export type WorkQueueClassificationInput = {
  conversation: ResearchConversationSummary & { status: GraphRunStatus };
  planApprovalStatus?: "awaiting_approval" | "approved" | "declined" | null;
  researchRun?: {
    status: string;
    maximumSearches?: number;
    maximumFetches?: number;
    consumedSearches?: number;
    currentWave?: number;
    failureMessage?: string | null;
    updatedAt?: string;
  } | null;
  synthesis?: {
    status: string;
    failureMessage?: string | null;
    updatedAt?: string;
  } | null;
  targetDecision?: {
    status: string;
    updatedAt?: string;
  } | null;
  companySearch?: {
    status: string;
    resultCount?: number | null;
    failureMessage?: string | null;
    updatedAt?: string;
  } | null;
  personSearch?: {
    status: string;
    resultCount?: number | null;
    failureMessage?: string | null;
    updatedAt?: string;
  } | null;
  verificationRun?: {
    status: string;
    estimatedCredits?: number | null;
    failureMessage?: string | null;
    updatedAt?: string;
  } | null;
  pendingProposals?: {
    count: number;
    updatedAt?: string;
  } | null;
};

function newestIso(...values: Array<string | null | undefined>) {
  const valid = values
    .filter((item): item is string => Boolean(item))
    .map((item) => ({ item, ms: new Date(item).getTime() }))
    .filter((entry) => Number.isFinite(entry.ms))
    .sort((left, right) => right.ms - left.ms);
  return valid[0]?.item ?? new Date().toISOString();
}

export function classifyConversationWorkItem(
  input: WorkQueueClassificationInput,
): WorkQueueItem | null {
  const {
    conversation,
    planApprovalStatus,
    researchRun,
    synthesis,
    targetDecision,
    companySearch,
    personSearch,
    verificationRun,
    pendingProposals,
  } = input;
  const updatedAt = newestIso(
    pendingProposals?.updatedAt,
    verificationRun?.updatedAt,
    personSearch?.updatedAt,
    companySearch?.updatedAt,
    targetDecision?.updatedAt,
    synthesis?.updatedAt,
    researchRun?.updatedAt,
    conversation.updatedAt,
  );

  if (targetDecision?.status === "locked") {
    if (pendingProposals && pendingProposals.count > 0) {
      return workQueueItemSchema.parse({
        id: `execution-proposal-approval:${conversation.id}`,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        category: "provider_scope_approval_required",
        bucket: "needs_review",
        label: "Approve outbound proposal",
        detail: `${pendingProposals.count} staged outreach, call, scheduling, or CRM proposal${pendingProposals.count === 1 ? "" : "s"} awaiting explicit approval.`,
        updatedAt,
      });
    }
    if (verificationRun?.status === "awaiting_approval") {
      return workQueueItemSchema.parse({
        id: `contact-verification-approval:${conversation.id}`,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        category: "provider_scope_approval_required",
        bucket: "needs_review",
        label: "Approve email verification",
        detail: "Selective work email verification preview awaits approval.",
        updatedAt,
      });
    }
    if (verificationRun?.status === "running") {
      return workQueueItemSchema.parse({
        id: `contact-verification-running:${conversation.id}`,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        category: "active_running",
        bucket: "active_research",
        label: "Verifying selected contacts",
        detail: "Ano is running the approved work email verification batch.",
        updatedAt,
      });
    }
    if (
      verificationRun?.status === "requires_manual_review" ||
      verificationRun?.status === "failed_safe"
    ) {
      return workQueueItemSchema.parse({
        id: `contact-verification-review:${conversation.id}`,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        category: "manual_review_required",
        bucket: "needs_review",
        label: "Verification review required",
        detail:
          verificationRun.failureMessage ??
          "Email verification paused safely and requires review.",
        updatedAt,
      });
    }

    if (personSearch?.status === "awaiting_approval") {
      return workQueueItemSchema.parse({
        id: `person-search-approval:${conversation.id}`,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        category: "provider_scope_approval_required",
        bucket: "needs_review",
        label: "Approve person search",
        detail: "Decision-maker search preview awaits approval.",
        updatedAt,
      });
    }
    if (personSearch?.status === "running") {
      return workQueueItemSchema.parse({
        id: `person-search-running:${conversation.id}`,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        category: "active_running",
        bucket: "active_research",
        label: "Person search running",
        detail: "Ano is running the approved decision-maker search.",
        updatedAt,
      });
    }
    if (
      personSearch?.status === "requires_manual_review" ||
      personSearch?.status === "failed_safe"
    ) {
      return workQueueItemSchema.parse({
        id: `person-search-review:${conversation.id}`,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        category: "manual_review_required",
        bucket: "needs_review",
        label: "Person search review required",
        detail:
          personSearch.failureMessage ??
          "Decision-maker search paused safely and requires review.",
        updatedAt,
      });
    }

    if (!companySearch || companySearch.status === "completed") {
      return null;
    }
    if (companySearch.status === "awaiting_approval") {
      return workQueueItemSchema.parse({
        id: `company-search-approval:${conversation.id}`,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        category: "provider_scope_approval_required",
        bucket: "needs_review",
        label: "Approve company search",
        detail: "Bounded company search preview (max 25 companies) awaits your explicit approval.",
        updatedAt,
      });
    }
    if (companySearch.status === "running") {
      return workQueueItemSchema.parse({
        id: `company-search-running:${conversation.id}`,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        category: "active_running",
        bucket: "active_research",
        label: "Company search running",
        detail: "Ano is running the approved bounded company search.",
        updatedAt,
      });
    }
    if (companySearch.status === "requires_manual_review" || companySearch.status === "failed_safe") {
      return workQueueItemSchema.parse({
        id: `company-search-review:${conversation.id}`,
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        category: "manual_review_required",
        bucket: "needs_review",
        label: "Company search review required",
        detail:
          companySearch.failureMessage ??
          "Company search stopped without retry and requires review.",
        updatedAt,
      });
    }
    return null;
  }

  if (
    targetDecision?.status === "awaiting_selection" ||
    synthesis?.status === "ready_for_decision"
  ) {
    return workQueueItemSchema.parse({
      id: `target:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "target_decision_required",
      bucket: "needs_review",
      label: "Choose target route",
      detail: "Evidence-backed market recommendation is ready for your target selection.",
      updatedAt,
    });
  }

  if (synthesis?.status === "running") {
    return workQueueItemSchema.parse({
      id: `synthesis:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "active_running",
      bucket: "active_research",
      label: "Checking citations",
      detail: "Ano is synthesizing saved source excerpts into a cited recommendation.",
      updatedAt,
    });
  }

  if (synthesis?.status === "requires_manual_review" || synthesis?.status === "failed_safe") {
    return workQueueItemSchema.parse({
      id: `synthesis-review:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "manual_review_required",
      bucket: "needs_review",
      label: "Synthesis review required",
      detail:
        synthesis.failureMessage ??
        "Evidence analysis paused safely and requires your review.",
      updatedAt,
    });
  }

  if (researchRun?.status === "running") {
    const wave = Math.max(1, researchRun.currentWave ?? 1);
    const searches = researchRun.consumedSearches ?? 0;
    const maxSearches = researchRun.maximumSearches ?? 50;
    return workQueueItemSchema.parse({
      id: `research:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "active_running",
      bucket: "active_research",
      label: "Public research running",
      detail: `Wave ${wave} · ${searches} of ${maxSearches} bounded searches executed.`,
      updatedAt,
    });
  }

  if (researchRun?.status === "requires_manual_review" || researchRun?.status === "failed_safe") {
    return workQueueItemSchema.parse({
      id: `research-review:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "manual_review_required",
      bucket: "needs_review",
      label: "Provider review required",
      detail:
        researchRun.failureMessage ??
        "An uncertain provider request was excluded without retry.",
      updatedAt,
    });
  }

  if (researchRun?.status === "awaiting_provider_approval") {
    return workQueueItemSchema.parse({
      id: `provider-approval:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "provider_scope_approval_required",
      bucket: "needs_review",
      label: "Approve research scope",
      detail: "Market research scope awaits your approval.",
      updatedAt,
    });
  }

  if (researchRun?.status === "sources_ready" && !synthesis) {
    return workQueueItemSchema.parse({
      id: `sources-ready:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "provider_scope_approval_required",
      bucket: "needs_review",
      label: "Analyze saved sources",
      detail: "Public sources are saved and ready for citation-bound synthesis.",
      updatedAt,
    });
  }

  if (conversation.status === "awaiting_context") {
    return workQueueItemSchema.parse({
      id: `clarification:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "needs_clarification",
      bucket: "needs_review",
      label: "Clarification needed",
      detail: "Ano paused for one answer that changes the research design.",
      updatedAt,
    });
  }

  if (conversation.status === "awaiting_plan_approval") {
    return workQueueItemSchema.parse({
      id: `plan:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "plan_approval_required",
      bucket: "needs_review",
      label: "Approve research plan",
      detail: "Research plan is ready to approve, edit, or decline.",
      updatedAt,
    });
  }

  if (
    conversation.status === "requires_manual_review" ||
    conversation.status === "failed_safe"
  ) {
    return workQueueItemSchema.parse({
      id: `conv-review:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "manual_review_required",
      bucket: "needs_review",
      label: "Conversation paused safely",
      detail: "Stopped safely before any external provider action.",
      updatedAt,
    });
  }

  if (conversation.status === "planning") {
    return workQueueItemSchema.parse({
      id: `planning:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "active_running",
      bucket: "active_research",
      label: "Preparing research plan",
      detail: "Ano is interpreting your brief and drafting a plan.",
      updatedAt,
    });
  }

  if (
    conversation.status === "complete_without_research" &&
    planApprovalStatus === "approved" &&
    !researchRun
  ) {
    return workQueueItemSchema.parse({
      id: `prepare-scope:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      category: "provider_scope_approval_required",
      bucket: "needs_review",
      label: "Start market research",
      detail: "Research plan approved; start market research when ready.",
      updatedAt,
    });
  }

  return null;
}

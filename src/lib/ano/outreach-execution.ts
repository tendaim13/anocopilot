import { z } from "zod";

import type { AccountPlaybookView, ContactCandidateView } from "./people-playbooks";

const identifier = z.string().uuid();
const shortText = z.string().trim().min(1).max(700);

export const outreachChannelSchema = z.enum([
  "email",
  "linkedin",
  "call_script",
  "follow_up",
]);
export type OutreachChannel = z.infer<typeof outreachChannelSchema>;

export const contactEligibilityStatusSchema = z.enum([
  "eligible",
  "blocked_unverified_email",
  "blocked_missing_contact",
  "blocked_suppressed",
  "review_only_channel",
]);
export type ContactEligibilityStatus = z.infer<typeof contactEligibilityStatusSchema>;

export const contactEligibilityCheckSchema = z.object({
  status: contactEligibilityStatusSchema,
  canProposeEmailSend: z.boolean(),
  canProposeCalendarSchedule: z.boolean(),
  canProposeCallTask: z.boolean(),
  canProposeMercurySync: z.boolean(),
  reasons: z.array(shortText).min(1).max(6),
});
export type ContactEligibilityCheck = z.infer<typeof contactEligibilityCheckSchema>;

export const outreachDraftStatusSchema = z.enum([
  "draft",
  "ready_for_proposal",
  "proposed",
  "approved",
  "rejected",
  "executed",
]);
export type OutreachDraftStatus = z.infer<typeof outreachDraftStatusSchema>;

export const outreachDraftViewSchema = z.object({
  id: identifier,
  conversationId: identifier,
  targetDecisionId: identifier,
  accountPlaybookId: identifier,
  accountCandidateId: identifier,
  accountName: z.string().trim().min(1).max(200),
  contactCandidateId: identifier.nullable(),
  contactName: z.string().trim().min(1).max(180).nullable(),
  contactEmail: z.string().trim().email().nullable(),
  channel: outreachChannelSchema,
  version: z.number().int().positive(),
  subject: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(4000),
  callScriptPoints: z.array(shortText).max(6),
  claimIds: z.array(identifier).max(16),
  signalIds: z.array(z.string().trim().min(1).max(160)).max(16),
  eligibility: contactEligibilityCheckSchema,
  status: outreachDraftStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OutreachDraftView = z.infer<typeof outreachDraftViewSchema>;

export const executionProposalTypeSchema = z.enum([
  "email_send",
  "calendar_schedule",
  "call_task",
  "mercury_task",
  "mercury_draft",
  "mercury_update",
]);
export type ExecutionProposalType = z.infer<typeof executionProposalTypeSchema>;

export const executionProposalStatusSchema = z.enum([
  "awaiting_approval",
  "approved",
  "rejected",
  "dismissed",
  "stale",
  "executed",
]);
export type ExecutionProposalStatus = z.infer<typeof executionProposalStatusSchema>;

export const approvalDecisionViewSchema = z.object({
  id: identifier,
  decision: z.enum(["approved", "edited", "rejected", "dismissed"]),
  proposalVersion: z.number().int().positive(),
  rationale: shortText.nullable(),
  decidedBy: identifier,
  createdAt: z.string().datetime(),
});
export type ApprovalDecisionView = z.infer<typeof approvalDecisionViewSchema>;

export const executionProposalViewSchema = z.object({
  id: identifier,
  conversationId: identifier,
  accountPlaybookId: identifier.nullable(),
  accountCandidateId: identifier.nullable(),
  accountName: z.string().trim().min(1).max(200),
  contactCandidateId: identifier.nullable(),
  contactName: z.string().trim().min(1).max(180).nullable(),
  contactEmail: z.string().trim().email().nullable(),
  outreachDraftId: identifier.nullable(),
  providerActionRequestId: identifier.nullable(),
  proposalType: executionProposalTypeSchema,
  targetReference: z.string().trim().min(1).max(240).nullable(),
  status: executionProposalStatusSchema,
  version: z.number().int().positive(),
  summary: shortText,
  payload: z.record(z.string(), z.unknown()),
  executionReceipt: z.record(z.string(), z.unknown()),
  decisions: z.array(approvalDecisionViewSchema).max(10),
  executedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ExecutionProposalView = z.infer<typeof executionProposalViewSchema>;

export const outreachExecutionViewSchema = z.object({
  drafts: z.array(outreachDraftViewSchema).max(100),
  proposals: z.array(executionProposalViewSchema).max(100),
  mercuryConnected: z.boolean(),
});
export type OutreachExecutionView = z.infer<typeof outreachExecutionViewSchema>;

export const outreachExecutionActionInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate_drafts"),
    playbookId: identifier.optional(),
  }),
  z.object({
    action: z.literal("edit_draft"),
    draftId: identifier,
    subject: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(4000),
  }),
  z.object({
    action: z.literal("create_proposal"),
    draftId: identifier,
    proposalType: executionProposalTypeSchema,
    scheduledFor: z.string().trim().min(1).max(120).optional(),
    note: z.string().trim().min(1).max(500).optional(),
  }),
  z.object({
    action: z.literal("decide_proposal"),
    proposalId: identifier,
    decision: z.enum(["approved", "rejected", "dismissed"]),
    rationale: z.string().trim().max(500).optional(),
  }),
]);
export type OutreachExecutionActionInput = z.infer<
  typeof outreachExecutionActionInputSchema
>;

export type MercuryConnectorState = {
  connector: "mercury";
  available: boolean;
  mode: "proposal_preview" | "disabled";
  note: string;
};

/**
 * Deterministic suppression and contact-eligibility check prior to any draft-to-proposal
 * promotion. Enforces that email sends and calendar invites require a Dropcontact-verified
 * email and blocks all outbound proposals if a contact is suppressed.
 */
export function evaluateContactEligibility(
  contact: ContactCandidateView | null,
  channel: OutreachChannel,
  suppressedEmails: string[] = [],
): ContactEligibilityCheck {
  if (!contact) {
    return contactEligibilityCheckSchema.parse({
      status: "blocked_missing_contact",
      canProposeEmailSend: false,
      canProposeCalendarSchedule: false,
      canProposeCallTask: true,
      canProposeMercurySync: true,
      reasons: [
        "No named contact is linked yet; only CRM review tasks or manual call tasks may be proposed.",
      ],
    });
  }

  const email = contact.verifiedDetails?.email?.trim().toLowerCase() ?? null;
  const suppressedSet = new Set(suppressedEmails.map((item) => item.trim().toLowerCase()));
  if (email && suppressedSet.has(email)) {
    return contactEligibilityCheckSchema.parse({
      status: "blocked_suppressed",
      canProposeEmailSend: false,
      canProposeCalendarSchedule: false,
      canProposeCallTask: false,
      canProposeMercurySync: false,
      reasons: [
        `${email} matches a workspace opt-out or suppression record; all outreach proposals are blocked.`,
      ],
    });
  }

  const hasVerifiedEmail = contact.verificationStatus === "verified" && Boolean(email);
  if (!hasVerifiedEmail) {
    const publicHint = contact.publicEmail
      ? ` Public website email (${contact.publicEmail}, ${contact.publicEmailKind === "direct_public" ? "direct" : "shared office inbox"}) is available for review/CSV export.`
      : "";
    return contactEligibilityCheckSchema.parse({
      status: channel === "linkedin" || channel === "call_script" ? "review_only_channel" : "blocked_unverified_email",
      canProposeEmailSend: false,
      canProposeCalendarSchedule: false,
      canProposeCallTask: true,
      canProposeMercurySync: true,
      reasons: [
        `${contact.fullName} does not have a verified work email yet; autonomous email send and calendar scheduling stay blocked until email verification succeeds.${publicHint}`,
      ],
    });
  }

  if (channel === "linkedin") {
    return contactEligibilityCheckSchema.parse({
      status: "review_only_channel",
      canProposeEmailSend: false,
      canProposeCalendarSchedule: false,
      canProposeCallTask: true,
      canProposeMercurySync: true,
      reasons: [
        "LinkedIn drafts are review-only for manual seller copy; Ano never automates LinkedIn sends.",
      ],
    });
  }

  return contactEligibilityCheckSchema.parse({
    status: "eligible",
    canProposeEmailSend: true,
    canProposeCalendarSchedule: true,
    canProposeCallTask: true,
    canProposeMercurySync: true,
    reasons: [
      `Verified work email (${email}) passed suppression checks and is eligible for per-action approval.`,
    ],
  });
}

export function compilePlaybookOutreachDrafts(input: {
  playbook: AccountPlaybookView;
  contacts: ContactCandidateView[];
  draftIds?: Record<OutreachChannel, string>;
  suppressedEmails?: string[];
  nowIso?: string;
}): OutreachDraftView[] {
  const now = input.nowIso ?? new Date().toISOString();
  const { playbook } = input;

  const accountContacts = input.contacts.filter(
    (contact) => contact.accountCandidateId === playbook.accountCandidateId,
  );
  const primaryContact =
    accountContacts.find((contact) => contact.verificationStatus === "verified") ??
    accountContacts[0] ??
    null;

  const signalFact =
    playbook.evidenceBackedPoints.find((point) => point.kind === "company_signal")?.statement ??
    `${playbook.accountName} was shortlisted under ${playbook.targetMarketName}.`;
  const firstQuestion =
    playbook.validationQuestions[0] ??
    `How is ${playbook.accountName} currently managing workflows in ${playbook.targetIndustryName}?`;

  const greetingName = primaryContact?.firstName ?? primaryContact?.fullName ?? "there";

  const specs: Array<{
    channel: OutreachChannel;
    subject: string;
    body: string;
    callScriptPoints: string[];
  }> = [
    {
      channel: "email",
      subject: `${playbook.accountName} · ${playbook.targetIndustryName} workflow question`,
      body: [
        `Hi ${greetingName},`,
        "",
        `I'm reaching out because ${signalFact}`,
        "",
        `Across ${playbook.targetIndustryName} in ${playbook.targetMarketName}, teams we research often tell us: ${firstQuestion}`,
        "",
        "Worth a short 15-minute conversation next week to compare notes? No pitch deck unless relevant.",
      ].join("\n"),
      callScriptPoints: [],
    },
    {
      channel: "linkedin",
      subject: `LinkedIn note · ${playbook.accountName}`,
      body: `Hi ${greetingName} — noticed ${playbook.accountName}'s footprint in ${playbook.targetMarketName}. Curious how your team handles: ${firstQuestion}`,
      callScriptPoints: [],
    },
    {
      channel: "call_script",
      subject: `Discovery call opener · ${playbook.accountName}`,
      body: `Call objective: validate ${playbook.targetIndustryName} operational assumptions at ${playbook.accountName} before pitching.`,
      callScriptPoints: [
        `Observed context: ${signalFact}`,
        `First-call question: ${firstQuestion}`,
        ...playbook.validationQuestions.slice(1, 3),
      ],
    },
    {
      channel: "follow_up",
      subject: `Re: ${playbook.accountName} · follow-up question`,
      body: [
        `Hi ${greetingName},`,
        "",
        `Following up briefly on my note — if ${firstQuestion.toLowerCase()} isn't a priority this quarter, let me know and I'll close the loop.`,
      ].join("\n"),
      callScriptPoints: [],
    },
  ];

  return specs.map((spec) => {
    const eligibility = evaluateContactEligibility(
      primaryContact,
      spec.channel,
      input.suppressedEmails,
    );
    return outreachDraftViewSchema.parse({
      id: input.draftIds?.[spec.channel] ?? crypto.randomUUID(),
      conversationId: playbook.conversationId,
      targetDecisionId: playbook.targetDecisionId,
      accountPlaybookId: playbook.id,
      accountCandidateId: playbook.accountCandidateId,
      accountName: playbook.accountName,
      contactCandidateId: primaryContact?.id ?? null,
      contactName: primaryContact?.fullName ?? null,
      contactEmail: primaryContact?.verifiedDetails?.email ?? null,
      channel: spec.channel,
      version: 1,
      subject: spec.subject,
      body: spec.body,
      callScriptPoints: spec.callScriptPoints,
      claimIds: playbook.claimIds,
      signalIds: playbook.signalIds,
      eligibility,
      status: eligibility.canProposeEmailSend ? "ready_for_proposal" : "draft",
      createdAt: now,
      updatedAt: now,
    });
  });
}

export function assertDraftCanCreateProposal(
  draft: OutreachDraftView,
  proposalType: ExecutionProposalType,
) {
  if (draft.eligibility.status === "blocked_suppressed") {
    throw new Error(
      draft.eligibility.reasons[0] ??
        "Contact is suppressed; Ano cannot stage an execution proposal.",
    );
  }
  if (proposalType === "email_send" && !draft.eligibility.canProposeEmailSend) {
    throw new Error(
      draft.eligibility.reasons[0] ??
        "Email send proposals require an eligible, verified email draft.",
    );
  }
  if (proposalType === "calendar_schedule" && !draft.eligibility.canProposeCalendarSchedule) {
    throw new Error(
      draft.eligibility.reasons[0] ??
        "Calendar invite proposals require a verified email recipient.",
    );
  }
  if (proposalType === "call_task" && !draft.eligibility.canProposeCallTask) {
    throw new Error("Call task proposal was blocked by contact suppression rules.");
  }
  if (
    (proposalType === "mercury_task" ||
      proposalType === "mercury_draft" ||
      proposalType === "mercury_update") &&
    !draft.eligibility.canProposeMercurySync
  ) {
    throw new Error("CRM proposal was blocked by contact suppression rules.");
  }
}

export function proposalSummaryFor(
  proposalType: ExecutionProposalType,
  draft: OutreachDraftView,
  scheduledFor?: string,
) {
  const recipient = draft.contactName ?? draft.accountName;
  if (proposalType === "email_send") {
    return `Send approved email v${draft.version} to ${recipient}${draft.contactEmail ? ` (${draft.contactEmail})` : ""}`;
  }
  if (proposalType === "calendar_schedule") {
    return `Schedule meeting with ${recipient}${scheduledFor ? ` for ${scheduledFor}` : ""}`;
  }
  if (proposalType === "call_task") {
    return `Create manual call task for ${draft.accountName} using approved call script v${draft.version}`;
  }
  if (proposalType === "mercury_task") {
    return `Stage CRM follow-up task for ${draft.accountName}`;
  }
  if (proposalType === "mercury_draft") {
    return `Stage CRM outreach draft v${draft.version} for ${recipient}`;
  }
  return `Propose CRM account context update for ${draft.accountName}`;
}

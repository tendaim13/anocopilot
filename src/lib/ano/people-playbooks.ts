import { z } from "zod";

import type { AccountCandidateDossier } from "./company-discovery";
import type { IndustryProfile, ResearchClaim } from "./market-synthesis";
import type { ResearchBrief } from "./research-conversation";

const shortText = z.string().trim().min(1).max(700);
const listText = z.string().trim().min(1).max(280);
const identifier = z.string().uuid();

export const buyerRoleRecommendationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  rationale: shortText,
  claimIds: z.array(identifier).max(12),
});
export type BuyerRoleRecommendation = z.infer<typeof buyerRoleRecommendationSchema>;

export const verificationStatusSchema = z.enum([
  "not_requested",
  "awaiting_approval",
  "running",
  "verified",
  "unverified",
  "requires_manual_review",
  "failed_safe",
]);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const verifiedContactDetailsSchema = z.object({
  email: z.string().trim().email().nullable(),
  emailQualification: z.string().trim().min(1).max(120).nullable(),
  phone: z.string().trim().min(1).max(80).nullable(),
  verifiedDomain: z.string().trim().min(1).max(200).nullable(),
  provider: z.literal("dropcontact"),
  verifiedAt: z.string().datetime(),
});
export type VerifiedContactDetails = z.infer<typeof verifiedContactDetailsSchema>;

export const contactCandidateViewSchema = z.object({
  id: identifier,
  conversationId: identifier,
  targetDecisionId: identifier,
  accountCandidateId: identifier,
  accountName: z.string().trim().min(1).max(200),
  accountDomain: z.string().trim().min(1).max(200).nullable(),
  personSearchId: identifier,
  sourceKey: z.string().trim().min(1).max(160),
  fullName: z.string().trim().min(1).max(180),
  firstName: z.string().trim().min(1).max(100).nullable(),
  lastName: z.string().trim().min(1).max(100).nullable(),
  title: z.string().trim().min(1).max(160).nullable(),
  seniority: z.string().trim().min(1).max(80).nullable(),
  department: z.string().trim().min(1).max(100).nullable(),
  location: z.string().trim().min(1).max(180).nullable(),
  linkedInUrl: z.string().trim().min(1).max(500).nullable(),
  roleRationale: shortText.nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  claimIds: z.array(identifier).max(12),
  selectedForVerification: z.boolean(),
  verificationStatus: verificationStatusSchema,
  verifiedDetails: verifiedContactDetailsSchema.nullable(),
  retrievedAt: z.string().datetime(),
  verifiedAt: z.string().datetime().nullable(),
});
export type ContactCandidateView = z.infer<typeof contactCandidateViewSchema>;

export const personSearchStatusSchema = z.enum([
  "awaiting_approval",
  "running",
  "completed",
  "requires_manual_review",
  "failed_safe",
]);
export type PersonSearchStatus = z.infer<typeof personSearchStatusSchema>;

export const personSearchViewSchema = z.object({
  id: identifier,
  conversationId: identifier,
  targetDecisionId: identifier,
  providerActionRequestId: identifier.nullable(),
  providerKey: z.literal("prospeo"),
  status: personSearchStatusSchema,
  shortlistedAccountIds: z.array(identifier).min(1).max(25),
  shortlistedAccountNames: z.array(z.string().trim().min(1).max(200)).min(1).max(25),
  roleRecommendations: z.array(buyerRoleRecommendationSchema).min(1).max(8),
  approvedRoles: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  providerFilters: z.record(z.string(), z.unknown()),
  maximumResults: z.literal(25),
  estimatedMaximumCredits: z.literal(1),
  estimateDetail: shortText,
  resultCount: z.number().int().min(0).nullable(),
  providerReceipt: z.record(z.string(), z.unknown()),
  failureMessage: shortText.nullable(),
  approvedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PersonSearchView = z.infer<typeof personSearchViewSchema>;

export const dropcontactPreviewPairSchema = z.object({
  contactId: identifier,
  fullName: z.string().trim().min(1).max(180),
  firstName: z.string().trim().min(1).max(100).nullable(),
  lastName: z.string().trim().min(1).max(100).nullable(),
  companyName: z.string().trim().min(1).max(200),
  website: z.string().trim().min(1).max(500).nullable(),
  fieldsSent: z.array(z.string().trim().min(1).max(60)).min(2).max(6),
});
export type DropcontactPreviewPair = z.infer<typeof dropcontactPreviewPairSchema>;

export const contactVerificationStatusSchema = z.enum([
  "awaiting_approval",
  "running",
  "completed",
  "requires_manual_review",
  "failed_safe",
]);
export type ContactVerificationRunStatus = z.infer<typeof contactVerificationStatusSchema>;

export const contactVerificationRunViewSchema = z.object({
  id: identifier,
  conversationId: identifier,
  personSearchId: identifier,
  providerActionRequestId: identifier.nullable(),
  providerKey: z.literal("dropcontact"),
  status: contactVerificationStatusSchema,
  selectedContactIds: z.array(identifier).min(1).max(10),
  previewPairs: z.array(dropcontactPreviewPairSchema).min(1).max(10),
  estimatedCredits: z.number().int().min(1).max(10),
  estimateDetail: shortText,
  verifiedCount: z.number().int().min(0).nullable(),
  providerReceipt: z.record(z.string(), z.unknown()),
  failureMessage: shortText.nullable(),
  approvedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContactVerificationRunView = z.infer<typeof contactVerificationRunViewSchema>;

export const evidencePointKindSchema = z.enum([
  "research_claim",
  "company_signal",
  "contact_record",
]);
export type EvidencePointKind = z.infer<typeof evidencePointKindSchema>;

export const playbookEvidencePointSchema = z.object({
  kind: evidencePointKindSchema,
  refId: z.string().trim().min(1).max(160),
  statement: shortText,
  attribution: z.string().trim().min(1).max(140),
});
export type PlaybookEvidencePoint = z.infer<typeof playbookEvidencePointSchema>;

export const buyerPlaybookAngleSchema = z.object({
  contactId: identifier.nullable(),
  personName: z.string().trim().min(1).max(180).nullable(),
  roleTitle: z.string().trim().min(1).max(140),
  contactProvenance: z.enum(["verified_contact", "named_unverified", "role_hypothesis"]),
  openingAngle: shortText,
  valueHypothesis: shortText,
});
export type BuyerPlaybookAngle = z.infer<typeof buyerPlaybookAngleSchema>;

export const accountPlaybookViewSchema = z.object({
  id: identifier,
  conversationId: identifier,
  targetDecisionId: identifier,
  accountCandidateId: identifier,
  accountName: z.string().trim().min(1).max(200),
  targetMarketName: z.string().trim().min(1).max(160),
  targetIndustryName: z.string().trim().min(1).max(160),
  status: z.enum(["draft", "ready", "approved"]),
  headline: z.string().trim().min(1).max(240),
  accountThesis: z.string().trim().min(1).max(1_200),
  industryContext: z.string().trim().min(1).max(1_200),
  selectedContactIds: z.array(identifier).max(10),
  claimIds: z.array(identifier).max(16),
  signalIds: z.array(z.string().trim().min(1).max(160)).max(16),
  buyerAngles: z.array(buyerPlaybookAngleSchema).min(1).max(8),
  evidenceBackedPoints: z.array(playbookEvidencePointSchema).min(1).max(16),
  validationQuestions: z.array(listText).min(1).max(6),
  unknowns: z.array(listText).min(1).max(8),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AccountPlaybookView = z.infer<typeof accountPlaybookViewSchema>;

export const peopleDiscoveryViewSchema = z.object({
  shortlistedCount: z.number().int().min(0),
  personSearch: personSearchViewSchema.nullable(),
  contacts: z.array(contactCandidateViewSchema).max(25),
  verificationRun: contactVerificationRunViewSchema.nullable(),
  playbooks: z.array(accountPlaybookViewSchema).max(25),
});
export type PeopleDiscoveryView = z.infer<typeof peopleDiscoveryViewSchema>;

export const workspaceContactDirectoryItemSchema = contactCandidateViewSchema.extend({
  conversationTitle: z.string().trim().min(1).max(160),
  targetMarketName: z.string().trim().min(1).max(160),
  targetIndustryName: z.string().trim().min(1).max(160),
});
export type WorkspaceContactDirectoryItem = z.infer<
  typeof workspaceContactDirectoryItemSchema
>;

export const workspacePlaybookDirectoryItemSchema = accountPlaybookViewSchema.extend({
  conversationTitle: z.string().trim().min(1).max(160),
});
export type WorkspacePlaybookDirectoryItem = z.infer<
  typeof workspacePlaybookDirectoryItemSchema
>;

export const peopleDiscoveryActionInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose_roles"),
    roleOverrides: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  }),
  z.object({
    action: z.literal("approve_person_search"),
    personSearchId: identifier,
  }),
  z.object({
    action: z.literal("prepare_verification"),
    contactIds: z.array(identifier).min(1).max(10),
  }),
  z.object({
    action: z.literal("approve_verification"),
    verificationRunId: identifier,
  }),
  z.object({
    action: z.literal("generate_playbooks"),
  }),
]);
export type PeopleDiscoveryActionInput = z.infer<typeof peopleDiscoveryActionInputSchema>;

export type DropcontactProviderState = {
  provider: "dropcontact";
  available: boolean;
  pricingNote: string;
};

export type NormalizedProspeoPersonInput = {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  seniority?: string;
  department?: string;
  linkedInUrl?: string;
  location?: string;
  companyId?: string;
  companyName?: string;
  companyDomain?: string;
};

function cleanUnique(values: string[], limit: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of values) {
    const normalized = item.trim().replace(/\s+/g, " ");
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

export function deriveBuyerRoleRecommendations(
  industry: IndustryProfile,
  brief: ResearchBrief | null,
  roleOverrides?: string[],
): BuyerRoleRecommendation[] {
  const roles = cleanUnique(
    roleOverrides && roleOverrides.length > 0
      ? roleOverrides
      : [
          ...industry.buyerRoleHypotheses,
          ...(brief?.buyerHints ?? []),
        ],
    6,
  );

  const fallbackRoles = roles.length > 0 ? roles : ["Managing Director", "Operations Manager"];
  const problemSummary =
    industry.operationalProblems[0] ??
    `Operational challenges noted for ${industry.name}`;

  return fallbackRoles.map((title) =>
    buyerRoleRecommendationSchema.parse({
      title,
      rationale: `Proposed buyer persona for ${industry.name} based on Phase C research: ${problemSummary}`,
      claimIds: industry.claimIds,
    }),
  );
}

export function buildPersonSearchPreview(input: {
  personSearchId: string;
  conversationId: string;
  targetDecisionId: string;
  shortlistedAccounts: AccountCandidateDossier[];
  roleRecommendations: BuyerRoleRecommendation[];
  nowIso?: string;
}): PersonSearchView {
  if (input.shortlistedAccounts.length === 0) {
    throw new Error(
      "Shortlist at least one discovered company before proposing buyer roles or preparing a Prospeo person search.",
    );
  }
  if (input.roleRecommendations.length === 0) {
    throw new Error("At least one buyer role criterion is required before preparing a person search.");
  }

  const now = input.nowIso ?? new Date().toISOString();
  const approvedRoles = input.roleRecommendations.map((item) => item.title);
  const domains = cleanUnique(
    input.shortlistedAccounts
      .map((item) => item.domain ?? "")
      .filter(Boolean),
    25,
  );
  const companyNames = cleanUnique(
    input.shortlistedAccounts.map((item) => item.name),
    25,
  );

  const companyFilter: Record<string, unknown> =
    domains.length > 0
      ? { company_websites: { include: domains } }
      : { company_names: { include: companyNames } };

  const providerFilters: Record<string, unknown> = {
    company: companyFilter,
    person_job_title: { include: approvedRoles },
  };

  return personSearchViewSchema.parse({
    id: input.personSearchId,
    conversationId: input.conversationId,
    targetDecisionId: input.targetDecisionId,
    providerActionRequestId: null,
    providerKey: "prospeo",
    status: "awaiting_approval",
    shortlistedAccountIds: input.shortlistedAccounts.map((item) => item.id),
    shortlistedAccountNames: companyNames,
    roleRecommendations: input.roleRecommendations,
    approvedRoles,
    providerFilters,
    maximumResults: 25,
    estimatedMaximumCredits: 1,
    estimateDetail:
      "One first-page Prospeo person search returns up to 25 named people across your shortlisted companies (max 1 credit). Verified contact details require a separate selective Dropcontact approval.",
    resultCount: null,
    providerReceipt: {
      shortlisted_company_count: input.shortlistedAccounts.length,
      approved_role_count: approvedRoles.length,
      credit_bearing_request: false,
    },
    failureMessage: null,
    approvedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

export function matchAccountForPerson(
  person: NormalizedProspeoPersonInput,
  shortlistedAccounts: AccountCandidateDossier[],
): AccountCandidateDossier | null {
  if (person.companyId) {
    const bySource = shortlistedAccounts.find(
      (account) => account.sourceKey === `prospeo:${person.companyId}`,
    );
    if (bySource) return bySource;
  }
  const personDomain = person.companyDomain?.trim().toLowerCase();
  if (personDomain) {
    const byDomain = shortlistedAccounts.find(
      (account) => account.domain?.trim().toLowerCase() === personDomain,
    );
    if (byDomain) return byDomain;
  }
  const personCompany = person.companyName?.trim().toLowerCase();
  if (personCompany) {
    const byName = shortlistedAccounts.find((account) => {
      const target = account.name.trim().toLowerCase();
      return target === personCompany || target.includes(personCompany) || personCompany.includes(target);
    });
    if (byName) return byName;
  }
  return shortlistedAccounts[0] ?? null;
}

export function normalizeDiscoveredPersonCandidate(
  person: NormalizedProspeoPersonInput,
  context: {
    candidateId: string;
    conversationId: string;
    targetDecisionId: string;
    personSearchId: string;
    account: AccountCandidateDossier;
    roleRecommendations: BuyerRoleRecommendation[];
    capturedAt: string;
  },
): ContactCandidateView {
  const titleLower = (person.title ?? "").toLowerCase();
  const matchedRole = context.roleRecommendations.find((role) =>
    role.title
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.length >= 3 && titleLower.includes(word)),
  );

  const confidence: ContactCandidateView["confidence"] =
    matchedRole && person.linkedInUrl
      ? "high"
      : person.title
        ? "medium"
        : "low";

  return contactCandidateViewSchema.parse({
    id: context.candidateId,
    conversationId: context.conversationId,
    targetDecisionId: context.targetDecisionId,
    accountCandidateId: context.account.id,
    accountName: context.account.name,
    accountDomain: context.account.domain,
    personSearchId: context.personSearchId,
    sourceKey: `prospeo-person:${person.id}`,
    fullName: person.fullName,
    firstName: person.firstName?.trim() || null,
    lastName: person.lastName?.trim() || null,
    title: person.title?.trim() || null,
    seniority: person.seniority?.trim() || null,
    department: person.department?.trim() || null,
    location: person.location?.trim() || null,
    linkedInUrl: person.linkedInUrl?.trim() || null,
    roleRationale:
      matchedRole?.rationale ??
      (person.title
        ? `Returned by Prospeo person search at shortlisted company ${context.account.name}.`
        : null),
    confidence,
    claimIds: context.account.claimIds,
    selectedForVerification: false,
    verificationStatus: "not_requested",
    verifiedDetails: null,
    retrievedAt: context.capturedAt,
    verifiedAt: null,
  });
}

export function buildDropcontactVerificationPreview(input: {
  verificationRunId: string;
  conversationId: string;
  personSearchId: string;
  selectedContacts: ContactCandidateView[];
  nowIso?: string;
}): ContactVerificationRunView {
  if (input.selectedContacts.length === 0) {
    throw new Error(
      "Select at least one named person before preparing a Dropcontact verification preview.",
    );
  }
  if (input.selectedContacts.length > 10) {
    throw new Error(
      "Select at most 10 people per selective Dropcontact verification batch.",
    );
  }

  const now = input.nowIso ?? new Date().toISOString();
  const previewPairs: DropcontactPreviewPair[] = input.selectedContacts.map((contact) => {
    const website = contact.accountDomain ? `https://${contact.accountDomain}` : null;
    const fieldsSent = [
      ...(contact.firstName ? ["first_name"] : []),
      ...(contact.lastName ? ["last_name"] : []),
      "full_name",
      "company",
      ...(website ? ["website"] : []),
    ];
    return dropcontactPreviewPairSchema.parse({
      contactId: contact.id,
      fullName: contact.fullName,
      firstName: contact.firstName,
      lastName: contact.lastName,
      companyName: contact.accountName,
      website,
      fieldsSent,
    });
  });

  return contactVerificationRunViewSchema.parse({
    id: input.verificationRunId,
    conversationId: input.conversationId,
    personSearchId: input.personSearchId,
    providerActionRequestId: null,
    providerKey: "dropcontact",
    status: "awaiting_approval",
    selectedContactIds: input.selectedContacts.map((item) => item.id),
    previewPairs,
    estimatedCredits: previewPairs.length,
    estimateDetail: `Dropcontact will check ${previewPairs.length} selected name-and-company pair${previewPairs.length === 1 ? "" : "s"} (estimated ${previewPairs.length} Dropcontact credit${previewPairs.length === 1 ? "" : "s"}). No other discovered contacts are submitted.`,
    verifiedCount: null,
    providerReceipt: {
      selected_count: previewPairs.length,
      credit_bearing_request: false,
    },
    failureMessage: null,
    approvedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

export function compileFactualAccountPlaybook(input: {
  playbookId: string;
  conversationId: string;
  targetDecisionId: string;
  account: AccountCandidateDossier;
  targetMarketName: string;
  industry: IndustryProfile;
  claims: ResearchClaim[];
  contacts: ContactCandidateView[];
  offerSummary?: string;
  nowIso?: string;
}): AccountPlaybookView {
  const now = input.nowIso ?? new Date().toISOString();
  const { account, industry } = input;
  const relevantClaims = input.claims.filter((claim) => account.claimIds.includes(claim.id));

  const evidenceBackedPoints: PlaybookEvidencePoint[] = [];

  for (const signal of account.signals.slice(0, 5)) {
    evidenceBackedPoints.push({
      kind: "company_signal",
      refId: signal.id,
      statement: signal.explanation,
      attribution: signal.sourceAttribution,
    });
  }

  for (const claim of relevantClaims.slice(0, 6)) {
    evidenceBackedPoints.push({
      kind: "research_claim",
      refId: claim.id,
      statement: claim.statement,
      attribution: `Phase C ${claim.kind}`,
    });
  }

  const accountContacts = input.contacts.filter(
    (contact) => contact.accountCandidateId === account.id,
  );

  for (const contact of accountContacts.slice(0, 6)) {
    evidenceBackedPoints.push({
      kind: "contact_record",
      refId: contact.id,
      statement:
        contact.verificationStatus === "verified" && contact.verifiedDetails?.email
          ? `${contact.fullName}${contact.title ? ` (${contact.title})` : ""} — verified email ${contact.verifiedDetails.email} via Dropcontact.`
          : `${contact.fullName}${contact.title ? ` (${contact.title})` : ""} — named via Prospeo; contact details not yet verified.`,
      attribution:
        contact.verificationStatus === "verified"
          ? "Prospeo + Dropcontact"
          : "Prospeo person search",
    });
  }

  if (evidenceBackedPoints.length === 0) {
    evidenceBackedPoints.push({
      kind: "company_signal",
      refId: `${account.id}:shortlisted`,
      statement: `${account.name} was shortlisted from Prospeo results in ${input.targetMarketName}.`,
      attribution: "Prospeo company search",
    });
  }

  const buyerAngles: BuyerPlaybookAngle[] =
    accountContacts.length > 0
      ? accountContacts.slice(0, 5).map((contact) => ({
          contactId: contact.id,
          personName: contact.fullName,
          roleTitle: contact.title ?? "Decision maker",
          contactProvenance:
            contact.verificationStatus === "verified"
              ? ("verified_contact" as const)
              : ("named_unverified" as const),
          openingAngle: `Anchor first contact around observed company context (${account.location ?? input.targetMarketName}${account.industry ? `, ${account.industry}` : ""}) without assuming unverified internal workflows.`,
          valueHypothesis:
            industry.solutionFit[0] ??
            `Validate fit of ${input.offerSummary ?? "your offer"} against ${industry.operationalProblems[0] ?? "team workflow bottlenecks"}.`,
        }))
      : [
          {
            contactId: null,
            personName: null,
            roleTitle: industry.buyerRoleHypotheses[0] ?? "Operations leader",
            contactProvenance: "role_hypothesis",
            openingAngle: `No named people saved yet for ${account.name}. Start outreach planning by validating role ownership in ${industry.name}.`,
            valueHypothesis:
              industry.solutionFit[0] ??
              `Test workflow fit for ${industry.operationalProblems[0] ?? "core operational friction"}.`,
          },
        ];

  const validationQuestions = cleanUnique(
    [
      ...industry.operationalProblems.map(
        (problem) => `How is ${account.name} currently handling ${problem.toLowerCase()}?`,
      ),
      ...industry.unknowns.map((unknown) => `Validate directly: ${unknown}`),
    ],
    6,
  );
  if (validationQuestions.length === 0) {
    validationQuestions.push(
      `Confirm whether ${account.name} experiences the workflow friction noted in ${industry.name} research.`,
    );
  }

  const unknowns = cleanUnique(
    [
      ...account.unknowns,
      ...(accountContacts.every((c) => c.verificationStatus !== "verified")
        ? ["No verified email address exists yet for contacts at this account until Dropcontact verification completes."]
        : []),
      "Industry operational problems from Phase C research remain hypotheses until confirmed on a first conversation.",
    ],
    8,
  );

  return accountPlaybookViewSchema.parse({
    id: input.playbookId,
    conversationId: input.conversationId,
    targetDecisionId: input.targetDecisionId,
    accountCandidateId: account.id,
    accountName: account.name,
    targetMarketName: input.targetMarketName,
    targetIndustryName: industry.name,
    status: "ready",
    headline: `Outreach playbook for ${account.name} (${industry.name})`,
    accountThesis: `${account.name} scored ${account.fit.totalScore}/100 (${account.fit.confidence} fit) based on ${account.signals.length} Prospeo company signal${account.signals.length === 1 ? "" : "s"}. Outreach remains gated until Phase 8 draft & approval.`,
    industryContext: `${industry.summary} Operational hypothesis from ${relevantClaims.length} cited Phase C claim${relevantClaims.length === 1 ? "" : "s"}: ${industry.operationalProblems[0] ?? "segment fit under evaluation"}.`,
    selectedContactIds: accountContacts
      .filter((item) => item.selectedForVerification || item.verificationStatus === "verified")
      .map((item) => item.id),
    claimIds: relevantClaims.map((claim) => claim.id),
    signalIds: account.signals.map((signal) => signal.id),
    buyerAngles,
    evidenceBackedPoints,
    validationQuestions,
    unknowns,
    createdAt: now,
    updatedAt: now,
  });
}

import { z } from "zod";

import type { AccountCandidateDossier } from "./company-discovery";
import type { IndustryProfile, ResearchClaim } from "./market-synthesis";
import type { ResearchBrief } from "./research-conversation";

const shortText = z.string().trim().min(1).max(700);
const listText = z.string().trim().min(1).max(280);
const identifier = z.string().uuid();

export const personDiscoveryProviderSchema = z.enum(["website_team", "prospeo"]);
export type PersonDiscoveryProvider = z.infer<typeof personDiscoveryProviderSchema>;

export const companyArchetypeSchema = z.enum(["local_smb", "mid_market", "enterprise"]);
export type CompanyArchetype = z.infer<typeof companyArchetypeSchema>;

export const PROSPEO_SENIORITY_OPTIONS = [
  "Founder/Owner",
  "C-Suite",
  "Partner",
  "Vice President",
  "Head",
  "Director",
  "Manager",
  "Senior",
] as const;

export const PROSPEO_DEPARTMENT_OPTIONS = [
  "C-Suite",
  "Operations",
  "Medical & Health",
  "Finance",
  "Information Technology",
  "Engineering & Technical",
  "Sales",
  "Marketing",
  "Product",
  "Human Resources",
  "Legal",
  "Consulting",
  "Design",
  "Education & Coaching",
] as const;

export const buyingCommitteeCriteriaSchema = z.object({
  archetype: companyArchetypeSchema,
  departments: z.array(z.string().trim().min(1).max(80)).max(6).default([]),
  seniorities: z.array(z.string().trim().min(1).max(60)).max(6).default([]),
  includeTitles: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
  excludeTitles: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  rationale: z.string().trim().min(1).max(500).optional(),
});
export type BuyingCommitteeCriteria = z.infer<typeof buyingCommitteeCriteriaSchema>;

export const buyerRoleRecommendationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  rationale: shortText,
  claimIds: z.array(identifier).max(12),
  department: z.string().trim().min(1).max(80).optional(),
  seniority: z.string().trim().min(1).max(60).optional(),
  seat: z.enum(["economic_buyer", "champion", "technical_gatekeeper"]).optional(),
});
export type BuyerRoleRecommendation = z.infer<typeof buyerRoleRecommendationSchema>;

export const contactVerificationProviderSchema = z.enum(["prospeo", "dropcontact"]);
export type ContactVerificationProvider = z.infer<typeof contactVerificationProviderSchema>;

export const publicEmailKindSchema = z.enum(["direct_public", "shared_inbox"]);
export type PublicEmailKind = z.infer<typeof publicEmailKindSchema>;

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
  provider: contactVerificationProviderSchema,
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
  sourceUrl: z.string().trim().min(1).max(500).nullable().optional(),
  discoveryProvider: personDiscoveryProviderSchema.optional(),
  publicEmail: z.string().trim().email().nullable().optional(),
  publicEmailKind: publicEmailKindSchema.nullable().optional(),
  publicPhone: z.string().trim().min(1).max(80).nullable().optional(),
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
  providerKey: personDiscoveryProviderSchema,
  status: personSearchStatusSchema,
  shortlistedAccountIds: z.array(identifier).min(1).max(25),
  shortlistedAccountNames: z.array(z.string().trim().min(1).max(200)).min(1).max(25),
  roleRecommendations: z.array(buyerRoleRecommendationSchema).min(1).max(10),
  approvedRoles: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
  buyingCommittee: buyingCommitteeCriteriaSchema.optional(),
  providerFilters: z.record(z.string(), z.unknown()),
  maximumResults: z.literal(25),
  estimatedMaximumCredits: z.union([z.literal(0), z.literal(1)]),
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
  linkedInUrl: z.string().trim().min(1).max(500).nullable().optional(),
  prospeoPersonId: z.string().trim().min(1).max(160).nullable().optional(),
  fieldsSent: z.array(z.string().trim().min(1).max(60)).min(2).max(8),
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
  providerKey: contactVerificationProviderSchema,
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
    providerKey: personDiscoveryProviderSchema.optional(),
    roleOverrides: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    departments: z.array(z.string().trim().min(1).max(80)).max(6).optional(),
    seniorities: z.array(z.string().trim().min(1).max(60)).max(6).optional(),
    excludeTitles: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    archetype: companyArchetypeSchema.optional(),
  }),
  z.object({
    action: z.literal("run_free_people_search"),
    roleOverrides: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    departments: z.array(z.string().trim().min(1).max(80)).max(6).optional(),
    seniorities: z.array(z.string().trim().min(1).max(60)).max(6).optional(),
    excludeTitles: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
    archetype: companyArchetypeSchema.optional(),
  }),
  z.object({
    action: z.literal("approve_person_search"),
    personSearchId: identifier,
  }),
  z.object({
    action: z.literal("prepare_verification"),
    contactIds: z.array(identifier).min(1).max(10),
    providerKey: contactVerificationProviderSchema.optional(),
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
  sourceUrl?: string;
  providerKey?: PersonDiscoveryProvider;
  publicEmail?: string;
  publicEmailKind?: PublicEmailKind;
  publicPhone?: string;
  roleRationale?: string;
  location?: string;
  companyId?: string;
  companyName?: string;
  companyDomain?: string;
};
export type NormalizedDiscoveredPersonInput = NormalizedProspeoPersonInput;

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

export function inferCompanyArchetype(
  shortlistedAccounts: AccountCandidateDossier[],
  industryName: string,
): CompanyArchetype {
  if (shortlistedAccounts.length > 0) {
    const osmCount = shortlistedAccounts.filter((account) =>
      account.sourceKey.startsWith("openstreetmap:"),
    ).length;
    if (osmCount / shortlistedAccounts.length >= 0.5) {
      return "local_smb";
    }

    const enterpriseCount = shortlistedAccounts.filter(
      (account) => (account.employeeCount ?? 0) >= 500 || /501-|1001-|5001-|10001/i.test(account.employeeBand ?? ""),
    ).length;
    if (enterpriseCount / shortlistedAccounts.length > 0.5) {
      return "enterprise";
    }

    const smbCount = shortlistedAccounts.filter(
      (account) =>
        (account.employeeCount !== null && account.employeeCount <= 50) ||
        /^(1-10|11-50|2-10)$/i.test(account.employeeBand ?? ""),
    ).length;
    if (smbCount / shortlistedAccounts.length >= 0.5) {
      return "local_smb";
    }
  }

  if (
    /\b(dental|dentist|clinic|medical|veterinary|salon|restaurant|cafe|hospitality|retail|gym|fitness|physio|chiro|optometr|pharmacy|practice|law\s+firm|attorney|accounting|real\s+estate|agency|studio|contractor|plumbing|electrical|automotive|repair|bakery|barbershop|spa|tutoring)\b/i.test(
      industryName,
    )
  ) {
    return "local_smb";
  }

  return "mid_market";
}

export function recommendPersonDiscoveryProvider(
  shortlistedAccounts: AccountCandidateDossier[],
  industryName: string,
): PersonDiscoveryProvider {
  const archetype = inferCompanyArchetype(shortlistedAccounts, industryName);
  const hasWebsites = shortlistedAccounts.some(
    (account) => Boolean(account.website || account.domain),
  );
  if (archetype === "local_smb" && hasWebsites) {
    return "website_team";
  }
  return "prospeo";
}

function inferDefaultDepartments(
  industry: IndustryProfile,
  brief: ResearchBrief | null,
): string[] {
  const corpus = [
    industry.name,
    industry.summary,
    ...industry.solutionFit,
    ...industry.operationalProblems,
    brief?.offer ?? "",
    brief?.goal ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (/\b(dental|dentist|clinic|medical|health|patient|hospital|physio|ortho|chiro|veterinary|pharmacy)\b/.test(corpus)) {
    return ["Medical & Health", "Operations", "C-Suite"];
  }
  if (/\b(legal|law\s+firm|law\b|attorney|solicitor|compliance|litigation)\b/.test(corpus)) {
    return ["Legal", "Operations", "C-Suite"];
  }
  if (/\b(product\s+management|product\s+team|ux|user\s+research)\b/.test(corpus)) {
    return ["Product", "Engineering & Technical", "C-Suite"];
  }
  if (/\b(security|devops|cloud|api|engineering|developer|software|saas|it\b|infrastructure|cyber|data)\b/.test(corpus)) {
    return ["Engineering & Technical", "Information Technology", "C-Suite"];
  }
  if (/\b(finance|accounting|billing|invoice|payroll|tax|audit|cfo|treasury|erp|bookkeeping)\b/.test(corpus)) {
    return ["Finance", "Operations", "C-Suite"];
  }
  if (/\b(design|creative|architecture|architect|branding\s+agency|studio)\b/.test(corpus)) {
    return ["Design", "Marketing", "C-Suite"];
  }
  if (/\b(sales|outbound|crm|revenue|pipeline|lead|marketing|demand|growth|brand)\b/.test(corpus)) {
    return ["Sales", "Marketing", "C-Suite"];
  }
  if (/\b(hr|recruiting|talent|hiring|people\s+ops|onboarding|workforce)\b/.test(corpus)) {
    return ["Human Resources", "Operations", "C-Suite"];
  }
  if (/\b(education|training|coaching|school|university|academy|tutoring)\b/.test(corpus)) {
    return ["Education & Coaching", "Operations", "C-Suite"];
  }
  if (/\b(consulting|advisory|real\s+estate|brokerage|property)\b/.test(corpus)) {
    return ["Consulting", "Operations", "C-Suite"];
  }
  if (/\b(logistics|manufacturing|supply\s+chain|warehouse|construction|contractor|hospitality|restaurant|retail)\b/.test(corpus)) {
    return ["Operations", "C-Suite"];
  }
  return ["C-Suite", "Operations"];
}

export function inferDefaultSeniorities(archetype: CompanyArchetype): string[] {
  if (archetype === "local_smb") {
    return ["Founder/Owner", "Partner", "Manager", "C-Suite"];
  }
  if (archetype === "enterprise") {
    return ["Vice President", "Head", "Director", "C-Suite"];
  }
  return ["C-Suite", "Vice President", "Head", "Director"];
}

function inferDefaultExcludeTitles(industry: IndustryProfile, brief: ResearchBrief | null): string[] {
  const corpus = `${industry.name} ${brief?.offer ?? ""}`.toLowerCase();
  const base = ["Intern", "Student", "Assistant", "Receptionist", "Coordinator"];
  if (/\b(dental|dentist|clinic|medical|health|patient)\b/.test(corpus)) {
    return [...base, "Hygienist", "Dental Nurse"];
  }
  if (/\b(legal|law\s+firm|attorney|solicitor)\b/.test(corpus)) {
    return [...base, "Paralegal", "Legal Secretary"];
  }
  if (/\b(retail|hospitality|restaurant|cafe)\b/.test(corpus)) {
    return [...base, "Cashier", "Server", "Barista"];
  }
  return base;
}

const DEPARTMENT_DEFAULT_TITLES: Record<
  string,
  Record<CompanyArchetype, string[]>
> = {
  "Medical & Health": {
    local_smb: ["Clinic Director", "Practice Manager", "Founder", "Owner"],
    mid_market: ["Medical Director", "COO", "Head of Operations", "Practice Manager"],
    enterprise: ["Chief Medical Officer", "VP of Clinical Operations", "Director of Operations"],
  },
  Legal: {
    local_smb: ["Managing Partner", "Senior Partner", "Practice Manager"],
    mid_market: ["General Counsel", "Managing Partner", "Head of Legal", "COO"],
    enterprise: ["General Counsel", "VP of Legal", "Director of Compliance"],
  },
  Finance: {
    local_smb: ["Founder", "Managing Director", "Finance Manager", "Controller"],
    mid_market: ["CFO", "Finance Director", "Controller", "COO"],
    enterprise: ["CFO", "VP of Finance", "Corporate Controller"],
  },
  "Engineering & Technical": {
    local_smb: ["CTO", "Founder", "Technical Director"],
    mid_market: ["CTO", "VP of Engineering", "Head of IT", "COO"],
    enterprise: ["VP of Engineering", "CTO", "Director of Engineering", "CISO"],
  },
  "Information Technology": {
    local_smb: ["Founder", "CTO", "IT Manager"],
    mid_market: ["CTO", "Head of IT", "CIO", "VP of Engineering"],
    enterprise: ["CIO", "CISO", "VP of IT", "Director of Infrastructure"],
  },
  Sales: {
    local_smb: ["Founder", "Managing Director", "Sales Manager"],
    mid_market: ["VP of Sales", "Head of Growth", "CRO", "COO"],
    enterprise: ["CRO", "VP of Sales", "Director of Revenue Operations"],
  },
  Marketing: {
    local_smb: ["Founder", "Managing Director", "Marketing Manager"],
    mid_market: ["CMO", "Head of Growth", "VP of Marketing"],
    enterprise: ["CMO", "VP of Marketing", "Director of Demand Generation"],
  },
  "Human Resources": {
    local_smb: ["Founder", "Operations Manager", "HR Manager"],
    mid_market: ["Head of People", "HR Director", "COO"],
    enterprise: ["CHRO", "VP of People", "Director of Talent"],
  },
  Design: {
    local_smb: ["Creative Director", "Managing Director", "Founder", "Principal"],
    mid_market: ["Creative Director", "Head of Design", "VP of Brand", "COO"],
    enterprise: ["VP of Design", "Head of Design", "Creative Director"],
  },
  Product: {
    local_smb: ["Founder", "CTO", "Head of Product"],
    mid_market: ["VP of Product", "Head of Product", "CPO", "CTO"],
    enterprise: ["CPO", "VP of Product", "Director of Product Management"],
  },
  Operations: {
    local_smb: ["Founder", "Owner", "Managing Director", "Operations Manager"],
    mid_market: ["COO", "Operations Director", "General Manager", "Plant Manager"],
    enterprise: ["COO", "VP of Operations", "Director of Operations"],
  },
  Consulting: {
    local_smb: ["Managing Partner", "Founder", "Principal", "Director"],
    mid_market: ["Managing Partner", "Managing Director", "Practice Lead", "COO"],
    enterprise: ["Managing Director", "Senior Partner", "VP of Advisory"],
  },
  "Education & Coaching": {
    local_smb: ["Founder", "Director", "Principal", "Operations Manager"],
    mid_market: ["Dean", "Headmaster", "COO", "Director of Operations"],
    enterprise: ["Provost", "VP of Operations", "Director of Academic Programs"],
  },
};

export function deriveBuyingCommitteeCriteria(input: {
  industry: IndustryProfile;
  brief: ResearchBrief | null;
  shortlistedAccounts: AccountCandidateDossier[];
  overrides?: {
    archetype?: CompanyArchetype;
    departments?: string[];
    seniorities?: string[];
    includeTitles?: string[];
    roleOverrides?: string[];
    excludeTitles?: string[];
  };
}): BuyingCommitteeCriteria {
  const { industry, brief, shortlistedAccounts, overrides } = input;
  const archetype =
    overrides?.archetype ?? inferCompanyArchetype(shortlistedAccounts, industry.name);

  const rawInclude =
    overrides?.includeTitles && overrides.includeTitles.length > 0
      ? overrides.includeTitles
      : overrides?.roleOverrides && overrides.roleOverrides.length > 0
        ? overrides.roleOverrides
        : null;

  const departments = cleanUnique(
    overrides?.departments && overrides.departments.length > 0
      ? overrides.departments
      : inferDefaultDepartments(industry, brief),
    6,
  );

  const seniorities = cleanUnique(
    overrides?.seniorities && overrides.seniorities.length > 0
      ? overrides.seniorities
      : inferDefaultSeniorities(archetype),
    6,
  );

  const primaryDept = departments[0] ?? "Operations";
  const isDental = /\b(dental|dentist)\b/i.test(`${industry.name} ${brief?.offer ?? ""}`);
  const verticalDefaults = isDental && archetype === "local_smb"
    ? ["Principal Dentist", "Practice Manager", "Clinic Director", "Founder", "Owner"]
    : DEPARTMENT_DEFAULT_TITLES[primaryDept]?.[archetype] ??
      (archetype === "local_smb"
        ? ["Founder", "Owner", "Managing Director", "General Manager", "Operations Manager"]
        : ["CEO", "COO", "VP of Operations", "Operations Director"]);

  const includeTitles = cleanUnique(
    rawInclude ?? [
      ...industry.buyerRoleHypotheses,
      ...(brief?.buyerHints ?? []),
      ...verticalDefaults,
    ],
    10,
  );

  const excludeTitles = cleanUnique(
    overrides?.excludeTitles !== undefined
      ? overrides.excludeTitles
      : inferDefaultExcludeTitles(industry, brief),
    12,
  );

  const archetypeLabel =
    archetype === "local_smb"
      ? "local SMB"
      : archetype === "enterprise"
        ? "enterprise"
        : "mid-market";

  return buyingCommitteeCriteriaSchema.parse({
    archetype,
    departments,
    seniorities,
    includeTitles: includeTitles.length > 0 ? includeTitles : ["Managing Director", "Operations Manager"],
    excludeTitles,
    rationale: `Calibrated for ${archetypeLabel} ${industry.name} accounts: targets ${departments.join(", ")} at ${seniorities.join(", ")} seniority, excluding ${excludeTitles.slice(0, 4).join(", ") || "junior"} roles.`,
  });
}

function inferRoleMetadata(
  title: string,
  criteria?: BuyingCommitteeCriteria,
): {
  department?: string;
  seniority?: string;
  seat?: "economic_buyer" | "champion" | "technical_gatekeeper";
} {
  const lower = title.toLowerCase();
  const seat: "economic_buyer" | "champion" | "technical_gatekeeper" =
    /\b(cto|cio|it |security|engineering|technical)\b/.test(lower)
      ? "technical_gatekeeper"
      : /\b(ceo|cfo|coo|founder|owner|managing director|partner|principal|president|vp)\b/.test(lower)
        ? "economic_buyer"
        : "champion";

  const seniority =
    /\b(founder|owner|proprietor)\b/.test(lower)
      ? "Founder/Owner"
      : /\b(ceo|coo|cto|cfo|cmo|cio|chief)\b/.test(lower)
        ? "C-Suite"
        : /\b(partner)\b/.test(lower)
          ? "Partner"
          : /\b(vp|vice president)\b/.test(lower)
            ? "Vice President"
            : /\b(head)\b/.test(lower)
              ? "Head"
              : /\b(director|principal)\b/.test(lower)
                ? "Director"
                : /\b(manager)\b/.test(lower)
                  ? "Manager"
                  : criteria?.seniorities[0];

  const department =
    /\b(dentist|clinical|medical|doctor|practice|clinic|health)\b/.test(lower)
      ? "Medical & Health"
      : /\b(legal|general counsel|attorney|lawyer|solicitor|compliance)\b/.test(lower)
        ? "Legal"
        : /\b(product|cpo|ux )\b/.test(lower)
          ? "Product"
          : /\b(design|creative|art director|architect)\b/.test(lower)
            ? "Design"
            : /\b(human resources|chro|people|talent|recruiting|hr )\b/.test(lower)
              ? "Human Resources"
              : /\b(education|dean|headmaster|faculty|training|coaching)\b/.test(lower)
                ? "Education & Coaching"
                : /\b(consult|advis|broker)\b/.test(lower)
                  ? "Consulting"
                  : /\b(cto|engineering|developer|software|technical)\b/.test(lower)
                    ? "Engineering & Technical"
                    : /\b(cio|it |information technology|security)\b/.test(lower)
                      ? "Information Technology"
                      : /\b(cfo|finance|accounting|controller|billing)\b/.test(lower)
                        ? "Finance"
                        : /\b(sales|revenue|business development|cro)\b/.test(lower)
                          ? "Sales"
                          : /\b(marketing|growth|cmo|brand)\b/.test(lower)
                            ? "Marketing"
                            : /\b(operations|coo|practice manager|general manager|plant manager)\b/.test(lower)
                              ? "Operations"
                              : criteria?.departments[0] ?? "C-Suite";

  return { department, seniority, seat };
}

export function deriveBuyerRoleRecommendations(
  industry: IndustryProfile,
  brief: ResearchBrief | null,
  roleOverrides?: string[],
  criteria?: BuyingCommitteeCriteria,
): BuyerRoleRecommendation[] {
  const roles = cleanUnique(
    roleOverrides && roleOverrides.length > 0
      ? roleOverrides
      : criteria?.includeTitles && criteria.includeTitles.length > 0
        ? criteria.includeTitles
        : [
            ...industry.buyerRoleHypotheses,
            ...(brief?.buyerHints ?? []),
          ],
    10,
  );

  const fallbackRoles = roles.length > 0 ? roles : ["Managing Director", "Operations Manager"];
  const problemSummary =
    industry.operationalProblems[0] ??
    `Operational challenges noted for ${industry.name}`;

  return fallbackRoles.map((title) => {
    const meta = inferRoleMetadata(title, criteria);
    return buyerRoleRecommendationSchema.parse({
      title,
      rationale: `Proposed ${meta.seat?.replaceAll("_", " ") ?? "buyer"} persona for ${industry.name}: ${problemSummary}`,
      claimIds: industry.claimIds,
      department: meta.department,
      seniority: meta.seniority,
      seat: meta.seat,
    });
  });
}

export function buildPersonSearchPreview(input: {
  personSearchId: string;
  conversationId: string;
  targetDecisionId: string;
  shortlistedAccounts: AccountCandidateDossier[];
  roleRecommendations: BuyerRoleRecommendation[];
  providerKey?: PersonDiscoveryProvider;
  buyingCommittee?: BuyingCommitteeCriteria;
  nowIso?: string;
}): PersonSearchView {
  if (input.shortlistedAccounts.length === 0) {
    throw new Error(
      "Shortlist at least one discovered company before proposing buyer roles or preparing a person search.",
    );
  }
  if (input.roleRecommendations.length === 0) {
    throw new Error("At least one buyer role criterion is required before preparing a person search.");
  }

  const now = input.nowIso ?? new Date().toISOString();
  const providerKey: PersonDiscoveryProvider = input.providerKey ?? "prospeo";
  const approvedRoles = input.roleRecommendations.map((item) => item.title);
  const domains = cleanUnique(
    input.shortlistedAccounts
      .map((item) => item.domain ?? "")
      .filter(Boolean),
    25,
  );
  const targetWebsites = cleanUnique(
    input.shortlistedAccounts
      .map((item) => item.website ?? (item.domain ? `https://${item.domain}` : ""))
      .filter(Boolean),
    10,
  );
  const companyNames = cleanUnique(
    input.shortlistedAccounts.map((item) => item.name),
    25,
  );

  const committee = input.buyingCommittee;
  const excludeTitles = committee?.excludeTitles ?? [];

  let providerFilters: Record<string, unknown>;
  if (providerKey === "website_team") {
    providerFilters = {
      source: "website_team",
      target_websites: targetWebsites,
      max_pages_per_company: 3,
      max_people: 25,
      ...(committee ? { buying_committee: committee } : {}),
    };
  } else {
    // Matches Prospeo /search-person JSON contract: company.websites / company.names
    const companyFilter: Record<string, unknown> =
      domains.length > 0
        ? { websites: { include: domains } }
        : { names: { include: companyNames } };

    providerFilters = {
      company: companyFilter,
      ...(committee?.seniorities.length
        ? { person_seniority: { include: committee.seniorities } }
        : {}),
      ...(committee?.departments.length
        ? { person_department: { include: committee.departments } }
        : {}),
      person_job_title: {
        include: approvedRoles,
        ...(excludeTitles.length > 0 ? { exclude: excludeTitles } : {}),
      },
    };
  }

  const estimatedMaximumCredits = providerKey === "website_team" ? 0 : 1;
  const estimateDetail =
    providerKey === "website_team"
      ? "Free website team-page discovery scans up to 10 shortlisted company websites (max 3 pages per site, $0 credits) to extract named owners, directors, and managers with cited source URLs. Email verification remains separate via Dropcontact."
      : "One first-page Prospeo /search-person request returns up to 25 named buyers matching your Buying Committee filters across shortlisted companies (max 1 credit). Verified contact details require a separate selective Dropcontact approval.";

  return personSearchViewSchema.parse({
    id: input.personSearchId,
    conversationId: input.conversationId,
    targetDecisionId: input.targetDecisionId,
    providerActionRequestId: null,
    providerKey,
    status: "awaiting_approval",
    shortlistedAccountIds: input.shortlistedAccounts.map((item) => item.id),
    shortlistedAccountNames: companyNames,
    roleRecommendations: input.roleRecommendations,
    approvedRoles,
    buyingCommittee: committee,
    providerFilters,
    maximumResults: 25,
    estimatedMaximumCredits,
    estimateDetail,
    resultCount: null,
    providerReceipt: {
      shortlisted_company_count: input.shortlistedAccounts.length,
      approved_role_count: approvedRoles.length,
      ...(committee ? { buying_committee: committee } : {}),
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
    providerKey?: PersonDiscoveryProvider;
    capturedAt: string;
  },
): ContactCandidateView {
  const providerKey: PersonDiscoveryProvider = person.providerKey ?? context.providerKey ?? "prospeo";
  const titleLower = (person.title ?? "").toLowerCase();
  const matchedRole = context.roleRecommendations.find((role) =>
    role.title
      .toLowerCase()
      .split(/\s+/)
      .some((word) => word.length >= 3 && titleLower.includes(word)),
  );

  const confidence: ContactCandidateView["confidence"] =
    matchedRole && (person.linkedInUrl || person.sourceUrl)
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
    sourceKey:
      providerKey === "website_team"
        ? `website-team:${person.id}`
        : `prospeo-person:${person.id}`,
    fullName: person.fullName,
    firstName: person.firstName?.trim() || null,
    lastName: person.lastName?.trim() || null,
    title: person.title?.trim() || null,
    seniority: person.seniority?.trim() || null,
    department: person.department?.trim() || null,
    location: person.location?.trim() || null,
    linkedInUrl: person.linkedInUrl?.trim() || null,
    sourceUrl: person.sourceUrl?.trim() || null,
    discoveryProvider: providerKey,
    publicEmail: person.publicEmail?.trim().toLowerCase() || null,
    publicEmailKind: person.publicEmail ? person.publicEmailKind ?? "shared_inbox" : null,
    publicPhone: person.publicPhone?.trim() || null,
    roleRationale:
      person.roleRationale?.trim() ||
      matchedRole?.rationale ||
      (person.title
        ? providerKey === "website_team"
          ? `Extracted directly from ${context.account.name}'s public website.`
          : `Returned by Prospeo person search at shortlisted company ${context.account.name}.`
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

export type PeopleCohortRow = {
  id: string;
  fullName: string;
  title: string;
  department: string;
  seniority: string;
  accountName: string;
  accountDomain: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  linkedInUrl: string | null;
  confidence: ContactCandidateView["confidence"];
  verificationStatus: VerificationStatus;
  verifiedEmail: string | null;
  publicEmail: string | null;
  publicEmailKind: PublicEmailKind | null;
  publicPhone: string | null;
  bestEmail: string | null;
  emailSourceLabel: string;
  selectedForVerification: boolean;
};

export function formatContactForCohortTable(contact: ContactCandidateView): PeopleCohortRow {
  const isWebsite =
    contact.discoveryProvider === "website_team" ||
    contact.sourceKey.startsWith("website-team:");
  const verifiedEmail = contact.verifiedDetails?.email ?? null;
  const publicEmail = contact.publicEmail ?? null;
  const bestEmail = verifiedEmail ?? publicEmail;
  const emailSourceLabel = verifiedEmail
    ? contact.verifiedDetails?.provider === "prospeo"
      ? "Prospeo verified"
      : "Dropcontact verified"
    : publicEmail
      ? contact.publicEmailKind === "direct_public"
        ? "Website (direct)"
        : "Website (office inbox)"
      : "No email yet";

  return {
    id: contact.id,
    fullName: contact.fullName,
    title: contact.title ?? "Role unspecified",
    department: contact.department ?? "General",
    seniority: contact.seniority ?? "Leadership",
    accountName: contact.accountName,
    accountDomain: contact.accountDomain,
    sourceLabel: isWebsite ? "Company website" : "Prospeo",
    sourceUrl: contact.sourceUrl ?? null,
    linkedInUrl: contact.linkedInUrl ?? null,
    confidence: contact.confidence,
    verificationStatus: contact.verificationStatus,
    verifiedEmail,
    publicEmail,
    publicEmailKind: contact.publicEmailKind ?? null,
    publicPhone: contact.publicPhone ?? null,
    bestEmail,
    emailSourceLabel,
    selectedForVerification: contact.selectedForVerification,
  };
}

export function buildDropcontactVerificationPreview(input: {
  verificationRunId: string;
  conversationId: string;
  personSearchId: string;
  selectedContacts: ContactCandidateView[];
  providerKey?: ContactVerificationProvider;
  nowIso?: string;
}): ContactVerificationRunView {
  const providerKey: ContactVerificationProvider = input.providerKey ?? "dropcontact";
  if (input.selectedContacts.length === 0) {
    throw new Error(
      `Select at least one named person before preparing a ${providerKey === "prospeo" ? "Prospeo" : "Dropcontact"} verification preview.`,
    );
  }
  if (input.selectedContacts.length > 10) {
    throw new Error(
      `Select at most 10 people per selective ${providerKey === "prospeo" ? "Prospeo" : "Dropcontact"} enrichment batch.`,
    );
  }

  const now = input.nowIso ?? new Date().toISOString();
  const previewPairs: DropcontactPreviewPair[] = input.selectedContacts.map((contact) => {
    const website = contact.accountDomain ? `https://${contact.accountDomain}` : null;
    const prospeoPersonId = contact.sourceKey.startsWith("prospeo-person:")
      ? contact.sourceKey.slice("prospeo-person:".length)
      : null;
    const fieldsSent = [
      ...(contact.firstName ? ["first_name"] : []),
      ...(contact.lastName ? ["last_name"] : []),
      "full_name",
      "company",
      ...(website ? ["website"] : []),
      ...(providerKey === "prospeo" && contact.linkedInUrl ? ["linkedin_url"] : []),
      ...(providerKey === "prospeo" && prospeoPersonId ? ["person_id"] : []),
    ];
    return dropcontactPreviewPairSchema.parse({
      contactId: contact.id,
      fullName: contact.fullName,
      firstName: contact.firstName,
      lastName: contact.lastName,
      companyName: contact.accountName,
      website,
      linkedInUrl: contact.linkedInUrl,
      prospeoPersonId,
      fieldsSent,
    });
  });

  const estimateDetail =
    providerKey === "prospeo"
      ? `Prospeo will enrich ${previewPairs.length} selected contact${previewPairs.length === 1 ? "" : "s"} for verified work emails (max ${previewPairs.length} credit${previewPairs.length === 1 ? "" : "s"}; 0 credits on misses or 90-day repeats). No other contacts are submitted.`
      : `Dropcontact will check ${previewPairs.length} selected name-and-company pair${previewPairs.length === 1 ? "" : "s"} (estimated ${previewPairs.length} Dropcontact credit${previewPairs.length === 1 ? "" : "s"}). No other discovered contacts are submitted.`;

  return contactVerificationRunViewSchema.parse({
    id: input.verificationRunId,
    conversationId: input.conversationId,
    personSearchId: input.personSearchId,
    providerActionRequestId: null,
    providerKey,
    status: "awaiting_approval",
    selectedContactIds: input.selectedContacts.map((item) => item.id),
    previewPairs,
    estimatedCredits: previewPairs.length,
    estimateDetail,
    verifiedCount: null,
    providerReceipt: {
      provider: providerKey,
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

export const buildContactVerificationPreview = buildDropcontactVerificationPreview;

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
    const isWebsiteSource =
      contact.discoveryProvider === "website_team" ||
      contact.sourceKey.startsWith("website-team:");
    const sourceLabel = isWebsiteSource ? "Company website" : "Prospeo";
    const verifyProviderLabel =
      contact.verifiedDetails?.provider === "prospeo" ? "Prospeo" : "Dropcontact";
    evidenceBackedPoints.push({
      kind: "contact_record",
      refId: contact.id,
      statement:
        contact.verificationStatus === "verified" && contact.verifiedDetails?.email
          ? `${contact.fullName}${contact.title ? ` (${contact.title})` : ""} — verified email ${contact.verifiedDetails.email} via ${verifyProviderLabel}.`
          : contact.publicEmail
            ? `${contact.fullName}${contact.title ? ` (${contact.title})` : ""} — named via ${sourceLabel}; public website email ${contact.publicEmail} (${contact.publicEmailKind === "direct_public" ? "direct" : "office inbox"}) unverified.`
            : `${contact.fullName}${contact.title ? ` (${contact.title})` : ""} — named via ${sourceLabel}; contact details not yet verified.`,
      attribution:
        contact.verificationStatus === "verified"
          ? `${sourceLabel} + ${verifyProviderLabel}`
          : isWebsiteSource
            ? "Company website team extraction"
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
        ? [
            "No verified email address exists yet for contacts at this account until selective Prospeo or Dropcontact verification completes.",
          ]
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

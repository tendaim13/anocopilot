import { z } from "zod";

import type { AccountCandidateDossier } from "@/lib/ano/company-discovery";
import type { OutreachTemplatePackView } from "@/lib/ano/outreach-templates";
import type { ContactCandidateView } from "@/lib/ano/people-playbooks";

export const leadExportScopeSchema = z.enum(["with_email", "verified_only", "all"]);
export type LeadExportScope = z.infer<typeof leadExportScopeSchema>;

export const conversationExportFormatSchema = z.enum([
  "leads_csv",
  "templates_csv",
  "templates_md",
]);
export type ConversationExportFormat = z.infer<typeof conversationExportFormatSchema>;

export type LeadExportAccountContext = {
  name: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  location?: string | null;
  fitScore?: number | null;
  lifecycleState?: string | null;
};

export const LEADS_CSV_HEADERS = [
  "first_name",
  "last_name",
  "full_name",
  "email",
  "email_status",
  "email_source",
  "phone",
  "job_title",
  "department",
  "seniority",
  "company_name",
  "company_domain",
  "company_website",
  "company_specialisation",
  "city",
  "country",
  "linkedin_url",
  "source_url",
  "fit_score",
  "lead_status",
] as const;

export const TEMPLATES_CSV_HEADERS = [
  "step_number",
  "step_key",
  "step_label",
  "channel",
  "delay_days",
  "subject",
  "body",
  "word_count",
  "human_voice_passed",
] as const;

const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

export function formatCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (text.length > 0 && (FORMULA_PREFIX_REGEX.test(text) || FORMULA_PREFIX_REGEX.test(text.trimStart()))) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function sanitizeExportFilenameSlug(value: string, fallback = "leads"): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return cleaned || fallback;
}

export type LeadEmailProvenance = {
  email: string;
  emailStatus: "verified" | "unverified_public" | "missing";
  emailSource:
    | "prospeo_verified"
    | "dropcontact_verified"
    | "public_website_direct"
    | "public_website_shared_inbox"
    | "none";
  leadStatus: "verified" | "public_email" | "named_only";
};

export function resolveLeadEmailProvenance(contact: ContactCandidateView): LeadEmailProvenance {
  const verifiedEmail = contact.verifiedDetails?.email?.trim().toLowerCase() ?? "";
  if (contact.verificationStatus === "verified" && verifiedEmail) {
    return {
      email: verifiedEmail,
      emailStatus: "verified",
      emailSource:
        contact.verifiedDetails?.provider === "prospeo"
          ? "prospeo_verified"
          : "dropcontact_verified",
      leadStatus: "verified",
    };
  }

  const publicEmail = contact.publicEmail?.trim().toLowerCase() ?? "";
  if (publicEmail) {
    return {
      email: publicEmail,
      emailStatus: "unverified_public",
      emailSource:
        contact.publicEmailKind === "direct_public"
          ? "public_website_direct"
          : "public_website_shared_inbox",
      leadStatus: "public_email",
    };
  }

  return {
    email: "",
    emailStatus: "missing",
    emailSource: "none",
    leadStatus: "named_only",
  };
}

export function filterContactsByExportScope(
  contacts: ContactCandidateView[],
  scope: LeadExportScope,
): ContactCandidateView[] {
  if (scope === "all") return contacts;
  return contacts.filter((contact) => {
    const provenance = resolveLeadEmailProvenance(contact);
    if (scope === "verified_only") {
      return provenance.emailStatus === "verified";
    }
    return provenance.emailStatus === "verified" || provenance.emailStatus === "unverified_public";
  });
}

export type LeadExportReadinessSummary = {
  totalLeads: number;
  withEmailCount: number;
  verifiedEmailCount: number;
  publicEmailCount: number;
  templateStepsCount: number;
  templatesReady: boolean;
  cleanVoiceStepsCount: number;
};

export function summarizeLeadExportReadiness(
  contacts: ContactCandidateView[],
  templatePack?: OutreachTemplatePackView | null,
): LeadExportReadinessSummary {
  let verifiedEmailCount = 0;
  let publicEmailCount = 0;

  for (const contact of contacts) {
    const provenance = resolveLeadEmailProvenance(contact);
    if (provenance.emailStatus === "verified") verifiedEmailCount += 1;
    else if (provenance.emailStatus === "unverified_public") publicEmailCount += 1;
  }

  const steps = templatePack?.steps ?? [];
  return {
    totalLeads: contacts.length,
    withEmailCount: verifiedEmailCount + publicEmailCount,
    verifiedEmailCount,
    publicEmailCount,
    templateStepsCount: steps.length,
    templatesReady: steps.length > 0,
    cleanVoiceStepsCount: steps.filter((s) => s.lint.passed).length,
  };
}

function splitFirstAndLastName(contact: ContactCandidateView): {
  firstName: string;
  lastName: string;
} {
  const first = contact.firstName?.trim() ?? "";
  const last = contact.lastName?.trim() ?? "";
  if (first || last) {
    return { firstName: first, lastName: last };
  }
  const stripped = contact.fullName
    .trim()
    .replace(/^(?:dr|mr|mrs|ms|prof)\.?\s+/i, "");
  const parts = stripped.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function splitCityAndCountry(location?: string | null): { city: string; country: string } {
  const parts = (location ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { city: "", country: "" };
  if (parts.length === 1) return { city: parts[0], country: "" };
  return {
    city: parts[0],
    country: parts[parts.length - 1],
  };
}

function resolveFitScore(
  account: AccountCandidateDossier | LeadExportAccountContext | undefined,
): string {
  if (!account) return "";
  if ("fit" in account && account.fit && typeof account.fit.totalScore === "number") {
    return String(account.fit.totalScore);
  }
  if ("fitScore" in account && typeof account.fitScore === "number") {
    return String(account.fitScore);
  }
  return "";
}

export function buildLeadsCsv(
  contacts: ContactCandidateView[],
  accountsById: Map<string, AccountCandidateDossier | LeadExportAccountContext>,
  scope: LeadExportScope,
): {
  csv: string;
  rowCount: number;
  verifiedCount: number;
  publicEmailCount: number;
} {
  const filtered = filterContactsByExportScope(contacts, scope);
  let verifiedCount = 0;
  let publicEmailCount = 0;

  const lines: string[] = [LEADS_CSV_HEADERS.map(formatCsvCell).join(",")];

  for (const contact of filtered) {
    const account = accountsById.get(contact.accountCandidateId);
    const provenance = resolveLeadEmailProvenance(contact);
    if (provenance.emailStatus === "verified") verifiedCount += 1;
    else if (provenance.emailStatus === "unverified_public") publicEmailCount += 1;

    const { firstName, lastName } = splitFirstAndLastName(contact);
    const phone = contact.verifiedDetails?.phone?.trim() || contact.publicPhone?.trim() || "";
    const companyName = account?.name?.trim() || contact.accountName;
    const companyDomain = account?.domain?.trim() || contact.accountDomain || "";
    const companyWebsite =
      account?.website?.trim() || (companyDomain ? `https://${companyDomain}` : "");
    const rawIndustry = account?.industry?.trim() || "";
    const companySpecialisation = rawIndustry.replace(/\s*\(OpenStreetMap\)\s*$/i, "").trim();
    const { city, country } = splitCityAndCountry(account?.location ?? contact.location ?? null);
    const fitScore = resolveFitScore(account);

    const rowValues = [
      firstName,
      lastName,
      contact.fullName,
      provenance.email,
      provenance.emailStatus,
      provenance.emailSource,
      phone,
      contact.title ?? "",
      contact.department ?? "",
      contact.seniority ?? "",
      companyName,
      companyDomain,
      companyWebsite,
      companySpecialisation,
      city,
      country,
      contact.linkedInUrl ?? "",
      contact.sourceUrl ?? "",
      fitScore,
      provenance.leadStatus,
    ];

    lines.push(rowValues.map(formatCsvCell).join(","));
  }

  return {
    csv: lines.join("\r\n"),
    rowCount: filtered.length,
    verifiedCount,
    publicEmailCount,
  };
}

export function buildTemplatesCsv(pack: OutreachTemplatePackView): {
  csv: string;
  rowCount: number;
} {
  const lines: string[] = [TEMPLATES_CSV_HEADERS.map(formatCsvCell).join(",")];

  for (const step of pack.steps) {
    lines.push(
      [
        step.stepNumber,
        step.stepKey,
        step.label,
        step.channel,
        step.dayOffset,
        step.subject,
        step.body,
        step.lint.wordCount,
        step.lint.passed ? "true" : "false",
      ]
        .map(formatCsvCell)
        .join(","),
    );
  }

  return {
    csv: lines.join("\r\n"),
    rowCount: pack.steps.length,
  };
}

export function buildTemplatesMarkdown(
  pack: OutreachTemplatePackView,
  meta: { title?: string; marketName?: string; industryName?: string } = {},
): string {
  const headerLines = [
    `# Outreach Sequence${meta.title ? `: ${meta.title}` : ""}`,
    "",
    `- **Sequence Version:** v${pack.version} (${pack.generationMode})`,
    `- **Voice Preset:** ${pack.tone} | **CTA Style:** ${pack.ctaStyle}`,
    ...(meta.marketName || meta.industryName
      ? [`- **Locked Route:** ${[meta.marketName, meta.industryName].filter(Boolean).join(" -> ")}`]
      : []),
    ...(pack.entryOffer ? [`- **Entry Offer:** ${pack.entryOffer}`] : []),
    ...(pack.senderName ? [`- **Sender Sign-Off:** ${pack.senderName}`] : []),
    `- **Clean Anti-AI Voice Steps:** ${pack.steps.filter((s) => s.lint.passed).length}/${pack.steps.length}`,
    "",
  ];

  const stepSections = pack.steps.flatMap((step) => [
    `## Step ${step.stepNumber}: ${step.label} (Day ${step.dayOffset} · ${step.channel})`,
    "",
    ...(step.subject ? [`**Subject:** \`${step.subject}\``, ""] : []),
    `Word count: ${step.lint.wordCount}/${step.lint.maxWords} · Anti-AI voice: ${
      step.lint.passed ? "Clean" : step.lint.issues.join("; ")
    }`,
    "",
    "```text",
    step.body,
    "```",
    "",
  ]);

  return [...headerLines, ...stepSections].join("\n").trimEnd() + "\n";
}

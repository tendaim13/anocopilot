import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreAndBuildAccountDossier,
  type AccountCandidateDossier,
} from "@/lib/ano/company-discovery";
import type { IndustryProfile, MarketProfile, ResearchClaim } from "@/lib/ano/market-synthesis";
import {
  buildLeadsCsv,
  buildTemplatesCsv,
  buildTemplatesMarkdown,
  filterContactsByExportScope,
  formatCsvCell,
  LEADS_CSV_HEADERS,
  resolveLeadEmailProvenance,
  sanitizeExportFilenameSlug,
  summarizeLeadExportReadiness,
  TEMPLATES_CSV_HEADERS,
} from "@/lib/ano/lead-export";
import { buildDeterministicFallbackTemplatePack } from "@/lib/ano/outreach-templates";
import {
  normalizeDiscoveredPersonCandidate,
  type ContactCandidateView,
} from "@/lib/ano/people-playbooks";
import type { ResearchBrief } from "@/lib/ano/research-conversation";

const convId = "00000000-0000-4000-8000-000000009301";
const decisionId = "00000000-0000-4000-8000-000000009302";
const searchId = "00000000-0000-4000-8000-000000009303";
const personSearchId = "00000000-0000-4000-8000-000000009304";
const packId = "00000000-0000-4000-8000-000000009305";
const claimId = "00000000-0000-4000-8000-000000009306";
const now = "2026-11-22T17:25:00.000Z";

const brief: ResearchBrief = {
  offer: "Automated SMS and email recall reminders for private dental clinics.",
  goal: "Reduce patient no-shows and fill overdue hygiene chairs.",
  marketHints: ["Australia"],
  locationHints: ["Melbourne, Australia"],
  buyerHints: ["Principal Dentist", "Practice Manager"],
  constraints: [],
  unknowns: [],
  sourceMessageIds: [],
};

const market: MarketProfile = {
  id: "00000000-0000-4000-8000-000000009310",
  name: "Australia",
  summary: "High density of independent dental clinics.",
  evidenceStrength: "strong",
  claimIds: [claimId],
  unknowns: [],
  nextResearchActions: [],
};

const industry: IndustryProfile = {
  id: "00000000-0000-4000-8000-000000009311",
  marketProfileId: market.id,
  name: "Private Dental Clinics",
  summary: "Multi-chair independent dental clinics",
  operationalProblems: ["overdue patient recall reminders"],
  solutionFit: ["automatic two-way SMS and email recall reminders"],
  buyerRoleHypotheses: ["Principal Dentist", "Practice Manager"],
  evidenceStrength: "strong",
  claimIds: [claimId],
  unknowns: [],
};

const claims: ResearchClaim[] = [
  {
    id: claimId,
    kind: "observation",
    statement: "Independent Australian dental clinics miss recurring recall visits when outreach stays manual.",
    sourceIds: ["00000000-0000-4000-8000-000000009307"],
    comparisonBasis: null,
    evidenceStrength: "strong",
    citationStatus: "supported",
  },
];

const account: AccountCandidateDossier = scoreAndBuildAccountDossier(
  {
    provider: "openstreetmap",
    id: "osm-melb-1",
    name: "Melbourne Family Dental",
    website: "https://melbournedental.example",
    domain: "melbournedental.example",
    industry: "Dental Clinic (OpenStreetMap)",
    location: { city: "Melbourne", country: "Australia" },
    osmTags: { amenity: "dentist" },
  },
  {
    dossierId: "00000000-0000-4000-8000-000000009320",
    conversationId: convId,
    targetDecisionId: decisionId,
    companySearchId: searchId,
    providerKey: "openstreetmap",
    targetMarketName: "Melbourne, Australia",
    targetIndustryName: industry.name,
    canonicalLocations: ["Melbourne, Australia"],
    linkedClaimIds: [claimId],
    capturedAt: now,
    lifecycleState: "shortlisted",
  },
);

test("formatCsvCell enforces RFC-4180 quoting and neutralizes formula injection", () => {
  assert.equal(formatCsvCell(null), "");
  assert.equal(formatCsvCell(undefined), "");
  assert.equal(formatCsvCell("Melbourne, Australia"), '"Melbourne, Australia"');
  assert.equal(formatCsvCell('Dr. "Sam" Lee'), '"Dr. ""Sam"" Lee"');
  assert.equal(formatCsvCell("Line 1\nLine 2"), '"Line 1\nLine 2"');

  // Formula prefixes
  assert.equal(formatCsvCell("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(formatCsvCell("+61390001111"), "'+61390001111");
  assert.equal(formatCsvCell("-1+2"), "'-1+2");
  assert.equal(formatCsvCell("@cmd"), "'@cmd");
  assert.equal(formatCsvCell("\t=1+1"), "'\t=1+1");
  assert.equal(formatCsvCell("\r=1+1"), '"\'\r=1+1"');
});

test("sanitizeExportFilenameSlug creates header-safe filenames", () => {
  assert.equal(
    sanitizeExportFilenameSlug('Melbourne Dental "2026"\r\nX-Inject: bad'),
    "melbourne-dental-2026-x-inject-bad",
  );
  assert.equal(sanitizeExportFilenameSlug("!!!", "fallback"), "fallback");
});

test("resolveLeadEmailProvenance, scope filtering, and buildLeadsCsv format blaster CSV cleanly", () => {
  const prospeoVerified: ContactCandidateView = {
    ...normalizeDiscoveredPersonCandidate(
      {
        id: "c1",
        providerKey: "website_team",
        fullName: "Dr. Mei Ling Tan",
        firstName: "Mei Ling",
        lastName: "Tan",
        title: "Principal Dentist",
        linkedInUrl: "https://linkedin.com/in/mei-tan",
        sourceUrl: "https://melbournedental.example/team",
      },
      {
        candidateId: "00000000-0000-4000-8000-000000009331",
        conversationId: convId,
        targetDecisionId: decisionId,
        personSearchId,
        account,
        roleRecommendations: [],
        providerKey: "website_team",
        capturedAt: now,
      },
    ),
    verificationStatus: "verified",
    verifiedDetails: {
      email: "mei.tan@melbournedental.example",
      emailQualification: "VERIFIED (smtp)",
      phone: "+61 3 9000 1111",
      verifiedDomain: "melbournedental.example",
      provider: "prospeo",
      verifiedAt: now,
    },
  };

  const publicInbox: ContactCandidateView = normalizeDiscoveredPersonCandidate(
    {
      id: "c2",
      providerKey: "website_team",
      fullName: "Sarah Jenkins",
      firstName: "Sarah",
      lastName: "Jenkins",
      title: "Practice Manager",
      sourceUrl: "https://melbournedental.example/team",
      publicEmail: "info@melbournedental.example",
      publicEmailKind: "shared_inbox",
      publicPhone: "+61390001112",
    },
    {
      candidateId: "00000000-0000-4000-8000-000000009332",
      conversationId: convId,
      targetDecisionId: decisionId,
      personSearchId,
      account,
      roleRecommendations: [],
      providerKey: "website_team",
      capturedAt: now,
    },
  );

  const namedOnlyAdversarial: ContactCandidateView = normalizeDiscoveredPersonCandidate(
    {
      id: "c3",
      providerKey: "website_team",
      fullName: "=IMPORTXML(\"https://evil.example\")",
      title: "Clinical, Director",
      sourceUrl: "https://melbournedental.example/team",
    },
    {
      candidateId: "00000000-0000-4000-8000-000000009333",
      conversationId: convId,
      targetDecisionId: decisionId,
      personSearchId,
      account,
      roleRecommendations: [],
      providerKey: "website_team",
      capturedAt: now,
    },
  );

  assert.equal(resolveLeadEmailProvenance(prospeoVerified).emailSource, "verified_work_email");
  assert.equal(resolveLeadEmailProvenance(publicInbox).emailSource, "public_website_shared_inbox");
  assert.equal(resolveLeadEmailProvenance(namedOnlyAdversarial).emailStatus, "missing");

  const allContacts = [prospeoVerified, publicInbox, namedOnlyAdversarial];
  assert.equal(filterContactsByExportScope(allContacts, "verified_only").length, 1);
  assert.equal(filterContactsByExportScope(allContacts, "with_email").length, 2);
  assert.equal(filterContactsByExportScope(allContacts, "all").length, 3);

  const accountsMap = new Map([[account.id, account]]);
  const csvWithEmail = buildLeadsCsv(allContacts, accountsMap, "with_email");
  assert.equal(csvWithEmail.rowCount, 2);
  assert.equal(csvWithEmail.verifiedCount, 1);
  assert.equal(csvWithEmail.publicEmailCount, 1);

  const lines = csvWithEmail.csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], LEADS_CSV_HEADERS.join(","));
  assert.ok(lines[1].includes("mei.tan@melbournedental.example,verified,verified_work_email,'+61 3 9000 1111"));
  assert.ok(lines[1].includes("Dental Clinic,Melbourne,Australia"));
  assert.ok(lines[2].includes("info@melbournedental.example,unverified_public,public_website_shared_inbox"));

  const csvAll = buildLeadsCsv(allContacts, accountsMap, "all");
  assert.equal(csvAll.rowCount, 3);
  assert.ok(csvAll.csv.includes('"\'=IMPORTXML(""https://evil.example"")"'));
  assert.ok(csvAll.csv.includes('"Clinical, Director"'));
});

test("buildTemplatesCsv, buildTemplatesMarkdown, and summarizeLeadExportReadiness preserve merge tags and metadata", () => {
  const pack = buildDeterministicFallbackTemplatePack({
    id: packId,
    conversationId: convId,
    targetDecisionId: decisionId,
    brief,
    market,
    industry,
    claims,
    accounts: [account],
    senderName: "Alex",
    nowIso: now,
  });

  const csvResult = buildTemplatesCsv(pack);
  assert.equal(csvResult.rowCount, 3);
  const rows = csvResult.csv.split("\r\n");
  assert.equal(rows[0], TEMPLATES_CSV_HEADERS.join(","));
  assert.ok(rows[1].startsWith("1,initial,Initial Email,email,0,"));
  assert.ok(csvResult.csv.includes("{{first_name}}"));
  assert.ok(csvResult.csv.includes("{{company_name}}"));

  const md = buildTemplatesMarkdown(pack, {
    title: "Dental clinics AU",
    marketName: "Australia",
    industryName: "Private Dental Clinics",
  });
  assert.ok(md.includes("# Outreach Sequence: Dental clinics AU"));
  assert.ok(md.includes("## Step 1: Initial Email (Day 0 · email)"));
  assert.ok(md.includes("## Step 3: Breakup (Day 7 · email)"));
  assert.ok(md.includes("```text"));

  const summary = summarizeLeadExportReadiness([], pack);
  assert.equal(summary.totalLeads, 0);
  assert.equal(summary.templatesReady, true);
  assert.equal(summary.templateStepsCount, 3);
  assert.equal(summary.cleanVoiceStepsCount, 3);
});

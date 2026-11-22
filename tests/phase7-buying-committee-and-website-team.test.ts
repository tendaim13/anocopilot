import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreAndBuildAccountDossier,
  type AccountCandidateDossier,
} from "@/lib/ano/company-discovery";
import type { IndustryProfile } from "@/lib/ano/market-synthesis";
import {
  buildPersonSearchPreview,
  deriveBuyerRoleRecommendations,
  deriveBuyingCommitteeCriteria,
  formatContactForCohortTable,
  inferCompanyArchetype,
  normalizeDiscoveredPersonCandidate,
  recommendPersonDiscoveryProvider,
  type PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import type { ResearchConversationView } from "@/lib/ano/research-conversation";
import {
  buildConversationChatPrompt,
  parseConversationChatResponse,
  replyInResearchConversation,
} from "@/server/agents/conversation-chat-model";
import { suggestProspeoJobTitles } from "@/server/connectors/prospeo/prospeo-client";
import { discoverPeopleFromCompanyWebsites } from "@/server/connectors/website-team/website-team-client";

const convId = "00000000-0000-4000-8000-000000000701";
const runId = "00000000-0000-4000-8000-000000000702";
const decisionId = "00000000-0000-4000-8000-000000000703";
const searchId = "00000000-0000-4000-8000-000000000704";
const personSearchId = "00000000-0000-4000-8000-000000000705";
const claimId = "00000000-0000-4000-8000-000000000706";
const now = "2026-11-21T16:00:00.000Z";

const dentalIndustry: IndustryProfile = {
  id: "00000000-0000-4000-8000-000000000710",
  marketProfileId: "00000000-0000-4000-8000-000000000711",
  name: "Private Dental Clinics",
  summary: "Independent multi-chair dental practices managing recall and patient retention.",
  operationalProblems: ["High patient no-show and overdue recall appointments"],
  solutionFit: ["Automated recall reminders and Chairfill scheduling"],
  buyerRoleHypotheses: ["Principal Dentist", "Practice Manager"],
  evidenceStrength: "strong",
  claimIds: [claimId],
  unknowns: ["Current PMS software per clinic"],
};

const saasIndustry: IndustryProfile = {
  id: "00000000-0000-4000-8000-000000000712",
  marketProfileId: "00000000-0000-4000-8000-000000000713",
  name: "B2B Cloud Security & DevOps",
  summary: "Mid-market engineering teams adopting automated deployment guardrails.",
  operationalProblems: ["Slow CI security reviews across product squads"],
  solutionFit: ["Automated PR policy checks and cloud posture alerts"],
  buyerRoleHypotheses: ["VP of Engineering", "Head of Security"],
  evidenceStrength: "moderate",
  claimIds: [claimId],
  unknowns: ["CI pipeline tooling"],
};

function makeOsmDentalAccount(id: string, name: string, website: string | null): AccountCandidateDossier {
  const domain = website ? new URL(website).hostname.replace(/^www\./, "") : null;
  return scoreAndBuildAccountDossier(
    {
      provider: "openstreetmap",
      id: `osm-${id}`,
      name,
      website: website ?? undefined,
      domain: domain ?? undefined,
      industry: "Dental Clinic (OpenStreetMap)",
      location: { city: "Melbourne", country: "Australia" },
      osmTags: { amenity: "dentist" },
    },
    {
      dossierId: id,
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "openstreetmap",
      targetMarketName: "Melbourne, Australia",
      targetIndustryName: dentalIndustry.name,
      canonicalLocations: ["Melbourne, Australia"],
      linkedClaimIds: [claimId],
      capturedAt: now,
      lifecycleState: "shortlisted",
    },
  );
}

function makeSaasAccount(id: string, name: string, domain: string): AccountCandidateDossier {
  return scoreAndBuildAccountDossier(
    {
      id: `prospeo-${id}`,
      name,
      domain,
      website: `https://${domain}`,
      industry: "Computer & Network Security",
      employeeCount: 180,
      employeeRange: "51-200",
      location: { city: "Singapore", country: "Singapore" },
    },
    {
      dossierId: id,
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "prospeo",
      targetMarketName: "Singapore",
      targetIndustryName: saasIndustry.name,
      canonicalLocations: ["Singapore"],
      linkedClaimIds: [claimId],
      capturedAt: now,
      lifecycleState: "shortlisted",
    },
  );
}

test("Buying Committee inference adapts to local_smb dental vs mid_market B2B SaaS", () => {
  const clinicA = makeOsmDentalAccount(
    "00000000-0000-4000-8000-000000000721",
    "Collins Dental Studio",
    "https://collinsdental.example",
  );
  assert.equal(inferCompanyArchetype([clinicA], dentalIndustry.name), "local_smb");
  assert.equal(recommendPersonDiscoveryProvider([clinicA], dentalIndustry.name), "website_team");

  const dentalCommittee = deriveBuyingCommitteeCriteria({
    industry: dentalIndustry,
    brief: null,
    shortlistedAccounts: [clinicA],
  });
  assert.equal(dentalCommittee.archetype, "local_smb");
  assert.ok(dentalCommittee.departments.includes("Medical & Health"));
  assert.ok(dentalCommittee.seniorities.includes("Founder/Owner"));
  assert.ok(dentalCommittee.includeTitles.includes("Principal Dentist"));
  assert.ok(dentalCommittee.excludeTitles.includes("Receptionist"));
  assert.ok(dentalCommittee.excludeTitles.includes("Hygienist"));

  const saasCo = makeSaasAccount(
    "00000000-0000-4000-8000-000000000722",
    "AegisCloud Labs",
    "aegiscloud.example",
  );
  assert.equal(inferCompanyArchetype([saasCo], saasIndustry.name), "mid_market");
  assert.equal(recommendPersonDiscoveryProvider([saasCo], saasIndustry.name), "prospeo");

  const saasCommittee = deriveBuyingCommitteeCriteria({
    industry: saasIndustry,
    brief: null,
    shortlistedAccounts: [saasCo],
  });
  assert.equal(saasCommittee.archetype, "mid_market");
  assert.ok(saasCommittee.departments.includes("Engineering & Technical"));
  assert.ok(saasCommittee.departments.includes("Information Technology"));
  assert.ok(saasCommittee.seniorities.includes("Vice President"));

  const overridden = deriveBuyingCommitteeCriteria({
    industry: saasIndustry,
    brief: null,
    shortlistedAccounts: [saasCo],
    overrides: {
      departments: ["Finance"],
      seniorities: ["C-Suite"],
      roleOverrides: ["CFO", "VP Finance"],
      excludeTitles: ["Intern"],
    },
  });
  assert.deepEqual(overridden.departments, ["Finance"]);
  assert.deepEqual(overridden.seniorities, ["C-Suite"]);
  assert.deepEqual(overridden.includeTitles, ["CFO", "VP Finance"]);
  assert.deepEqual(overridden.excludeTitles, ["Intern"]);
});

test("buildPersonSearchPreview emits fixed Prospeo /search-person schema and free website_team preview", () => {
  const saasCo = makeSaasAccount(
    "00000000-0000-4000-8000-000000000723",
    "AegisCloud Labs",
    "aegiscloud.example",
  );
  const committee = deriveBuyingCommitteeCriteria({
    industry: saasIndustry,
    brief: null,
    shortlistedAccounts: [saasCo],
  });
  const roles = deriveBuyerRoleRecommendations(
    saasIndustry,
    null,
    committee.includeTitles,
    committee,
  );

  const prospeoPreview = buildPersonSearchPreview({
    personSearchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    shortlistedAccounts: [saasCo],
    roleRecommendations: roles,
    providerKey: "prospeo",
    buyingCommittee: committee,
    nowIso: now,
  });

  assert.equal(prospeoPreview.providerKey, "prospeo");
  assert.equal(prospeoPreview.estimatedMaximumCredits, 1);
  const filters = prospeoPreview.providerFilters as {
    company?: { websites?: { include: string[] }; company_websites?: unknown };
    person_seniority?: { include: string[] };
    person_department?: { include: string[] };
    person_job_title?: { include: string[]; exclude?: string[] };
  };
  assert.deepEqual(filters.company?.websites?.include, ["aegiscloud.example"]);
  assert.equal(filters.company?.company_websites, undefined);
  assert.ok(filters.person_seniority?.include.includes("Vice President"));
  assert.ok(filters.person_department?.include.includes("Engineering & Technical"));
  assert.ok(filters.person_job_title?.include.includes("VP of Engineering"));
  assert.ok(filters.person_job_title?.exclude?.includes("Intern"));

  const clinic = makeOsmDentalAccount(
    "00000000-0000-4000-8000-000000000724",
    "Bright Smile Dental",
    "https://brightsmile.example",
  );
  const clinicCommittee = deriveBuyingCommitteeCriteria({
    industry: dentalIndustry,
    brief: null,
    shortlistedAccounts: [clinic],
  });
  const clinicRoles = deriveBuyerRoleRecommendations(
    dentalIndustry,
    null,
    clinicCommittee.includeTitles,
    clinicCommittee,
  );
  const websitePreview = buildPersonSearchPreview({
    personSearchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    shortlistedAccounts: [clinic],
    roleRecommendations: clinicRoles,
    providerKey: "website_team",
    buyingCommittee: clinicCommittee,
    nowIso: now,
  });
  assert.equal(websitePreview.providerKey, "website_team");
  assert.equal(websitePreview.estimatedMaximumCredits, 0);
});

test("discoverPeopleFromCompanyWebsites extracts leaders safely, enforces SSRF & excludes non-buyers", async () => {
  const clinicOk = makeOsmDentalAccount(
    "00000000-0000-4000-8000-000000000731",
    "Melbourne Family Dental",
    "https://melbournedental.example",
  );
  const clinicPrivate = makeOsmDentalAccount(
    "00000000-0000-4000-8000-000000000732",
    "Internal Clinic",
    "https://internal-clinic.example",
  );
  const clinicBroken = makeOsmDentalAccount(
    "00000000-0000-4000-8000-000000000733",
    "Timeout Dental",
    "https://timeoutdental.example",
  );

  const committee = deriveBuyingCommitteeCriteria({
    industry: dentalIndustry,
    brief: null,
    shortlistedAccounts: [clinicOk],
  });

  const homeHtml = `
    <html>
      <body>
        <nav><a href="/about-our-team">Meet Our Team</a><a href="/contact">Contact Us</a></nav>
        <main>
          <h1>Melbourne Family Dental</h1>
          <h2>Book Appointment</h2>
        </main>
      </body>
    </html>
  `;
  const teamHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Physician",
            "name": "Dr. Jason Lim",
            "jobTitle": "Clinic Director",
            "sameAs": "https://www.linkedin.com/in/jason-lim-dental"
          }
        </script>
      </head>
      <body>
        <section class="team-grid">
          <article class="team-member">
            <h3>Dr. Mei Ling Tan</h3>
            <p class="role">Principal Dentist</p>
          </article>
          <article class="team-member">
            <h3>Sarah Jenkins — Practice Manager</h3>
          </article>
          <article class="team-member">
            <h3>Emily Wong</h3>
            <p>Receptionist</p>
          </article>
          <article class="team-member">
            <h3>Chloe Patel</h3>
            <p>Dental Hygienist</p>
          </article>
        </section>
      </body>
    </html>
  `;

  const result = await discoverPeopleFromCompanyWebsites(
    [clinicOk, clinicPrivate, clinicBroken],
    committee,
    {
      lookup: async (hostname) => {
        if (hostname.includes("internal-clinic")) {
          return [{ address: "127.0.0.1", family: 4 }];
        }
        return [{ address: "93.184.216.34", family: 4 }];
      },
      fetch: (async (input) => {
        const url = String(input);
        if (url.includes("timeoutdental")) {
          throw new Error("Simulated network timeout");
        }
        if (url.includes("/about-our-team")) {
          return new Response(teamHtml, {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        return new Response(homeHtml, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }) as typeof fetch,
    },
  );

  assert.equal(result.companiesScanned, 3);
  assert.equal(result.people.length, 3);
  const names = result.people.map((p) => p.fullName);
  assert.ok(names.includes("Dr. Jason Lim"));
  assert.ok(names.includes("Dr. Mei Ling Tan"));
  assert.ok(names.includes("Sarah Jenkins"));
  assert.ok(!names.includes("Emily Wong"));
  assert.ok(!names.includes("Chloe Patel"));
  assert.ok(result.people.every((p) => p.sourceUrl.includes("/about-our-team")));

  const privateReport = result.companyReports.find((r) => r.accountId === clinicPrivate.id);
  assert.ok(privateReport?.note?.includes("non-public"));
  const brokenReport = result.companyReports.find((r) => r.accountId === clinicBroken.id);
  assert.ok(brokenReport?.note?.includes("Simulated network timeout"));
});

test("suggestProspeoJobTitles calls /search-suggestions cleanly", async () => {
  const prevKey = process.env.PROSPEO_KEY;
  process.env.PROSPEO_KEY = "test-prospeo-key";
  try {
    const suggestions = await suggestProspeoJobTitles("practice manager", (async (_url, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}"));
      assert.equal(payload.job_title_search, "practice manager");
      return new Response(
        JSON.stringify({
          error: false,
          job_title_suggestions: ["Practice Manager", "Dental Practice Manager"],
        }),
        { status: 200 },
      );
    }) as typeof fetch);
    assert.deepEqual(suggestions, ["Practice Manager", "Dental Practice Manager"]);
  } finally {
    if (prevKey === undefined) delete process.env.PROSPEO_KEY;
    else process.env.PROSPEO_KEY = prevKey;
  }
});

test("formatContactForCohortTable, buildConversationChatPrompt, and parseConversationChatResponse handle peopleUpdate", () => {
  const clinic = makeOsmDentalAccount(
    "00000000-0000-4000-8000-000000000741",
    "Melbourne Family Dental",
    "https://melbournedental.example",
  );
  const roles = deriveBuyerRoleRecommendations(dentalIndustry, null);
  const contact = normalizeDiscoveredPersonCandidate(
    {
      id: "wt-1",
      fullName: "Dr. Mei Ling Tan",
      firstName: "Mei Ling",
      lastName: "Tan",
      title: "Principal Dentist",
      seniority: "Director",
      department: "Medical & Health",
      sourceUrl: "https://melbournedental.example/about-our-team",
      providerKey: "website_team",
    },
    {
      candidateId: "00000000-0000-4000-8000-000000000742",
      conversationId: convId,
      targetDecisionId: decisionId,
      personSearchId,
      account: clinic,
      roleRecommendations: roles,
      providerKey: "website_team",
      capturedAt: now,
    },
  );

  const row = formatContactForCohortTable(contact);
  assert.equal(row.sourceLabel, "Company website");
  assert.equal(row.sourceUrl, "https://melbournedental.example/about-our-team");
  assert.equal(row.department, "Medical & Health");

  const conversation: ResearchConversationView = {
    conversation: {
      id: convId,
      title: "Dental clinics outbound",
      status: "complete_without_research",
      threadId: `ano:ws:${convId}`,
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: runId,
      status: "complete_without_research",
      graphVersion: "phase-a-v1",
      currentNode: "complete",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [],
    brief: null,
    pendingQuestion: null,
    plan: null,
    events: [],
  };

  const peopleDiscovery: PeopleDiscoveryView = {
    shortlistedCount: 1,
    personSearch: buildPersonSearchPreview({
      personSearchId,
      conversationId: convId,
      targetDecisionId: decisionId,
      shortlistedAccounts: [clinic],
      roleRecommendations: roles,
      providerKey: "website_team",
      buyingCommittee: deriveBuyingCommitteeCriteria({
        industry: dentalIndustry,
        brief: null,
        shortlistedAccounts: [clinic],
      }),
      nowIso: now,
    }),
    contacts: [contact],
    verificationRun: null,
    playbooks: [],
  };

  const { user, system } = buildConversationChatPrompt(
    { conversation, peopleDiscovery },
    "Also target COO and exclude dental hygienists.",
  );
  assert.ok(user.includes("Dr. Mei Ling Tan | Principal Dentist | Medical & Health / Director | Melbourne Family Dental | source=Company website"));
  assert.ok(system.includes("peopleUpdate"));

  const parsed = parseConversationChatResponse(
    JSON.stringify({
      reply: "Updating the Buying Committee to include COO and exclude hygienists.",
      filterUpdate: null,
      peopleUpdate: {
        apply: true,
        providerKey: "website_team",
        includeTitles: ["Principal Dentist", "Practice Manager", "COO"],
        excludeTitles: ["Dental Hygienist"],
        reason: "Add COO and exclude hygienists",
      },
    }),
  );
  assert.equal(parsed.peopleUpdate?.apply, true);
  assert.equal(parsed.peopleUpdate?.providerKey, "website_team");
  assert.deepEqual(parsed.peopleUpdate?.includeTitles, [
    "Principal Dentist",
    "Practice Manager",
    "COO",
  ]);
});

test("replyInResearchConversation suppresses spurious peopleUpdate echoes on read-only Q&A", async () => {
  const conversation: ResearchConversationView = {
    conversation: {
      id: convId,
      title: "Dental clinics outbound",
      status: "complete_without_research",
      threadId: `ano:ws:${convId}`,
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: runId,
      status: "complete_without_research",
      graphVersion: "phase-a-v1",
      currentNode: "complete",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [],
    brief: null,
    pendingQuestion: null,
    plan: null,
    events: [],
  };

  const mockConfig = {
    provider: "ollama" as const,
    baseUrl: "http://127.0.0.1:11434",
    modelId: "qwen2.5:3b",
  };

  const spuriousModel = {
    async invoke() {
      return {
        content: JSON.stringify({
          reply: "We found Dr. Mei Ling Tan at Melbourne Family Dental.",
          filterUpdate: null,
          peopleUpdate: {
            apply: true,
            departments: ["Medical & Health"],
          },
        }),
      };
    },
  };

  const qaResult = await replyInResearchConversation(
    mockConfig,
    { conversation },
    "Who have we found so far at Melbourne Family Dental and which departments are we targeting?",
    spuriousModel,
  );
  assert.equal(qaResult.peopleUpdate, null);
  assert.equal(qaResult.filterUpdate, null);

  const mutationResult = await replyInResearchConversation(
    mockConfig,
    { conversation },
    "Exclude receptionists and target COO and Practice Manager",
    spuriousModel,
  );
  assert.equal(mutationResult.peopleUpdate?.apply, true);
});

test("Cross-industry generalization supports law firms, manufacturing/logistics, narrative prose, and text-verified LLM fallback", async () => {
  const lawIndustry: IndustryProfile = {
    id: "00000000-0000-4000-8000-000000000760",
    marketProfileId: "00000000-0000-4000-8000-000000000761",
    name: "Commercial Law Firm",
    summary: "Boutique commercial litigation and corporate legal practices.",
    operationalProblems: ["Slow client intake and matter conflict checks"],
    solutionFit: ["Automated client onboarding"],
    buyerRoleHypotheses: [],
    evidenceStrength: "moderate",
    claimIds: [claimId],
    unknowns: [],
  };

  const lawFirm = scoreAndBuildAccountDossier(
    {
      provider: "openstreetmap",
      id: "osm-law-1",
      name: "Harbour Legal Partners",
      website: "https://harbourlegal.example",
      domain: "harbourlegal.example",
      industry: "Law Firm",
      location: { city: "Sydney", country: "Australia" },
    },
    {
      dossierId: "00000000-0000-4000-8000-000000000762",
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "openstreetmap",
      targetMarketName: "Sydney, Australia",
      targetIndustryName: lawIndustry.name,
      canonicalLocations: ["Sydney, Australia"],
      linkedClaimIds: [claimId],
      capturedAt: now,
      lifecycleState: "shortlisted",
    },
  );

  const lawCommittee = deriveBuyingCommitteeCriteria({
    industry: lawIndustry,
    brief: null,
    shortlistedAccounts: [lawFirm],
  });
  assert.equal(lawCommittee.archetype, "local_smb");
  assert.ok(lawCommittee.departments.includes("Legal"));
  assert.ok(lawCommittee.includeTitles.includes("Managing Partner"));
  assert.ok(lawCommittee.excludeTitles.includes("Paralegal"));

  const mfgIndustry: IndustryProfile = {
    id: "00000000-0000-4000-8000-000000000763",
    marketProfileId: "00000000-0000-4000-8000-000000000764",
    name: "Industrial Manufacturing & Logistics",
    summary: "Regional precision manufacturing and warehouse distribution operators.",
    operationalProblems: ["Delayed multi-plant inventory replenishment"],
    solutionFit: ["Automated supply-chain visibility"],
    buyerRoleHypotheses: [],
    evidenceStrength: "moderate",
    claimIds: [claimId],
    unknowns: [],
  };

  const mfgAccount = makeSaasAccount(
    "00000000-0000-4000-8000-000000000765",
    "Pacific Precision Mfg",
    "pacificmfg.example",
  );
  const mfgCommittee = deriveBuyingCommitteeCriteria({
    industry: mfgIndustry,
    brief: null,
    shortlistedAccounts: [mfgAccount],
  });
  assert.equal(mfgCommittee.archetype, "mid_market");
  assert.ok(mfgCommittee.departments.includes("Operations"));
  assert.ok(mfgCommittee.includeTitles.includes("Plant Manager"));
  assert.ok(mfgCommittee.includeTitles.includes("COO"));

  const proseAccount = makeSaasAccount(
    "00000000-0000-4000-8000-000000000766",
    "Aurora Studio",
    "aurorastudio.example",
  );
  const fallbackOnlyAccount = makeSaasAccount(
    "00000000-0000-4000-8000-000000000767",
    "Nimbus Freight",
    "nimbusfreight.example",
  );

  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  let llmInvocations = 0;

  const discovery = await discoverPeopleFromCompanyWebsites(
    [lawFirm, mfgAccount, proseAccount, fallbackOnlyAccount],
    mfgCommittee,
    {
      lookup,
      fetch: (async (input) => {
        const url = String(input);
        if (url.includes("harbourlegal.example")) {
          if (url.endsWith("/partners")) {
            return new Response(
              `<html><body>
                <div class="partner-card"><h3>Hannah Brooks</h3><p>Managing Partner</p></div>
                <div class="partner-card"><h3>Tom Rivera</h3><p>Paralegal</p></div>
              </body></html>`,
              { status: 200, headers: { "content-type": "text/html" } },
            );
          }
          return new Response(
            `<html><body><nav><a href="/partners">Our Partners</a></nav></body></html>`,
            { status: 200, headers: { "content-type": "text/html" } },
          );
        }

        if (url.includes("pacificmfg.example")) {
          if (url.endsWith("/leadership")) {
            return new Response(
              `<html><head>
                <script type="application/ld+json">
                  {"@type":"Person","name":"David Chen","jobTitle":"VP of Supply Chain"}
                </script>
              </head><body>
                <article><h3>Grace Lim — COO</h3></article>
                <article><h3>Robert Tan</h3><p>Plant Manager</p></article>
              </body></html>`,
              { status: 200, headers: { "content-type": "text/html" } },
            );
          }
          return new Response(
            `<html><body><nav><a href="/leadership">Leadership</a><a href="/company">Our Company</a></nav></body></html>`,
            { status: 200, headers: { "content-type": "text/html" } },
          );
        }

        if (url.includes("aurorastudio.example")) {
          if (url.endsWith("/about")) {
            return new Response(
              `<html><body><main><p>Founded in 2019 by Elena Rostova and Marcus Vance to modernize industrial design workflows.</p></main></body></html>`,
              { status: 200, headers: { "content-type": "text/html" } },
            );
          }
          return new Response(
            `<html><body><nav><a href="/about">About Us</a></nav></body></html>`,
            { status: 200, headers: { "content-type": "text/html" } },
          );
        }

        // fallbackOnlyAccount: unstructured bio where regex intentionally won't fire, triggering LLM fallback
        return new Response(
          `<html><body><main><p>Heading up daily fleet dispatch in Singapore is Priya Nair across 120 routes.</p></main></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }) as typeof fetch,
      llmFallback: async () => {
        llmInvocations += 1;
        return [
          {
            fullName: "Priya Nair",
            title: "Head of Operations",
            sourceUrl: "https://nimbusfreight.example/",
          },
          {
            fullName: "Fake Person",
            title: "CEO",
            sourceUrl: "https://nimbusfreight.example/",
          },
        ];
      },
    },
  );

  // Law firm /partners: keeps Hannah Brooks (Managing Partner), drops Paralegal
  const lawPeople = discovery.people.filter((p) => p.accountId === lawFirm.id);
  assert.ok(lawPeople.some((p) => p.fullName === "Hannah Brooks" && p.title === "Managing Partner"));

  // Check law exclusion directly using lawCommittee too
  const lawExcludedDiscovery = await discoverPeopleFromCompanyWebsites([lawFirm], lawCommittee, {
    lookup,
    fetch: (async (input) => {
      const url = String(input);
      if (url.endsWith("/partners")) {
        return new Response(
          `<html><body>
            <div class="partner-card"><h3>Hannah Brooks</h3><p>Managing Partner</p></div>
            <div class="partner-card"><h3>Tom Rivera</h3><p>Paralegal</p></div>
          </body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response(
        `<html><body><nav><a href="/partners">Our Partners</a></nav></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }) as typeof fetch,
  });
  assert.equal(lawExcludedDiscovery.people.length, 1);
  assert.equal(lawExcludedDiscovery.people[0]?.fullName, "Hannah Brooks");
  assert.equal(lawExcludedDiscovery.people[0]?.department, "Legal");

  // Manufacturing /leadership + JSON-LD custom jobTitle
  const mfgPeople = discovery.people.filter((p) => p.accountId === mfgAccount.id);
  assert.ok(mfgPeople.some((p) => p.fullName === "David Chen" && p.title === "VP of Supply Chain"));
  assert.ok(mfgPeople.some((p) => p.fullName === "Grace Lim" && p.title === "COO"));
  assert.ok(mfgPeople.some((p) => p.fullName === "Robert Tan" && p.title === "Plant Manager"));

  // Narrative prose without LLM
  const prosePeople = discovery.people.filter((p) => p.accountId === proseAccount.id);
  assert.ok(prosePeople.some((p) => p.fullName === "Elena Rostova" && p.title === "Founder"));
  assert.ok(prosePeople.some((p) => p.fullName === "Marcus Vance" && p.title === "Founder"));

  // LLM fallback runs only on fallbackOnlyAccount and strips hallucinated names not in page text
  assert.equal(llmInvocations, 1);
  const fallbackPeople = discovery.people.filter((p) => p.accountId === fallbackOnlyAccount.id);
  assert.equal(fallbackPeople.length, 1);
  assert.equal(fallbackPeople[0]?.fullName, "Priya Nair");
  assert.equal(fallbackPeople[0]?.department, "Operations");
});

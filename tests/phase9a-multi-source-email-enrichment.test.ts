import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreAndBuildAccountDossier,
  type AccountCandidateDossier,
} from "@/lib/ano/company-discovery";
import type { IndustryProfile } from "@/lib/ano/market-synthesis";
import { evaluateContactEligibility } from "@/lib/ano/outreach-execution";
import {
  buildContactVerificationPreview,
  deriveBuyingCommitteeCriteria,
  formatContactForCohortTable,
  normalizeDiscoveredPersonCandidate,
} from "@/lib/ano/people-playbooks";
import type { PeopleDiscoveryView } from "@/lib/ano/people-playbooks";
import type { ResearchConversationView } from "@/lib/ano/research-conversation";
import {
  applyDeterministicChatFailsafes,
  buildConversationChatPrompt,
} from "@/server/agents/conversation-chat-model";
import {
  DropcontactClientError,
  verifyContactsWithDropcontact,
} from "@/server/connectors/dropcontact/dropcontact-client";
import {
  enrichProspeoPeople,
  ProspeoClientError,
} from "@/server/connectors/prospeo/prospeo-client";
import {
  discoverPeopleFromCompanyWebsites,
  extractPublicContactsFromHtml,
} from "@/server/connectors/website-team/website-team-client";

const convId = "00000000-0000-4000-8000-000000000901";
const decisionId = "00000000-0000-4000-8000-000000000902";
const searchId = "00000000-0000-4000-8000-000000000903";
const personSearchId = "00000000-0000-4000-8000-000000000904";
const claimId = "00000000-0000-4000-8000-000000000905";
const now = "2026-11-22T12:00:00.000Z";

const dentalIndustry: IndustryProfile = {
  id: "00000000-0000-4000-8000-000000000910",
  marketProfileId: "00000000-0000-4000-8000-000000000911",
  name: "Private Dental Clinics",
  summary: "Independent multi-chair dental practices managing recall and patient retention.",
  operationalProblems: ["High patient no-show and overdue recall appointments"],
  solutionFit: ["Automated recall reminders and Chairfill scheduling"],
  buyerRoleHypotheses: ["Principal Dentist", "Practice Manager"],
  evidenceStrength: "strong",
  claimIds: [claimId],
  unknowns: ["Current PMS software per clinic"],
};

function makeClinicAccount(id: string, name: string, website: string): AccountCandidateDossier {
  const domain = new URL(website).hostname.replace(/^www\./, "");
  return scoreAndBuildAccountDossier(
    {
      provider: "openstreetmap",
      id: `osm-${id}`,
      name,
      website,
      domain,
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

test("extractPublicContactsFromHtml distinguishes direct personal emails, shared inboxes, and tel links", () => {
  const html = `
    <html>
      <body>
        <header>
          <a href="tel:+61 3 9000 1111">Call Clinic</a>
          <a href="mailto:appointments@melbournedental.example">Appointments</a>
        </header>
        <main>
          <p>Contact Dr. Mei Ling Tan at dr.tan@melbournedental.example or write to press@thirdparty.org.</p>
          <p>Skip example assets logo@2x.png or fake@test.invalid.</p>
        </main>
        <footer>info@melbournedental.example</footer>
      </body>
    </html>
  `;

  const result = extractPublicContactsFromHtml(html, "melbournedental.example");
  assert.deepEqual(result.phones, ["+61 3 9000 1111"]);

  const directMatch = result.emails.find((e) => e.email === "dr.tan@melbournedental.example");
  assert.ok(directMatch);
  assert.equal(directMatch.kind, "direct_public");
  assert.equal(directMatch.matchesDomain, true);

  const sharedAppt = result.emails.find(
    (e) => e.email === "appointments@melbournedental.example",
  );
  assert.ok(sharedAppt);
  assert.equal(sharedAppt.kind, "shared_inbox");
  assert.equal(sharedAppt.matchesDomain, true);

  assert.ok(!result.emails.some((e) => e.email.includes("logo@2x.png")));
  assert.equal(result.emails[0]?.email, "dr.tan@melbournedental.example");
});

test("discoverPeopleFromCompanyWebsites captures $0 public emails (direct vs shared) & phones while preserving exclusions", async () => {
  const clinic = makeClinicAccount(
    "00000000-0000-4000-8000-000000000921",
    "Melbourne Family Dental",
    "https://melbournedental.example",
  );
  const committee = deriveBuyingCommitteeCriteria({
    industry: dentalIndustry,
    brief: null,
    shortlistedAccounts: [clinic],
  });

  const homeHtml = `
    <html>
      <body>
        <header><a href="tel:+61395551234">(03) 9555 1234</a></header>
        <nav>
          <a href="/team">Our Team</a>
          <a href="/contact">Contact Us</a>
        </nav>
        <main><h1>Melbourne Family Dental</h1></main>
      </body>
    </html>
  `;
  const teamHtml = `
    <html>
      <body>
        <section class="team">
          <article class="member-card">
            <h3>Dr. Jason Lim</h3>
            <p class="role">Principal Dentist</p>
            <a href="mailto:jason.lim@melbournedental.example">Email Dr. Lim</a>
          </article>
          <article class="member-card">
            <h3>Sarah Jenkins</h3>
            <p class="role">Practice Manager</p>
          </article>
          <article class="member-card">
            <h3>Chloe Patel</h3>
            <p class="role">Receptionist</p>
          </article>
        </section>
      </body>
    </html>
  `;
  const contactHtml = `
    <html>
      <body>
        <p>General clinic desk: <a href="mailto:info@melbournedental.example">info@melbournedental.example</a></p>
      </body>
    </html>
  `;

  const result = await discoverPeopleFromCompanyWebsites([clinic], committee, {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetch: (async (input) => {
      const url = String(input);
      if (url.includes("/team")) {
        return new Response(teamHtml, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.includes("/contact")) {
        return new Response(contactHtml, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(homeHtml, { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch,
  });

  const jason = result.people.find((p) => p.fullName === "Dr. Jason Lim");
  const sarah = result.people.find((p) => p.fullName === "Sarah Jenkins");
  assert.ok(jason);
  assert.equal(jason.publicEmail, "jason.lim@melbournedental.example");
  assert.equal(jason.publicEmailKind, "direct_public");
  assert.equal(jason.publicPhone, "+61395551234");

  assert.ok(sarah);
  assert.equal(sarah.publicEmail, "info@melbournedental.example");
  assert.equal(sarah.publicEmailKind, "shared_inbox");
  assert.equal(sarah.publicPhone, "+61395551234");

  assert.ok(!result.people.some((p) => p.fullName === "Chloe Patel"));
});

test("enrichProspeoPeople calls /bulk-enrich-person once and accounts for verified, free_enrichment, and misses", async () => {
  const prevKey = process.env.PROSPEO_KEY;
  process.env.PROSPEO_KEY = "test-prospeo-key";
  let callCount = 0;

  try {
    const response = await enrichProspeoPeople(
      [
        {
          contactId: "c-1",
          fullName: "Dr. Jason Lim",
          firstName: "Jason",
          lastName: "Lim",
          companyName: "Melbourne Family Dental",
          website: "https://melbournedental.example",
        },
        {
          contactId: "c-2",
          fullName: "Sarah Jenkins",
          firstName: "Sarah",
          lastName: "Jenkins",
          companyName: "Melbourne Family Dental",
          website: "https://melbournedental.example",
          prospeoPersonId: "prospeo-p2",
        },
        {
          contactId: "c-3",
          fullName: "Unknown Manager",
          companyName: "Side Clinic",
          website: "https://sideclinic.example",
        },
      ],
      (async (url, init) => {
        callCount += 1;
        assert.ok(String(url).endsWith("/bulk-enrich-person"));
        const body = JSON.parse(String(init?.body ?? "{}"));
        assert.equal(body.only_verified_email, true);
        assert.equal(body.enrich_mobile, false);
        assert.equal(body.data.length, 3);
        assert.equal(body.data[0].company_website, "melbournedental.example");
        assert.equal(body.data[1].person_id, "prospeo-p2");

        return new Response(
          JSON.stringify({
            error: false,
            matched: [
              {
                identifier: "c-1",
                free_enrichment: false,
                person: {
                  email: {
                    email: "jason.lim@melbournedental.example",
                    status: "VERIFIED",
                    verification_method: "smtp",
                  },
                },
                company: { domain: "melbournedental.example" },
              },
              {
                identifier: "c-2",
                free_enrichment: true,
                person: {
                  email: {
                    email: "sarah@melbournedental.example",
                    status: "VERIFIED",
                    verification_method: "catchall_verified",
                  },
                },
                company: { domain: "melbournedental.example" },
              },
            ],
            not_matched: ["c-3"],
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    );

    assert.equal(callCount, 1);
    assert.equal(response.creditsCharged, 1);
    assert.equal(response.results[0]?.verified, true);
    assert.equal(response.results[0]?.email, "jason.lim@melbournedental.example");
    assert.equal(response.results[1]?.verified, true);
    assert.equal(response.results[1]?.freeEnrichment, true);
    assert.equal(response.results[2]?.verified, false);
    assert.equal(response.results[2]?.email, null);
    assert.equal(response.results[2]?.emailStatus, "NOT_MATCHED");

    const noResults = await enrichProspeoPeople(
      [
        {
          contactId: "c-none",
          fullName: "No Match Person",
          companyName: "Nowhere Dental",
        },
      ],
      (async () =>
        new Response(
          JSON.stringify({ error: true, error_code: "NO_RESULTS" }),
          { status: 400 },
        )) as typeof fetch,
    );
    assert.equal(noResults.creditsCharged, 0);
    assert.equal(noResults.results[0]?.verified, false);
    assert.equal(noResults.results[0]?.emailStatus, "NO_RESULTS");

    await assert.rejects(
      () => enrichProspeoPeople([]),
      (err: unknown) => err instanceof ProspeoClientError && err.code === "INVALID_FILTERS",
    );
  } finally {
    if (prevKey === undefined) delete process.env.PROSPEO_KEY;
    else process.env.PROSPEO_KEY = prevKey;
  }
});

test("multi-provider verification preview, cohort formatting, and outreach eligibility handle Prospeo & public emails transparently", () => {
  const account = makeClinicAccount(
    "00000000-0000-4000-8000-000000000931",
    "Harbour Dental Studio",
    "https://harbourdental.example",
  );

  const namedPublicDirect = normalizeDiscoveredPersonCandidate(
    {
      id: "abc",
      providerKey: "website_team",
      fullName: "Dr. Mei Ling Tan",
      firstName: "Mei Ling",
      lastName: "Tan",
      title: "Principal Dentist",
      linkedInUrl: "https://www.linkedin.com/in/mei-ling-tan",
      sourceUrl: "https://harbourdental.example/team",
      publicEmail: "mei.tan@harbourdental.example",
      publicEmailKind: "direct_public",
      publicPhone: "+61 2 9000 3333",
    },
    {
      candidateId: "00000000-0000-4000-8000-000000000941",
      conversationId: convId,
      targetDecisionId: decisionId,
      personSearchId,
      account,
      roleRecommendations: [],
      providerKey: "website_team",
      capturedAt: now,
    },
  );

  const rowPublic = formatContactForCohortTable(namedPublicDirect);
  assert.equal(rowPublic.publicEmail, "mei.tan@harbourdental.example");
  assert.equal(rowPublic.publicEmailKind, "direct_public");
  assert.equal(rowPublic.bestEmail, "mei.tan@harbourdental.example");
  assert.equal(rowPublic.emailSourceLabel, "Website (direct)");
  assert.equal(rowPublic.publicPhone, "+61 2 9000 3333");

  const unverifiedPublicEligibility = evaluateContactEligibility(namedPublicDirect, "email");
  assert.equal(unverifiedPublicEligibility.status, "blocked_unverified_email");
  assert.equal(unverifiedPublicEligibility.canProposeEmailSend, false);
  assert.ok(
    unverifiedPublicEligibility.reasons.some((r) =>
      r.includes("mei.tan@harbourdental.example"),
    ),
  );

  const prospeoPreview = buildContactVerificationPreview({
    verificationRunId: "00000000-0000-4000-8000-000000000951",
    conversationId: convId,
    personSearchId,
    selectedContacts: [namedPublicDirect],
    providerKey: "prospeo",
    nowIso: now,
  });
  assert.equal(prospeoPreview.providerKey, "prospeo");
  assert.equal(prospeoPreview.estimatedCredits, 1);
  assert.ok(prospeoPreview.previewPairs[0]?.fieldsSent.includes("linkedin_url"));
  assert.match(prospeoPreview.estimateDetail, /Prospeo/);

  const prospeoVerified = {
    ...namedPublicDirect,
    verificationStatus: "verified" as const,
    verifiedDetails: {
      email: "mei.tan@harbourdental.example",
      emailQualification: "VERIFIED (smtp)",
      phone: null,
      verifiedDomain: "harbourdental.example",
      provider: "prospeo" as const,
      verifiedAt: now,
    },
    verifiedAt: now,
  };

  const rowVerified = formatContactForCohortTable(prospeoVerified);
  assert.equal(rowVerified.emailSourceLabel, "Prospeo verified");
  assert.equal(rowVerified.bestEmail, "mei.tan@harbourdental.example");

  const verifiedEligibility = evaluateContactEligibility(prospeoVerified, "email");
  assert.equal(verifiedEligibility.status, "eligible");
  assert.equal(verifiedEligibility.canProposeEmailSend, true);
  assert.ok(verifiedEligibility.reasons.some((r) => r.includes("Prospeo-verified email")));
});

test("Dropcontact async polling sends linkedin, prefers nominative@pro, falls back to mobile_phone, and rejects fail qualifications", async () => {
  const prevDropcontact = process.env.DROPCONTACT_API_KEY;
  process.env.DROPCONTACT_API_KEY = "test-dropcontact-key";

  try {
    const account = makeClinicAccount(
      "00000000-0000-4000-8000-000000000961",
      "Harbour Dental Studio",
      "https://harbourdental.example",
    );
    const contact = normalizeDiscoveredPersonCandidate(
      {
        id: "p-1",
        providerKey: "prospeo",
        fullName: "Dr. Mei Ling Tan",
        firstName: "Mei Ling",
        lastName: "Tan",
        title: "Principal Dentist",
        linkedInUrl: "https://www.linkedin.com/in/mei-ling-tan",
      },
      {
        candidateId: "00000000-0000-4000-8000-000000000962",
        conversationId: convId,
        targetDecisionId: decisionId,
        personSearchId,
        account,
        roleRecommendations: [],
        providerKey: "prospeo",
        capturedAt: now,
      },
    );

    const dcPreview = buildContactVerificationPreview({
      verificationRunId: "00000000-0000-4000-8000-000000000963",
      conversationId: convId,
      personSearchId,
      selectedContacts: [contact],
      providerKey: "dropcontact",
      nowIso: now,
    });
    assert.ok(dcPreview.previewPairs[0]?.fieldsSent.includes("linkedin"));
    assert.equal(dcPreview.previewPairs[0]?.fieldsSent.includes("linkedin_url"), false);

    let postCount = 0;
    let getCount = 0;

    const batchRes = await verifyContactsWithDropcontact(
      [
        {
          contactId: "dc-1",
          fullName: "Dr. Mei Ling Tan",
          firstName: "Mei Ling",
          lastName: "Tan",
          companyName: "Harbour Dental Studio",
          website: "https://harbourdental.example",
          linkedInUrl: "https://www.linkedin.com/in/mei-ling-tan",
          fieldsSent: ["first_name", "last_name", "full_name", "company", "website", "linkedin"],
        },
        {
          contactId: "dc-2",
          fullName: "Pengsan Yong",
          firstName: "Pengsan",
          lastName: "Yong",
          companyName: "SmileBay Dental",
          website: "https://smilebaydental.com",
          fieldsSent: ["first_name", "last_name", "full_name", "company", "website"],
        },
        {
          contactId: "dc-3",
          fullName: "Unreachable Buyer",
          firstName: "Unreachable",
          lastName: "Buyer",
          companyName: "Clinic Three",
          website: null,
          fieldsSent: ["first_name", "last_name", "full_name", "company"],
        },
      ],
      (async (url, init) => {
        const target = String(url);
        if ((init?.method ?? "GET") === "POST") {
          postCount += 1;
          const body = JSON.parse(String(init?.body ?? "{}"));
          assert.equal(body.data[0].linkedin, "https://www.linkedin.com/in/mei-ling-tan");
          return new Response(
            JSON.stringify({
              error: false,
              success: true,
              request_id: "dc-async-1",
              credits_left: 47,
            }),
            { status: 200 },
          );
        }

        assert.equal(target, "https://api.dropcontact.io/batch/dc-async-1");
        getCount += 1;
        if (getCount === 1) {
          return new Response(
            JSON.stringify({
              error: true,
              reason: "Your request is not ready yet",
            }),
            { status: 200 },
          );
        }

        return new Response(
          JSON.stringify({
            error: false,
            success: true,
            request_id: "dc-async-1",
            data: [
              {
                email: [
                  { email: "info@harbourdental.example", qualification: "generic@pro" },
                  { email: "invalid@harbourdental.example", qualification: "fail" },
                  { email: "mei.tan@harbourdental.example", qualification: "nominative@pro" },
                ],
                mobile_phone: "+60 12 345 6789",
                website: "https://harbourdental.example",
                custom_fields: { ano_contact_id: "dc-1" },
              },
              {
                email: "pengsan@smilebaydental.com",
                qualification: "catch_all@pro",
                phone: "+60 4 643 1111",
                website: "smilebaydental.com",
                custom_fields: { ano_contact_id: "dc-2" },
              },
              {
                email: "bounced@clinicthree.example",
                qualification: "fail",
                custom_fields: { ano_contact_id: "dc-3" },
              },
            ],
          }),
          { status: 200 },
        );
      }) as typeof fetch,
      { pollIntervalMs: 0, maxPollAttempts: 3 },
    );

    assert.equal(postCount, 1);
    assert.equal(getCount, 2);
    assert.equal(batchRes.requestId, "dc-async-1");
    assert.equal(batchRes.creditsLeft, 47);
    assert.equal(batchRes.results[0]?.verified, true);
    assert.equal(batchRes.results[0]?.email, "mei.tan@harbourdental.example");
    assert.equal(batchRes.results[0]?.emailQualification, "nominative@pro");
    assert.equal(batchRes.results[0]?.phone, "+60 12 345 6789");
    assert.equal(batchRes.results[0]?.verifiedDomain, "harbourdental.example");
    assert.equal(batchRes.results[1]?.verified, true);
    assert.equal(batchRes.results[1]?.email, "pengsan@smilebaydental.com");
    assert.equal(batchRes.results[1]?.emailQualification, "catch_all@pro");
    assert.equal(batchRes.results[1]?.phone, "+60 4 643 1111");
    assert.equal(batchRes.results[2]?.verified, false);
    assert.equal(batchRes.results[2]?.email, null);

    let slowPostCount = 0;
    let slowGetCount = 0;
    await assert.rejects(
      () =>
        verifyContactsWithDropcontact(
          [
            {
              contactId: "dc-slow",
              fullName: "Slow Contact",
              firstName: null,
              lastName: null,
              companyName: "Slow Dental",
              website: null,
              fieldsSent: ["full_name", "company"],
            },
          ],
          (async (_url, init) => {
            if ((init?.method ?? "GET") === "POST") {
              slowPostCount += 1;
              return new Response(
                JSON.stringify({
                  error: false,
                  success: true,
                  request_id: "dc-slow-1",
                  credits_left: 46,
                }),
                { status: 200 },
              );
            }
            slowGetCount += 1;
            return new Response(
              JSON.stringify({ error: true, reason: "Your request is not ready yet" }),
              { status: 200 },
            );
          }) as typeof fetch,
          { pollIntervalMs: 0, maxPollAttempts: 2 },
        ),
      (err: unknown) => err instanceof DropcontactClientError && err.code === "TIMEOUT_NO_RETRY",
    );
    assert.equal(slowPostCount, 1);
    assert.equal(slowGetCount, 2);
  } finally {
    if (prevDropcontact === undefined) delete process.env.DROPCONTACT_API_KEY;
    else process.env.DROPCONTACT_API_KEY = prevDropcontact;
  }
});

test("3-way email routing directs Dropcontact requests deterministically and exposes emailSources in prompt", () => {
  const account = makeClinicAccount(
    "00000000-0000-4000-8000-000000000971",
    "SmileBay Dental",
    "https://smilebaydental.com",
  );
  const contact = normalizeDiscoveredPersonCandidate(
    {
      id: "p-9",
      providerKey: "prospeo",
      fullName: "Pengsan Yong",
      firstName: "Pengsan",
      lastName: "Yong",
      title: "Managing Director",
    },
    {
      candidateId: "00000000-0000-4000-8000-000000000972",
      conversationId: convId,
      targetDecisionId: decisionId,
      personSearchId,
      account,
      roleRecommendations: [],
      providerKey: "prospeo",
      capturedAt: now,
    },
  );

  const conversation: ResearchConversationView = {
    conversation: {
      id: convId,
      title: "Malaysia dental clinics",
      status: "complete_without_research",
      threadId: `ano:ws:${convId}`,
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: "00000000-0000-4000-8000-000000000973",
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
    personSearch: null,
    verificationRun: null,
    contacts: [contact],
    playbooks: [],
  };

  const { user } = buildConversationChatPrompt(
    {
      conversation,
      peopleDiscovery,
      emailSources: { prospeoAvailable: true, dropcontactAvailable: true },
    },
    "try dropcontact on the unverified contacts",
  );
  assert.match(
    user,
    /Email sources configured: Company websites \(\$0, always ready\) \| Prospeo \(ready\) \| Dropcontact \(ready\)\./,
  );

  const routed = applyDeterministicChatFailsafes(
    "try dropcontact on the unverified contacts",
    {
      reply: "Staging Dropcontact verification.",
      approveAction: null,
      filterUpdate: null,
      shortlistUpdate: null,
      peopleUpdate: null,
      verificationUpdate: null,
      templateUpdate: null,
    },
    { conversation, peopleDiscovery },
  );
  assert.equal(routed.verificationUpdate?.apply, true);
  assert.equal(routed.verificationUpdate?.providerKey, "dropcontact");
  assert.equal(routed.verificationUpdate?.allUnverified, true);
  assert.equal(routed.verificationUpdate?.executeIfApproved, false);
});

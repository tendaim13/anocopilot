import { expect, test, type Page } from "@playwright/test";

const VENDOR_OR_INTERNAL_LEAK =
  /\b(?:Prospeo|Dropcontact|SearXNG|Tavily|OpenStreetMap|OSM|Nominatim|Overpass|Mercury|Google AI Studio|Gemini|Amazon Bedrock|Bedrock|Ollama|LangGraph|Supabase|PROSPEO_KEY|DROPCONTACT_API_KEY|SEARXNG_BASE_URL|SEARXNG_GATEWAY_TOKEN|GEMINI_API_KEY|AWS_SECRET_ACCESS_KEY|PHASE\s+[A-F]|Phase\s+[A-F])\b/;

const INTERNAL_CREDIT_PRICE = /(?:\bcredits?\b|cr\/found|\$\d)/i;

const NOW = "2026-11-25T00:00:00.000Z";
const WS_ALPHA_ID = "00000000-0000-4000-8000-00000000aa01";
const WS_BETA_ID = "00000000-0000-4000-8000-00000000bb02";
const USER_ID = "00000000-0000-4000-8000-00000000cc03";
const CONV_ID = "00000000-0000-4000-8000-00000000dd04";
const GRAPH_ID = "00000000-0000-4000-8000-00000000ee05";
const RUN_ID = "00000000-0000-4000-8000-00000000ff06";
const DECISION_ID = "00000000-0000-4000-8000-000000001107";
const MARKET_ID = "00000000-0000-4000-8000-000000001208";
const INDUSTRY_ID = "00000000-0000-4000-8000-000000001309";
const CLAIM_ID = "00000000-0000-4000-8000-000000001410";
const SOURCE_ID = "00000000-0000-4000-8000-000000001511";
const SEARCH_ID = "00000000-0000-4000-8000-000000001612";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000001713";
const PERSON_SEARCH_ID = "00000000-0000-4000-8000-000000001814";
const CONTACT_VERIFIED_ID = "00000000-0000-4000-8000-000000001915";
const CONTACT_PUBLIC_ID = "00000000-0000-4000-8000-000000001916";
const PLAYBOOK_ID = "00000000-0000-4000-8000-000000002017";
const TEMPLATE_ID = "00000000-0000-4000-8000-000000002118";

async function installAuthenticatedFixtures(page: Page) {
  let activeWorkspaceId = WS_ALPHA_ID;
  const autopilotStepCalls: string[] = [];
  const workspaceSwitches: string[] = [];

  const workspaces = [
    { id: WS_ALPHA_ID, name: "Northstar Revenue", slug: "northstar-revenue", role: "owner" },
    { id: WS_BETA_ID, name: "Pacific Expansion", slug: "pacific-expansion", role: "admin" },
  ];

  const conversationView = {
    conversation: {
      id: CONV_ID,
      title: "Patient Recall Automation — Australia",
      status: "complete_without_research",
      threadId: `thread-${CONV_ID}`,
      createdAt: NOW,
      updatedAt: NOW,
    },
    run: {
      id: GRAPH_ID,
      status: "complete_without_research",
      graphVersion: "v1",
      currentNode: "locked",
      checkpointRef: "cp-e2e-1",
      failureMessage: null,
    },
    messages: [
      {
        id: "00000000-0000-4000-8000-000000009001",
        role: "user",
        kind: "message",
        text: "We automate patient recall reminders for multi-chair dental groups.",
        createdAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000009002",
        role: "assistant",
        kind: "message",
        text: "Completed market research, shortlisted matching practices, identified named buyers, and drafted outreach.",
        createdAt: NOW,
      },
    ],
    brief: {
      offer: "Patient recall & follow-up automation",
      goal: "Identify high-fit dental clinics and named decision-makers.",
      businessLocation: "Wyoming, USA",
      targetMarkets: ["Australia"],
      intakeComplete: true,
      marketHints: ["Dental Clinic"],
      locationHints: ["Sydney, Australia"],
      buyerHints: ["Principal Dentist", "Practice Manager"],
      constraints: [],
      unknowns: [],
      sourceMessageIds: ["00000000-0000-4000-8000-000000009001"],
    },
    pendingQuestion: null,
    plan: null,
    events: [],
  };

  const dossier = {
    id: ACCOUNT_ID,
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    companySearchId: SEARCH_ID,
    sourceKey: "prospeo:harbour-dental",
    name: "Harbour Dental Studio",
    domain: "harbourdental.com.au",
    website: "https://harbourdental.com.au",
    linkedInUrl: "https://linkedin.com/company/harbour-dental",
    industry: "Dental Clinic",
    location: "Sydney, Australia",
    employeeBand: "11-50",
    employeeCount: 28,
    description: "Multi-chair Sydney practice focused on preventive care.",
    lifecycleState: "shortlisted",
    fit: {
      locationScore: 38,
      industryScore: 34,
      signalScore: 18,
      totalScore: 90,
      confidence: "high",
      rationale: "Scored 90/100 from company profile signals (38/40 location, 34/35 industry alignment, 18/25 profile completeness).",
      industryHypothesisNote: "Market research findings explain why Dental Clinic in Australia was targeted.",
    },
    matchReasons: [
      "Location matches locked target geography Australia (Sydney, Australia, 38/40 fit).",
      "Segment fit for Dental Clinic via industry classification (34/35 alignment).",
      "Verified public web domain (harbourdental.com.au) available for named decision-maker lookup.",
    ],
    signals: [
      {
        id: "sig-e2e-1",
        signalType: "industry_match",
        label: "Target segment relevance match",
        explanation: "Matches Dental Clinic profile in Sydney, Australia.",
        sourceAttribution: "B2B company directory",
        evidenceUrl: "https://harbourdental.com.au",
        capturedAt: NOW,
      },
    ],
    claimIds: [CLAIM_ID],
    evidenceUrls: ["https://harbourdental.com.au"],
    unknowns: ["Confirm current patient recall software vendor during initial outreach."],
    retrievedAt: NOW,
  };

  const contacts = [
    {
      id: CONTACT_VERIFIED_ID,
      conversationId: CONV_ID,
      targetDecisionId: DECISION_ID,
      personSearchId: PERSON_SEARCH_ID,
      accountCandidateId: ACCOUNT_ID,
      accountName: "Harbour Dental Studio",
      accountDomain: "harbourdental.com.au",
      discoveryProvider: "prospeo",
      sourceKey: "prospeo-person:mei-tan",
      fullName: "Dr. Mei Tan",
      firstName: "Mei",
      lastName: "Tan",
      title: "Principal Dentist",
      seniority: "Director",
      department: "Medical & Health",
      location: "Sydney, Australia",
      sourceUrl: null,
      linkedInUrl: "https://linkedin.com/in/mei-tan",
      roleRationale: "Clinical practice owner and software sponsor.",
      confidence: "high",
      claimIds: [CLAIM_ID],
      selectedForVerification: true,
      verificationStatus: "verified",
      verifiedDetails: {
        email: "mei@harbourdental.com.au",
        emailQualification: "VERIFIED",
        phone: null,
        verifiedDomain: "harbourdental.com.au",
        provider: "prospeo",
        verifiedAt: NOW,
      },
      retrievedAt: NOW,
      verifiedAt: NOW,
    },
    {
      id: CONTACT_PUBLIC_ID,
      conversationId: CONV_ID,
      targetDecisionId: DECISION_ID,
      personSearchId: PERSON_SEARCH_ID,
      accountCandidateId: ACCOUNT_ID,
      accountName: "Harbour Dental Studio",
      accountDomain: "harbourdental.com.au",
      discoveryProvider: "website_team",
      sourceKey: "website-team:reception",
      fullName: "Liam Chen",
      firstName: "Liam",
      lastName: "Chen",
      title: "Practice Manager",
      seniority: "Manager",
      department: "Operations",
      location: "Sydney, Australia",
      sourceUrl: "https://harbourdental.com.au/team",
      linkedInUrl: null,
      roleRationale: "Practice operations coordinator.",
      confidence: "medium",
      claimIds: [CLAIM_ID],
      selectedForVerification: false,
      verificationStatus: "not_requested",
      verifiedDetails: null,
      publicEmail: "liam@harbourdental.com.au",
      publicEmailKind: "direct_public",
      publicPhone: null,
      retrievedAt: NOW,
      verifiedAt: null,
    },
  ];

  const playbook = {
    id: PLAYBOOK_ID,
    conversationId: CONV_ID,
    targetDecisionId: DECISION_ID,
    accountCandidateId: ACCOUNT_ID,
    accountName: "Harbour Dental Studio",
    targetMarketName: "Australia",
    targetIndustryName: "Dental Clinic",
    status: "ready",
    headline: "Outreach playbook for Harbour Dental Studio (Dental Clinic)",
    accountThesis: "Harbour Dental Studio scored 90/100 (high fit) in Sydney, Australia. Outreach remains draft-only.",
    industryContext: "Multi-chair practices face overdue patient recall gaps.",
    selectedContactIds: [CONTACT_VERIFIED_ID],
    claimIds: [CLAIM_ID],
    signalIds: ["sig-e2e-1"],
    buyerAngles: [
      {
        contactId: CONTACT_VERIFIED_ID,
        personName: "Dr. Mei Tan",
        roleTitle: "Principal Dentist",
        contactProvenance: "verified_contact",
        openingAngle: "Anchor on Sydney multi-chair patient recall follow-ups.",
        valueHypothesis: "Reduce overdue recall gaps without increasing front-desk workload.",
      },
    ],
    evidenceBackedPoints: [
      {
        kind: "research_claim",
        refId: CLAIM_ID,
        statement: "Urban multi-chair clinics report 28% overdue recall visits.",
        attribution: "Direct market research",
      },
    ],
    validationQuestions: ["How are overdue 6-month recall patients currently reminded?"],
    unknowns: ["Current practice management system vendor."],
    createdAt: NOW,
    updatedAt: NOW,
  };

  await page.route("**/api/v1/**", async (route) => {
    const reqUrl = new URL(route.request().url());
    const pathname = reqUrl.pathname;
    const method = route.request().method();

    if (pathname.includes("/autopilot/step")) {
      autopilotStepCalls.push(pathname);
    }

    if (pathname === "/api/v1/workspace" && method === "GET") {
      const current = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          mode: "supabase",
          workspace: current,
          workspaces,
          actor: { id: USER_ID, email: "alex@northstar.example" },
          persistence: "supabase",
        }),
      });
      return;
    }

    if (pathname === "/api/v1/workspace/switch" && method === "POST") {
      const body = route.request().postDataJSON() as { workspaceId?: string };
      if (body?.workspaceId) {
        activeWorkspaceId = body.workspaceId;
        workspaceSwitches.push(body.workspaceId);
      }
      const current = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          mode: "supabase",
          workspace: current,
          workspaces,
          actor: { id: USER_ID, email: "alex@northstar.example" },
          persistence: "supabase",
        }),
      });
      return;
    }

    if (pathname === "/api/v1/workspace/invites") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ invites: [] }),
      });
      return;
    }

    if (pathname === "/api/v1/conversations" && method === "GET") {
      const list =
        activeWorkspaceId === WS_ALPHA_ID
          ? [
              {
                id: CONV_ID,
                title: conversationView.conversation.title,
                status: conversationView.conversation.status,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ]
          : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ conversations: list, nextCursor: null }),
      });
      return;
    }

    if (pathname === `/api/v1/conversations/${CONV_ID}` && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversation: conversationView,
          research: {
            run: {
              id: RUN_ID,
              conversationId: CONV_ID,
              threadId: `thread-${RUN_ID}`,
              attemptNumber: 1,
              status: "sources_ready",
              provider: "searxng",
              maximumSearches: 50,
              maximumFetches: 100,
              consumedSearches: 18,
              consumedFetches: 24,
              currentWave: 3,
              sourceCount: 1,
              failureMessage: null,
              createdAt: NOW,
              updatedAt: NOW,
            },
            actions: [],
            queries: [],
            sources: [
              {
                id: SOURCE_ID,
                url: "https://example.org.au/dental-benchmark",
                title: "Australian Dental Recall Benchmarks",
                sourceClass: "industry",
                sourceProvenance: "public_web",
                evidenceScore: 86,
                excerpt: "Multi-chair urban practices face 28% overdue recalls.",
                fetchedAt: NOW,
              },
            ],
          },
          synthesis: {
            id: SYNTHESIS_ID(),
            conversationId: CONV_ID,
            researchRunId: RUN_ID,
            status: "ready_for_decision",
            recommendationMode: "directly_supported",
            assessment: {
              fetchedSourceCount: 1,
              sourceClassCount: 1,
              coverageStrength: "moderate",
              comparisonReady: true,
              contradictions: [],
              gaps: ["Confirm PMS integration preference"],
              summary: "Direct Australian dental association findings support targeting urban multi-chair clinics.",
            },
            claims: [
              {
                id: CLAIM_ID,
                kind: "observation",
                statement: "Australian urban dental clinics report 28% overdue recall visits.",
                sourceIds: [SOURCE_ID],
                comparisonBasis: null,
                evidenceStrength: "strong",
                citationStatus: "supported",
              },
            ],
            markets: [
              {
                id: MARKET_ID,
                name: "Australia",
                summary: "High density of independent multi-chair private dental groups.",
                evidenceStrength: "moderate",
                claimIds: [CLAIM_ID],
                unknowns: ["PMS renewal timing"],
                nextResearchActions: ["Validate buyer role split across multi-chair groups."],
              },
            ],
            industries: [
              {
                id: INDUSTRY_ID,
                marketProfileId: MARKET_ID,
                name: "Dental Clinic",
                summary: "Independent multi-chair dental practices.",
                operationalProblems: ["Overdue patient recall visits"],
                solutionFit: ["Automated two-way patient recall"],
                buyerRoleHypotheses: ["Principal Dentist", "Practice Manager"],
                evidenceStrength: "moderate",
                claimIds: [CLAIM_ID],
                unknowns: ["Current software stack"],
              },
            ],
            decision: {
              id: DECISION_ID,
              status: "locked",
              marketProfileId: MARKET_ID,
              industryProfileId: INDUSTRY_ID,
              rationale: "Strongest verified recall urgency.",
              selectedAt: NOW,
            },
            report: {
              recommendation: {
                headline: "Prioritize Dental Clinic accounts in Australia",
                summary: "Focus on 11-50 employee urban dental clinics.",
                recommendedMarket: "Australia",
                recommendedIndustry: "Dental Clinic",
                mode: "directly_supported",
              },
              evidence: [
                {
                  claimId: CLAIM_ID,
                  statement: "Australian urban dental clinics report 28% overdue recall visits.",
                  sourceIds: [SOURCE_ID],
                  evidenceStrength: "strong",
                  comparisonBasis: null,
                },
              ],
              comparableEvidence: [],
              assumptions: ["Clinics handle recall reminders manually today."],
              unknowns: ["Preferred PMS vendor."],
              confidence: {
                level: "moderate",
                rationale: "Direct national dental benchmark source supports demand.",
                totalSourcesAnalyzed: 1,
                groupsAnalyzed: 1,
                directEvidenceCount: 1,
                comparableEvidenceCount: 0,
              },
              nextValidationActions: ["Ask shortlisted practices which PMS handles patient reminders."],
            },
            failureMessage: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
          companySearch: {
            id: SEARCH_ID,
            conversationId: CONV_ID,
            targetDecisionId: DECISION_ID,
            providerActionRequestId: null,
            providerKey: "prospeo",
            status: "completed",
            targetMarketName: "Australia",
            targetIndustryName: "Dental Clinic",
            requestedLocations: ["Sydney, Australia"],
            canonicalLocations: ["Sydney, Australia"],
            canonicalIndustries: ["Dental Clinic"],
            industryKeywords: ["dental"],
            excludedCategories: [],
            linkedClaimIds: [CLAIM_ID],
            criteria: ["Locked market route: Australia"],
            providerFilters: {},
            maximumResults: 25,
            estimatedMaximumCredits: 1,
            estimateDetail: "B2B company directory search returns up to 25 matching companies.",
            resultCount: 1,
            providerReceipt: {},
            failureMessage: null,
            cohort: {
              totalReturned: 1,
              providerTotalAvailable: 1,
              shortlistedCount: 1,
              heldCount: 0,
              dismissedCount: 0,
              averageFitScore: 90,
              signalBreakdown: [],
              cohortExplanation: "Returned 1 candidate matching Australia · Dental Clinic.",
              separationNote: "Market insights stay separate from observed company signals.",
            },
            accounts: [dossier],
            approvedAt: NOW,
            completedAt: NOW,
            createdAt: NOW,
            updatedAt: NOW,
          },
          peopleDiscovery: {
            shortlistedCount: 1,
            personSearch: null,
            contacts,
            verificationRun: null,
            playbooks: [playbook],
            industryPlaybook: null,
          },
          outreachExecution: {
            drafts: [],
            proposals: [],
            mercuryConnected: false,
          },
          templatePack: {
            id: TEMPLATE_ID,
            conversationId: CONV_ID,
            targetDecisionId: DECISION_ID,
            version: 1,
            tone: "peer_direct",
            ctaStyle: "easy_yes",
            entryOffer: null,
            senderName: "Alex",
            targetRoles: ["Principal Dentist", "Practice Manager"],
            steps: [
              {
                stepKey: "initial",
                stepNumber: 1,
                label: "Initial Email",
                channel: "email",
                dayOffset: 0,
                subject: "patient recalls at {{company_name}}",
                body: "Hi {{first_name}},\n\nNoticed {{company_name}} runs a multi-chair clinic in {{city}}. Open to a short note on reducing overdue recall visits?\n\nBest,\nAlex",
                mergeFieldsUsed: ["company_name", "first_name", "city"],
                lint: { passed: true, wordCount: 25, maxWords: 120, issues: [] },
              },
            ],
            claimIds: [CLAIM_ID],
            generationMode: "fallback",
            deliveryMode: "draft_only",
            lastInstruction: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
        }),
      });
      return;
    }

    if (pathname === `/api/v1/conversations/${CONV_ID}/autopilot/status`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ autopilotRun: null, activeJob: null }),
      });
      return;
    }

    if (pathname === "/api/v1/work-queue") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workQueue: { needsReviewCount: 0, activeResearchCount: 0, items: [] } }),
      });
      return;
    }

    if (pathname === "/api/v1/companies") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accounts: [
            {
              ...dossier,
              conversationTitle: conversationView.conversation.title,
              targetMarketName: "Australia",
              targetIndustryName: "Dental Clinic",
            },
          ],
        }),
      });
      return;
    }

    if (pathname === "/api/v1/people") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contacts: contacts.map((contact) => ({
            ...contact,
            conversationTitle: conversationView.conversation.title,
            targetMarketName: "Australia",
            targetIndustryName: "Dental Clinic",
          })),
        }),
      });
      return;
    }

    if (pathname === "/api/v1/playbooks") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          playbooks: [
            {
              ...playbook,
              conversationTitle: conversationView.conversation.title,
            },
          ],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  return { autopilotStepCalls, workspaceSwitches };
}

function SYNTHESIS_ID() {
  return "00000000-0000-4000-8000-000000009901";
}

test("Public homepage, health probe, and auth boundaries are white-labeled and functional", async ({ page, request }) => {
  const healthRes = await request.get("/api/health");
  expect(healthRes.status()).toBe(200);
  const healthJson = await healthRes.json();
  expect(healthJson.ok).toBe(true);
  expect(VENDOR_OR_INTERNAL_LEAK.test(JSON.stringify(healthJson))).toBe(false);

  const unauthApiRes = await request.get("/api/v1/conversations");
  expect([401, 403, 503]).toContain(unauthApiRes.status());

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Turn a product brief into researched accounts and ready outreach.",
  );

  await page.getByText("Companies", { exact: true }).click();
  await expect(page.getByText("Klang Valley Cold Storage")).toBeVisible();

  await page.getByText("Contacts", { exact: true }).click();
  await expect(page.getByText("Verified work email").first()).toBeVisible();

  await page.getByText("Outreach", { exact: true }).click();
  await expect(page.getByText("Awaiting approval")).toBeVisible();

  const homeText = await page.locator("body").innerText();
  expect(VENDOR_OR_INTERNAL_LEAK.test(homeText)).toBe(false);
  expect(INTERNAL_CREDIT_PRICE.test(homeText)).toBe(false);

  await page.getByRole("button", { name: /Switch to dark theme/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sign in to Ano");
  await page.goto("/signup");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Get started with Ano");
});

test("Authenticated workspace journey renders research, company match explanations, verified vs public contacts, playbooks, and workspace switch with zero vendor or credit leaks", async ({ page }) => {
  const { autopilotStepCalls, workspaceSwitches } = await installAuthenticatedFixtures(page);

  await page.goto(`/research/${CONV_ID}`);
  await expect(page.getByText("Northstar Revenue").first()).toBeVisible();
  await expect(page.getByText("Harbour Dental Studio").first()).toBeVisible();

  await page.goto("/companies");
  await expect(page.getByText("Why this company matches").first()).toBeVisible();
  await expect(page.getByText(/Location matches locked target geography Australia/).first()).toBeVisible();

  await page.goto("/people");
  await expect(page.getByText("Dr. Mei Tan").first()).toBeVisible();
  await expect(page.getByText(/Verified work email/i).first()).toBeVisible();
  await expect(page.getByText(/Website/i).first()).toBeVisible();

  await page.goto("/playbook");
  await expect(page.getByText("Factual account playbooks").first()).toBeVisible();
  await expect(page.getByText("Harbour Dental Studio").first()).toBeVisible();

  await page.goto("/work");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const bodyText = await page.locator("body").innerText();
  expect(VENDOR_OR_INTERNAL_LEAK.test(bodyText)).toBe(false);
  expect(INTERNAL_CREDIT_PRICE.test(bodyText)).toBe(false);
  expect(autopilotStepCalls).toEqual([]);

  // Switch active workspace via WorkspaceSwitcher menu.
  await page.locator("#ano-ws-switcher-anchor").click();
  await page.locator("#ano-ws-switcher-menu").getByText("Pacific Expansion", { exact: true }).click();
  await expect.poll(() => workspaceSwitches.length).toBeGreaterThan(0);
});

import assert from "node:assert/strict";
import test from "node:test";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  scoreAndBuildAccountDossier,
  type AccountCandidateDossier,
} from "@/lib/ano/company-discovery";
import type { IndustryProfile, MarketProfile, ResearchClaim } from "@/lib/ano/market-synthesis";
import {
  buildDeterministicFallbackTemplatePack,
  lintOutreachEmailStep,
  normalizeMergeTags,
  renderTemplateForContact,
  stripBoilerplateSignOff,
  tidyEmailText,
} from "@/lib/ano/outreach-templates";
import { normalizeDiscoveredPersonCandidate } from "@/lib/ano/people-playbooks";
import type { ResearchBrief, ResearchConversationView } from "@/lib/ano/research-conversation";
import {
  parseConversationChatResponse,
  replyInResearchConversation,
} from "@/server/agents/conversation-chat-model";
import { generateOutreachTemplatePackWithModel } from "@/server/agents/outreach-template-model";

const convId = "00000000-0000-4000-8000-000000009001";
const decisionId = "00000000-0000-4000-8000-000000009002";
const packId = "00000000-0000-4000-8000-000000009003";
const claimId = "00000000-0000-4000-8000-000000009004";
const now = "2026-11-22T17:00:00.000Z";

const brief: ResearchBrief = {
  offer: "Automated SMS and email recall reminders for private dental clinics.",
  goal: "Reduce patient no-shows and fill overdue hygiene chairs.",
  marketHints: ["Australia"],
  locationHints: ["Melbourne, Australia"],
  buyerHints: ["Principal Dentist", "Practice Manager"],
  constraints: ["Do not invent software stack details"],
  unknowns: [],
  sourceMessageIds: [],
};

const market: MarketProfile = {
  id: "00000000-0000-4000-8000-000000009010",
  name: "Australia",
  summary: "High density of independent dental practices using cloud recall systems.",
  evidenceStrength: "strong",
  claimIds: [claimId],
  unknowns: [],
  nextResearchActions: [],
};

const industry: IndustryProfile = {
  id: "00000000-0000-4000-8000-000000009011",
  marketProfileId: market.id,
  name: "Private Dental Clinics",
  summary: "Multi-chair independent dental clinics",
  operationalProblems: ["overdue patient recall reminders falling through front-desk cracks"],
  solutionFit: ["automatic two-way SMS and email recall reminders"],
  buyerRoleHypotheses: ["Principal Dentist", "Practice Manager"],
  evidenceStrength: "strong",
  claimIds: [claimId],
  unknowns: ["Current PMS software"],
};

const claims: ResearchClaim[] = [
  {
    id: claimId,
    kind: "observation",
    statement: "Independent Australian dental practices lose recurring revenue when six-month checkup reminders stay manual.",
    sourceIds: ["00000000-0000-4000-8000-000000009005"],
    comparisonBasis: null,
    evidenceStrength: "strong",
    citationStatus: "supported",
  },
];

const sampleClinic: AccountCandidateDossier = scoreAndBuildAccountDossier(
  {
    provider: "openstreetmap",
    id: "osm-harbour",
    name: "Elevate Dental Studio",
    website: "https://elevatedental.example",
    domain: "elevatedental.example",
    industry: "Dental Clinic",
    location: { city: "Melbourne", country: "Australia" },
    osmTags: { amenity: "dentist" },
  },
  {
    dossierId: "00000000-0000-4000-8000-000000009021",
    conversationId: convId,
    targetDecisionId: decisionId,
    companySearchId: "00000000-0000-4000-8000-000000009022",
    providerKey: "openstreetmap",
    targetMarketName: "Melbourne, Australia",
    targetIndustryName: industry.name,
    canonicalLocations: ["Melbourne, Australia"],
    linkedClaimIds: [claimId],
    capturedAt: now,
    lifecycleState: "shortlisted",
  },
);

test("tidyEmailText, normalizeMergeTags, and stripBoilerplateSignOff clean formatting consistently", () => {
  assert.equal(tidyEmailText("“Smart” quote…  \nLine two\u00A0"), '"Smart" quote...\nLine two');
  assert.equal(
    normalizeMergeTags("Hi {{firstName}}, saw {{company}} hires {{title}} at {{domain}}."),
    "Hi {{first_name}}, saw {{company_name}} hires {{job_title}} at {{website}}.",
  );
  assert.equal(
    stripBoilerplateSignOff("Hi Sam,\n\nSaw your clinic.\n\nBest regards,\nAlex", "Alex Morgan"),
    "Hi Sam,\n\nSaw your clinic.\n\nAlex",
  );
  assert.equal(
    stripBoilerplateSignOff("Hi Sam,\n\nSaw your clinic.\n\nCheers,\n", null),
    "Hi Sam,\n\nSaw your clinic.",
  );
});

test("lintOutreachEmailStep enforces anti-AI voice rules and blanks company names", () => {
  const aiBad = lintOutreachEmailStep({
    stepKey: "initial",
    channel: "email",
    subject: "{{first_name}}, Quick question about https://x.com",
    body: "Hi {{first_name}},\n\nI'm reaching out because in today's market we elevate dental clinics — picture this, seamless recall!\n\n- Benefit one\n- Benefit two\n\nWorth a quick chat? Is this urgent?",
  });
  assert.equal(aiBad.passed, false);
  assert.ok(aiBad.issues.some((i) => i.includes("dash")));
  assert.ok(aiBad.issues.some((i) => i.includes("exclamation")));
  assert.ok(aiBad.issues.some((i) => i.includes("formatting")));
  assert.ok(aiBad.issues.some((i) => i.includes("AI-written")));
  assert.ok(aiBad.issues.some((i) => i.includes("Remove recipient name")));
  assert.ok(aiBad.issues.some((i) => i.includes("quick question")));
  assert.ok(aiBad.issues.some((i) => i.includes("lowercase")));
  assert.ok(aiBad.issues.some((i) => i.includes("URLs")));
  assert.ok(aiBad.issues.some((i) => i.includes("one question")));
  assert.ok(aiBad.issues.some((i) => i.includes('Opens with "I"')));

  // Company name "Elevate Dental Studio" contains "elevate", which must NOT trigger an AI tell when passed in knownNames
  const cleanStep = lintOutreachEmailStep(
    {
      stepKey: "initial",
      channel: "email",
      subject: "elevate dental studio recall",
      body: "Hi Mei,\n\nElevate Dental Studio in Melbourne relies on six-month visits for steady chair utilization. Manual reminder chasing leaves overdue hygiene slots open each week.\n\nIs recall coverage already sorted on your side?",
    },
    { knownNames: ["Elevate Dental Studio"] },
  );
  assert.deepEqual(cleanStep.issues, []);
  assert.equal(cleanStep.passed, true);

  // Follow-up 2 (Breakup) allows "I will leave this here." while enforcing <= 30 words
  const cleanBreakup = lintOutreachEmailStep({
    stepKey: "follow_up_2",
    channel: "email",
    subject: "closing the loop",
    body: "Hi {{first_name}},\n\nI will leave this here for now. Reply anytime if chair recall moves up the list at {{company_name}}.",
  });
  assert.deepEqual(cleanBreakup.issues, []);
  assert.equal(cleanBreakup.passed, true);
});

test("renderTemplateForContact and buildDeterministicFallbackTemplatePack produce clean copy with fallbacks", () => {
  const pack = buildDeterministicFallbackTemplatePack({
    id: packId,
    conversationId: convId,
    targetDecisionId: decisionId,
    brief,
    market,
    industry,
    claims,
    accounts: [sampleClinic],
    includeLinkedIn: true,
    nowIso: now,
  });

  assert.equal(pack.steps.length, 4);
  for (const step of pack.steps) {
    assert.deepEqual(
      step.lint.issues,
      [],
      `Expected zero lint issues for ${step.stepKey}, got: ${step.lint.issues.join(" | ")}`,
    );
    assert.equal(step.lint.passed, true);
  }

  const contact = normalizeDiscoveredPersonCandidate(
    {
      id: "p1",
      providerKey: "website_team",
      fullName: "Dr. Mei Ling Tan",
      firstName: "Mei",
      lastName: "Tan",
      title: "Principal Dentist",
      sourceUrl: "https://elevatedental.example/team",
    },
    {
      candidateId: "00000000-0000-4000-8000-000000009031",
      conversationId: convId,
      targetDecisionId: decisionId,
      personSearchId: "00000000-0000-4000-8000-000000009032",
      account: sampleClinic,
      roleRecommendations: [],
      providerKey: "website_team",
      capturedAt: now,
    },
  );

  const renderedWithLead = renderTemplateForContact(pack.steps[0], contact, sampleClinic, "Alex Morgan");
  assert.ok(renderedWithLead.subject.includes("Elevate Dental Studio"));
  assert.ok(renderedWithLead.body.includes("Hi Mei,"));
  assert.ok(renderedWithLead.body.includes("Melbourne"));
  assert.ok(renderedWithLead.body.endsWith("\n\nAlex"));

  const renderedNoLead = renderTemplateForContact(pack.steps[0], null, null, null);
  assert.ok(renderedNoLead.body.includes("Hi there,"));
  assert.ok(renderedNoLead.body.includes("your company"));
});

test("generateOutreachTemplatePackWithModel performs bounded 1-rewrite loop and preserves merge tags", async () => {
  let invokeCount = 0;
  const mockModel = {
    async invoke(_messages: Array<SystemMessage | HumanMessage>) {
      invokeCount += 1;
      if (invokeCount === 1) {
        return {
          content: JSON.stringify({
            steps: [
              {
                stepKey: "initial",
                subject: "Quick question about {{company}}",
                body: "Hi {{firstName}},\n\nI'm reaching out because in today's dental market — teams miss recalls!\n\nWorth a quick chat?",
              },
              {
                stepKey: "follow_up_1",
                subject: "recall gaps",
                body: "Hi {{first_name}},\n\nMost clinics in {{city}} lose appointments waiting on manual calls. Automated reminders fill open hygiene chairs.\n\nIs this handled on your side?",
              },
              {
                stepKey: "follow_up_2",
                subject: "closing the loop",
                body: "Hi {{first_name}},\n\nI will leave this here. Reply anytime if patient recall becomes a focus at {{company_name}}.",
              },
            ],
          }),
        };
      }
      // Single rewrite fixes step "initial" cleanly and preserves normalized merge tags
      return {
        content: JSON.stringify({
          steps: [
            {
              stepKey: "initial",
              subject: "{{company_name}} recall",
              body: "Hi {{first_name}},\n\nClinics at {{company_name}} often lose repeat checkups when follow-ups stay manual.\n\nWant me to share how we automate two-way reminders?",
            },
          ],
        }),
      };
    },
  };

  const result = await generateOutreachTemplatePackWithModel(
    { provider: "ollama", baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5:14b" },
    {
      templatePackId: packId,
      conversationId: convId,
      targetDecisionId: decisionId,
      version: 1,
      brief,
      market,
      industry,
      claims,
      accounts: [sampleClinic],
      buyingCommittee: null,
      contacts: [],
      tone: "warm_smb",
      ctaStyle: "easy_yes",
      senderName: "Alex",
      nowIso: now,
    },
    mockModel,
  );

  assert.equal(invokeCount, 2);
  assert.equal(result.generationMode, "llm");
  assert.equal(result.steps.length, 3);
  assert.equal(result.steps[0].lint.passed, true);
  assert.equal(result.steps[0].subject, "{{company_name}} recall");
  assert.ok(result.steps[0].body.includes("{{first_name}}"));
  assert.ok(result.steps[0].body.endsWith("\n\nAlex"));
});

test("conversation-chat-model parses templateUpdate commands and suppresses false updates on read-only Q&A", async () => {
  const parsedEdit = parseConversationChatResponse(
    JSON.stringify({
      reply: "Shortened Email 1 to under 40 words in a calmer SMB voice.",
      filterUpdate: null,
      peopleUpdate: null,
      templateUpdate: {
        apply: true,
        tone: "warm_smb",
        maxWords: 40,
        instruction: "Shorten Email 1 under 40 words and avoid salesy framing",
      },
    }),
  );
  assert.equal(parsedEdit.templateUpdate?.apply, true);
  assert.equal(parsedEdit.templateUpdate?.tone, "warm_smb");
  assert.equal(parsedEdit.templateUpdate?.maxWords, 40);

  const mockConv: ResearchConversationView = {
    conversation: {
      id: convId,
      title: "Dental clinics AU",
      status: "complete_without_research",
      threadId: "thread-1",
      createdAt: now,
      updatedAt: now,
    },
    run: {
      id: "00000000-0000-4000-8000-000000009099",
      status: "complete_without_research",
      graphVersion: "phase4b",
      currentNode: "complete",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [],
    brief,
    pendingQuestion: null,
    plan: null,
    events: [],
  };

  // Read-only question must suppress any spurious templateUpdate echoed by a smaller model
  const qaReply = await replyInResearchConversation(
    { provider: "ollama", baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5:14b" },
    { conversation: mockConv },
    "Why is the Email 1 word cap set to 60 words?",
    {
      async invoke() {
        return {
          content: JSON.stringify({
            reply: "Emails under 60 words fit on one phone screen and convert better.",
            templateUpdate: { apply: true, maxWords: 50 },
          }),
        };
      },
    },
  );
  assert.equal(qaReply.templateUpdate, null);
  assert.match(qaReply.reply, /phone screen/);

  const commandReply = await replyInResearchConversation(
    { provider: "ollama", baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5:14b" },
    { conversation: mockConv },
    "Shorten Email 1 to 40 words in warm SMB voice.",
    {
      async invoke() {
        return {
          content: JSON.stringify({
            reply: "Updated Email 1 to under 40 words in warm SMB tone.",
            templateUpdate: { apply: true, tone: "warm_smb", maxWords: 40 },
          }),
        };
      },
    },
  );
  assert.equal(commandReply.templateUpdate?.apply, true);
  assert.equal(commandReply.templateUpdate?.maxWords, 40);
});

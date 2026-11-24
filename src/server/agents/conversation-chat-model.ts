import "server-only";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import {
  autopilotRerunScopeSchema,
  sanitizeAutopilotStageSummariesForChat,
  type AutopilotRerunScope,
  type AutopilotRunView,
} from "@/lib/ano/autopilot";
import {
  formatAccountForCohortTable,
  type CompanySearchView,
} from "@/lib/ano/company-discovery";
import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type { OutreachExecutionView } from "@/lib/ano/outreach-execution";
import {
  templateCtaStyleSchema,
  templateToneSchema,
  type OutreachTemplatePackView,
} from "@/lib/ano/outreach-templates";
import {
  formatContactForCohortTable,
  PROSPEO_DEPARTMENT_OPTIONS,
  PROSPEO_SENIORITY_OPTIONS,
  type PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import {
  maskVendorNamesForDisplay,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import type { LlmPlannerConfig } from "@/server/agents/bedrock-contracts";
import { createPlannerChatModel } from "@/server/agents/ollama-chat-model";

export const chatFilterUpdateSchema = z.object({
  apply: z.boolean(),
  providerKey: z.enum(["openstreetmap", "prospeo"]).optional(),
  locations: z.array(z.string().trim().min(1).max(120)).max(5).optional(),
  locationMode: z.enum(["replace", "append"]).optional(),
  keywords: z.array(z.string().trim().min(3).max(100)).max(15).optional(),
  industries: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  excludedCategories: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  executeIfApproved: z.boolean().optional(),
  reason: z.string().trim().max(280).optional(),
});
export type ChatFilterUpdate = z.infer<typeof chatFilterUpdateSchema>;

export const chatPeopleUpdateSchema = z.object({
  apply: z.boolean(),
  providerKey: z.enum(["website_team", "prospeo"]).optional(),
  departments: z.array(z.string().trim().min(1).max(80)).max(6).optional(),
  seniorities: z.array(z.string().trim().min(1).max(60)).max(6).optional(),
  includeTitles: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
  excludeTitles: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  executeIfApproved: z.boolean().optional(),
  reason: z.string().trim().max(280).optional(),
});
export type ChatPeopleUpdate = z.infer<typeof chatPeopleUpdateSchema>;

export const chatApproveActionSchema = z.object({
  apply: z.boolean(),
  target: z.enum(["company_search", "person_search", "contact_verification", "any_pending"]),
  reason: z.string().trim().max(280).optional(),
});
export type ChatApproveAction = z.infer<typeof chatApproveActionSchema>;

export const chatShortlistUpdateSchema = z.object({
  apply: z.boolean(),
  action: z.enum(["shortlist", "hold", "dismiss"]).default("shortlist"),
  accountNames: z.array(z.string().trim().min(1).max(160)).max(15).optional(),
  locationFilter: z.string().trim().min(1).max(120).optional(),
  topN: z.number().int().min(1).max(10).optional(),
  all: z.boolean().optional(),
  reason: z.string().trim().max(280).optional(),
});
export type ChatShortlistUpdate = z.infer<typeof chatShortlistUpdateSchema>;

export const chatVerificationUpdateSchema = z.object({
  apply: z.boolean(),
  providerKey: z.enum(["prospeo", "dropcontact"]).optional(),
  contactNames: z.array(z.string().trim().min(1).max(160)).max(10).optional(),
  topN: z.number().int().min(1).max(10).optional(),
  allUnverified: z.boolean().optional(),
  executeIfApproved: z.boolean().optional(),
  reason: z.string().trim().max(280).optional(),
});
export type ChatVerificationUpdate = z.infer<typeof chatVerificationUpdateSchema>;

export const chatTemplateUpdateSchema = z.object({
  apply: z.boolean(),
  instruction: z.string().trim().min(1).max(500).optional(),
  tone: templateToneSchema.optional(),
  ctaStyle: templateCtaStyleSchema.optional(),
  entryOffer: z.string().trim().max(240).optional(),
  maxWords: z.number().int().min(20).max(140).optional(),
  reason: z.string().trim().max(280).optional(),
});
export type ChatTemplateUpdate = z.infer<typeof chatTemplateUpdateSchema>;

export const chatAutopilotRerunSchema = z.object({
  apply: z.boolean(),
  scope: autopilotRerunScopeSchema,
  reason: z.string().trim().max(280).optional(),
});
export type ChatAutopilotRerun = z.infer<typeof chatAutopilotRerunSchema>;

export const conversationChatOutputSchema = z.object({
  reply: z.string().trim().min(1).max(4_000),
  approveAction: chatApproveActionSchema.nullable().optional(),
  filterUpdate: chatFilterUpdateSchema.nullable().optional(),
  shortlistUpdate: chatShortlistUpdateSchema.nullable().optional(),
  peopleUpdate: chatPeopleUpdateSchema.nullable().optional(),
  verificationUpdate: chatVerificationUpdateSchema.nullable().optional(),
  templateUpdate: chatTemplateUpdateSchema.nullable().optional(),
  autopilotRerun: chatAutopilotRerunSchema.nullable().optional(),
});
export type ConversationChatOutput = z.infer<typeof conversationChatOutputSchema>;

export type ProductSourceExcerptForChat = {
  label: string;
  sourceType: string;
  summaryText: string | null;
  excerpt: string;
};

export type ConversationChatContext = {
  conversation: ResearchConversationView;
  autopilotRun?: AutopilotRunView | null;
  productSourceExcerpts?: ProductSourceExcerptForChat[] | null;
  research?: EvidenceResearchView | null;
  synthesis?: MarketSynthesis | null;
  companySearch?: CompanySearchView | null;
  peopleDiscovery?: PeopleDiscoveryView | null;
  emailSources?: {
    prospeoAvailable: boolean;
    dropcontactAvailable: boolean;
  } | null;
  outreachExecution?: OutreachExecutionView | null;
  templatePack?: OutreachTemplatePackView | null;
};

function clip(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}…`;
}

export function buildConversationChatPrompt(
  context: ConversationChatContext,
  userMessage: string,
): { system: string; user: string } {
  const {
    conversation,
    autopilotRun = null,
    productSourceExcerpts = null,
    research,
    synthesis,
    companySearch,
    peopleDiscovery,
    emailSources,
    outreachExecution,
    templatePack,
  } = context;

  const lines: string[] = [];

  if (conversation.brief) {
    lines.push(`Offer: ${clip(conversation.brief.offer, 220)}`);
    lines.push(`Goal: ${clip(conversation.brief.goal, 200)}`);
    if (conversation.brief.businessLocation) {
      lines.push(`Business location: ${clip(conversation.brief.businessLocation, 160)}`);
    }
    if (conversation.brief.targetMarkets && conversation.brief.targetMarkets.length > 0) {
      lines.push(`Target selling markets: ${conversation.brief.targetMarkets.join(", ")}`);
    }
    if (conversation.brief.constraints.length > 0) {
      lines.push(`Constraints: ${conversation.brief.constraints.join("; ")}`);
    }
  } else {
    lines.push(`Conversation title: ${conversation.conversation.title}`);
  }

  if (productSourceExcerpts && productSourceExcerpts.length > 0) {
    lines.push(
      "Attached product sources & excerpts:\n" +
        productSourceExcerpts
          .slice(0, 3)
          .map(
            (src) =>
              `- ${src.label} (${src.sourceType})${src.summaryText ? ` [summary: ${clip(src.summaryText, 220)}]` : ""}: ${clip(src.excerpt, 900)}`,
          )
          .join("\n"),
    );
  } else if (conversation.productSources && conversation.productSources.length > 0) {
    lines.push(
      "Attached product sources:\n" +
        conversation.productSources
          .map(
            (src) =>
              `- ${src.label} (${src.sourceType}): ${clip(src.summaryText ?? "", 220)}`,
          )
          .join("\n"),
    );
  }

  if (autopilotRun) {
    lines.push(sanitizeAutopilotStageSummariesForChat(autopilotRun));
  }

  lines.push(`Phase A run status: ${conversation.run.status}`);
  if (conversation.plan) {
    lines.push(
      `Research plan v${conversation.plan.version} (${conversation.plan.approvalStatus}): ${clip(conversation.plan.summary, 240)}`,
    );
  }

  const evidenceSourceTitlesById = new Map<string, string>();
  if (research) {
    for (const src of research.sources) {
      if (src.title) {
        evidenceSourceTitlesById.set(src.id, clip(src.title, 90));
      }
    }
    lines.push(
      `Phase B evidence run: ${research.run.status}, ${research.run.sourceCount} saved sources.`,
    );
    const fetchedTitles = research.sources
      .filter((item) => item.status === "fetched")
      .slice(0, 5)
      .map((item) => `- ${clip(item.title, 100)}`);
    if (fetchedTitles.length > 0) {
      lines.push("Top evidence sources:\n" + fetchedTitles.join("\n"));
    }
  }

  if (synthesis) {
    lines.push(
      `Phase C synthesis (${synthesis.status}, ${synthesis.recommendationMode}): ${clip(synthesis.assessment.summary, 220)}`,
    );
    const lockedMarket = synthesis.markets.find(
      (m) => m.id === synthesis.decision?.marketProfileId,
    );
    const lockedIndustry = synthesis.industries.find(
      (i) => i.id === synthesis.decision?.industryProfileId,
    );
    if (synthesis.decision?.status === "locked" && lockedMarket && lockedIndustry) {
      lines.push(
        `Locked target route: ${lockedMarket.name} -> ${lockedIndustry.name}${synthesis.decision.rationale ? ` | Rationale: ${clip(synthesis.decision.rationale, 240)}` : ""}`,
      );
      if (lockedMarket.summary) {
        lines.push(`Locked market profile: ${clip(lockedMarket.summary, 240)}`);
      }
      if (lockedIndustry.summary) {
        lines.push(`Locked industry profile: ${clip(lockedIndustry.summary, 240)}`);
      }
      if (lockedIndustry.operationalProblems.length > 0) {
        lines.push(`Industry pain points: ${lockedIndustry.operationalProblems.slice(0, 4).join("; ")}`);
      }
      if (lockedIndustry.solutionFit.length > 0) {
        lines.push(`Product-solution fit: ${lockedIndustry.solutionFit.slice(0, 4).join("; ")}`);
      }
    } else if (synthesis.markets.length > 0 || synthesis.industries.length > 0) {
      lines.push(
        `Markets: ${synthesis.markets.map((m) => m.name).join(", ") || "none"} | Industries: ${synthesis.industries.map((i) => i.name).join(", ") || "none"}`,
      );
    }
    if (synthesis.claims.length > 0) {
      lines.push(
        "Key synthesis claims:\n" +
        synthesis.claims
          .slice(0, 8)
          .map((c) => {
            const sourceTitles = Array.from(
              new Set(
                c.sourceIds
                  .map((sourceId) => evidenceSourceTitlesById.get(sourceId))
                  .filter((title): title is string => Boolean(title)),
              ),
            ).slice(0, 2);
            const citationSuffix =
              sourceTitles.length > 0 ? ` [sources: ${sourceTitles.join("; ")}]` : "";
            return `- (${c.kind}) ${clip(c.statement, 180)}${citationSuffix}`;
          })
          .join("\n"),
      );
    }
  }

  if (companySearch) {
    lines.push(
      `Phase D company search (${companySearch.providerKey}, status=${companySearch.status}): locations=[${companySearch.requestedLocations.join("; ")}], keywords=[${companySearch.industryKeywords.join(", ")}]${companySearch.canonicalIndustries?.length ? `, industries=[${companySearch.canonicalIndustries.join(", ")}]` : ""}${companySearch.excludedCategories.length ? `, excluded=[${companySearch.excludedCategories.join(", ")}]` : ""}, returned=${companySearch.accounts.length}.`,
    );
    if (companySearch.accounts.length > 0) {
      const tableLines = companySearch.accounts.slice(0, 25).map((acc, index) => {
        const row = formatAccountForCohortTable(acc);
        return `${index + 1}. ${row.name} | ${row.specialisation} | ${row.city}, ${row.country} | domain=${row.domain ?? "none"} | fit=${row.fitScore}/100 | state=${row.lifecycleState}`;
      });
      lines.push("Discovered companies table:\n" + tableLines.join("\n"));
    }
  }

  if (peopleDiscovery) {
    const ps = peopleDiscovery.personSearch;
    const committee = ps?.buyingCommittee;
    lines.push(
      `Phase E people/playbooks: shortlistedAccounts=${peopleDiscovery.shortlistedCount}, contacts=${peopleDiscovery.contacts.length}, verified=${peopleDiscovery.contacts.filter((c) => c.verificationStatus === "verified").length}, playbooks=${peopleDiscovery.playbooks.length}${ps ? `, personProvider=${ps.providerKey}, personSearchStatus=${ps.status}` : ""}.`,
    );
    if (committee) {
      lines.push(
        `Active Buying Committee: archetype=${committee.archetype}, departments=[${committee.departments.join(", ")}], seniorities=[${committee.seniorities.join(", ")}], includeTitles=[${committee.includeTitles.join(", ")}], excludeTitles=[${committee.excludeTitles.join(", ")}].`,
      );
    } else if (ps?.approvedRoles.length) {
      lines.push(`Target buyer roles: ${ps.approvedRoles.join(", ")}.`);
    }
    if (peopleDiscovery.contacts.length > 0) {
      const contactLines = peopleDiscovery.contacts.slice(0, 30).map((contact, idx) => {
        const row = formatContactForCohortTable(contact);
        const emailSuffix = row.verifiedEmail
          ? ` (${row.verifiedEmail} verified)`
          : contact.publicEmail
            ? ` (website: ${contact.publicEmail}${contact.publicEmailKind ? ` · ${contact.publicEmailKind}` : ""})`
            : "";
        const resolvedPhone = contact.verifiedDetails?.phone ?? contact.publicPhone;
        const phoneSuffix = resolvedPhone ? ` | tel=${resolvedPhone}` : "";
        return `${idx + 1}. ${row.fullName} | ${row.title} | ${row.department} / ${row.seniority} | ${row.accountName} | source=${row.sourceLabel} | status=${row.verificationStatus}${emailSuffix}${phoneSuffix}`;
      });
      lines.push("Discovered people table:\n" + contactLines.join("\n"));
    }
  }

  if (emailSources) {
    lines.push(
      `Email sources configured: Company websites ($0, always ready) | Prospeo (${emailSources.prospeoAvailable ? "ready" : "key missing"}) | Dropcontact (${emailSources.dropcontactAvailable ? "ready" : "key missing"}).`,
    );
  }

  if (outreachExecution) {
    lines.push(
      `Phase F outreach: drafts=${outreachExecution.drafts.length}, proposals=${outreachExecution.proposals.length}.`,
    );
  }

  const pendingApprovals: string[] = [];
  if (companySearch?.status === "awaiting_approval") {
    pendingApprovals.push(
      `- company_search (provider=${companySearch.providerKey}, locations=[${companySearch.canonicalLocations.join("; ")}], keywords=[${companySearch.industryKeywords.join(", ")}])`,
    );
  }
  if (peopleDiscovery?.personSearch?.status === "awaiting_approval") {
    const ps = peopleDiscovery.personSearch;
    pendingApprovals.push(
      `- person_search (provider=${ps.providerKey}, accounts=[${ps.shortlistedAccountNames.join(", ")}], roles=[${ps.approvedRoles.join(", ")}])`,
    );
  }
  if (peopleDiscovery?.verificationRun?.status === "awaiting_approval") {
    const vr = peopleDiscovery.verificationRun;
    pendingApprovals.push(
      `- contact_verification (provider=${vr.providerKey}, contacts=${vr.selectedContactIds.length})`,
    );
  }
  if (pendingApprovals.length > 0) {
    lines.push("Pending approvals ready to execute upon user confirmation:\n" + pendingApprovals.join("\n"));
  }

  if (templatePack) {
    const stepSummaries = templatePack.steps
      .map(
        (step) =>
          `- Step ${step.stepNumber} (${step.stepKey}, Day ${step.dayOffset}, ${step.channel}): subject="${step.subject || "(none)"}" | ${step.lint.wordCount}/${step.lint.maxWords}w | humanVoicePassed=${step.lint.passed}${step.lint.issues.length ? ` | issues=${step.lint.issues.join("; ")}` : ""} | preview="${clip(step.body, 140)}"`,
      )
      .join("\n");
    lines.push(
      `Phase 9B outreach template sequence (v${templatePack.version}, tone=${templatePack.tone}, cta=${templatePack.ctaStyle}${templatePack.entryOffer ? `, offer="${templatePack.entryOffer}"` : ""}):\n${stepSummaries}`,
    );
  }

  const recentTurns = conversation.messages.slice(-8);
  if (recentTurns.length > 0) {
    lines.push(
      "Recent chat turns:\n" +
      recentTurns
        .map((msg) => `${msg.role === "assistant" ? "Ano" : "User"}: ${clip(msg.text, 350)}`)
        .join("\n"),
    );
  }

  const system = `You are Ano, a practical, genuinely agentic two-way AI sales-research copilot.
Use ONLY the workspace snapshot provided by the user message. Never invent companies, people, websites, emails, statistics, or source facts not present in the snapshot. Refer to discovered people in the third person (never say "you have been identified as <person>").

HONESTY & EXECUTION RULE:
- NEVER claim a company search, people search, shortlist change, email verification, or autopilot stage re-run has ALREADY finished or returned new contacts unless those exact results are already visible in the workspace snapshot above.
- NEVER mention API credits, dollar costs, '$0', daily budgets, or billing to the user.
- NEVER suggest or claim you are sending emails or pushing CRM proposals autonomously — outbound sends and CRM writes remain confirmation-gated.
- WHITE-LABEL OUTPUT RULE: In your "reply" string, NEVER mention backend vendors, search engines, model providers, or infrastructure names (such as Prospeo, Dropcontact, SearXNG, OpenStreetMap, Nominatim, Overpass, Mercury, Google AI Studio, Gemini, Bedrock, Ollama, LangGraph, or Supabase) or internal environment variables/credits. Refer instead to "public web search", "local business directory", "B2B company directory", "work email verification", "company websites", or "your CRM".
- POST-AUTOPILOT REFERENCE Q&A: When autopilot stages or saved artifacts are present and the user asks an explanatory or lookup question (e.g. "Why did you pick...?", "Show me emails/phones for...", "Which contacts should I prioritize?"), answer directly from the attached product sources, locked route rationale, Phase C claims/evidence sources, company rows, and people/email/phone rows without emitting any action directive.
- When you emit an action object below, state concisely what you are updating or initiating; the server executes approved steps and downstream autopilot stages automatically.

Output strictly valid JSON matching:
{
  "reply": "string — direct, helpful answer referencing exact rows, claims, and sources from the snapshot",
  "approveAction": null | {
    "apply": boolean,
    "target": "company_search" | "person_search" | "contact_verification" | "any_pending",
    "reason": "short summary of what preview the user approved"
  },
  "filterUpdate": null | {
    "apply": boolean,
    "providerKey": "openstreetmap" | "prospeo" (optional),
    "locations": ["city or country", ...] (optional, max 5),
    "locationMode": "replace" | "append" (optional, "append" when adding onto existing locations like "also include Singapore"),
    "keywords": ["3+ char keyword", ...] (optional, max 15),
    "industries": ["exact Prospeo industry", ...] (optional, max 8),
    "excludedCategories": ["term to exclude", ...] (optional, max 8),
    "executeIfApproved": boolean (optional, true ONLY when user explicitly confirmed running the search),
    "reason": "short summary of requested filter adjustment"
  },
  "shortlistUpdate": null | {
    "apply": boolean,
    "action": "shortlist" | "hold" | "dismiss",
    "accountNames": ["Company Name", ...] (optional, max 15),
    "locationFilter": "country or city" (optional),
    "topN": number (optional, 1-10),
    "all": boolean (optional),
    "reason": "short summary of shortlist change"
  },
  "peopleUpdate": null | {
    "apply": boolean,
    "providerKey": "website_team" | "prospeo" (optional),
    "departments": ["C-Suite"|"Operations"|"Medical & Health"|"Finance"|"Information Technology"|"Engineering & Technical"|"Sales"|"Marketing"|"Product"|"Human Resources", ...] (optional, max 6),
    "seniorities": ["Founder/Owner"|"C-Suite"|"Partner"|"Vice President"|"Head"|"Director"|"Manager"|"Senior", ...] (optional, max 6),
    "includeTitles": ["Job Title", ...] (optional, max 10),
    "excludeTitles": ["Title to exclude", ...] (optional, max 12),
    "executeIfApproved": boolean (optional, true ONLY when user explicitly confirmed running the search),
    "reason": "short summary of requested persona update"
  },
  "verificationUpdate": null | {
    "apply": boolean,
    "providerKey": "prospeo" | "dropcontact" (optional),
    "contactNames": ["Full Name or Company", ...] (optional, max 10),
    "topN": number (optional, 1-10),
    "allUnverified": boolean (optional),
    "executeIfApproved": boolean (optional, true ONLY when user explicitly confirmed running email verification),
    "reason": "short summary of requested email verification"
  },
  "templateUpdate": null | {
    "apply": boolean,
    "instruction": "concise rewrite directive preserving facts" (optional),
    "tone": "peer_direct" | "curious" | "executive_brief" | "warm_smb" (optional),
    "ctaStyle": "easy_yes" | "free_offer" | "direct_question" (optional),
    "entryOffer": "concrete free offer for email 1" (optional),
    "maxWords": number (optional, 20-140),
    "reason": "short summary of requested template change"
  },
  "autopilotRerun": null | {
    "apply": boolean,
    "scope": "companies_people_templates" | "companies_and_people" | "people_and_emails" | "email_enrichment" | "templates_only",
    "reason": "short summary of which downstream autopilot stages should re-run"
  }
}

CRITICAL DEFAULT RULE:
- Set ALL action fields ("approveAction", "filterUpdate", "shortlistUpdate", "peopleUpdate", "verificationUpdate", "templateUpdate", "autopilotRerun") to null whenever the user asks a read-only question ("who", "what", "which", "why", "how", "show me", "what hasn't been done", "what next steps") without commanding you to change filters, approve/run a search, shortlist companies, find contacts, verify emails, or edit templates. Never copy existing snapshot settings into any action object during a question.

Action Rules:
1. approveAction:
   - Set "approveAction": { "apply": true, "target": ... } whenever Pending approvals exist in the snapshot and the user says "yes", "approved", "approve", "go ahead", "confirm", or "proceed to search".
   - Choose the specific target if clear, otherwise "any_pending".
2. filterUpdate (company cohort discovery):
   - Set "filterUpdate": { "apply": true, ... } when the user asks to filter, narrow, expand, add or focus on a country/city (e.g. "only Malaysia", "also include Singapore" with locationMode="append", "try Singapore", "switch to Selangor clinics only"), exclude terms, switch provider ("openstreetmap" for local clinics/businesses, "prospeo" for B2B corporate database), or find more companies.
   - Only include fields the user wants changed. Set "executeIfApproved": true ONLY when the user explicitly approved running the search right now.
3. shortlistUpdate (shortlist / hold / dismiss companies):
   - Set "shortlistUpdate": { "apply": true, ... } when the user asks to shortlist, select, focus on, hold, or dismiss discovered companies by name ("accountNames"), country/city ("locationFilter"), count ("topN"), or "all": true.
4. peopleUpdate (buying committee & decision-maker discovery):
   - Set "peopleUpdate": { "apply": true, ... } when the user asks to get/find contacts or decision-makers, shortlist & find buyers at discovered companies, shift target job titles (e.g. "target Practice Managers instead"), change departments (${PROSPEO_DEPARTMENT_OPTIONS.join(", ")}), change seniorities (${PROSPEO_SENIORITY_OPTIONS.join(", ")}), or switch people provider ("website_team" for website crawl vs "prospeo" for B2B database).
   - IMPORTANT FALLBACK RULE: When the user asks to get/extract/check emails or contacts FROM COMPANY WEBSITES or says Prospeo didn't work / returned 0 emails, set "peopleUpdate": { "apply": true, "providerKey": "website_team" } (website scan + automatic backfill of public emails/phones onto existing contacts) — do NOT re-stage Prospeo verification.
   - If the user asks to get contacts in a country where companies aren't filtered/shortlisted yet (e.g. "give me 10 contacts in Malaysia"), emit BOTH "filterUpdate" (for that location) AND "shortlistUpdate" (locationFilter/topN) AND "peopleUpdate" so the backend coordinates the workflow smoothly without dead ends.
5. verificationUpdate (Phase 9A email lookup/enrichment, max 10 contacts):
   - Set "verificationUpdate": { "apply": true, ... } when the user asks to verify, enrich, run another verification pass, or look up email addresses for discovered contacts.
6. templateUpdate (blaster-ready cold email sequence):
   - Set "templateUpdate": { "apply": true, ... } ONLY when the user explicitly asks to write, generate, rewrite, shorten, adjust tone/CTA/offer of, or refine outreach email templates.
7. autopilotRerun (ONLY when an Autopilot status block exists in the snapshot and the user requests a downstream change):
   - Geo / keyword / provider change ("also include Singapore", "try Singapore", "switch to Selangor clinics only") -> emit "filterUpdate" + "autopilotRerun": { "apply": true, "scope": "companies_people_templates" }.
   - More leads ("find 10 more companies") -> emit "filterUpdate"/"shortlistUpdate" + "autopilotRerun": { "apply": true, "scope": "companies_and_people" }.
   - Target buyer role shift ("target Practice Managers instead") -> emit "peopleUpdate" + "autopilotRerun": { "apply": true, "scope": "people_and_emails" }.
   - Email verification boost ("run another verification pass on unverified contacts") -> emit "verificationUpdate" + "autopilotRerun": { "apply": true, "scope": "email_enrichment" }.
   - Email copy / tone / CTA refinement ("make Email 1 shorter", "use a soft question CTA") -> emit "templateUpdate" + "autopilotRerun": { "apply": true, "scope": "templates_only" }.`;

  const user = `WORKSPACE SNAPSHOT:\n${lines.join("\n\n")}\n\nLATEST USER MESSAGE:\n${userMessage}`;

  return { system, user };
}

function stripJsonCodeFence(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function cleanStringArray(
  value: unknown,
  minLen = 1,
  maxItems = 10,
  maxLen = 120,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length >= minLen && item.length <= maxLen)
    .slice(0, maxItems);
  return cleaned.length > 0 ? cleaned : undefined;
}

function cleanReason(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 280) : undefined;
}

export function parseConversationChatResponse(rawText: string): ConversationChatOutput {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      reply: "I reviewed the current workspace state, but my response came back empty. Try asking again.",
      approveAction: null,
      filterUpdate: null,
      shortlistUpdate: null,
      peopleUpdate: null,
      verificationUpdate: null,
      templateUpdate: null,
      autopilotRerun: null,
    };
  }

  try {
    const candidate = JSON.parse(stripJsonCodeFence(trimmed)) as Record<string, unknown>;
    if (candidate && typeof candidate === "object" && typeof candidate.reply === "string" && candidate.reply.trim()) {
      const rawApprove =
        candidate.approveAction && typeof candidate.approveAction === "object"
          ? (candidate.approveAction as Record<string, unknown>)
          : null;
      let normalizedApprove: ChatApproveAction | null = null;
      if (rawApprove && rawApprove.apply === true) {
        const targetRaw = rawApprove.target;
        const target =
          targetRaw === "company_search" ||
          targetRaw === "person_search" ||
          targetRaw === "contact_verification" ||
          targetRaw === "any_pending"
            ? targetRaw
            : "any_pending";
        normalizedApprove = chatApproveActionSchema.parse({
          apply: true,
          target,
          reason: cleanReason(rawApprove.reason),
        });
      }

      const rawFilter =
        candidate.filterUpdate && typeof candidate.filterUpdate === "object"
          ? (candidate.filterUpdate as Record<string, unknown>)
          : null;

      let normalisedFilter: ChatFilterUpdate | null = null;
      if (rawFilter && rawFilter.apply === true) {
        const providerRaw = rawFilter.providerKey;
        const locationModeRaw = rawFilter.locationMode;
        normalisedFilter = chatFilterUpdateSchema.parse({
          apply: true,
          providerKey:
            providerRaw === "openstreetmap" || providerRaw === "prospeo" ? providerRaw : undefined,
          locations: cleanStringArray(rawFilter.locations, 1, 5),
          locationMode:
            locationModeRaw === "append" || locationModeRaw === "replace"
              ? locationModeRaw
              : undefined,
          keywords: cleanStringArray(rawFilter.keywords, 3, 15, 100),
          industries: cleanStringArray(rawFilter.industries, 1, 8),
          excludedCategories: cleanStringArray(rawFilter.excludedCategories, 1, 8),
          executeIfApproved:
            typeof rawFilter.executeIfApproved === "boolean"
              ? rawFilter.executeIfApproved
              : undefined,
          reason: cleanReason(rawFilter.reason),
        });
      }

      const rawShortlist =
        candidate.shortlistUpdate && typeof candidate.shortlistUpdate === "object"
          ? (candidate.shortlistUpdate as Record<string, unknown>)
          : null;
      let normalizedShortlist: ChatShortlistUpdate | null = null;
      if (rawShortlist && rawShortlist.apply === true) {
        const actionRaw = rawShortlist.action;
        const action =
          actionRaw === "hold" || actionRaw === "dismiss" ? actionRaw : "shortlist";
        const topN =
          typeof rawShortlist.topN === "number" &&
          Number.isFinite(rawShortlist.topN) &&
          rawShortlist.topN >= 1 &&
          rawShortlist.topN <= 10
            ? Math.round(rawShortlist.topN)
            : undefined;
        normalizedShortlist = chatShortlistUpdateSchema.parse({
          apply: true,
          action,
          accountNames: cleanStringArray(rawShortlist.accountNames, 1, 15, 160),
          locationFilter:
            typeof rawShortlist.locationFilter === "string" && rawShortlist.locationFilter.trim()
              ? rawShortlist.locationFilter.trim().slice(0, 120)
              : undefined,
          topN,
          all: rawShortlist.all === true ? true : undefined,
          reason: cleanReason(rawShortlist.reason),
        });
      }

      const rawPeople =
        candidate.peopleUpdate && typeof candidate.peopleUpdate === "object"
          ? (candidate.peopleUpdate as Record<string, unknown>)
          : null;

      let normalisedPeople: ChatPeopleUpdate | null = null;
      if (rawPeople && rawPeople.apply === true) {
        const pProviderRaw = rawPeople.providerKey;
        normalisedPeople = chatPeopleUpdateSchema.parse({
          apply: true,
          providerKey:
            pProviderRaw === "website_team" || pProviderRaw === "prospeo" ? pProviderRaw : undefined,
          departments: cleanStringArray(rawPeople.departments, 1, 6, 80),
          seniorities: cleanStringArray(rawPeople.seniorities, 1, 6, 60),
          includeTitles: cleanStringArray(rawPeople.includeTitles, 1, 10),
          excludeTitles: cleanStringArray(rawPeople.excludeTitles, 1, 12),
          executeIfApproved:
            typeof rawPeople.executeIfApproved === "boolean"
              ? rawPeople.executeIfApproved
              : undefined,
          reason: cleanReason(rawPeople.reason),
        });
      }

      const rawVerification =
        candidate.verificationUpdate && typeof candidate.verificationUpdate === "object"
          ? (candidate.verificationUpdate as Record<string, unknown>)
          : null;
      let normalizedVerification: ChatVerificationUpdate | null = null;
      if (rawVerification && rawVerification.apply === true) {
        const vProviderRaw = rawVerification.providerKey;
        const topN =
          typeof rawVerification.topN === "number" &&
          Number.isFinite(rawVerification.topN) &&
          rawVerification.topN >= 1 &&
          rawVerification.topN <= 10
            ? Math.round(rawVerification.topN)
            : undefined;
        normalizedVerification = chatVerificationUpdateSchema.parse({
          apply: true,
          providerKey:
            vProviderRaw === "prospeo" || vProviderRaw === "dropcontact"
              ? vProviderRaw
              : undefined,
          contactNames: cleanStringArray(rawVerification.contactNames, 1, 10, 160),
          topN,
          allUnverified: rawVerification.allUnverified === true ? true : undefined,
          executeIfApproved:
            typeof rawVerification.executeIfApproved === "boolean"
              ? rawVerification.executeIfApproved
              : undefined,
          reason: cleanReason(rawVerification.reason),
        });
      }

      const rawTemplate =
        candidate.templateUpdate && typeof candidate.templateUpdate === "object"
          ? (candidate.templateUpdate as Record<string, unknown>)
          : null;

      let normalisedTemplate: ChatTemplateUpdate | null = null;
      if (rawTemplate && rawTemplate.apply === true) {
        const parsedTone = templateToneSchema.safeParse(rawTemplate.tone);
        const parsedCta = templateCtaStyleSchema.safeParse(rawTemplate.ctaStyle);
        const parsedMaxWords =
          typeof rawTemplate.maxWords === "number" &&
            Number.isFinite(rawTemplate.maxWords) &&
            rawTemplate.maxWords >= 20 &&
            rawTemplate.maxWords <= 140
            ? Math.round(rawTemplate.maxWords)
            : undefined;
        normalisedTemplate = chatTemplateUpdateSchema.parse({
          apply: true,
          instruction:
            typeof rawTemplate.instruction === "string" && rawTemplate.instruction.trim()
              ? rawTemplate.instruction.trim().slice(0, 500)
              : undefined,
          tone: parsedTone.success ? parsedTone.data : undefined,
          ctaStyle: parsedCta.success ? parsedCta.data : undefined,
          entryOffer:
            typeof rawTemplate.entryOffer === "string" && rawTemplate.entryOffer.trim()
              ? rawTemplate.entryOffer.trim().slice(0, 240)
              : undefined,
          maxWords: parsedMaxWords,
          reason: cleanReason(rawTemplate.reason),
        });
      }

      const rawAutopilotRerun =
        candidate.autopilotRerun && typeof candidate.autopilotRerun === "object"
          ? (candidate.autopilotRerun as Record<string, unknown>)
          : null;

      let normalizedAutopilotRerun: ChatAutopilotRerun | null = null;
      if (rawAutopilotRerun && rawAutopilotRerun.apply === true) {
        const parsedScope = autopilotRerunScopeSchema.safeParse(rawAutopilotRerun.scope);
        if (parsedScope.success) {
          normalizedAutopilotRerun = chatAutopilotRerunSchema.parse({
            apply: true,
            scope: parsedScope.data,
            reason: cleanReason(rawAutopilotRerun.reason),
          });
        }
      }

      return conversationChatOutputSchema.parse({
        reply: candidate.reply.trim().slice(0, 4_000),
        approveAction: normalizedApprove,
        filterUpdate: normalisedFilter,
        shortlistUpdate: normalizedShortlist,
        peopleUpdate: normalisedPeople,
        verificationUpdate: normalizedVerification,
        templateUpdate: normalisedTemplate,
        autopilotRerun: normalizedAutopilotRerun,
      });
    }
  } catch {
    // Fall back to plain text response below if the model did not emit valid JSON.
  }

  return conversationChatOutputSchema.parse({
    reply: trimmed.slice(0, 4_000),
    approveAction: null,
    filterUpdate: null,
    shortlistUpdate: null,
    peopleUpdate: null,
    verificationUpdate: null,
    templateUpdate: null,
    autopilotRerun: null,
  });
}

const EXPLICIT_MUTATION_OR_SEARCH_VERB =
  /\b(change|update|modify|edit|refine|filter|narrow|expand|exclude|without|skip|omit|drop|remove|add|include|focus|switch|find|search|run|scan|refresh|re-run|rerun|replace|set\s+(?!to\b)|target|prefer|prioritize|approve|approved|confirm|confirmed|proceed|go\s+ahead|do\s+it|execute|continue|shortlist|hold|dismiss|select|fetch|pull|enrich|verify|start|launch|yes|give\s+(?:me|us|the|their)|get\s+(?:me|us|the|their|some|more|emails?|contacts?|leads?|people|phones?)|try\s+(?!(?:to\s+)?(?:see|understand|explain)\b)[a-z][a-z0-9_-]*|check\s+(?:their\s+)?websites?|from\s+(?:their\s+)?websites?|scrape|crawl|extract|look\s*(?:up|for)|lookup|fallback|failsafe|list\s+(?:of|at\s+least)|(?:use|try)\s+(?:a|an|the|prospeo|openstreetmap|osm|website[_\s]team|dropcontact)|make\s+(?:email|step|it|the\s+(?:email|opener|copy|sequence|tone))|write|draft|rewrite|generate|shorten|tighten|rephrase|tweak|regenerate|shorter|warmer)\b/i;

const INTERROGATIVE_START_REGEX =
  /^(?:(?:ok(?:ay)?|so|well|hey|ano|please)[,\s]+)*(?:why|what|which|who|when|where|how)\b/i;
const STRONG_IMPERATIVE_REGEX =
  /\b(change|update|modify|edit|refine|filter|narrow|expand|exclude|remove|drop|add|switch|run|scan|refresh|rerun|re-run|replace|shortlist|dismiss|hold|approve|approved|execute|verify|enrich|proceed|scrape|crawl|extract|write|draft|rewrite|generate|shorten|tighten|rephrase|tweak|regenerate)\b/i;

const EXPLICIT_SPEND_APPROVAL_REGEX =
  /\b(approve|approved|i\s+approve|yes[\s,!.-]+(proceed|go\s+ahead|approve|approved|run|search|do\s+it|please|continue|verify|enrich)|go\s+ahead|confirmed?|execute(\s+the)?\s+(search|prospeo|verification|run)|run\s+(the\s+)?(prospeo|search|verification)|proceed\s+to\s+(search|run|verify|enrich)|proceed\s+please|yes\s+please)\b/i;
const SPEND_QUESTION_PREFIX_REGEX =
  /^(?:should|would|could|can|may|might|who|what|which|when|where|how|why)\b/i;

export function userRequestedAction(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (INTERROGATIVE_START_REGEX.test(trimmed) && !STRONG_IMPERATIVE_REGEX.test(trimmed)) {
    return false;
  }
  return EXPLICIT_MUTATION_OR_SEARCH_VERB.test(trimmed);
}

/** Strict deterministic gate before any credit-bearing Prospeo or Dropcontact execution in chat. */
export function userExplicitlyApprovedSpend(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.endsWith("?")) {
    return false;
  }
  if (SPEND_QUESTION_PREFIX_REGEX.test(trimmed)) {
    return false;
  }
  return EXPLICIT_SPEND_APPROVAL_REGEX.test(trimmed);
}

const WEBSITE_SOURCE_REQUEST_REGEX =
  /\b(websites?|their\s+sites?|company\s+sites?|web\s+pages?|scrape|crawl)\b/i;
const CONTACT_OR_EMAIL_INTENT_REGEX =
  /\b(emails?|e-mails?|contacts?|people|phones?|leads?|decision[\s-]?makers?|team)\b/i;
const PROSPEO_DID_NOT_WORK_REGEX =
  /\b(didn'?t\s+work|did\s+not\s+work|failed|no\s+results|zero\s+emails?|0\s+emails?|instead|as\s+well|from\s+(?:their\s+)?websites?)\b/i;
const DROPCONTACT_REQUEST_REGEX = /\bdropcontact\b/i;
const LOCATION_APPEND_INTENT_REGEX =
  /\b(also\s+include|also\s+add|expand\s+to|in\s+addition\s+to|alongside)\b/i;
const MORE_LEADS_REQUEST_REGEX =
  /\b(more\s+companies|more\s+accounts|more\s+leads|find\s+\d+\s+more|additional\s+companies)\b/i;
const VERIFICATION_PASS_REQUEST_REGEX =
  /\b(?:another\s+verification\s+pass|verify\s+(?:the\s+)?(?:remaining|unverified)|enrich\s+(?:the\s+)?(?:remaining|unverified)|more\s+verified\s+emails?)\b/i;
const TEMPLATE_TARGET_REGEX =
  /\b(email\s*[123]|opener|follow[\s-]?up(?:\s*[12])?|sequence|templates?|cold\s+email|subject\s+line)\b/i;
const TEMPLATE_STYLE_VERB_REGEX =
  /\b(shorter|shorten|longer|warmer|direct|softer|soft\s+question|direct\s+question|easy[\s_-]?yes|free[\s_-]?offer|rewrite|rephrase|tweak|regenerate|tighten|make\s+(?:email|step|it|the))\b/i;

function inferAutopilotRerunScope(
  userMessage: string,
  output: ConversationChatOutput,
): AutopilotRerunScope | null {
  if (output.filterUpdate?.apply) {
    const f = output.filterUpdate;
    const changedGeoOrCriteria = Boolean(
      f.locations?.length ||
        f.keywords?.length ||
        f.industries?.length ||
        f.excludedCategories?.length ||
        f.providerKey ||
        f.locationMode === "append",
    );
    if (!changedGeoOrCriteria && MORE_LEADS_REQUEST_REGEX.test(userMessage)) {
      return "companies_and_people";
    }
    if (
      MORE_LEADS_REQUEST_REGEX.test(userMessage) &&
      !f.locationMode &&
      !f.locations?.length &&
      !f.keywords?.length
    ) {
      return "companies_and_people";
    }
    return "companies_people_templates";
  }
  if (output.shortlistUpdate?.apply) {
    return "companies_and_people";
  }
  if (output.peopleUpdate?.apply) {
    return "people_and_emails";
  }
  if (output.verificationUpdate?.apply) {
    return "email_enrichment";
  }
  if (output.templateUpdate?.apply) {
    return "templates_only";
  }
  return null;
}

/**
 * Deterministic routing failsafes:
 * 1. Explicit website-source contact requests route to `website_team` discovery.
 * 2. Explicit Dropcontact requests with discovered contacts route `verificationUpdate`
 *    to `providerKey: "dropcontact"` (unless an awaiting Dropcontact run is already being approved).
 * 3. Template rewrite, incremental verification-pass, and post-autopilot downstream partial-rerun directives.
 */
export function applyDeterministicChatFailsafes(
  userMessage: string,
  output: ConversationChatOutput,
  context: ConversationChatContext,
): ConversationChatOutput {
  if (!userRequestedAction(userMessage)) {
    return output;
  }

  let nextOutput: ConversationChatOutput = output;

  const wantsWebsiteContacts =
    WEBSITE_SOURCE_REQUEST_REGEX.test(userMessage) &&
    CONTACT_OR_EMAIL_INTENT_REGEX.test(userMessage);
  const hasCompanyCohort =
    (context.companySearch?.accounts.length ?? 0) > 0 ||
    (context.peopleDiscovery?.shortlistedCount ?? 0) > 0;
  const hasContacts = (context.peopleDiscovery?.contacts.length ?? 0) > 0;

  if (wantsWebsiteContacts && hasCompanyCohort) {
    const clearErroneousProspeoVerify =
      PROSPEO_DID_NOT_WORK_REGEX.test(userMessage) &&
      nextOutput.verificationUpdate?.providerKey !== "dropcontact";

    nextOutput = {
      ...nextOutput,
      peopleUpdate: {
        ...(nextOutput.peopleUpdate ?? {}),
        apply: true,
        providerKey: "website_team",
        reason:
          nextOutput.peopleUpdate?.reason ??
          "Scan shortlisted company websites for decision-makers, public emails, and phone numbers.",
      },
      verificationUpdate: clearErroneousProspeoVerify ? null : nextOutput.verificationUpdate,
    };
  } else if (
    DROPCONTACT_REQUEST_REGEX.test(userMessage) &&
    hasContacts &&
    !WEBSITE_SOURCE_REQUEST_REGEX.test(userMessage)
  ) {
    const existingRun = context.peopleDiscovery?.verificationRun;
    if (
      existingRun?.status === "awaiting_approval" &&
      existingRun.providerKey === "dropcontact" &&
      (nextOutput.approveAction?.apply || userExplicitlyApprovedSpend(userMessage))
    ) {
      nextOutput = {
        ...nextOutput,
        approveAction: nextOutput.approveAction?.apply
          ? nextOutput.approveAction
          : {
              apply: true,
              target: "contact_verification",
              reason: "Approve staged Dropcontact email verification.",
            },
      };
    } else {
      const existingApproveTarget = nextOutput.approveAction?.target;
      const clearStaleProspeoApproval =
        Boolean(nextOutput.approveAction?.apply) &&
        existingRun?.providerKey !== "dropcontact" &&
        (existingApproveTarget === "contact_verification" ||
          existingApproveTarget === "any_pending");

      const hasExplicitSelection = Boolean(
        nextOutput.verificationUpdate?.contactNames?.length ||
          nextOutput.verificationUpdate?.topN,
      );

      nextOutput = {
        ...nextOutput,
        approveAction: clearStaleProspeoApproval ? null : nextOutput.approveAction,
        verificationUpdate: {
          ...(nextOutput.verificationUpdate ?? {}),
          apply: true,
          providerKey: "dropcontact",
          allUnverified:
            nextOutput.verificationUpdate?.allUnverified ??
            (!hasExplicitSelection ? true : undefined),
          executeIfApproved:
            nextOutput.verificationUpdate?.executeIfApproved ??
            userExplicitlyApprovedSpend(userMessage),
          reason:
            nextOutput.verificationUpdate?.reason ??
            "Verify unverified contact emails with Dropcontact.",
        },
      };
    }
  } else if (
    hasContacts &&
    !WEBSITE_SOURCE_REQUEST_REGEX.test(userMessage) &&
    !nextOutput.verificationUpdate?.apply &&
    !nextOutput.filterUpdate?.apply &&
    !nextOutput.peopleUpdate?.apply &&
    !nextOutput.templateUpdate?.apply &&
    VERIFICATION_PASS_REQUEST_REGEX.test(userMessage)
  ) {
    nextOutput = {
      ...nextOutput,
      verificationUpdate: {
        apply: true,
        allUnverified: true,
        executeIfApproved:
          Boolean(context.autopilotRun) || userExplicitlyApprovedSpend(userMessage),
        reason: "Run an additional email verification pass on remaining unverified contacts.",
      },
    };
  } else if (
    context.templatePack &&
    !nextOutput.filterUpdate?.apply &&
    !nextOutput.shortlistUpdate?.apply &&
    !nextOutput.peopleUpdate?.apply &&
    !nextOutput.verificationUpdate?.apply &&
    !nextOutput.templateUpdate?.apply &&
    TEMPLATE_TARGET_REGEX.test(userMessage) &&
    TEMPLATE_STYLE_VERB_REGEX.test(userMessage)
  ) {
    const wantsSoftQuestion = /\b(?:soft\s+question|direct\s+question|question\s+cta)\b/i.test(
      userMessage,
    );
    const wantsShorter = /\b(?:shorter|shorten|tighten)\b/i.test(userMessage);
    nextOutput = {
      ...nextOutput,
      templateUpdate: {
        apply: true,
        instruction: userMessage.trim().slice(0, 500),
        ctaStyle: wantsSoftQuestion ? "direct_question" : undefined,
        maxWords: wantsShorter ? 45 : undefined,
        reason: "Refine outreach email sequence from chat feedback.",
      },
    };
  }

  if (
    nextOutput.filterUpdate?.apply &&
    nextOutput.filterUpdate.locations?.length &&
    !nextOutput.filterUpdate.locationMode &&
    LOCATION_APPEND_INTENT_REGEX.test(userMessage)
  ) {
    nextOutput = {
      ...nextOutput,
      filterUpdate: {
        ...nextOutput.filterUpdate,
        locationMode: "append",
      },
    };
  }

  if (context.autopilotRun && !nextOutput.autopilotRerun?.apply) {
    const inferredScope = inferAutopilotRerunScope(userMessage, nextOutput);
    if (inferredScope) {
      nextOutput = {
        ...nextOutput,
        autopilotRerun: {
          apply: true,
          scope: inferredScope,
          reason: `Re-run affected downstream autopilot stages (${inferredScope}).`,
        },
      };
    }
  }

  return nextOutput;
}

export async function replyInResearchConversation(
  config: LlmPlannerConfig,
  context: ConversationChatContext,
  userMessage: string,
  modelOverride?: { invoke(messages: Array<SystemMessage | HumanMessage>): Promise<{ content: unknown }> },
): Promise<ConversationChatOutput> {
  const { system, user } = buildConversationChatPrompt(context, userMessage);
  const model = modelOverride ?? createPlannerChatModel(config, { maxTokens: 900 });
  const response = await model.invoke([new SystemMessage(system), new HumanMessage(user)]);
  const rawContent =
    typeof response.content === "string"
      ? response.content
      : Array.isArray(response.content)
        ? response.content
          .map((part) =>
            typeof part === "string"
              ? part
              : part && typeof part === "object" && "text" in part && typeof part.text === "string"
                ? part.text
                : "",
          )
          .join("\n")
        : String(response.content ?? "");

  const parsed = parseConversationChatResponse(rawContent);
  const maskedParsed: ConversationChatOutput = {
    ...parsed,
    reply: maskVendorNamesForDisplay(parsed.reply),
  };
  if (
    !userRequestedAction(userMessage) &&
    (maskedParsed.approveAction?.apply ||
      maskedParsed.filterUpdate?.apply ||
      maskedParsed.shortlistUpdate?.apply ||
      maskedParsed.peopleUpdate?.apply ||
      maskedParsed.verificationUpdate?.apply ||
      maskedParsed.templateUpdate?.apply ||
      maskedParsed.autopilotRerun?.apply)
  ) {
    return {
      ...maskedParsed,
      approveAction: null,
      filterUpdate: null,
      shortlistUpdate: null,
      peopleUpdate: null,
      verificationUpdate: null,
      templateUpdate: null,
      autopilotRerun: null,
    };
  }
  const withFailsafes = applyDeterministicChatFailsafes(userMessage, maskedParsed, context);
  return {
    ...withFailsafes,
    reply: maskVendorNamesForDisplay(withFailsafes.reply),
  };
}

import "server-only";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

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
import type { ResearchConversationView } from "@/lib/ano/research-conversation";
import type { LlmPlannerConfig } from "@/server/agents/bedrock-contracts";
import { createPlannerChatModel } from "@/server/agents/ollama-chat-model";

export const chatFilterUpdateSchema = z.object({
  apply: z.boolean(),
  providerKey: z.enum(["openstreetmap", "prospeo"]).optional(),
  locations: z.array(z.string().trim().min(1).max(120)).max(5).optional(),
  keywords: z.array(z.string().trim().min(3).max(100)).max(15).optional(),
  industries: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
  excludedCategories: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
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
  reason: z.string().trim().max(280).optional(),
});
export type ChatPeopleUpdate = z.infer<typeof chatPeopleUpdateSchema>;

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

export const conversationChatOutputSchema = z.object({
  reply: z.string().trim().min(1).max(4_000),
  filterUpdate: chatFilterUpdateSchema.nullable().optional(),
  peopleUpdate: chatPeopleUpdateSchema.nullable().optional(),
  templateUpdate: chatTemplateUpdateSchema.nullable().optional(),
});
export type ConversationChatOutput = z.infer<typeof conversationChatOutputSchema>;

export type ConversationChatContext = {
  conversation: ResearchConversationView;
  research?: EvidenceResearchView | null;
  synthesis?: MarketSynthesis | null;
  companySearch?: CompanySearchView | null;
  peopleDiscovery?: PeopleDiscoveryView | null;
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
    research,
    synthesis,
    companySearch,
    peopleDiscovery,
    outreachExecution,
    templatePack,
  } = context;

  const lines: string[] = [];

  if (conversation.brief) {
    lines.push(`Offer: ${clip(conversation.brief.offer, 220)}`);
    lines.push(`Goal: ${clip(conversation.brief.goal, 200)}`);
    if (conversation.brief.constraints.length > 0) {
      lines.push(`Constraints: ${conversation.brief.constraints.join("; ")}`);
    }
  } else {
    lines.push(`Conversation title: ${conversation.conversation.title}`);
  }

  lines.push(`Phase A run status: ${conversation.run.status}`);
  if (conversation.plan) {
    lines.push(
      `Research plan v${conversation.plan.version} (${conversation.plan.approvalStatus}): ${clip(conversation.plan.summary, 240)}`,
    );
  }

  if (research) {
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
      lines.push(`Locked target route: ${lockedMarket.name} -> ${lockedIndustry.name}`);
    } else if (synthesis.markets.length > 0 || synthesis.industries.length > 0) {
      lines.push(
        `Markets: ${synthesis.markets.map((m) => m.name).join(", ") || "none"} | Industries: ${synthesis.industries.map((i) => i.name).join(", ") || "none"}`,
      );
    }
    if (synthesis.claims.length > 0) {
      lines.push(
        "Key synthesis claims:\n" +
        synthesis.claims
          .slice(0, 5)
          .map((c) => `- (${c.kind}) ${clip(c.statement, 180)}`)
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
      const contactLines = peopleDiscovery.contacts.slice(0, 25).map((contact, idx) => {
        const row = formatContactForCohortTable(contact);
        return `${idx + 1}. ${row.fullName} | ${row.title} | ${row.department} / ${row.seniority} | ${row.accountName} | source=${row.sourceLabel} | status=${row.verificationStatus}${row.verifiedEmail ? ` (${row.verifiedEmail})` : ""}`;
      });
      lines.push("Discovered people table:\n" + contactLines.join("\n"));
    }
  }

  if (outreachExecution) {
    lines.push(
      `Phase F outreach: drafts=${outreachExecution.drafts.length}, proposals=${outreachExecution.proposals.length}.`,
    );
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

  const system = `You are Ano, a practical, concise two-way AI sales-research copilot.
Use ONLY the workspace snapshot provided by the user message. Never invent companies, people, websites, emails, statistics, or source facts not present in the snapshot. Refer to discovered people in the third person (never say "you have been identified as <person>").

Output strictly valid JSON matching:
{
  "reply": "string — direct, helpful answer referencing exact rows/findings from the snapshot",
  "filterUpdate": null | {
    "apply": boolean,
    "providerKey": "openstreetmap" | "prospeo" (optional),
    "locations": ["city or country", ...] (optional, max 5),
    "keywords": ["3+ char keyword", ...] (optional, max 15),
    "industries": ["exact Prospeo industry", ...] (optional, max 8),
    "excludedCategories": ["term to exclude", ...] (optional, max 8),
    "reason": "short summary of requested filter adjustment"
  },
  "peopleUpdate": null | {
    "apply": boolean,
    "providerKey": "website_team" | "prospeo" (optional),
    "departments": ["C-Suite"|"Operations"|"Medical & Health"|"Finance"|"Information Technology"|"Engineering & Technical"|"Sales"|"Marketing"|"Product"|"Human Resources", ...] (optional, max 6),
    "seniorities": ["Founder/Owner"|"C-Suite"|"Partner"|"Vice President"|"Head"|"Director"|"Manager"|"Senior", ...] (optional, max 6),
    "includeTitles": ["Job Title", ...] (optional, max 10),
    "excludeTitles": ["Title to exclude", ...] (optional, max 12),
    "reason": "short summary of requested persona update"
  },
  "templateUpdate": null | {
    "apply": boolean,
    "instruction": "concise rewrite directive preserving facts" (optional),
    "tone": "peer_direct" | "curious" | "executive_brief" | "warm_smb" (optional),
    "ctaStyle": "easy_yes" | "free_offer" | "direct_question" (optional),
    "entryOffer": "concrete free offer for email 1" (optional),
    "maxWords": number (optional, 20-140),
    "reason": "short summary of requested template change"
  }
}

CRITICAL DEFAULT RULE:
- Set "filterUpdate": null, "peopleUpdate": null, AND "templateUpdate": null whenever the user asks a question ("who", "what", "which", "why", "how", "compare", "tell me") without commanding you to change filters, add/remove roles, edit/rewrite email templates, or run a search. Never copy existing snapshot settings into filterUpdate, peopleUpdate, or templateUpdate during a question.

Rules for filterUpdate (company cohort discovery):
- Set "filterUpdate": { "apply": true, ... } ONLY when the user explicitly asks to change, filter, narrow, expand, exclude from, switch provider ("openstreetmap" for local clinics/businesses, "prospeo" for B2B corporate database), or re-run the company cohort search.
- Preserve unchanged filters by omitting fields the user did not ask to change.

Rules for peopleUpdate (buying committee & decision-maker discovery):
- Set "peopleUpdate": { "apply": true, ... } ONLY when the user explicitly commands you to add/change/remove target job titles (preserve any requested title accurately in includeTitles), change departments (${PROSPEO_DEPARTMENT_OPTIONS.join(", ")}), change seniorities (${PROSPEO_SENIORITY_OPTIONS.join(", ")}), add exclusions (\`excludeTitles\`), switch people provider ("website_team" for $0 website crawl vs "prospeo" for B2B database), or run a people search.
- Never claim a credit-bearing Prospeo search has already executed; free OpenStreetMap ($0) and free website_team ($0) scans can run right away while Prospeo searches prepare a preview for explicit credit approval.

Rules for templateUpdate (blaster-ready cold email sequence, $0 external spend):
- Set "templateUpdate": { "apply": true, ... } ONLY when the user explicitly asks to write, generate, rewrite, shorten, adjust the tone/CTA/offer of, or refine outreach email templates.
- Updating templates costs $0 external spend and never sends emails autonomously.`;

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

function cleanStringArray(value: unknown, minLen = 1, maxItems = 10): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length >= minLen && item.length <= 120)
    .slice(0, maxItems);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function parseConversationChatResponse(rawText: string): ConversationChatOutput {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      reply: "I reviewed the current workspace state, but my response came back empty. Try asking again.",
      filterUpdate: null,
      peopleUpdate: null,
    };
  }

  try {
    const candidate = JSON.parse(stripJsonCodeFence(trimmed)) as Record<string, unknown>;
    if (candidate && typeof candidate === "object" && typeof candidate.reply === "string" && candidate.reply.trim()) {
      const rawFilter =
        candidate.filterUpdate && typeof candidate.filterUpdate === "object"
          ? (candidate.filterUpdate as Record<string, unknown>)
          : null;

      let normalisedFilter: ChatFilterUpdate | null = null;
      if (rawFilter && rawFilter.apply === true) {
        const providerRaw = rawFilter.providerKey;
        normalisedFilter = chatFilterUpdateSchema.parse({
          apply: true,
          providerKey:
            providerRaw === "openstreetmap" || providerRaw === "prospeo" ? providerRaw : undefined,
          locations: cleanStringArray(rawFilter.locations, 1, 5),
          keywords: cleanStringArray(rawFilter.keywords, 3, 15),
          industries: cleanStringArray(rawFilter.industries, 1, 8),
          excludedCategories: cleanStringArray(rawFilter.excludedCategories, 1, 8),
          reason:
            typeof rawFilter.reason === "string" && rawFilter.reason.trim()
              ? rawFilter.reason.trim().slice(0, 280)
              : undefined,
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
          departments: cleanStringArray(rawPeople.departments, 1, 6),
          seniorities: cleanStringArray(rawPeople.seniorities, 1, 6),
          includeTitles: cleanStringArray(rawPeople.includeTitles, 1, 10),
          excludeTitles: cleanStringArray(rawPeople.excludeTitles, 1, 12),
          reason:
            typeof rawPeople.reason === "string" && rawPeople.reason.trim()
              ? rawPeople.reason.trim().slice(0, 280)
              : undefined,
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
          reason:
            typeof rawTemplate.reason === "string" && rawTemplate.reason.trim()
              ? rawTemplate.reason.trim().slice(0, 280)
              : undefined,
        });
      }

      return conversationChatOutputSchema.parse({
        reply: candidate.reply.trim().slice(0, 4_000),
        filterUpdate: normalisedFilter,
        peopleUpdate: normalisedPeople,
        templateUpdate: normalisedTemplate,
      });
    }
  } catch {
    // Fall back to plain text response below if the model did not emit valid JSON.
  }

  return conversationChatOutputSchema.parse({
    reply: trimmed.slice(0, 4_000),
    filterUpdate: null,
    peopleUpdate: null,
    templateUpdate: null,
  });
}

const EXPLICIT_MUTATION_OR_SEARCH_VERB =
  /\b(change|update|modify|edit|refine|filter|narrow|expand|exclude|without|skip|omit|drop|remove|add|include|focus|switch|find|search|run|scan|refresh|re-run|rerun|replace|set\s+(?!to\b)|target|prefer|prioritize|use|only|write|draft|rewrite|generate|shorten|tighten|rephrase|tweak|regenerate|shorter)\b/i;

const INTERROGATIVE_START_REGEX = /^(?:why|what|which|who|when|where|how)\b/i;
const STRONG_IMPERATIVE_REGEX =
  /\b(change|update|modify|edit|refine|filter|narrow|expand|exclude|remove|drop|add|switch|run|scan|refresh|rerun|re-run|replace|write|draft|rewrite|generate|shorten|tighten|rephrase|tweak|regenerate)\b/i;

function userRequestedAction(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (INTERROGATIVE_START_REGEX.test(trimmed) && !STRONG_IMPERATIVE_REGEX.test(trimmed)) {
    return false;
  }
  return EXPLICIT_MUTATION_OR_SEARCH_VERB.test(trimmed);
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
  if (
    !userRequestedAction(userMessage) &&
    (parsed.filterUpdate?.apply || parsed.peopleUpdate?.apply || parsed.templateUpdate?.apply)
  ) {
    return {
      ...parsed,
      filterUpdate: null,
      peopleUpdate: null,
      templateUpdate: null,
    };
  }
  return parsed;
}

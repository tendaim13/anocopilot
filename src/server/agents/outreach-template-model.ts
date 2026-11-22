import "server-only";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import type { AccountCandidateDossier } from "@/lib/ano/company-discovery";
import type { IndustryProfile, MarketProfile, ResearchClaim } from "@/lib/ano/market-synthesis";
import {
  buildDeterministicFallbackTemplatePack,
  extractMergeFields,
  lintOutreachEmailStep,
  normalizeMergeTags,
  outreachTemplatePackViewSchema,
  outreachTemplateStepSchema,
  stripBoilerplateSignOff,
  SUPPORTED_MERGE_TAGS,
  tidyEmailText,
  type OutreachTemplatePackView,
  type OutreachTemplateStep,
  type TemplateCtaStyle,
  type TemplateStepKey,
  type TemplateTone,
} from "@/lib/ano/outreach-templates";
import type { BuyingCommitteeCriteria, ContactCandidateView } from "@/lib/ano/people-playbooks";
import type { ResearchBrief } from "@/lib/ano/research-conversation";
import type { LlmPlannerConfig } from "@/server/agents/bedrock-contracts";
import { createPlannerChatModel } from "@/server/agents/ollama-chat-model";

export type InvokableTemplateModel = {
  invoke(messages: Array<SystemMessage | HumanMessage>): Promise<{ content: unknown }>;
};

export type OutreachTemplateGenerationContext = {
  templatePackId: string;
  conversationId: string;
  targetDecisionId: string;
  version: number;
  brief: ResearchBrief | null;
  market: MarketProfile | null;
  industry: IndustryProfile | null;
  claims: ResearchClaim[];
  accounts: AccountCandidateDossier[];
  buyingCommittee: BuyingCommitteeCriteria | null;
  contacts: ContactCandidateView[];
  tone: TemplateTone;
  ctaStyle: TemplateCtaStyle;
  entryOffer?: string | null;
  senderName?: string | null;
  instruction?: string | null;
  includeLinkedIn?: boolean;
  maxWords?: number;
  nowIso?: string;
};

type RawStepJson = {
  stepKey?: string;
  subject?: string;
  body?: string;
};

const META_REWRITE_PREFIXES = [
  "i can't",
  "i cannot",
  "as an ai",
  "sorry,",
  "here is",
  "here's",
];

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : part && typeof part === "object" && "text" in part && typeof part.text === "string"
            ? part.text
            : "",
      )
      .join("\n");
  }
  return String(content ?? "");
}

function stripJsonCodeFence(raw: string): string {
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

function clip(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1)}...`;
}

function toneInstruction(tone: TemplateTone): string {
  switch (tone) {
    case "curious":
      return "Curious, observant, conversational peer voice that opens a low-friction question.";
    case "executive_brief":
      return "Ultra-brief, direct executive note respecting time with zero fluff.";
    case "warm_smb":
      return "Warm, grounded, non-pushy peer tone suited for clinic owners or local operators who dislike sales hype.";
    default:
      return "Direct, helpful peer voice like one operator writing plainly to another.";
  }
}

function ctaInstruction(ctaStyle: TemplateCtaStyle, entryOffer?: string | null): string {
  if (ctaStyle === "free_offer" && entryOffer?.trim()) {
    return `Offer this concrete free deliverable in Email 1: "${entryOffer.trim()}" as a simple yes/no question.`;
  }
  if (ctaStyle === "direct_question") {
    return "End Email 1 with one specific, practical question about the workflow problem (not 'worth a call?').";
  }
  return "End Email 1 with an easy-yes ask ('Is this on your radar?' or asking if sending a short breakdown is useful).";
}

function buildKnownNames(context: OutreachTemplateGenerationContext): string[] {
  return Array.from(
    new Set(
      [
        ...context.accounts.map((a) => a.name),
        ...context.contacts.map((c) => c.fullName),
        context.market?.name ?? "",
      ]
        .map((s) => s.trim())
        .filter((s) => s.length >= 3),
    ),
  );
}

function stepMeta(stepKey: TemplateStepKey): {
  stepNumber: number;
  label: string;
  channel: "email" | "linkedin";
  dayOffset: number;
} {
  switch (stepKey) {
    case "initial":
      return { stepNumber: 1, label: "Initial Email", channel: "email", dayOffset: 0 };
    case "follow_up_1":
      return { stepNumber: 2, label: "Follow-Up 1", channel: "email", dayOffset: 3 };
    case "follow_up_2":
      return { stepNumber: 3, label: "Breakup", channel: "email", dayOffset: 7 };
    case "linkedin_note":
      return { stepNumber: 4, label: "LinkedIn Note", channel: "linkedin", dayOffset: 1 };
  }
}

export function buildOutreachTemplatePrompt(
  context: OutreachTemplateGenerationContext,
): { system: string; user: string } {
  const email1Cap = context.maxWords ?? 60;
  const email2Cap = context.maxWords ? Math.min(context.maxWords, 50) : 50;
  const includeLinkedIn = Boolean(context.includeLinkedIn);

  const system = `You write cold outreach sequences that read like a busy real human wrote a quick note, never like AI or marketing copy.

HUMAN VOICE & STRUCTURE RULES (STRICTLY ENFORCED BY CODE LINTER):
1. SHORTER WINS:
   - Step "initial" (Day 0): aim 25-45 words (hard max ${email1Cap}). Delete every extra word. Must fit on one phone screen.
   - Step "follow_up_1" (Day 3): aim 20-40 words (hard max ${email2Cap}). New angle; NEVER reference Email 1 or say "just following up".
   - Step "follow_up_2" (Day 7): aim 10-20 words (hard max 30). Clean respectful loop close leaving the door open. Zero guilt, zero pitching, zero fake well-wishes.
   ${includeLinkedIn ? '- Step "linkedin_note" (Day 1): under 260 characters, conversational, zero pitch, zero links.' : ""}
2. EMAIL 1 SHAPE (no pitch dump):
   - Greeting ("Hi {{first_name}},")
   - One grounded observation about their industry/business workflow in plain words
   - One plain sentence on what that gap costs them
   - One easy-yes or free-offer question (${ctaInstruction(context.ctaStyle, context.entryOffer)})
   - Do NOT name a product feature list and do NOT put any URL/link in Email 1.
3. EMAIL 2 SHAPE:
   - Take a fresh angle. 1 specific problem stated plainly, 1 plain sentence on how you solve it, 1 direct question.
4. HARD ANTI-AI BANS (drafts violating ANY of these fail verification):
   - ZERO dashes between words: NO em dashes (\u2014), NO en dashes (\u2013), NO "--", NO spaced hyphens " - ". Use periods or commas.
   - ZERO exclamation marks ("!").
   - ZERO formatting: plain text only (no **bold**, no *italics*, no bullet lists, no numbered lists, no headers).
   - ZERO self-opening ("I", "We", "I'm", "We're", "My", "Our") on the first sentence after the greeting in "initial" and "follow_up_1". Start with their team, role, city, or situation.
   - AT MOST ONE question ("?") per email.
   - ZERO sign-off lines at the end (no "Best,", "Thanks,", "Cheers,", or sender names — Ano adds optional sign-offs automatically).
   - ZERO AI clichés: never use "hope this finds you", "reaching out because", "just wanted to", "just following up", "circling back", "touch base", "i'd love to", "in today's", "fast-paced", "picture this", "imagine if", "what if i told you", "here's the thing", "here's what i keep seeing", "worth a quick", "quick question", "no pressure", "would you be open to", "are you the right person", "game-changer", "revolutionize", "cutting-edge", "next-level", "supercharge", "unlock", "unleash", "elevate", "empower", "seamless", "leverage", "synergy", "delve", "tapestry", "robust", "crucial", "pivotal", "transformative", "streamline", "pain point", "best-in-class", "world-class", "move the needle", or "not just X but Y".
5. SUBJECT LINE RULES:
   - All lowercase (except inside {{merge_tags}}), 2-5 words, look like an internal email subject (e.g. "{{company_name}} recall", "patient no-shows", "closing the loop").
   - NEVER put {{first_name}} or {{full_name}} in the subject, NEVER use "quick question", and NEVER use fake "re:" or "fwd:" on Email 1.
6. HONESTY / GROUNDING:
   - Use ONLY facts present in the Offer Brief, Phase C claims, accounts, and Buying Committee below.
   - NEVER invent statistics, customer case studies, reviews, search rankings, hiring posts, or mutual connections.
7. MERGE VARIABLES (exact spellings only):
   ${SUPPORTED_MERGE_TAGS.join(", ")}

Tone calibration: ${toneInstruction(context.tone)}

Return STRICTLY valid JSON matching:
{
  "steps": [
    { "stepKey": "initial", "subject": "...", "body": "..." },
    { "stepKey": "follow_up_1", "subject": "...", "body": "..." },
    { "stepKey": "follow_up_2", "subject": "...", "body": "..." }${includeLinkedIn ? ',\n    { "stepKey": "linkedin_note", "subject": "", "body": "..." }' : ""}
  ]
}`;

  const targetAccounts = context.accounts
    .filter((a) => a.lifecycleState === "shortlisted")
    .slice(0, 6);
  const sampleAccounts = targetAccounts.length > 0 ? targetAccounts : context.accounts.slice(0, 5);

  const lines: string[] = [];
  if (context.brief) {
    lines.push(`Offer summary: ${clip(context.brief.offer, 320)}`);
    lines.push(`Goal: ${clip(context.brief.goal, 240)}`);
    if (context.brief.constraints.length > 0) {
      lines.push(`Constraints: ${context.brief.constraints.join("; ")}`);
    }
  }
  if (context.market) {
    lines.push(`Target market: ${context.market.name} (${clip(context.market.summary, 200)})`);
  }
  if (context.industry) {
    lines.push(`Target segment: ${context.industry.name} (${clip(context.industry.summary, 220)})`);
    if (context.industry.operationalProblems.length > 0) {
      lines.push(
        `Operational problems:\n${context.industry.operationalProblems.map((p) => `- ${p}`).join("\n")}`,
      );
    }
    if (context.industry.solutionFit.length > 0) {
      lines.push(`Solution fit:\n${context.industry.solutionFit.map((s) => `- ${s}`).join("\n")}`);
    }
    if (context.industry.buyerRoleHypotheses.length > 0) {
      lines.push(`Target roles: ${context.industry.buyerRoleHypotheses.join(", ")}`);
    }
  }
  if (context.buyingCommittee) {
    lines.push(
      `Buying committee (${context.buyingCommittee.archetype}): ${context.buyingCommittee.includeTitles.join(", ")}`,
    );
  }
  if (context.claims.length > 0) {
    lines.push(
      `Verified Phase C claims:\n${context.claims
        .slice(0, 6)
        .map((c) => `- (${c.kind}) ${clip(c.statement, 180)}`)
        .join("\n")}`,
    );
  }
  if (sampleAccounts.length > 0) {
    lines.push(
      `Representative target companies:\n${sampleAccounts
        .map((a) => `- ${a.name} (${a.location ?? context.market?.name ?? "local market"}, ${a.industry ?? context.industry?.name ?? "target segment"})`)
        .join("\n")}`,
    );
  }
  if (context.entryOffer?.trim()) {
    lines.push(`Free entry offer: ${context.entryOffer.trim()}`);
  }
  if (context.instruction?.trim()) {
    lines.push(`Specific user instruction: ${context.instruction.trim()}`);
  }

  return {
    system,
    user: lines.join("\n\n"),
  };
}

function finalizeStep(
  stepKey: TemplateStepKey,
  rawSubject: string,
  rawBody: string,
  senderName: string | null,
  knownNames: string[],
  maxWordsOverride?: number,
): OutreachTemplateStep {
  const meta = stepMeta(stepKey);
  const subject = meta.channel === "linkedin" ? "" : tidyEmailText(normalizeMergeTags(rawSubject));
  const cleanedBody = tidyEmailText(normalizeMergeTags(rawBody));
  const body =
    meta.channel === "email"
      ? stripBoilerplateSignOff(cleanedBody, senderName)
      : cleanedBody;

  return outreachTemplateStepSchema.parse({
    stepKey,
    stepNumber: meta.stepNumber,
    label: meta.label,
    channel: meta.channel,
    dayOffset: meta.dayOffset,
    subject,
    body,
    mergeFieldsUsed: extractMergeFields(subject, body),
    lint: lintOutreachEmailStep(
      {
        stepKey,
        channel: meta.channel,
        subject,
        body,
      },
      {
        knownNames,
        maxWordsOverride: stepKey === "initial" || stepKey === "follow_up_1" ? maxWordsOverride : undefined,
      },
    ),
  });
}

function isAcceptableRewrite(
  original: OutreachTemplateStep,
  candidate: OutreachTemplateStep,
): boolean {
  if (!candidate.body.trim()) return false;
  if (original.channel === "email" && !candidate.subject.trim()) return false;
  const loweredBody = candidate.body.trim().toLowerCase();
  if (META_REWRITE_PREFIXES.some((prefix) => loweredBody.startsWith(prefix))) {
    return false;
  }

  const beforeVars = [...original.mergeFieldsUsed].sort().join(",");
  const afterVars = [...candidate.mergeFieldsUsed].sort().join(",");
  if (beforeVars !== afterVars) return false;

  if (candidate.lint.issues.length < original.lint.issues.length) {
    return true;
  }
  return candidate.lint.passed && !original.lint.passed;
}

function parseStepsPayload(rawText: string): RawStepJson[] {
  const jsonText = stripJsonCodeFence(rawText);
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.steps)) {
    return parsed.steps.filter((item): item is RawStepJson => Boolean(item && typeof item === "object"));
  }
  return [];
}

export async function generateOutreachTemplatePackWithModel(
  config: LlmPlannerConfig,
  context: OutreachTemplateGenerationContext,
  modelOverride?: InvokableTemplateModel,
): Promise<OutreachTemplatePackView> {
  const now = context.nowIso ?? new Date().toISOString();
  const senderName = context.senderName?.trim() || null;
  const targetRoles = Array.from(
    new Set(
      [
        ...(context.buyingCommittee?.includeTitles ?? []),
        ...(context.industry?.buyerRoleHypotheses ?? []),
      ]
        .map((r) => r.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);

  const fallback = buildDeterministicFallbackTemplatePack({
    id: context.templatePackId,
    conversationId: context.conversationId,
    targetDecisionId: context.targetDecisionId,
    version: context.version,
    tone: context.tone,
    ctaStyle: context.ctaStyle,
    entryOffer: context.entryOffer,
    senderName,
    targetRoles,
    brief: context.brief,
    market: context.market,
    industry: context.industry,
    claims: context.claims,
    accounts: context.accounts,
    includeLinkedIn: context.includeLinkedIn,
    lastInstruction: context.instruction,
    maxWords: context.maxWords,
    nowIso: now,
  });

  const knownNames = buildKnownNames(context);
  const desiredKeys: TemplateStepKey[] = context.includeLinkedIn
    ? ["initial", "follow_up_1", "follow_up_2", "linkedin_note"]
    : ["initial", "follow_up_1", "follow_up_2"];

  try {
    const model = modelOverride ?? createPlannerChatModel(config, { maxTokens: 1_200 });
    const { system, user } = buildOutreachTemplatePrompt(context);
    const initialRes = await model.invoke([new SystemMessage(system), new HumanMessage(user)]);
    const initialRawSteps = parseStepsPayload(extractTextContent(initialRes.content));
    if (initialRawSteps.length === 0) {
      return fallback;
    }

    const stepMap = new Map<TemplateStepKey, OutreachTemplateStep>();
    for (const key of desiredKeys) {
      const match = initialRawSteps.find((s) => s.stepKey === key);
      if (match && typeof match.body === "string" && match.body.trim()) {
        try {
          const built = finalizeStep(
            key,
            typeof match.subject === "string" ? match.subject : "",
            match.body,
            senderName,
            knownNames,
            context.maxWords,
          );
          stepMap.set(key, built);
        } catch {
          // Will fall back to deterministic step below if invalid shape.
        }
      }
    }

    if (stepMap.size === 0) {
      return fallback;
    }

    const failingSteps = Array.from(stepMap.values()).filter((step) => !step.lint.passed);
    if (failingSteps.length > 0) {
      const rewritePrompt = `Rewrite ONLY the failing cold outreach step(s) below so every anti-AI rule passes cleanly.

Hard requirements:
- Keep every existing {{merge_tag}} exactly intact: ${SUPPORTED_MERGE_TAGS.join(", ")}.
- Add NO new facts, companies, metrics, links, or names.
- NO em dashes (\u2014), NO en dashes (\u2013), NO "--", NO spaced hyphens " - ", NO exclamation marks, NO bullets, NO AI clichés, NO sign-off line.
- Keep Email 1 ("initial") <= ${context.maxWords ?? 60} words, Email 2 ("follow_up_1") <= ${context.maxWords ? Math.min(context.maxWords, 50) : 50} words, Email 3 ("follow_up_2") <= 30 words, LinkedIn <= 280 chars.
- Keep subjects all lowercase, 2-5 words, no {{first_name}}, no "quick question", no fake re:/fwd:.
- Start "initial" and "follow_up_1" body lines after greeting with them/their situation (not "I" or "We").

Failing steps & exact linter issues to fix:
${JSON.stringify(
  failingSteps.map((s) => ({
    stepKey: s.stepKey,
    subject: s.subject,
    body: s.body,
    requiredMergeTags: s.mergeFieldsUsed,
    issuesToFix: s.lint.issues,
  })),
  null,
  2,
)}

Return ONLY valid JSON: { "steps": [{ "stepKey": "...", "subject": "...", "body": "..." }] }`;

      try {
        const rewriteRes = await model.invoke([
          new SystemMessage(
            "You are a crisp plain-text cold-email editor. Fix every reported AI-voice, length, punctuation, and subject issue without adding new facts or changing merge tags.",
          ),
          new HumanMessage(rewritePrompt),
        ]);
        const rewrittenRaw = parseStepsPayload(extractTextContent(rewriteRes.content));
        for (const candidateRaw of rewrittenRaw) {
          const key = candidateRaw.stepKey as TemplateStepKey | undefined;
          if (!key || !stepMap.has(key) || typeof candidateRaw.body !== "string") continue;
          const original = stepMap.get(key)!;
          try {
            const finalizedRewrite = finalizeStep(
              key,
              typeof candidateRaw.subject === "string" ? candidateRaw.subject : "",
              candidateRaw.body,
              senderName,
              knownNames,
              context.maxWords,
            );
            if (isAcceptableRewrite(original, finalizedRewrite)) {
              stepMap.set(key, finalizedRewrite);
            }
          } catch {
            // Keep original step if rewritten candidate fails validation.
          }
        }
      } catch {
        // Bounded fail-open: keep original steps if single rewrite call fails.
      }
    }

    const finalSteps = desiredKeys.map((key) => {
      const candidate = stepMap.get(key);
      if (candidate) return candidate;
      return fallback.steps.find((s) => s.stepKey === key) ?? fallback.steps[0];
    });

    return outreachTemplatePackViewSchema.parse({
      id: context.templatePackId,
      conversationId: context.conversationId,
      targetDecisionId: context.targetDecisionId,
      version: context.version,
      tone: context.tone,
      ctaStyle: context.ctaStyle,
      entryOffer: context.entryOffer?.trim() || null,
      senderName,
      targetRoles,
      steps: finalSteps,
      claimIds: context.claims.slice(0, 8).map((c) => c.id),
      generationMode: "llm",
      lastInstruction: context.instruction?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    return fallback;
  }
}

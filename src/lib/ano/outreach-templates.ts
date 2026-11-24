import { z } from "zod";

import type { AccountCandidateDossier } from "@/lib/ano/company-discovery";
import type { IndustryProfile, MarketProfile, ResearchClaim } from "@/lib/ano/market-synthesis";
import type { ContactCandidateView } from "@/lib/ano/people-playbooks";
import type { ResearchBrief } from "@/lib/ano/research-conversation";

export const SUPPORTED_MERGE_TAGS = [
  "{{first_name}}",
  "{{full_name}}",
  "{{job_title}}",
  "{{company_name}}",
  "{{city}}",
  "{{country}}",
  "{{website}}",
] as const;

export type SupportedMergeTag = (typeof SUPPORTED_MERGE_TAGS)[number];

export const EMAIL_STEP_WORD_CAPS = {
  initial: 60,
  follow_up_1: 50,
  follow_up_2: 30,
  linkedin_note: 55,
} as const;

export const templateToneSchema = z.enum([
  "peer_direct",
  "curious",
  "executive_brief",
  "warm_smb",
]);
export type TemplateTone = z.infer<typeof templateToneSchema>;

export const templateCtaStyleSchema = z.enum([
  "easy_yes",
  "free_offer",
  "direct_question",
]);
export type TemplateCtaStyle = z.infer<typeof templateCtaStyleSchema>;

export const templateStepKeySchema = z.enum([
  "initial",
  "follow_up_1",
  "follow_up_2",
  "linkedin_note",
]);
export type TemplateStepKey = z.infer<typeof templateStepKeySchema>;

export const templateStyleLintSchema = z.object({
  passed: z.boolean(),
  wordCount: z.number().int().nonnegative(),
  maxWords: z.number().int().positive(),
  issues: z.array(z.string()),
});
export type TemplateStyleLint = z.infer<typeof templateStyleLintSchema>;

export const outreachTemplateStepSchema = z.object({
  stepKey: templateStepKeySchema,
  stepNumber: z.number().int().min(1).max(4),
  label: z.string().trim().min(1).max(80),
  channel: z.enum(["email", "linkedin"]),
  dayOffset: z.number().int().min(0).max(30),
  subject: z.string().max(180),
  body: z.string().trim().min(1).max(2000),
  mergeFieldsUsed: z.array(z.string()),
  lint: templateStyleLintSchema,
});
export type OutreachTemplateStep = z.infer<typeof outreachTemplateStepSchema>;

export const outreachTemplatePackViewSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  targetDecisionId: z.string().uuid(),
  version: z.number().int().positive(),
  tone: templateToneSchema,
  ctaStyle: templateCtaStyleSchema,
  entryOffer: z.string().max(240).nullable(),
  senderName: z.string().max(120).nullable(),
  targetRoles: z.array(z.string()),
  steps: z.array(outreachTemplateStepSchema).min(1).max(4),
  claimIds: z.array(z.string().uuid()),
  generationMode: z.enum(["llm", "fallback", "manual"]),
  deliveryMode: z.literal("draft_only").optional(),
  lastInstruction: z.string().max(500).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OutreachTemplatePackView = z.infer<typeof outreachTemplatePackViewSchema>;

export const outreachTemplateActionInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate"),
    tone: templateToneSchema.optional(),
    ctaStyle: templateCtaStyleSchema.optional(),
    entryOffer: z.string().trim().max(240).nullable().optional(),
    senderName: z.string().trim().max(120).nullable().optional(),
    instruction: z.string().trim().min(1).max(500).optional(),
    includeLinkedIn: z.boolean().optional(),
    maxWords: z.number().int().min(20).max(140).optional(),
  }),
  z.object({
    action: z.literal("edit_step"),
    stepKey: templateStepKeySchema,
    subject: z.string().trim().max(180),
    body: z.string().trim().min(1).max(2000),
    senderName: z.string().trim().max(120).nullable().optional(),
  }),
  z.object({
    action: z.literal("update_settings"),
    tone: templateToneSchema.optional(),
    ctaStyle: templateCtaStyleSchema.optional(),
    entryOffer: z.string().trim().max(240).nullable().optional(),
    senderName: z.string().trim().max(120).nullable().optional(),
  }),
]);
export type OutreachTemplateActionInput = z.infer<typeof outreachTemplateActionInputSchema>;

const AI_VOICE_TELLS = [
  "hope this finds you",
  "hope this email finds you",
  "hope you're doing well",
  "hope you are doing well",
  "hope you're well",
  "hope all is well",
  "i know you're busy",
  "i know you are busy",
  "reaching out because",
  "i'm reaching out",
  "i am reaching out",
  "just wanted to",
  "wanted to reach out",
  "just following up",
  "just checking in",
  "following up on my",
  "circling back",
  "circle back",
  "touch base",
  "i'd love to",
  "i would love to",
  "in today's",
  "fast-paced",
  "picture this",
  "imagine if",
  "imagine a world",
  "what if i told you",
  "here's the thing",
  "here is the thing",
  "here's what i keep seeing",
  "here's what i keep hearing",
  "the truth is",
  "funny enough",
  "let that sink in",
  "worth a quick",
  "quick question",
  "no pressure",
  "no obligation",
  "no strings",
  "would you be open to",
  "let me know if you're interested",
  "let me know if you are interested",
  "are you the right person",
  "game-changer",
  "game changer",
  "gamechanger",
  "revolutionize",
  "revolutionise",
  "cutting-edge",
  "cutting edge",
  "next-level",
  "next level",
  "supercharge",
  "unlock",
  "unleash",
  "elevate",
  "empower",
  "seamless",
  "seamlessly",
  "leverage",
  "leveraging",
  "synergy",
  "synergies",
  "delve",
  "tapestry",
  "testament to",
  "robust",
  "crucial",
  "pivotal",
  "transformative",
  "transform your",
  "streamline",
  "pain point",
  "pain points",
  "best-in-class",
  "world-class",
  "low-hanging fruit",
  "move the needle",
  "at the end of the day",
  "a whole new level",
  "it's not about",
  "it is not about",
  "isn't about",
  "this isn't just",
  "it's not just",
  "it isn't just",
  "not just a",
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const AI_TELL_PATTERNS = AI_VOICE_TELLS.map((phrase) => ({
  phrase,
  regex: new RegExp(
    `(?:^|[^\\w-])${escapeRegex(phrase).replace(/'/g, "['’]")}(?=$|[^\\w-])`,
    "i",
  ),
}));

const NOT_ONLY_BUT_REGEX = /\bnot (?:only|just|merely) [^.?!\n]{1,60}?\bbut\b/i;
const UNICODE_DASH_REGEX = /[‒–—―−]/;
const SPACED_OR_DOUBLE_HYPHEN_REGEX = /(?<=\S) +-{1,3} +(?=\S)|(?<=\w)--(?=\w)/;
const LIST_LINE_REGEX = /^\s*(?:[-*•●▪]|\d{1,2}[.)])\s+\S/m;
const MARKDOWN_FORMATTING_REGEX = /\*\*[^*\n]+\*\*|__[^_\n]+__|^\s*#{1,6}\s/m;
const GREETING_LINE_REGEX =
  /^(?:hi|hey|hello|dear|good (?:morning|afternoon))\b[^\n]{0,45}$|^[\w{}.'-][\w {}.'-]{0,35},$/i;
const SELF_OPENING_REGEX = /^(?:i|we|i'm|we're|i've|we've|i'd|we'd|my|our)\b/i;
const DECEPTIVE_SUBJECT_PREFIX_REGEX = /^\s*(?:re|fwd):/i;
const SUBJECT_NAME_TAG_REGEX = /\{\{\s*(?:first_?name|full_?name)\s*\}\}/i;
const URL_REGEX = /(?:https?:\/\/|www\.)\S+/i;

const BOILERPLATE_SIGN_OFF_REGEX =
  /^(?:best|best wishes|thanks|thank you|thanks again|many thanks|cheers|regards|best regards|kind regards|warm regards|warmly|talk soon|speak soon|all the best|sincerely|take care)[,.!?]?$/i;

export function tidyEmailText(text: string): string {
  return (text ?? "")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[\u00A0\u202F\u2009\u200A]/g, " ")
    .replace(/[\u200B\u2060\uFEFF]/g, "")
    .replace(/…/g, "...")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function normalizeMergeTags(text: string): string {
  return (text ?? "")
    .replace(/\{\{\s*(?:company|company_name|account|account_name)\s*\}\}/gi, "{{company_name}}")
    .replace(/\{\{\s*(?:title|job_title|role)\s*\}\}/gi, "{{job_title}}")
    .replace(/\{\{\s*(?:first_?name|firstname)\s*\}\}/gi, "{{first_name}}")
    .replace(/\{\{\s*(?:full_?name|fullname|name)\s*\}\}/gi, "{{full_name}}")
    .replace(/\{\{\s*city\s*\}\}/gi, "{{city}}")
    .replace(/\{\{\s*country\s*\}\}/gi, "{{country}}")
    .replace(/\{\{\s*(?:website|domain|company_website)\s*\}\}/gi, "{{website}}");
}

export function stripBoilerplateSignOff(body: string, senderName?: string | null): string {
  const trimmedSender = (senderName ?? "").trim();
  const senderFirst = trimmedSender ? trimmedSender.split(/\s+/)[0] : "";
  const senderFullLower = trimmedSender.toLowerCase();
  const lines = tidyEmailText(body).split("\n");

  while (lines.length > 0) {
    const rawLast = lines[lines.length - 1].trim();
    const cleanedLast = rawLast.replace(/^[-~–—\s]+/, "").trim();
    const lowLast = cleanedLast.toLowerCase().replace(/[,.]+$/, "");

    if (!cleanedLast) {
      lines.pop();
      continue;
    }
    if (BOILERPLATE_SIGN_OFF_REGEX.test(cleanedLast)) {
      lines.pop();
      continue;
    }
    if (senderFirst && (lowLast === senderFirst.toLowerCase() || lowLast === senderFullLower)) {
      lines.pop();
      continue;
    }
    const signOffWithSenderMatch = cleanedLast.match(/^([a-z ]+?)[,.]?\s+(?:-\s*)?([a-z'-]+)\.?$/i);
    if (
      signOffWithSenderMatch &&
      BOILERPLATE_SIGN_OFF_REGEX.test(`${signOffWithSenderMatch[1].trim()},`) &&
      (!senderFirst || signOffWithSenderMatch[2].toLowerCase() === senderFirst.toLowerCase())
    ) {
      lines.pop();
      continue;
    }
    break;
  }

  const baseBody = lines.join("\n").trim();
  if (!senderFirst) return baseBody;
  return baseBody ? `${baseBody}\n\n${senderFirst}` : senderFirst;
}

export function extractMergeFields(subject: string, body: string): string[] {
  const combined = `${subject}\n${body}`;
  const found = new Set<string>();
  const matches = combined.match(/\{\{\s*[a-z_]+\s*\}\}/gi) ?? [];
  for (const raw of matches) {
    const normalized = normalizeMergeTags(raw);
    if ((SUPPORTED_MERGE_TAGS as readonly string[]).includes(normalized)) {
      found.add(normalized);
    }
  }
  return Array.from(found);
}

export function countEmailWords(text: string): number {
  const trimmed = tidyEmailText(text);
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function blankKnownText(text: string, knownNames: string[] = []): string {
  let out = text.replace(/\{\{\s*[a-z0-9_]+\s*\}\}/gi, " placeholder ");
  for (const name of knownNames) {
    const clean = name.trim();
    if (clean.length >= 3) {
      out = out.replace(new RegExp(escapeRegex(clean), "gi"), " ");
    }
  }
  return out;
}

function firstNonGreetingLine(body: string): string {
  const lines = tidyEmailText(body)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (GREETING_LINE_REGEX.test(line)) {
      continue;
    }
    return line;
  }
  return "";
}

export function lintOutreachEmailStep(
  input: {
    stepKey: TemplateStepKey;
    channel: "email" | "linkedin";
    subject: string;
    body: string;
  },
  options: {
    knownNames?: string[];
    maxWordsOverride?: number;
    enforceShape?: boolean;
  } = {},
): TemplateStyleLint {
  const subject = tidyEmailText(input.subject);
  const body = tidyEmailText(input.body);
  const rawCombined = `${subject}\n${body}`;
  const blankedCombined = blankKnownText(rawCombined, options.knownNames);
  const loweredBlanked = blankedCombined.toLowerCase();

  const issues: string[] = [];
  const defaultCap = EMAIL_STEP_WORD_CAPS[input.stepKey];
  const maxWords =
    options.maxWordsOverride && input.channel === "email"
      ? options.maxWordsOverride
      : defaultCap;
  const wordCount = countEmailWords(body);

  if (UNICODE_DASH_REGEX.test(rawCombined) || SPACED_OR_DOUBLE_HYPHEN_REGEX.test(rawCombined)) {
    issues.push("Uses a dash between words; replace with a comma or period.");
  }

  if (rawCombined.includes("!")) {
    issues.push("Contains an exclamation mark; remove it for a calm peer tone.");
  }

  if (LIST_LINE_REGEX.test(body) || MARKDOWN_FORMATTING_REGEX.test(rawCombined)) {
    issues.push("Contains markdown or bullet formatting; keep the message plain text.");
  }

  const matchedTells: string[] = [];
  for (const item of AI_TELL_PATTERNS) {
    if (item.regex.test(loweredBlanked)) {
      matchedTells.push(item.phrase);
    }
  }
  if (NOT_ONLY_BUT_REGEX.test(loweredBlanked)) {
    matchedTells.push("not just X but Y");
  }
  if (matchedTells.length > 0) {
    issues.push(
      `Sounds AI-written or salesy (${matchedTells
        .slice(0, 4)
        .map((t) => `"${t}"`)
        .join(", ")}).`,
    );
  }

  if (input.channel === "email") {
    if (!subject) {
      issues.push("Subject line is blank.");
    } else {
      if (SUBJECT_NAME_TAG_REGEX.test(subject)) {
        issues.push("Remove recipient name merge tags from the subject line.");
      }
      if (input.stepKey === "initial" && DECEPTIVE_SUBJECT_PREFIX_REGEX.test(subject)) {
        issues.push('Do not use a fake "re:" or "fwd:" subject on Email 1.');
      }
      if (/quick question/i.test(subject)) {
        issues.push('Avoid "quick question" in the subject line.');
      }
      const subjectWithoutTags = subject.replace(/\{\{\s*[a-z0-9_]+\s*\}\}/gi, "").trim();
      if (/[A-Z]/.test(subjectWithoutTags)) {
        issues.push("Keep email subject lines all lowercase so they read like an internal note.");
      }
      const subjectWords = countEmailWords(subject);
      if (subjectWords > 6) {
        issues.push(`Subject is ${subjectWords} words; aim for 2-5 short words.`);
      }
    }

    if (input.stepKey === "initial" && URL_REGEX.test(rawCombined)) {
      issues.push("Remove URLs or links from Email 1 for cleaner inbox deliverability.");
    }

    if (options.enforceShape !== false) {
      if (wordCount > maxWords) {
        issues.push(`Body is ${wordCount} words; Step ${input.stepKey} cap is ${maxWords} words.`);
      }
      const questionCount = (body.match(/\?/g) ?? []).length;
      if (questionCount > 1) {
        issues.push(`Asks ${questionCount} questions; keep at most one question.`);
      }
      if (input.stepKey === "initial" || input.stepKey === "follow_up_1") {
        const openingLine = firstNonGreetingLine(body);
        if (openingLine && SELF_OPENING_REGEX.test(openingLine)) {
          issues.push('Opens with "I" or "We"; start with the prospect or their situation instead.');
        }
      }
    }
  } else {
    if (body.length > 300) {
      issues.push(`LinkedIn note is ${body.length} characters; keep it under 300.`);
    }
    if (URL_REGEX.test(rawCombined)) {
      issues.push("Remove URLs from the LinkedIn note.");
    }
  }

  return templateStyleLintSchema.parse({
    passed: issues.length === 0,
    wordCount,
    maxWords,
    issues,
  });
}

function parseCityAndCountryFromLocation(location?: string | null): {
  city: string;
  country: string;
} {
  const parts = (location ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { city: "your area", country: "your market" };
  }
  if (parts.length === 1) {
    return { city: parts[0], country: parts[0] };
  }
  return {
    city: parts[0],
    country: parts[parts.length - 1],
  };
}

export function renderTemplateForContact(
  step: Pick<OutreachTemplateStep, "subject" | "body">,
  contact: ContactCandidateView | null,
  account: AccountCandidateDossier | null,
  senderName?: string | null,
): { subject: string; body: string } {
  const fullName = contact?.fullName?.trim() || "";
  const derivedFirstName =
    contact?.firstName?.trim() ||
    (fullName
      ? fullName
          .replace(/^(?:dr|mr|mrs|ms|prof)\.?\s+/i, "")
          .split(/\s+/)[0]
      : "") ||
    "there";

  const jobTitle = contact?.title?.trim() || "leader";
  const companyName =
    account?.name?.trim() || contact?.accountName?.trim() || "your company";
  const locationParts = parseCityAndCountryFromLocation(
    account?.location ?? contact?.location ?? null,
  );
  const website =
    account?.domain?.trim() ||
    account?.website?.trim() ||
    contact?.accountDomain?.trim() ||
    "your website";

  const applyVars = (raw: string) =>
    normalizeMergeTags(raw)
      .replace(/\{\{first_name\}\}/g, derivedFirstName)
      .replace(/\{\{full_name\}\}/g, fullName || "there")
      .replace(/\{\{job_title\}\}/g, jobTitle)
      .replace(/\{\{company_name\}\}/g, companyName)
      .replace(/\{\{city\}\}/g, locationParts.city)
      .replace(/\{\{country\}\}/g, locationParts.country)
      .replace(/\{\{website\}\}/g, website);

  const renderedSubject = tidyEmailText(applyVars(step.subject));
  const rawRenderedBody = tidyEmailText(applyVars(step.body));
  const renderedBody = senderName
    ? stripBoilerplateSignOff(rawRenderedBody, senderName)
    : rawRenderedBody;

  return {
    subject: renderedSubject,
    body: renderedBody,
  };
}

function conciseProblemClause(
  industry: IndustryProfile | null,
  brief: ResearchBrief | null,
): string {
  const rawProblem = industry?.operationalProblems[0]?.trim();
  if (rawProblem) {
    const cleaned = rawProblem
      .replace(/[—–‒―−!]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.]+$/, "");
    const words = cleaned.split(" ").slice(0, 9).join(" ");
    return words.charAt(0).toLowerCase() + words.slice(1);
  }
  const goal = brief?.goal?.trim();
  if (goal) {
    const words = goal.replace(/[—–‒―−!]/g, " ").split(/\s+/).slice(0, 8).join(" ");
    return words.charAt(0).toLowerCase() + words.slice(1);
  }
  return "manual follow-ups and missed team handoffs";
}

function conciseFixClause(
  industry: IndustryProfile | null,
  brief: ResearchBrief | null,
): string {
  const solution = industry?.solutionFit[0]?.trim();
  if (solution) {
    const cleaned = solution
      .replace(/[—–‒―−!]/g, " ")
      .replace(/\b(?:seamless|seamlessly|leverage|leveraging|streamline|elevate|empower|unlock|unleash|cutting-edge|game-changer|robust|crucial|pivotal|transformative)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.]+$/, "");
    if (cleaned.split(" ").length >= 3) {
      const words = cleaned.split(" ").slice(0, 10).join(" ");
      return words.charAt(0).toLowerCase() + words.slice(1);
    }
  }
  const offer = brief?.offer?.trim();
  if (offer) {
    const cleaned = offer
      .replace(/[—–‒―−!]/g, " ")
      .replace(/\b(?:seamless|seamlessly|leverage|leveraging|streamline|elevate|empower|unlock|unleash|cutting-edge|game-changer|robust|crucial|pivotal|transformative)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.]+$/, "");
    const words = cleaned.split(" ").slice(0, 11).join(" ");
    if (words) return words.charAt(0).toLowerCase() + words.slice(1);
  }
  return "automated scheduling and patient follow-ups";
}

function conciseSubjectPhrase(industry: IndustryProfile | null): string {
  const raw = (industry?.name ?? "team operations")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => !["the", "and", "for", "of", "in", "private", "services"].includes(w))
    .slice(0, 2)
    .join(" ");
  return raw || "operations";
}

export function buildDeterministicFallbackTemplatePack(input: {
  id: string;
  conversationId: string;
  targetDecisionId: string;
  version?: number;
  tone?: TemplateTone;
  ctaStyle?: TemplateCtaStyle;
  entryOffer?: string | null;
  senderName?: string | null;
  targetRoles?: string[];
  brief: ResearchBrief | null;
  market: MarketProfile | null;
  industry: IndustryProfile | null;
  claims: ResearchClaim[];
  accounts?: AccountCandidateDossier[];
  includeLinkedIn?: boolean;
  lastInstruction?: string | null;
  maxWords?: number;
  nowIso?: string;
}): OutreachTemplatePackView {
  const now = input.nowIso ?? new Date().toISOString();
  const tone = input.tone ?? "peer_direct";
  const ctaStyle = input.ctaStyle ?? "easy_yes";
  const entryOffer = input.entryOffer?.trim() || null;
  const senderName = input.senderName?.trim() || null;
  const problem = conciseProblemClause(input.industry, input.brief);
  const fix = conciseFixClause(input.industry, input.brief);
  const topicWords = conciseSubjectPhrase(input.industry);
  const marketLabel = input.market?.name?.trim();
  const knownNames = [
    ...(input.accounts ?? []).map((a) => a.name),
    ...(marketLabel ? [marketLabel] : []),
  ];

  const askLine =
    ctaStyle === "free_offer" && entryOffer
      ? `Want me to send over ${entryOffer.replace(/[.!?]+$/, "")}?`
      : ctaStyle === "direct_question"
        ? `How is {{company_name}} handling ${problem} today?`
        : "Is sorting this out on your radar this quarter?";

  const step1Body = stripBoilerplateSignOff(
    `Hi {{first_name}},\n\nTeams running {{company_name}} around {{city}} often run into ${problem}. Those small delays quietly turn into lost hours and missed demand each week.\n\n${askLine}`,
    senderName,
  );

  const step2Body = stripBoilerplateSignOff(
    `Hi {{first_name}},\n\n${problem.charAt(0).toUpperCase() + problem.slice(1)} usually costs teams hours each week before anyone spots the gap. Our system handles ${fix} inside the tools {{company_name}} uses today.\n\nIs this already handled on your side?`,
    senderName,
  );

  const step3Body = stripBoilerplateSignOff(
    `Hi {{first_name}},\n\nI will leave this here for now. Reply anytime if fixing ${problem} becomes a focus for {{company_name}}.`,
    senderName,
  );

  const rawSteps: Array<{
    stepKey: TemplateStepKey;
    stepNumber: number;
    label: string;
    channel: "email" | "linkedin";
    dayOffset: number;
    subject: string;
    body: string;
  }> = [
    {
      stepKey: "initial",
      stepNumber: 1,
      label: "Initial Email",
      channel: "email",
      dayOffset: 0,
      subject: `{{company_name}} ${topicWords}`.toLowerCase().trim(),
      body: step1Body,
    },
    {
      stepKey: "follow_up_1",
      stepNumber: 2,
      label: "Follow-Up 1",
      channel: "email",
      dayOffset: 3,
      subject: `${topicWords} follow-up`.toLowerCase().trim(),
      body: step2Body,
    },
    {
      stepKey: "follow_up_2",
      stepNumber: 3,
      label: "Breakup",
      channel: "email",
      dayOffset: 7,
      subject: "closing the loop",
      body: step3Body,
    },
  ];

  if (input.includeLinkedIn) {
    rawSteps.push({
      stepKey: "linkedin_note",
      stepNumber: 4,
      label: "LinkedIn Note",
      channel: "linkedin",
      dayOffset: 1,
      subject: "",
      body: `Hi {{first_name}}, good seeing the work {{company_name}} is doing in {{city}}. Happy to connect here.`,
    });
  }

  const steps: OutreachTemplateStep[] = rawSteps.map((raw) => {
    const cleanSubject = tidyEmailText(normalizeMergeTags(raw.subject));
    const cleanBody = tidyEmailText(normalizeMergeTags(raw.body));
    return outreachTemplateStepSchema.parse({
      ...raw,
      subject: cleanSubject,
      body: cleanBody,
      mergeFieldsUsed: extractMergeFields(cleanSubject, cleanBody),
      lint: lintOutreachEmailStep(
        {
          stepKey: raw.stepKey,
          channel: raw.channel,
          subject: cleanSubject,
          body: cleanBody,
        },
        { knownNames, maxWordsOverride: input.maxWords },
      ),
    });
  });

  const targetRoles = Array.from(
    new Set(
      (input.targetRoles?.length ? input.targetRoles : input.industry?.buyerRoleHypotheses ?? [])
        .map((r) => r.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);

  return outreachTemplatePackViewSchema.parse({
    id: input.id,
    conversationId: input.conversationId,
    targetDecisionId: input.targetDecisionId,
    version: input.version ?? 1,
    tone,
    ctaStyle,
    entryOffer,
    senderName,
    targetRoles,
    steps,
    claimIds: input.claims.slice(0, 8).map((c) => c.id),
    generationMode: "fallback",
    deliveryMode: "draft_only",
    lastInstruction: input.lastInstruction?.trim() || null,
    createdAt: now,
    updatedAt: now,
  });
}

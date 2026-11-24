import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  buildDeterministicFallbackTemplatePack,
  extractMergeFields,
  lintOutreachEmailStep,
  normalizeMergeTags,
  outreachTemplateStepSchema,
  stripBoilerplateSignOff,
  tidyEmailText,
  type OutreachTemplatePackView,
  type TemplateCtaStyle,
  type TemplateStepKey,
  type TemplateTone,
} from "@/lib/ano/outreach-templates";
import { getActivePlannerConfig, getAnoAgentMode } from "@/server/agents/bedrock";
import { generateOutreachTemplatePackWithModel } from "@/server/agents/outreach-template-model";
import { readMarketSynthesis } from "@/server/persistence/market-synthesis-store";
import {
  readOutreachTemplatePackForConversation,
  upsertOutreachTemplatePack,
} from "@/server/persistence/outreach-template-store";
import { readPeopleDiscoveryForConversation } from "@/server/persistence/people-playbook-store";
import { readResearchConversation } from "@/server/persistence/research-conversation-store";
import { readCompanySearchForConversation } from "@/server/persistence/target-account-discovery-store";

export class OutreachTemplateServiceError extends Error {
  constructor(message: string, readonly code: string = "OUTREACH_TEMPLATE_UNAVAILABLE") {
    super(message);
    this.name = "OutreachTemplateServiceError";
  }
}

async function loadTemplateContextForConversation(
  session: WorkspaceSession,
  conversationId: string,
) {
  const [conversation, synthesis, companySearch, peopleDiscovery, existingPack] = await Promise.all([
    readResearchConversation(session, conversationId),
    readMarketSynthesis(session, conversationId),
    readCompanySearchForConversation(session, conversationId).catch(() => null),
    readPeopleDiscoveryForConversation(session, conversationId).catch(() => null),
    readOutreachTemplatePackForConversation(session, conversationId),
  ]);

  if (!synthesis?.decision || synthesis.decision.status !== "locked") {
    throw new OutreachTemplateServiceError(
      "Lock a target market and industry route before generating outreach email templates.",
      "TARGET_DECISION_REQUIRED",
    );
  }

  const market =
    synthesis.markets.find((item) => item.id === synthesis.decision?.marketProfileId) ?? null;
  const industry =
    synthesis.industries.find((item) => item.id === synthesis.decision?.industryProfileId) ?? null;

  return {
    conversation,
    synthesis,
    targetDecisionId: synthesis.decision.id,
    market,
    industry,
    companySearch,
    peopleDiscovery,
    existingPack,
  };
}

export async function getOutreachTemplatePackForConversation(
  session: WorkspaceSession,
  conversationId: string,
): Promise<{ templatePack: OutreachTemplatePackView | null }> {
  const templatePack = await readOutreachTemplatePackForConversation(session, conversationId);
  return { templatePack };
}

export async function generateOutreachTemplatePackForConversation(
  session: WorkspaceSession,
  conversationId: string,
  options: {
    tone?: TemplateTone;
    ctaStyle?: TemplateCtaStyle;
    entryOffer?: string | null;
    senderName?: string | null;
    instruction?: string;
    includeLinkedIn?: boolean;
    maxWords?: number;
  } = {},
): Promise<{ templatePack: OutreachTemplatePackView }> {
  const ctx = await loadTemplateContextForConversation(session, conversationId);
  const nextVersion = ctx.existingPack ? ctx.existingPack.version + 1 : 1;
  const templatePackId = ctx.existingPack?.id ?? crypto.randomUUID();
  const tone = options.tone ?? ctx.existingPack?.tone ?? "peer_direct";
  const ctaStyle = options.ctaStyle ?? ctx.existingPack?.ctaStyle ?? "easy_yes";
  const entryOffer =
    options.entryOffer !== undefined ? options.entryOffer : ctx.existingPack?.entryOffer ?? null;
  const senderName =
    options.senderName !== undefined ? options.senderName : ctx.existingPack?.senderName ?? null;
  const accounts = ctx.companySearch?.accounts ?? [];
  const contacts = ctx.peopleDiscovery?.contacts ?? [];
  const buyingCommittee = ctx.peopleDiscovery?.personSearch?.buyingCommittee ?? null;

  const claims = ctx.synthesis.claims.filter(
    (claim) =>
      (ctx.market && ctx.market.claimIds.includes(claim.id)) ||
      (ctx.industry && ctx.industry.claimIds.includes(claim.id)),
  );

  const agentMode = getAnoAgentMode();
  let generated: OutreachTemplatePackView;

  if (agentMode === "disabled") {
    generated = buildDeterministicFallbackTemplatePack({
      id: templatePackId,
      conversationId,
      targetDecisionId: ctx.targetDecisionId,
      version: nextVersion,
      tone,
      ctaStyle,
      entryOffer,
      senderName,
      targetRoles: buyingCommittee?.includeTitles ?? ctx.industry?.buyerRoleHypotheses,
      brief: ctx.conversation.brief,
      market: ctx.market,
      industry: ctx.industry,
      claims,
      accounts,
      includeLinkedIn: options.includeLinkedIn,
      lastInstruction: options.instruction,
      maxWords: options.maxWords,
    });
  } else {
    const plannerConfig = getActivePlannerConfig();
    generated = await generateOutreachTemplatePackWithModel(plannerConfig, {
      templatePackId,
      conversationId,
      targetDecisionId: ctx.targetDecisionId,
      version: nextVersion,
      brief: ctx.conversation.brief,
      market: ctx.market,
      industry: ctx.industry,
      claims,
      accounts,
      buyingCommittee,
      contacts,
      tone,
      ctaStyle,
      entryOffer,
      senderName,
      instruction: options.instruction,
      includeLinkedIn: options.includeLinkedIn,
      maxWords: options.maxWords,
    });
  }

  const saved = await upsertOutreachTemplatePack(session, {
    id: generated.id,
    conversationId,
    targetDecisionId: ctx.targetDecisionId,
    version: nextVersion,
    tone: generated.tone,
    ctaStyle: generated.ctaStyle,
    entryOffer: generated.entryOffer,
    senderName: generated.senderName,
    targetRoles: generated.targetRoles,
    steps: generated.steps,
    claimIds: generated.claimIds,
    generationMode: generated.generationMode,
    lastInstruction: generated.lastInstruction,
  });

  return { templatePack: saved };
}

export async function editOutreachTemplateStepForConversation(
  session: WorkspaceSession,
  conversationId: string,
  input: {
    stepKey: TemplateStepKey;
    subject: string;
    body: string;
    senderName?: string | null;
  },
): Promise<{ templatePack: OutreachTemplatePackView }> {
  const ctx = await loadTemplateContextForConversation(session, conversationId);
  const existing = ctx.existingPack;
  if (!existing) {
    throw new OutreachTemplateServiceError(
      "Generate an outreach template sequence first before editing individual steps.",
      "TEMPLATE_PACK_NOT_FOUND",
    );
  }

  const nextSenderName =
    input.senderName !== undefined ? input.senderName?.trim() || null : existing.senderName;
  const knownNames = [
    ...(ctx.companySearch?.accounts ?? []).map((a) => a.name),
    ctx.market?.name ?? "",
  ];

  const updatedSteps = existing.steps.map((step) => {
    if (step.stepKey !== input.stepKey) {
      if (input.senderName !== undefined && step.channel === "email") {
        const nextBody = stripBoilerplateSignOff(step.body, nextSenderName);
        return outreachTemplateStepSchema.parse({
          ...step,
          body: nextBody,
          lint: lintOutreachEmailStep(
            {
              stepKey: step.stepKey,
              channel: step.channel,
              subject: step.subject,
              body: nextBody,
            },
            { knownNames },
          ),
        });
      }
      return step;
    }

    const cleanSubject =
      step.channel === "linkedin" ? "" : tidyEmailText(normalizeMergeTags(input.subject));
    const cleanRawBody = tidyEmailText(normalizeMergeTags(input.body));
    const cleanBody =
      step.channel === "email"
        ? stripBoilerplateSignOff(cleanRawBody, nextSenderName)
        : cleanRawBody;

    return outreachTemplateStepSchema.parse({
      ...step,
      subject: cleanSubject,
      body: cleanBody,
      mergeFieldsUsed: extractMergeFields(cleanSubject, cleanBody),
      lint: lintOutreachEmailStep(
        {
          stepKey: step.stepKey,
          channel: step.channel,
          subject: cleanSubject,
          body: cleanBody,
        },
        { knownNames },
      ),
    });
  });

  const saved = await upsertOutreachTemplatePack(session, {
    id: existing.id,
    conversationId,
    targetDecisionId: existing.targetDecisionId,
    version: existing.version + 1,
    tone: existing.tone,
    ctaStyle: existing.ctaStyle,
    entryOffer: existing.entryOffer,
    senderName: nextSenderName,
    targetRoles: existing.targetRoles,
    steps: updatedSteps,
    claimIds: existing.claimIds,
    generationMode: "manual",
    lastInstruction: existing.lastInstruction,
  });

  return { templatePack: saved };
}

export async function updateOutreachTemplateSettingsForConversation(
  session: WorkspaceSession,
  conversationId: string,
  input: {
    tone?: TemplateTone;
    ctaStyle?: TemplateCtaStyle;
    entryOffer?: string | null;
    senderName?: string | null;
  },
): Promise<{ templatePack: OutreachTemplatePackView }> {
  const ctx = await loadTemplateContextForConversation(session, conversationId);
  const existing = ctx.existingPack;
  if (!existing) {
    return generateOutreachTemplatePackForConversation(session, conversationId, input);
  }

  const nextSenderName =
    input.senderName !== undefined ? input.senderName?.trim() || null : existing.senderName;
  const knownNames = [
    ...(ctx.companySearch?.accounts ?? []).map((a) => a.name),
    ctx.market?.name ?? "",
  ];

  const updatedSteps =
    input.senderName !== undefined
      ? existing.steps.map((step) => {
          if (step.channel !== "email") return step;
          const nextBody = stripBoilerplateSignOff(step.body, nextSenderName);
          return outreachTemplateStepSchema.parse({
            ...step,
            body: nextBody,
            lint: lintOutreachEmailStep(
              {
                stepKey: step.stepKey,
                channel: step.channel,
                subject: step.subject,
                body: nextBody,
              },
              { knownNames },
            ),
          });
        })
      : existing.steps;

  const saved = await upsertOutreachTemplatePack(session, {
    id: existing.id,
    conversationId,
    targetDecisionId: existing.targetDecisionId,
    version: existing.version + 1,
    tone: input.tone ?? existing.tone,
    ctaStyle: input.ctaStyle ?? existing.ctaStyle,
    entryOffer:
      input.entryOffer !== undefined ? input.entryOffer?.trim() || null : existing.entryOffer,
    senderName: nextSenderName,
    targetRoles: existing.targetRoles,
    steps: updatedSteps,
    claimIds: existing.claimIds,
    generationMode: existing.generationMode,
    lastInstruction: existing.lastInstruction,
  });

  return { templatePack: saved };
}

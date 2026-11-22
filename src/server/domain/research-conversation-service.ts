import "server-only";

import { Command } from "@langchain/langgraph";

import type { WorkspaceSession } from "@/contracts/ano";
import type { CompanySearchView } from "@/lib/ano/company-discovery";
import { recommendDiscoveryProvider } from "@/lib/ano/company-discovery";
import type { OutreachTemplatePackView } from "@/lib/ano/outreach-templates";
import {
  recommendPersonDiscoveryProvider,
  type PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import {
  conversationPatchSchema,
  graphResumeSchema,
  type ConversationMessageMetadata,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import { BedrockConfigurationError, getActivePlannerConfig } from "@/server/agents/bedrock";
import { replyInResearchConversation } from "@/server/agents/conversation-chat-model";
import { createBedrockResearchPlanningModel, ResearchPlanningModelError } from "@/server/agents/research-planning-model";
import { dropcontactConfiguration } from "@/server/connectors/dropcontact/dropcontact-client";
import { getOutreachExecutionForConversation } from "@/server/domain/outreach-execution-service";
import {
  generateOutreachTemplatePackForConversation,
  getOutreachTemplatePackForConversation,
} from "@/server/domain/outreach-template-service";
import {
  getPeopleDiscoveryForConversation,
  proposeBuyerRolesForConversation,
  runWebsiteTeamDiscoveryForConversation,
} from "@/server/domain/people-playbook-service";
import {
  getCompanySearchForConversation,
  prepareCompanySearchPreviewForConversation,
  runOpenStreetMapSearchForConversation,
} from "@/server/domain/target-account-discovery-service";
import { getResearchCheckpointer } from "@/server/langgraph/checkpointer";
import { createResearchGraph } from "@/server/langgraph/research-graph";
import { readEvidenceResearchView } from "@/server/persistence/evidence-research-store";
import { readMarketSynthesis } from "@/server/persistence/market-synthesis-store";
import {
  appendAssistantMessage,
  appendUserMessage,
  archiveResearchConversation,
  createResearchConversation,
  failResearchConversation,
  listResearchConversationSummaries,
  readLatestResearchConversation,
  readResearchConversation,
  readWorkspaceWorkQueue,
  recordGraphDecision,
  renameResearchConversation,
  ResearchConversationPersistenceError,
  syncResearchGraphSnapshot,
} from "@/server/persistence/research-conversation-store";
import { prospeoConfiguration } from "@/server/persistence/target-account-discovery-store";

export class ResearchConversationServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchConversationServiceError";
  }
}

function requirePlannerConfig() {
  try {
    return getActivePlannerConfig();
  } catch (error) {
    if (error instanceof BedrockConfigurationError) throw new ResearchConversationServiceError(error.message);
    throw error;
  }
}

async function graphForPhaseA() {
  const config = requirePlannerConfig();
  const [checkpointer] = await Promise.all([getResearchCheckpointer()]);
  return createResearchGraph(createBedrockResearchPlanningModel(config), checkpointer);
}

function graphConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

async function advance(
  session: WorkspaceSession,
  view: ResearchConversationView,
  input: Record<string, unknown> | Command,
) {
  try {
    const graph = await graphForPhaseA();
    const config = graphConfig(view.conversation.threadId);
    await graph.invoke(input as never, config);
    return syncResearchGraphSnapshot(session, view.conversation.id, await graph.getState(config));
  } catch (error) {
    if (error instanceof ResearchPlanningModelError && error.reason) {
      console.error("[ano:phase-a]", error.message, error.reason);
    }
    const message = error instanceof ResearchPlanningModelError || error instanceof ResearchConversationServiceError || error instanceof ResearchConversationPersistenceError
      ? error.message
      : "Ano stopped safely while preparing this research conversation. No research, provider, contact, email, schedule, or call action was attempted.";
    await failResearchConversation(session, view.conversation.id, message).catch(() => undefined);
    throw new ResearchConversationServiceError(message);
  }
}

export async function startResearchConversation(session: WorkspaceSession, message: string, idempotencyKey: string) {
  const created = await createResearchConversation(session, message);
  const appended = await appendUserMessage(session, created.conversationId, message, idempotencyKey);
  const view = await readResearchConversation(session, created.conversationId);
  if (!appended.created) return view;
  return advance(session, view, {
    workspaceId: session.workspace.id,
    conversationId: created.conversationId,
    graphRunId: view.run.id,
    submittedMessage: { id: appended.id, text: message },
  });
}

function mergeUniqueTerms(existing: string[], additions: string[], max = 8) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...existing, ...additions]) {
    const clean = raw.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

export async function continueResearchConversation(
  session: WorkspaceSession,
  conversationId: string,
  message: string,
  idempotencyKey: string,
): Promise<{
  conversation: ResearchConversationView;
  companySearch?: CompanySearchView | null;
  prospeo?: ReturnType<typeof prospeoConfiguration>;
  peopleDiscovery?: PeopleDiscoveryView | null;
  dropcontact?: ReturnType<typeof dropcontactConfiguration>;
  templatePack?: OutreachTemplatePackView | null;
}> {
  const view = await readResearchConversation(session, conversationId);
  if (view.run.status === "draft") {
    const appended = await appendUserMessage(session, conversationId, message, idempotencyKey);
    if (!appended.created) {
      return { conversation: await readResearchConversation(session, conversationId) };
    }
    const conversation = await advance(session, view, {
      workspaceId: session.workspace.id,
      conversationId,
      graphRunId: view.run.id,
      submittedMessage: { id: appended.id, text: message },
    });
    return { conversation };
  }

  const appended = await appendUserMessage(session, conversationId, message, idempotencyKey);
  if (!appended.created) {
    const [existingConv, companyDiscovery] = await Promise.all([
      readResearchConversation(session, conversationId),
      getCompanySearchForConversation(session, conversationId).catch(() => ({
        companySearch: null,
        prospeo: prospeoConfiguration(),
      })),
    ]);
    return {
      conversation: existingConv,
      companySearch: companyDiscovery.companySearch,
      prospeo: companyDiscovery.prospeo,
    };
  }

  const [research, synthesis, companyDiscovery, peopleRes, outreachRes, templateRes] =
    await Promise.all([
      readEvidenceResearchView(session, conversationId).catch(() => null),
      readMarketSynthesis(session, conversationId).catch(() => null),
      getCompanySearchForConversation(session, conversationId).catch(() => ({
        companySearch: null,
        prospeo: prospeoConfiguration(),
      })),
      getPeopleDiscoveryForConversation(session, conversationId).catch(() => null),
      getOutreachExecutionForConversation(session, conversationId).catch(() => null),
      getOutreachTemplatePackForConversation(session, conversationId).catch(() => null),
    ]);

  const enrichedView: ResearchConversationView = {
    ...view,
    messages: [
      ...view.messages,
      {
        id: appended.id,
        role: "user",
        kind: "message",
        text: message,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  let chatOutput;
  try {
    chatOutput = await replyInResearchConversation(
      requirePlannerConfig(),
      {
        conversation: enrichedView,
        research,
        synthesis,
        companySearch: companyDiscovery.companySearch,
        peopleDiscovery: peopleRes?.peopleDiscovery ?? null,
        outreachExecution: outreachRes?.outreachExecution ?? null,
        templatePack: templateRes?.templatePack ?? null,
      },
      message,
    );
  } catch (error) {
    const fallbackError =
      error instanceof ResearchConversationServiceError
        ? error.message
        : "Ano's conversational model could not respond right now. Check your configured model and try again.";
    throw new ResearchConversationServiceError(fallbackError);
  }

  let replyText = chatOutput.reply;
  let messageMetadata: ConversationMessageMetadata | undefined;
  let updatedCompanySearch = companyDiscovery.companySearch;
  let updatedProspeo = companyDiscovery.prospeo;
  let updatedPeopleDiscovery = peopleRes?.peopleDiscovery ?? null;
  let updatedDropcontact = peopleRes?.dropcontact ?? dropcontactConfiguration();
  let updatedTemplatePack = templateRes?.templatePack ?? null;

  if (chatOutput.filterUpdate?.apply) {
    if (synthesis?.decision?.status !== "locked") {
      replyText +=
        "\n\nNote: Lock a Phase C target market and industry route first before I can run a company discovery search.";
    } else {
      const existingSearch = companyDiscovery.companySearch;
      const lockedIndustry = synthesis.industries.find(
        (item) => item.id === synthesis.decision?.industryProfileId,
      );
      const filterUpdate = chatOutput.filterUpdate;
      const mergedKeywords = filterUpdate.keywords?.length
        ? filterUpdate.keywords
        : existingSearch?.industryKeywords;
      const targetProvider =
        filterUpdate.providerKey ??
        existingSearch?.providerKey ??
        (lockedIndustry
          ? recommendDiscoveryProvider(lockedIndustry.name, mergedKeywords ?? [])
          : "openstreetmap");
      const mergedLocations = filterUpdate.locations?.length
        ? filterUpdate.locations
        : existingSearch?.requestedLocations;
      const mergedExclusions = filterUpdate.excludedCategories?.length
        ? mergeUniqueTerms(
            existingSearch?.excludedCategories ?? [],
            filterUpdate.excludedCategories,
            8,
          )
        : existingSearch?.excludedCategories;

      try {
        if (targetProvider === "openstreetmap") {
          const searchRes = await runOpenStreetMapSearchForConversation(session, conversationId, {
            locationOverrides: mergedLocations,
            keywordOverrides: mergedKeywords,
            excludedCategories: mergedExclusions,
            resolveWebsites: true,
          });
          updatedCompanySearch = searchRes.companySearch;
          updatedProspeo = searchRes.prospeo;
          const count = updatedCompanySearch.accounts.length;
          messageMetadata = {
            companySearchUpdated: true,
            companySearchProvider: "openstreetmap",
            companySearchId: updatedCompanySearch.id,
            companySearchResultCount: count,
            awaitingCreditApproval: false,
            actionSummary:
              updatedCompanySearch.status === "completed"
                ? `Updated OpenStreetMap cohort: ${count} companies ($0 credits).`
                : updatedCompanySearch.failureMessage ?? "OpenStreetMap search needs review.",
          };
          if (updatedCompanySearch.status !== "completed") {
            replyText += `\n\nNote: ${updatedCompanySearch.failureMessage ?? "OpenStreetMap could not complete the updated search."}`;
          } else {
            replyText += `\n\nUpdated the Company Cohort Artifact via OpenStreetMap (${count} companies, $0 credits). Click "Open company artifact" below to inspect or shortlist them.`;
          }
        } else {
          const previewRes = await prepareCompanySearchPreviewForConversation(
            session,
            conversationId,
            {
              providerKey: "prospeo",
              locationOverrides: mergedLocations,
              keywordOverrides: mergedKeywords,
              industryOverrides: filterUpdate.industries?.length
                ? filterUpdate.industries
                : undefined,
              excludedCategories: mergedExclusions,
            },
          );
          updatedCompanySearch = previewRes.companySearch;
          updatedProspeo = previewRes.prospeo;
          messageMetadata = {
            companySearchUpdated: true,
            companySearchProvider: "prospeo",
            companySearchId: updatedCompanySearch.id,
            awaitingCreditApproval: true,
            actionSummary:
              "Prepared updated Prospeo preview (max 1 credit on approval).",
          };
          replyText +=
            "\n\nI prepared the updated Prospeo query preview — approve the 1-credit run below when ready.";
        }
      } catch (updateError) {
        const reason =
          updateError instanceof Error
            ? updateError.message
            : "Could not apply the requested filter change automatically.";
        replyText += `\n\nNote: I could not update the company search automatically (${reason}).`;
      }
    }
  }

  if (chatOutput.peopleUpdate?.apply) {
    const shortlistedAccounts = (updatedCompanySearch?.accounts ?? []).filter(
      (acc) => acc.lifecycleState === "shortlisted",
    );
    if (shortlistedAccounts.length === 0) {
      replyText +=
        "\n\nNote: Shortlist at least one company from the Company Cohort Artifact first before I can target decision-makers.";
    } else {
      const existingPersonSearch = updatedPeopleDiscovery?.personSearch ?? null;
      const existingCommittee = existingPersonSearch?.buyingCommittee;
      const lockedIndustry = synthesis?.industries.find(
        (item) => item.id === synthesis.decision?.industryProfileId,
      );
      const pu = chatOutput.peopleUpdate;
      const targetProvider =
        pu.providerKey ??
        existingPersonSearch?.providerKey ??
        recommendPersonDiscoveryProvider(shortlistedAccounts, lockedIndustry?.name ?? "");

      const mergedDepartments = pu.departments?.length
        ? pu.departments
        : existingCommittee?.departments;
      const mergedSeniorities = pu.seniorities?.length
        ? pu.seniorities
        : existingCommittee?.seniorities;
      const mergedIncludeTitles = pu.includeTitles?.length
        ? pu.includeTitles
        : existingCommittee?.includeTitles;
      const mergedExcludeTitles = pu.excludeTitles?.length
        ? mergeUniqueTerms(existingCommittee?.excludeTitles ?? [], pu.excludeTitles, 12)
        : existingCommittee?.excludeTitles;

      try {
        if (targetProvider === "website_team") {
          const runRes = await runWebsiteTeamDiscoveryForConversation(session, conversationId, {
            roleOverrides: mergedIncludeTitles,
            departments: mergedDepartments,
            seniorities: mergedSeniorities,
            excludeTitles: mergedExcludeTitles,
            archetype: existingCommittee?.archetype,
          });
          updatedPeopleDiscovery = runRes.peopleDiscovery;
          updatedDropcontact = runRes.dropcontact;
          const count = updatedPeopleDiscovery.contacts.length;
          const searchStatus = updatedPeopleDiscovery.personSearch?.status;
          messageMetadata = {
            ...(messageMetadata ?? {}),
            peopleSearchUpdated: true,
            peopleSearchProvider: "website_team",
            peopleSearchId: updatedPeopleDiscovery.personSearch?.id,
            peopleResultCount: count,
            awaitingPersonCreditApproval: false,
            actionSummary:
              searchStatus === "completed"
                ? `Updated people cohort via website team scan: ${count} decision-makers ($0 credits).`
                : updatedPeopleDiscovery.personSearch?.failureMessage ??
                  "Website team scan needs review.",
          };
          if (searchStatus !== "completed") {
            replyText += `\n\nNote: ${updatedPeopleDiscovery.personSearch?.failureMessage ?? "Website team extraction could not complete automatically."}`;
          } else {
            replyText += `\n\nUpdated your Buying Committee and scanned shortlisted company websites ($0 credits): ${count} named decision-maker${count === 1 ? "" : "s"} saved. Click "Open people artifact" below to review or select contacts for verification.`;
          }
        } else {
          const previewRes = await proposeBuyerRolesForConversation(session, conversationId, {
            providerKey: "prospeo",
            roleOverrides: mergedIncludeTitles,
            departments: mergedDepartments,
            seniorities: mergedSeniorities,
            excludeTitles: mergedExcludeTitles,
            archetype: existingCommittee?.archetype,
          });
          updatedPeopleDiscovery = previewRes.peopleDiscovery;
          updatedDropcontact = previewRes.dropcontact;
          messageMetadata = {
            ...(messageMetadata ?? {}),
            peopleSearchUpdated: true,
            peopleSearchProvider: "prospeo",
            peopleSearchId: updatedPeopleDiscovery.personSearch?.id,
            awaitingPersonCreditApproval: true,
            actionSummary:
              "Prepared updated Prospeo Buying Committee preview (max 1 credit on approval).",
          };
          replyText +=
            "\n\nI updated the Buying Committee and staged the 1-page Prospeo people preview — approve the 1-credit search below when ready.";
        }
      } catch (peopleError) {
        const reason =
          peopleError instanceof Error
            ? peopleError.message
            : "Could not apply the requested buying committee change automatically.";
        replyText += `\n\nNote: I could not update people discovery automatically (${reason}).`;
      }
    }
  }

  if (chatOutput.templateUpdate?.apply) {
    if (synthesis?.decision?.status !== "locked") {
      replyText +=
        "\n\nNote: Lock a Phase C target market and industry route first before generating outreach email templates.";
    } else {
      const tu = chatOutput.templateUpdate;
      try {
        const templateResult = await generateOutreachTemplatePackForConversation(
          session,
          conversationId,
          {
            tone: tu.tone,
            ctaStyle: tu.ctaStyle,
            entryOffer: tu.entryOffer,
            instruction: tu.instruction ?? message,
            maxWords: tu.maxWords,
          },
        );
        updatedTemplatePack = templateResult.templatePack;
        const passedCount = updatedTemplatePack.steps.filter((s) => s.lint.passed).length;
        messageMetadata = {
          ...(messageMetadata ?? {}),
          templatePackUpdated: true,
          templatePackVersion: updatedTemplatePack.version,
          lintPassedCount: passedCount,
          actionSummary: `Updated outreach email templates (v${updatedTemplatePack.version}, ${passedCount}/${updatedTemplatePack.steps.length} clean anti-AI check, $0 credits).`,
        };
        replyText += `\n\nUpdated your outreach email sequence (v${updatedTemplatePack.version}, ${passedCount}/${updatedTemplatePack.steps.length} steps passed human-voice checks, $0 external spend). Open "Open template studio & lead preview" to inspect or copy it.`;
      } catch (templateError) {
        const reason =
          templateError instanceof Error
            ? templateError.message
            : "Could not update outreach email templates automatically.";
        replyText += `\n\nNote: I could not update your email templates automatically (${reason}).`;
      }
    }
  }

  await appendAssistantMessage(
    session,
    conversationId,
    replyText,
    `assistant:${idempotencyKey}`,
    messageMetadata,
  );

  return {
    conversation: await readResearchConversation(session, conversationId),
    companySearch: updatedCompanySearch,
    prospeo: updatedProspeo,
    peopleDiscovery: updatedPeopleDiscovery,
    dropcontact: updatedDropcontact,
    templatePack: updatedTemplatePack,
  };
}

export async function resumeResearchConversation(session: WorkspaceSession, conversationId: string, input: unknown, idempotencyKey: string) {
  const response = graphResumeSchema.safeParse(input);
  if (!response.success) throw new ResearchConversationServiceError("Ano could not understand that response. Please answer the current question or choose a plan decision.");
  const view = await readResearchConversation(session, conversationId);
  if (view.run.status !== "awaiting_context" && view.run.status !== "awaiting_plan_approval") {
    throw new ResearchConversationServiceError("Ano is not currently waiting for a response in this conversation.");
  }
  let resume = response.data;
  if (resume.kind === "clarification") {
    const message = await appendUserMessage(session, conversationId, resume.answer, idempotencyKey);
    resume = { ...resume, messageId: message.id };
  }
  if (resume.kind === "edit") {
    const message = await appendUserMessage(session, conversationId, resume.instruction, idempotencyKey);
    resume = { ...resume, messageId: message.id };
  }
  const recorded = await recordGraphDecision(session, conversationId, resume, idempotencyKey);
  if (!recorded) return readResearchConversation(session, conversationId);
  return advance(session, view, new Command({ resume }));
}

export async function getCurrentResearchConversation(session: WorkspaceSession) {
  return readLatestResearchConversation(session);
}

export async function listResearchConversations(
  session: WorkspaceSession,
  options: { cursor?: string | null; limit?: number } = {},
) {
  return listResearchConversationSummaries(session, options);
}

export async function getWorkspaceWorkQueue(session: WorkspaceSession) {
  return readWorkspaceWorkQueue(session);
}

export async function getResearchConversation(session: WorkspaceSession, conversationId: string) {
  return readResearchConversation(session, conversationId);
}

export async function updateResearchConversationTitle(
  session: WorkspaceSession,
  conversationId: string,
  title: string,
) {
  return renameResearchConversation(session, conversationId, title);
}

export async function patchResearchConversation(
  session: WorkspaceSession,
  conversationId: string,
  input: unknown,
): Promise<{ conversation: ResearchConversationView; archived: boolean }> {
  const parsed = conversationPatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new ResearchConversationServiceError(
      parsed.error.issues[0]?.message ?? "Provide a valid conversation title or archive action.",
    );
  }
  if (parsed.data.title !== undefined) {
    await renameResearchConversation(session, conversationId, parsed.data.title);
  }
  if (parsed.data.archived === true) {
    await archiveResearchConversation(session, conversationId);
  }
  return {
    conversation: await readResearchConversation(session, conversationId),
    archived: Boolean(parsed.data.archived),
  };
}

import "server-only";

import { Command, type StateSnapshot } from "@langchain/langgraph";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  rankAccountsForAutopilotShortlist,
  selectNextVerificationProvider,
  selectPriorityContactsForWaterfall,
  stagesForAutopilotRerunScope,
  type AutopilotExecutableStage,
  type AutopilotRunView,
  type AutopilotStageSummary,
} from "@/lib/ano/autopilot";
import type {
  AccountCandidateDossier,
  CompanySearchView,
} from "@/lib/ano/company-discovery";
import { recommendDiscoveryProvider } from "@/lib/ano/company-discovery";
import type { OutreachTemplatePackView } from "@/lib/ano/outreach-templates";
import {
  recommendPersonDiscoveryProvider,
  type ContactCandidateView,
  type PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import {
  buildFriendlyConversationTitle,
  conversationPatchSchema,
  formatDisplayErrorMessage,
  graphResumeSchema,
  maskVendorNamesForDisplay,
  needsFriendlyTitleRefresh,
  type ConversationMessageMetadata,
  type GraphResume,
  type ResearchBrief,
  type ResearchConversationView,
  type ResearchPlan,
} from "@/lib/ano/research-conversation";
import { BedrockConfigurationError, getActivePlannerConfig } from "@/server/agents/bedrock";
import {
  replyInResearchConversation,
  userExplicitlyApprovedSpend,
  type ChatShortlistUpdate,
  type ChatVerificationUpdate,
} from "@/server/agents/conversation-chat-model";
import { GeminiApiError, sanitizeLlmErrorForUser } from "@/server/agents/gemini-chat-model";
import {
  OllamaConnectionError,
  OllamaModelNotFoundError,
} from "@/server/agents/ollama-chat-model";
import {
  createAutopilotIntakePlanningModel,
  createBedrockResearchPlanningModel,
  ResearchPlanningModelError,
} from "@/server/agents/research-planning-model";
import { dropcontactConfiguration } from "@/server/connectors/dropcontact/dropcontact-client";
import { getOutreachExecutionForConversation } from "@/server/domain/outreach-execution-service";
import {
  generateOutreachTemplatePackForConversation,
  getOutreachTemplatePackForConversation,
} from "@/server/domain/outreach-template-service";
import {
  approveContactVerificationForConversation,
  approvePersonSearchForConversation,
  getPeopleDiscoveryForConversation,
  prepareContactVerificationForConversation,
  proposeBuyerRolesForConversation,
  runWebsiteTeamDiscoveryForConversation,
} from "@/server/domain/people-playbook-service";
import {
  approveCompanySearchForConversation,
  getCompanySearchForConversation,
  prepareCompanySearchPreviewForConversation,
  runOpenStreetMapSearchForConversation,
  updateAccountStateForConversation,
} from "@/server/domain/target-account-discovery-service";
import {
  detectUrlsInText,
  formatProductSourcesForPrompt,
  ingestProductFile,
  ingestProductUrl,
  ProductIngestionError,
} from "@/server/ingestion/product-source-ingestor";
import {
  getResearchCheckpointer,
  hasPostgresCheckpointerConfig,
} from "@/server/langgraph/checkpointer";
import {
  createResearchGraph,
  type ResearchGraphStateValue,
} from "@/server/langgraph/research-graph";
import { readEvidenceResearchView } from "@/server/persistence/evidence-research-store";
import {
  readAutopilotRun,
  recordAutopilotStageSummary,
  scheduleAutopilotPartialRerun,
} from "@/server/persistence/autopilot-store";
import { readMarketSynthesis } from "@/server/persistence/market-synthesis-store";
import {
  deleteConversationProductSource,
  readConversationProductSources,
  saveConversationProductSource,
} from "@/server/persistence/product-source-store";
import {
  appendAssistantMessage,
  appendUserMessage,
  archiveResearchConversation,
  backfillFriendlyConversationTitles,
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
import { canExecutePaidProviderCall } from "@/server/telemetry/internal-api-usage";

export class ResearchConversationServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchConversationServiceError";
  }
}

export function formatConversationChatError(error: unknown): string {
  if (
    error instanceof GeminiApiError ||
    error instanceof OllamaConnectionError ||
    error instanceof OllamaModelNotFoundError
  ) {
    return sanitizeLlmErrorForUser(error);
  }
  if (error instanceof ResearchConversationServiceError) {
    return formatDisplayErrorMessage(error.message);
  }
  return "Ano could not respond right now. Please try again in a moment.";
}

function requirePlannerConfig() {
  try {
    return getActivePlannerConfig();
  } catch (error) {
    if (error instanceof BedrockConfigurationError) {
      throw new ResearchConversationServiceError(sanitizeLlmErrorForUser(error));
    }
    throw error;
  }
}

async function graphForPhaseA(options?: {
  autopilotIntake?: boolean;
  productContextText?: string | null;
  productSummary?: string | null;
}) {
  const config = requirePlannerConfig();
  const [checkpointer] = await Promise.all([getResearchCheckpointer()]);
  const model = options?.autopilotIntake
    ? createAutopilotIntakePlanningModel(config, {
        productContextText: options.productContextText,
        productSummary: options.productSummary,
      })
    : createBedrockResearchPlanningModel(config);
  return createResearchGraph(model, checkpointer, {
    autopilotIntake: options?.autopilotIntake,
  });
}

function graphConfig(threadId: string) {
  return { configurable: { thread_id: threadId } };
}

async function advance(
  session: WorkspaceSession,
  view: ResearchConversationView,
  input: Record<string, unknown> | Command,
  options?: {
    autopilotIntake?: boolean;
    productContextText?: string | null;
    productSummary?: string | null;
  },
) {
  try {
    const graph = await graphForPhaseA(options);
    const config = graphConfig(view.conversation.threadId);
    await graph.invoke(input as never, config);
    return syncResearchGraphSnapshot(session, view.conversation.id, await graph.getState(config));
  } catch (error) {
    if (error instanceof ResearchPlanningModelError && error.reason) {
      console.error("[ano:phase-a]", error.message, error.reason);
    }
    const rawMessage = error instanceof ResearchPlanningModelError || error instanceof ResearchConversationServiceError || error instanceof ResearchConversationPersistenceError
      ? error.message
      : "Ano could not continue right now. Please try again in a moment.";
    const message = formatDisplayErrorMessage(rawMessage);
    await failResearchConversation(session, view.conversation.id, message).catch(() => undefined);
    throw new ResearchConversationServiceError(message);
  }
}

export type StartConversationInput =
  | string
  | {
      message?: string;
      files?: Array<{ fileName: string; mimeType?: string | null; bytes: Uint8Array }>;
      urls?: string[];
    };

export async function addProductSourceToConversation(
  session: WorkspaceSession,
  conversationId: string,
  input:
    | { kind: "url"; url: string }
    | { kind: "file"; fileName: string; mimeType?: string | null; bytes: Uint8Array },
) {
  await readResearchConversation(session, conversationId);
  try {
    const ingested =
      input.kind === "url"
        ? await ingestProductUrl(input.url)
        : await ingestProductFile({
            fileName: input.fileName,
            mimeType: input.mimeType,
            bytes: input.bytes,
          });
    const productSource = await saveConversationProductSource(session, conversationId, ingested);
    const { summaries } = await readConversationProductSources(session, conversationId);
    return { productSource, productSources: summaries };
  } catch (error) {
    if (error instanceof ProductIngestionError) {
      throw error;
    }
    throw new ResearchConversationServiceError(
      error instanceof Error ? error.message : "Could not process that product source.",
    );
  }
}

export async function getProductSourcesForConversation(
  session: WorkspaceSession,
  conversationId: string,
) {
  await readResearchConversation(session, conversationId);
  const { summaries } = await readConversationProductSources(session, conversationId);
  return { productSources: summaries };
}

export async function removeProductSourceFromConversation(
  session: WorkspaceSession,
  conversationId: string,
  sourceId: string,
) {
  await readResearchConversation(session, conversationId);
  await deleteConversationProductSource(session, conversationId, sourceId);
  const { summaries } = await readConversationProductSources(session, conversationId);
  return { productSources: summaries };
}

export async function startResearchConversation(
  session: WorkspaceSession,
  input: StartConversationInput,
  idempotencyKey: string,
) {
  const normalized =
    typeof input === "string" ? { message: input, files: [], urls: [] } : input;
  const rawMessage = normalized.message?.trim() ?? "";
  const files = normalized.files ?? [];
  const explicitUrls = normalized.urls ?? [];
  const detectedUrls = rawMessage ? detectUrlsInText(rawMessage) : [];
  const candidateUrls = Array.from(
    new Set([...explicitUrls, ...detectedUrls].map((u) => u.trim()).filter(Boolean)),
  ).slice(0, 3);

  const ingestedSources = [];
  for (const file of files.slice(0, 3)) {
    ingestedSources.push(
      await ingestProductFile({
        fileName: file.fileName,
        mimeType: file.mimeType,
        bytes: file.bytes,
      }),
    );
  }
  for (const url of candidateUrls) {
    ingestedSources.push(await ingestProductUrl(url));
  }

  const attachmentLabels = [
    ...files.map((f) => f.fileName),
    ...candidateUrls,
  ].filter(Boolean);

  const effectiveMessage =
    rawMessage ||
    (attachmentLabels.length > 0
      ? `Analyze my attached product source(s): ${attachmentLabels.join(", ")}`
      : "");

  if (!effectiveMessage) {
    throw new ResearchConversationServiceError(
      "Tell Ano what you sell or attach a product link, PDF, Word doc (.docx), or text file first.",
    );
  }

  const initialTitle = buildFriendlyConversationTitle({
    openingMessage: rawMessage || effectiveMessage,
    productSourceLabels: ingestedSources.map((s) => s.label),
    productSourceSummaries: ingestedSources
      .map((s) => s.summaryText)
      .filter((v): v is string => Boolean(v)),
  });

  const created = await createResearchConversation(
    session,
    effectiveMessage,
    initialTitle,
  );
  for (const ingested of ingestedSources) {
    await saveConversationProductSource(session, created.conversationId, ingested);
  }

  const appended = await appendUserMessage(
    session,
    created.conversationId,
    effectiveMessage,
    idempotencyKey,
  );
  const view = await readResearchConversation(session, created.conversationId);
  if (!appended.created) return view;

  const { fullSources } = await readConversationProductSources(session, created.conversationId);
  const productContextText = formatProductSourcesForPrompt(fullSources);
  const productSummary = fullSources[0]?.summaryText ?? null;

  return advance(
    session,
    view,
    {
      workspaceId: session.workspace.id,
      conversationId: created.conversationId,
      graphRunId: view.run.id,
      submittedMessage: { id: appended.id, text: effectiveMessage },
    },
    {
      autopilotIntake: true,
      productContextText,
      productSummary,
    },
  );
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

export function selectAccountsForChatShortlist(
  accounts: AccountCandidateDossier[],
  update: ChatShortlistUpdate,
): AccountCandidateDossier[] {
  const targetState =
    update.action === "hold"
      ? "held"
      : update.action === "dismiss"
        ? "dismissed"
        : "shortlisted";

  let candidates = accounts.filter((acc) => acc.lifecycleState !== targetState);
  if (update.accountNames?.length) {
    const needles = update.accountNames
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    candidates = candidates.filter((acc) =>
      needles.some((needle) => acc.name.toLowerCase().includes(needle)),
    );
  }
  if (update.locationFilter?.trim()) {
    const locNeedle = update.locationFilter.trim().toLowerCase();
    candidates = candidates.filter((acc) =>
      (acc.location ?? "").toLowerCase().includes(locNeedle),
    );
  }

  candidates = [...candidates].sort((left, right) => right.fit.totalScore - left.fit.totalScore);
  const maxLimit =
    targetState === "dismissed"
      ? update.topN
        ? Math.min(update.topN, 25)
        : 25
      : Math.min(update.topN ?? (update.all ? 10 : 5), 10);

  return candidates.slice(0, maxLimit);
}

export function selectContactsForChatVerification(
  contacts: ContactCandidateView[],
  update: ChatVerificationUpdate,
): ContactCandidateView[] {
  let candidates = contacts.filter((c) => c.verificationStatus !== "verified");
  if (update.contactNames?.length) {
    const needles = update.contactNames
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    candidates = candidates.filter((c) => {
      const hay = `${c.fullName} ${c.accountName}`.toLowerCase();
      return needles.some((needle) => hay.includes(needle));
    });
  }
  const maxLimit = Math.min(update.topN ?? 10, 10);
  return candidates.slice(0, maxLimit);
}

function accountMatchesLocationTerms(
  account: AccountCandidateDossier,
  locationTerms?: string[],
): boolean {
  if (!locationTerms?.length) return true;
  const loc = (account.location ?? "").toLowerCase();
  return locationTerms.some((term) => loc.includes(term.trim().toLowerCase()));
}

function formatCompanyBullets(accounts: AccountCandidateDossier[], limit = 10): string {
  return accounts
    .slice(0, limit)
    .map(
      (a) =>
        `- ${a.name} (${a.location ?? "Location n/a"})${a.domain ? ` · ${a.domain}` : ""}`,
    )
    .join("\n");
}

function formatContactBullets(contacts: ContactCandidateView[], limit = 10): string {
  return contacts
    .slice(0, limit)
    .map((c) => {
      const emailTag = c.verifiedDetails?.email
        ? ` · ${c.verifiedDetails.email} [verified]`
        : c.publicEmail
          ? ` · ${c.publicEmail} [public]`
          : "";
      return `- ${c.fullName}${c.title ? ` (${c.title})` : ""} · ${c.accountName}${emailTag}`;
    })
    .join("\n");
}

function buildCompanyDiscoveryStageSummary(
  companySearch: CompanySearchView | null,
  warnings: string[] = [],
): AutopilotStageSummary {
  const accounts = companySearch?.accounts ?? [];
  const shortlistedCount = accounts.filter((a) => a.lifecycleState === "shortlisted").length;
  const completedAt = new Date().toISOString();

  if (accounts.length === 0) {
    const cleanWarnings =
      warnings.length > 0
        ? warnings
        : ["No matching companies were found for the updated filters. Try broadening the location or keywords."];
    return {
      stage: "company_discovery",
      status: "completed_with_warnings",
      headline: "No matching companies found yet",
      detail: cleanWarnings[0] ?? "Company discovery returned 0 candidates.",
      metrics: {
        discoveredCount: 0,
        shortlistedCount: 0,
      },
      warnings: cleanWarnings,
      completedAt,
    };
  }

  return {
    stage: "company_discovery",
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    headline: `Shortlisted top ${shortlistedCount} of ${accounts.length} companies`,
    detail: `Matched ${accounts.length} target accounts and shortlisted ${shortlistedCount} priority candidates.`,
    metrics: {
      discoveredCount: accounts.length,
      shortlistedCount,
      providerKey: companySearch?.providerKey ?? "unknown",
    },
    warnings,
    completedAt,
  };
}

function buildPeopleStageSummary(
  peopleDiscovery: PeopleDiscoveryView | null,
  warnings: string[] = [],
  tiersAttempted: string[] = [],
): AutopilotStageSummary {
  const contacts = peopleDiscovery?.contacts ?? [];
  const shortlistedCount = peopleDiscovery?.shortlistedCount ?? 0;
  const verifiedEmails = contacts.filter(
    (c) => c.verificationStatus === "verified" && Boolean(c.verifiedDetails?.email),
  ).length;
  const publicDirectEmails = contacts.filter(
    (c) =>
      c.verificationStatus !== "verified" &&
      Boolean(c.publicEmail) &&
      c.publicEmailKind === "direct_public",
  ).length;
  const publicSharedEmails = contacts.filter(
    (c) =>
      c.verificationStatus !== "verified" &&
      Boolean(c.publicEmail) &&
      c.publicEmailKind !== "direct_public",
  ).length;
  const withAnyEmail = contacts.filter((c) =>
    Boolean(c.verifiedDetails?.email || c.publicEmail),
  ).length;
  const withPhone = contacts.filter((c) =>
    Boolean(c.verifiedDetails?.phone || c.publicPhone),
  ).length;

  return {
    stage: "people_and_emails",
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    headline: `Found ${contacts.length} decision-makers (${withAnyEmail} with email)`,
    detail: `Captured ${verifiedEmails} verified work email${verifiedEmails === 1 ? "" : "s"}, ${publicDirectEmails + publicSharedEmails} public website email${publicDirectEmails + publicSharedEmails === 1 ? "" : "s"}, and ${withPhone} phone number${withPhone === 1 ? "" : "s"} across ${shortlistedCount} shortlisted companies.`,
    metrics: {
      contactsFound: contacts.length,
      verifiedEmails,
      publicDirectEmails,
      publicSharedEmails,
      withAnyEmail,
      withPhone,
      tiersAttempted: tiersAttempted.join(","),
    },
    warnings,
    completedAt: new Date().toISOString(),
  };
}

function buildTemplatesStageSummary(
  templatePack: OutreachTemplatePackView | null,
  warnings: string[] = [],
): AutopilotStageSummary {
  const passedCount = templatePack ? templatePack.steps.filter((s) => s.lint.passed).length : 0;
  return {
    stage: "outreach_templates",
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    headline: templatePack
      ? `Email templates v${templatePack.version} ready (${passedCount}/${templatePack.steps.length} clean)`
      : "Outreach templates updated",
    detail: templatePack
      ? `Prepared ${templatePack.steps.length}-step outreach sequence (${templatePack.tone}, ${templatePack.ctaStyle}).`
      : "Updated outreach templates.",
    metrics: {
      templateVersion: templatePack?.version ?? 0,
      stepsCount: templatePack?.steps.length ?? 0,
      passedLintCount: passedCount,
    },
    warnings,
    completedAt: new Date().toISOString(),
  };
}

async function resolveBudgetAllowedVerificationProvider(
  session: WorkspaceSession,
  input: {
    requestedProvider?: "prospeo" | "dropcontact";
    lastRunProvider?: "prospeo" | "dropcontact" | null;
    prospeoAvailable: boolean;
    dropcontactAvailable: boolean;
  },
): Promise<"prospeo" | "dropcontact" | null> {
  const primary = selectNextVerificationProvider(input);
  if (!primary) return null;
  if (await canExecutePaidProviderCall(session, primary)) {
    return primary;
  }
  const alternate = primary === "prospeo" ? "dropcontact" : "prospeo";
  const alternateAvailable =
    alternate === "prospeo" ? input.prospeoAvailable : input.dropcontactAvailable;
  if (!input.requestedProvider && alternateAvailable && (await canExecutePaidProviderCall(session, alternate))) {
    return alternate;
  }
  return null;
}

export async function continueResearchConversation(
  session: WorkspaceSession,
  conversationId: string,
  message: string,
  idempotencyKey: string,
): Promise<{
  conversation: ResearchConversationView;
  autopilotRun?: AutopilotRunView | null;
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
    const [existingConv, existingAutopilot, companyDiscovery] = await Promise.all([
      readResearchConversation(session, conversationId),
      readAutopilotRun(session, conversationId).catch(() => null),
      getCompanySearchForConversation(session, conversationId).catch(() => ({
        companySearch: null,
        prospeo: prospeoConfiguration(),
      })),
    ]);
    return {
      conversation: existingConv,
      autopilotRun: existingAutopilot,
      companySearch: companyDiscovery.companySearch,
      prospeo: companyDiscovery.prospeo,
    };
  }

  const [
    research,
    synthesis,
    companyDiscovery,
    peopleRes,
    outreachRes,
    templateRes,
    autopilotRun,
    productSourcesData,
  ] = await Promise.all([
    readEvidenceResearchView(session, conversationId).catch(() => null),
    readMarketSynthesis(session, conversationId).catch(() => null),
    getCompanySearchForConversation(session, conversationId).catch(() => ({
      companySearch: null,
      prospeo: prospeoConfiguration(),
    })),
    getPeopleDiscoveryForConversation(session, conversationId).catch(() => null),
    getOutreachExecutionForConversation(session, conversationId).catch(() => null),
    getOutreachTemplatePackForConversation(session, conversationId).catch(() => null),
    readAutopilotRun(session, conversationId).catch(() => null),
    readConversationProductSources(session, conversationId).catch(() => ({
      summaries: [],
      fullSources: [],
    })),
  ]);

  const initialDropcontact = peopleRes?.dropcontact ?? dropcontactConfiguration();
  const isAutopilotMode = Boolean(autopilotRun);

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
        autopilotRun,
        productSourceExcerpts: productSourcesData.fullSources.slice(0, 3).map((src) => ({
          label: src.label,
          sourceType: src.sourceType,
          summaryText: src.summaryText,
          excerpt: src.extractedText,
        })),
        research,
        synthesis,
        companySearch: companyDiscovery.companySearch,
        peopleDiscovery: peopleRes?.peopleDiscovery ?? null,
        emailSources: {
          prospeoAvailable: companyDiscovery.prospeo.available,
          dropcontactAvailable: initialDropcontact.available,
        },
        outreachExecution: outreachRes?.outreachExecution ?? null,
        templatePack: templateRes?.templatePack ?? null,
      },
      message,
    );
  } catch (error) {
    console.error(
      "[ano:chat]",
      error instanceof Error
        ? { name: error.name, message: error.message.slice(0, 400) }
        : { type: typeof error },
    );
    throw new ResearchConversationServiceError(formatConversationChatError(error));
  }

  let replyText = chatOutput.reply;
  const meta: ConversationMessageMetadata = {};
  let hasMetadata = false;
  let updatedAutopilotRun = autopilotRun;
  let updatedCompanySearch = companyDiscovery.companySearch;
  let updatedProspeo = companyDiscovery.prospeo;
  let updatedPeopleDiscovery = peopleRes?.peopleDiscovery ?? null;
  let updatedDropcontact = initialDropcontact;
  let updatedTemplatePack = templateRes?.templatePack ?? null;

  const spendApproved = userExplicitlyApprovedSpend(message);
  let creditActionExecutedThisTurn = false;
  const executionNotes: string[] = [];
  const executionErrors: string[] = [];

  const hasNewToolDirective = Boolean(
    chatOutput.filterUpdate?.apply ||
      chatOutput.shortlistUpdate?.apply ||
      chatOutput.peopleUpdate?.apply ||
      chatOutput.verificationUpdate?.apply ||
      chatOutput.templateUpdate?.apply,
  );
  const hasPendingPreview = Boolean(
    updatedCompanySearch?.status === "awaiting_approval" ||
      updatedPeopleDiscovery?.personSearch?.status === "awaiting_approval" ||
      updatedPeopleDiscovery?.verificationRun?.status === "awaiting_approval",
  );
  const effectiveApproveTarget = chatOutput.approveAction?.apply
    ? chatOutput.approveAction.target
    : spendApproved && !hasNewToolDirective && hasPendingPreview
      ? "any_pending"
      : null;

  // 1. Execute an already-staged pending approval when explicitly confirmed.
  if (effectiveApproveTarget) {
    if (!spendApproved) {
      executionNotes.push(
        "Pending searches stay paused until you confirm. Click the confirmation button below or reply \"yes, approved\".",
      );
    } else {
      try {
        if (
          (effectiveApproveTarget === "contact_verification" ||
            effectiveApproveTarget === "any_pending") &&
          updatedPeopleDiscovery?.verificationRun?.status === "awaiting_approval"
        ) {
          const runRes = await approveContactVerificationForConversation(
            session,
            conversationId,
            updatedPeopleDiscovery.verificationRun.id,
          );
          updatedPeopleDiscovery = runRes.peopleDiscovery;
          updatedDropcontact = runRes.dropcontact;
          creditActionExecutedThisTurn = true;
          const verifiedContacts = updatedPeopleDiscovery.contacts.filter(
            (c) => c.verificationStatus === "verified",
          );
          const vProvider = updatedPeopleDiscovery.verificationRun?.providerKey ?? "prospeo";
          meta.verificationUpdated = true;
          meta.verificationProvider = vProvider;
          meta.verificationRunId = updatedPeopleDiscovery.verificationRun?.id;
          meta.awaitingVerificationApproval = false;
          meta.verifiedEmailCount = verifiedContacts.length;
          meta.actionSummary = `Work email verification finished: ${verifiedContacts.length} verified email${verifiedContacts.length === 1 ? "" : "s"}.`;
          hasMetadata = true;
          executionNotes.push(
            verifiedContacts.length > 0
              ? `Verified emails saved (${verifiedContacts.length}):\n${formatContactBullets(verifiedContacts)}`
              : (() => {
                  const withAnyEmail = updatedPeopleDiscovery.contacts.filter((c) =>
                    Boolean(c.verifiedDetails?.email || c.publicEmail),
                  );
                  return withAnyEmail.length > 0
                    ? `Verification found 0 additional work emails, and ${withAnyEmail.length} contact(s) now have public website email addresses:\n${formatContactBullets(withAnyEmail)}`
                    : vProvider === "prospeo" && updatedDropcontact.available
                      ? `Email verification finished (${updatedPeopleDiscovery.verificationRun?.status ?? "completed"}), with 0 newly verified emails. Reply "try another verification pass on unverified contacts" or "scan shortlisted company websites" to check your other email sources.`
                      : `Email verification finished (${updatedPeopleDiscovery.verificationRun?.status ?? "completed"}), with 0 newly verified emails. Reply "scan shortlisted company websites" to pull public company contact pages.`;
                })(),
          );
        } else if (
          (effectiveApproveTarget === "person_search" ||
            effectiveApproveTarget === "any_pending") &&
          updatedPeopleDiscovery?.personSearch?.status === "awaiting_approval"
        ) {
          const pProvider = updatedPeopleDiscovery.personSearch.providerKey;
          const runRes = await approvePersonSearchForConversation(
            session,
            conversationId,
            updatedPeopleDiscovery.personSearch.id,
          );
          updatedPeopleDiscovery = runRes.peopleDiscovery;
          updatedDropcontact = runRes.dropcontact;
          creditActionExecutedThisTurn = pProvider === "prospeo";
          const count = updatedPeopleDiscovery.contacts.length;
          const pStatus = updatedPeopleDiscovery.personSearch?.status;
          meta.peopleSearchUpdated = true;
          meta.peopleSearchProvider = pProvider;
          meta.peopleSearchId = updatedPeopleDiscovery.personSearch?.id;
          meta.peopleResultCount = count;
          meta.awaitingPersonCreditApproval = false;
          meta.actionSummary =
            pStatus === "completed"
              ? `${pProvider === "prospeo" ? "B2B directory" : "Website team"} person search finished: ${count} contacts.`
              : maskVendorNamesForDisplay(
                  updatedPeopleDiscovery.personSearch?.failureMessage ??
                    "Person search needs review.",
                );
          hasMetadata = true;
          if (pStatus !== "completed") {
            executionErrors.push(
              maskVendorNamesForDisplay(
                updatedPeopleDiscovery.personSearch?.failureMessage ??
                  "Person search could not complete cleanly.",
              ),
            );
          } else if (count > 0) {
            const withAnyEmailCount = updatedPeopleDiscovery.contacts.filter(
              (c) => Boolean(c.verifiedDetails?.email || c.publicEmail),
            ).length;
            executionNotes.push(
              `Saved ${count} decision-maker${count === 1 ? "" : "s"} (${withAnyEmailCount} with email found):\n${formatContactBullets(updatedPeopleDiscovery.contacts)}\n\nReply "verify emails" to look up direct work emails or "scan shortlisted company websites" for website contacts.`,
            );
          } else {
            executionNotes.push(
              "The approved person search returned 0 matches for the current roles and companies. Ask me to widen the job titles or shortlist more companies.",
            );
          }
        } else if (
          (effectiveApproveTarget === "company_search" ||
            effectiveApproveTarget === "any_pending") &&
          updatedCompanySearch?.status === "awaiting_approval"
        ) {
          const cProvider = updatedCompanySearch.providerKey;
          const runRes = await approveCompanySearchForConversation(
            session,
            conversationId,
            updatedCompanySearch.id,
          );
          updatedCompanySearch = runRes.companySearch;
          updatedProspeo = runRes.prospeo;
          creditActionExecutedThisTurn = cProvider === "prospeo";
          const count = updatedCompanySearch.accounts.length;
          meta.companySearchUpdated = true;
          meta.companySearchProvider = cProvider;
          meta.companySearchId = updatedCompanySearch.id;
          meta.companySearchResultCount = count;
          meta.awaitingCreditApproval = false;
          meta.actionSummary =
            updatedCompanySearch.status === "completed"
              ? `Approved ${cProvider === "prospeo" ? "B2B directory" : "local business"} search: ${count} companies.`
              : maskVendorNamesForDisplay(
                  updatedCompanySearch.failureMessage ?? "Company search needs review.",
                );
          hasMetadata = true;
          if (updatedCompanySearch.status !== "completed") {
            executionErrors.push(
              maskVendorNamesForDisplay(
                updatedCompanySearch.failureMessage ?? "Approved company search needs review.",
              ),
            );
          } else if (count > 0) {
            executionNotes.push(
              `Saved ${count} companies in the cohort:\n${formatCompanyBullets(updatedCompanySearch.accounts)}\n\nReply "shortlist the top 5 and find contacts" whenever you are ready to pull decision-makers.`,
            );
          } else {
            executionNotes.push(
              "The approved company search returned 0 matching companies. Tell me how you would like to broaden the location or keywords.",
            );
          }
        }
      } catch (approveError) {
        executionErrors.push(
          approveError instanceof Error
            ? approveError.message
            : "Could not execute the approved search.",
        );
      }
    }
  }

  // 2. Phase D Company Discovery filter updates (and immediate execution when free, spend-approved, or autopilot).
  let pendingPostShortlistAutopilotSchedule = false;
  if (chatOutput.filterUpdate?.apply) {
    if (synthesis?.decision?.status !== "locked") {
      executionErrors.push(
        "Lock a Phase C target market and industry route first before running company discovery.",
      );
    } else {
      const existingSearch = updatedCompanySearch;
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
        ? filterUpdate.locationMode === "append"
          ? mergeUniqueTerms(existingSearch?.requestedLocations ?? [], filterUpdate.locations, 5)
          : filterUpdate.locations
        : existingSearch?.requestedLocations;
      const mergedExclusions = filterUpdate.excludedCategories?.length
        ? mergeUniqueTerms(
            existingSearch?.excludedCategories ?? [],
            filterUpdate.excludedCategories,
            8,
          )
        : existingSearch?.excludedCategories;

      try {
        if (isAutopilotMode) {
          const prospeoAllowed =
            updatedProspeo.available && (await canExecutePaidProviderCall(session, "prospeo"));
          const providerOrder: Array<"openstreetmap" | "prospeo"> =
            targetProvider === "prospeo" && prospeoAllowed
              ? ["prospeo", "openstreetmap"]
              : targetProvider === "openstreetmap"
                ? prospeoAllowed
                  ? ["openstreetmap", "prospeo"]
                  : ["openstreetmap"]
                : ["openstreetmap"];

          const warnings: string[] = [];
          let executedProvider: "openstreetmap" | "prospeo" = targetProvider;
          let searchSucceeded = false;

          for (const candidateProvider of providerOrder) {
            if (searchSucceeded) break;
            try {
              if (candidateProvider === "openstreetmap") {
                const searchRes = await runOpenStreetMapSearchForConversation(
                  session,
                  conversationId,
                  {
                    locationOverrides: mergedLocations,
                    keywordOverrides: mergedKeywords,
                    excludedCategories: mergedExclusions,
                    resolveWebsites: true,
                  },
                );
                updatedCompanySearch = searchRes.companySearch;
                updatedProspeo = searchRes.prospeo;
                executedProvider = "openstreetmap";
                searchSucceeded = updatedCompanySearch.status === "completed";
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
                if (previewRes.companySearch.status === "awaiting_approval") {
                  const execRes = await approveCompanySearchForConversation(
                    session,
                    conversationId,
                    previewRes.companySearch.id,
                  );
                  updatedCompanySearch = execRes.companySearch;
                  updatedProspeo = execRes.prospeo;
                  creditActionExecutedThisTurn = true;
                } else {
                  updatedCompanySearch = previewRes.companySearch;
                  updatedProspeo = previewRes.prospeo;
                }
                executedProvider = "prospeo";
                searchSucceeded = updatedCompanySearch.status === "completed";
              }
            } catch (providerErr) {
              warnings.push(
                providerErr instanceof Error
                  ? providerErr.message
                  : "Primary company source fell back to alternate provider.",
              );
            }
          }

          if (updatedCompanySearch?.status === "completed") {
            if (updatedCompanySearch.accounts.length > 0 && !chatOutput.shortlistUpdate?.apply) {
              const topAccounts = rankAccountsForAutopilotShortlist(
                updatedCompanySearch.accounts,
                10,
              );
              for (const acc of topAccounts) {
                if (acc.lifecycleState !== "shortlisted") {
                  updatedCompanySearch = await updateAccountStateForConversation(
                    session,
                    conversationId,
                    acc.id,
                    "shortlisted",
                  );
                }
              }
            }

            const count = updatedCompanySearch.accounts.length;
            const shortlistedCount = updatedCompanySearch.accounts.filter(
              (a) => a.lifecycleState === "shortlisted",
            ).length;
            meta.companySearchUpdated = true;
            meta.companySearchProvider = executedProvider;
            meta.companySearchId = updatedCompanySearch.id;
            meta.companySearchResultCount = count;
            meta.awaitingCreditApproval = false;
            meta.shortlistedUpdated = shortlistedCount > 0;
            meta.shortlistedCount = shortlistedCount;
            meta.actionSummary = `Updated companies (${count} found, ${shortlistedCount} shortlisted).`;
            hasMetadata = true;

            if (chatOutput.shortlistUpdate?.apply) {
              pendingPostShortlistAutopilotSchedule = true;
            } else {
              const rerunScope =
                chatOutput.autopilotRerun?.scope === "companies_and_people"
                  ? "companies_and_people"
                  : "companies_people_templates";
              const downstreamStages = stagesForAutopilotRerunScope(rerunScope).filter(
                (stage): stage is AutopilotExecutableStage => stage !== "company_discovery",
              );
              updatedAutopilotRun =
                (await scheduleAutopilotPartialRerun(session, conversationId, {
                  stagesToRerun: downstreamStages,
                  completedStageSummary: buildCompanyDiscoveryStageSummary(
                    updatedCompanySearch,
                    warnings,
                  ),
                  reason: filterUpdate.reason ?? "Updated company filters in chat",
                })) ?? updatedAutopilotRun;
              meta.autopilotRerunTriggered = true;
              meta.autopilotRerunStages = downstreamStages;
            }

            executionNotes.push(
              count > 0
                ? `Updated matching companies for [${updatedCompanySearch.canonicalLocations.join(", ")}] (${count} matched, ${shortlistedCount} shortlisted):\n${formatCompanyBullets(updatedCompanySearch.accounts)}\n\nAutopilot is refreshing decision-makers and emails automatically.`
                : `Updated search for [${updatedCompanySearch.canonicalLocations.join(", ")}], returning 0 companies. Try broadening the keywords or location.`,
            );
          } else {
            executionErrors.push(
              updatedCompanySearch?.failureMessage ??
                warnings[0] ??
                "Could not update company discovery right now.",
            );
          }
        } else if (targetProvider === "openstreetmap") {
          const searchRes = await runOpenStreetMapSearchForConversation(session, conversationId, {
            locationOverrides: mergedLocations,
            keywordOverrides: mergedKeywords,
            excludedCategories: mergedExclusions,
            resolveWebsites: true,
          });
          updatedCompanySearch = searchRes.companySearch;
          updatedProspeo = searchRes.prospeo;
          const count = updatedCompanySearch.accounts.length;
          meta.companySearchUpdated = true;
          meta.companySearchProvider = "openstreetmap";
          meta.companySearchId = updatedCompanySearch.id;
          meta.companySearchResultCount = count;
          meta.awaitingCreditApproval = false;
          meta.actionSummary =
            updatedCompanySearch.status === "completed"
              ? `Updated local business cohort: ${count} companies.`
              : maskVendorNamesForDisplay(
                  updatedCompanySearch.failureMessage ?? "Local business search needs review.",
                );
          hasMetadata = true;
          if (updatedCompanySearch.status !== "completed") {
            executionErrors.push(
              maskVendorNamesForDisplay(
                updatedCompanySearch.failureMessage ??
                  "Local business search could not complete cleanly.",
              ),
            );
          } else if (count > 0) {
            executionNotes.push(
              `Updated the Company Cohort via local business search (${count} companies):\n${formatCompanyBullets(updatedCompanySearch.accounts)}`,
            );
          } else {
            executionNotes.push(
              "Local business search returned 0 companies for those filters. Try a specific city or switch to B2B company directory search.",
            );
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

          if (
            updatedCompanySearch.status === "awaiting_approval" &&
            spendApproved &&
            !creditActionExecutedThisTurn &&
            filterUpdate.executeIfApproved !== false
          ) {
            const execRes = await approveCompanySearchForConversation(
              session,
              conversationId,
              updatedCompanySearch.id,
            );
            updatedCompanySearch = execRes.companySearch;
            updatedProspeo = execRes.prospeo;
            creditActionExecutedThisTurn = true;
            const count = updatedCompanySearch.accounts.length;
            meta.companySearchUpdated = true;
            meta.companySearchProvider = "prospeo";
            meta.companySearchId = updatedCompanySearch.id;
            meta.companySearchResultCount = count;
            meta.awaitingCreditApproval = false;
            meta.actionSummary =
              updatedCompanySearch.status === "completed"
                ? `Executed B2B company search: ${count} companies.`
                : maskVendorNamesForDisplay(
                    updatedCompanySearch.failureMessage ?? "Company search needs review.",
                  );
            hasMetadata = true;
            if (updatedCompanySearch.status !== "completed") {
              executionErrors.push(
                maskVendorNamesForDisplay(
                  updatedCompanySearch.failureMessage ??
                    "Ano could not complete the approved company search.",
                ),
              );
            } else if (count > 0) {
              executionNotes.push(
                `Ran B2B company directory search for [${updatedCompanySearch.canonicalLocations.join(", ")}] (${count} companies saved):\n${formatCompanyBullets(updatedCompanySearch.accounts)}`,
              );
            } else {
              executionNotes.push(
                `B2B directory returned 0 companies for [${updatedCompanySearch.canonicalLocations.join(", ")}]. Try broadening keywords or switching to local business search.`,
              );
            }
          } else {
            meta.companySearchUpdated = true;
            meta.companySearchProvider = "prospeo";
            meta.companySearchId = updatedCompanySearch.id;
            meta.awaitingCreditApproval = true;
            meta.actionSummary = "Prepared updated B2B company search preview.";
            hasMetadata = true;
            executionNotes.push(
              `Prepared updated B2B company search preview for [${updatedCompanySearch.canonicalLocations.join(", ")}]. Click "Run company search" below or reply "yes, go ahead" to run it.`,
            );
          }
        }
      } catch (updateError) {
        executionErrors.push(
          updateError instanceof Error
            ? updateError.message
            : "Could not apply the requested filter change automatically.",
        );
      }
    }
  }

  // 3. Company cohort shortlisting / hold / dismiss via chat.
  if (chatOutput.shortlistUpdate?.apply) {
    const accounts = updatedCompanySearch?.accounts ?? [];
    if (updatedCompanySearch?.status === "awaiting_approval" && chatOutput.filterUpdate?.apply) {
      executionNotes.push(
        "Once you approve and run the updated company search, I will shortlist the best matching companies.",
      );
    } else if (accounts.length === 0) {
      executionNotes.push(
        "There are no discovered companies in this conversation to shortlist yet.",
      );
    } else {
      const targetState =
        chatOutput.shortlistUpdate.action === "hold"
          ? "held"
          : chatOutput.shortlistUpdate.action === "dismiss"
            ? "dismissed"
            : "shortlisted";
      const matched = selectAccountsForChatShortlist(accounts, chatOutput.shortlistUpdate);
      if (matched.length === 0 && !pendingPostShortlistAutopilotSchedule) {
        executionNotes.push(
          "No additional companies matched your shortlist filter criteria (they may already be in that state or outside the named filter).",
        );
      } else {
        try {
          for (const acc of matched) {
            updatedCompanySearch = await updateAccountStateForConversation(
              session,
              conversationId,
              acc.id,
              targetState,
            );
          }
          const refreshedPeople = await getPeopleDiscoveryForConversation(
            session,
            conversationId,
          ).catch(() => null);
          if (refreshedPeople) {
            updatedPeopleDiscovery = refreshedPeople.peopleDiscovery;
            updatedDropcontact = refreshedPeople.dropcontact;
          }
          const totalShortlisted =
            updatedCompanySearch?.accounts.filter((a) => a.lifecycleState === "shortlisted")
              .length ?? 0;
          meta.shortlistedUpdated = true;
          meta.shortlistedCount = totalShortlisted;
          meta.actionSummary = `${targetState === "shortlisted" ? "Shortlisted" : targetState === "held" ? "Held" : "Dismissed"} ${matched.length} company candidate(s).`;
          hasMetadata = true;
          if (matched.length > 0) {
            executionNotes.push(
              `${targetState === "shortlisted" ? "Shortlisted" : targetState === "held" ? "Held" : "Dismissed"} ${matched.length} compan${matched.length === 1 ? "y" : "ies"}: ${matched.map((a) => a.name).join(", ")}.`,
            );
          }

          if (
            isAutopilotMode &&
            (pendingPostShortlistAutopilotSchedule ||
              (chatOutput.autopilotRerun?.scope === "companies_and_people" &&
                !chatOutput.peopleUpdate?.apply))
          ) {
            const rerunScope =
              chatOutput.autopilotRerun?.scope === "companies_people_templates"
                ? "companies_people_templates"
                : "companies_and_people";
            const downstreamStages = stagesForAutopilotRerunScope(rerunScope).filter(
              (stage): stage is AutopilotExecutableStage => stage !== "company_discovery",
            );
            updatedAutopilotRun =
              (await scheduleAutopilotPartialRerun(session, conversationId, {
                stagesToRerun: downstreamStages,
                completedStageSummary: buildCompanyDiscoveryStageSummary(updatedCompanySearch),
                reason:
                  chatOutput.shortlistUpdate.reason ?? "Updated shortlisted companies in chat",
              })) ?? updatedAutopilotRun;
            meta.autopilotRerunTriggered = true;
            meta.autopilotRerunStages = downstreamStages;
            if (!pendingPostShortlistAutopilotSchedule) {
              executionNotes.push(
                "Autopilot is now finding decision-makers and emails for the updated shortlist.",
              );
            }
          }
        } catch (shortlistError) {
          executionErrors.push(
            shortlistError instanceof Error
              ? shortlistError.message
              : "Could not update the selected companies.",
          );
        }
      }
    }
  }

  // 4. Phase E Buying Committee & decision-maker discovery (with smart auto-shortlist on completed cohorts).
  if (chatOutput.peopleUpdate?.apply && !meta.autopilotRerunTriggered) {
    if (updatedCompanySearch?.status === "awaiting_approval") {
      executionNotes.push(
        "The updated company search is staged and awaiting approval first — approve it below (or reply \"yes, approved\"), then I can shortlist the matching companies and pull decision-makers.",
      );
    } else {
      let shortlistedAccounts = (updatedCompanySearch?.accounts ?? []).filter(
        (acc) => acc.lifecycleState === "shortlisted",
      );

      if (shortlistedAccounts.length === 0 && (updatedCompanySearch?.accounts.length ?? 0) > 0) {
        const locationHints = chatOutput.filterUpdate?.locations;
        const pool = (updatedCompanySearch?.accounts ?? [])
          .filter(
            (acc) =>
              acc.lifecycleState !== "dismissed" &&
              accountMatchesLocationTerms(acc, locationHints),
          )
          .sort((a, b) => b.fit.totalScore - a.fit.totalScore)
          .slice(0, 5);

        if (pool.length > 0) {
          try {
            for (const acc of pool) {
              updatedCompanySearch = await updateAccountStateForConversation(
                session,
                conversationId,
                acc.id,
                "shortlisted",
              );
            }
            shortlistedAccounts = (updatedCompanySearch?.accounts ?? []).filter(
              (acc) => acc.lifecycleState === "shortlisted",
            );
            meta.shortlistedUpdated = true;
            meta.shortlistedCount = shortlistedAccounts.length;
            hasMetadata = true;
            executionNotes.push(
              `Shortlisted ${pool.length} matching compan${pool.length === 1 ? "y" : "ies"} (${pool.map((a) => a.name).join(", ")}) so decision-maker search can run.`,
            );
          } catch (autoShortlistError) {
            executionErrors.push(
              autoShortlistError instanceof Error
                ? autoShortlistError.message
                : "Could not shortlist companies before people discovery.",
            );
          }
        }
      }

      if (shortlistedAccounts.length === 0) {
        executionNotes.push(
          "No shortlisted companies match yet — run or approve company discovery first so I have target companies to search.",
        );
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
          if (isAutopilotMode) {
            const prospeoAllowed =
              updatedProspeo.available && (await canExecutePaidProviderCall(session, "prospeo"));
            const runWebsiteFirst = targetProvider === "website_team" || !prospeoAllowed;
            let executedPeopleProvider: "website_team" | "prospeo" = runWebsiteFirst
              ? "website_team"
              : "prospeo";
            const tiersUsed: string[] = [];

            if (runWebsiteFirst) {
              tiersUsed.push("website_team");
              const runRes = await runWebsiteTeamDiscoveryForConversation(session, conversationId, {
                roleOverrides: mergedIncludeTitles,
                departments: mergedDepartments,
                seniorities: mergedSeniorities,
                excludeTitles: mergedExcludeTitles,
                archetype: existingCommittee?.archetype,
              });
              updatedPeopleDiscovery = runRes.peopleDiscovery;
              updatedDropcontact = runRes.dropcontact;
            } else {
              tiersUsed.push("prospeo_search");
              const previewRes = await proposeBuyerRolesForConversation(session, conversationId, {
                providerKey: "prospeo",
                roleOverrides: mergedIncludeTitles,
                departments: mergedDepartments,
                seniorities: mergedSeniorities,
                excludeTitles: mergedExcludeTitles,
                archetype: existingCommittee?.archetype,
              });
              if (previewRes.peopleDiscovery.personSearch?.status === "awaiting_approval") {
                const execRes = await approvePersonSearchForConversation(
                  session,
                  conversationId,
                  previewRes.peopleDiscovery.personSearch.id,
                );
                updatedPeopleDiscovery = execRes.peopleDiscovery;
                updatedDropcontact = execRes.dropcontact;
                creditActionExecutedThisTurn = true;
              } else {
                updatedPeopleDiscovery = previewRes.peopleDiscovery;
                updatedDropcontact = previewRes.dropcontact;
              }
            }

            if (
              updatedPeopleDiscovery &&
              updatedPeopleDiscovery.contacts.length > 0 &&
              !chatOutput.verificationUpdate?.apply
            ) {
              const priorityTargets = selectPriorityContactsForWaterfall(
                updatedPeopleDiscovery.contacts,
                10,
              );
              if (priorityTargets.length > 0) {
                const verifyProvider = await resolveBudgetAllowedVerificationProvider(session, {
                  prospeoAvailable: updatedProspeo.available,
                  dropcontactAvailable: updatedDropcontact.available,
                });
                if (verifyProvider) {
                  tiersUsed.push(`${verifyProvider}_verify`);
                  try {
                    const verifyPreview = await prepareContactVerificationForConversation(
                      session,
                      conversationId,
                      priorityTargets.map((c) => c.id),
                      verifyProvider,
                    );
                    const verifyRunId = verifyPreview.peopleDiscovery.verificationRun?.id;
                    if (
                      verifyRunId &&
                      verifyPreview.peopleDiscovery.verificationRun?.status === "awaiting_approval"
                    ) {
                      const verifyExec = await approveContactVerificationForConversation(
                        session,
                        conversationId,
                        verifyRunId,
                      );
                      updatedPeopleDiscovery = verifyExec.peopleDiscovery;
                      updatedDropcontact = verifyExec.dropcontact;
                      creditActionExecutedThisTurn = true;
                    }
                  } catch {
                    // Keep discovered contacts cleanly if verification had partial misses.
                  }
                }
              }
            }

            const count = updatedPeopleDiscovery?.contacts.length ?? 0;
            meta.peopleSearchUpdated = true;
            meta.peopleSearchProvider = executedPeopleProvider;
            meta.peopleSearchId = updatedPeopleDiscovery?.personSearch?.id;
            meta.peopleResultCount = count;
            meta.awaitingPersonCreditApproval = false;
            meta.actionSummary = `Updated decision-makers: ${count} contact${count === 1 ? "" : "s"}.`;
            hasMetadata = true;

            updatedAutopilotRun =
              (await recordAutopilotStageSummary(
                session,
                conversationId,
                buildPeopleStageSummary(updatedPeopleDiscovery, [], tiersUsed),
              )) ?? updatedAutopilotRun;

            if (count > 0 && updatedPeopleDiscovery) {
              const withAnyEmailCount = updatedPeopleDiscovery.contacts.filter((c) =>
                Boolean(c.verifiedDetails?.email || c.publicEmail),
              ).length;
              executionNotes.push(
                `Updated decision-makers (${count} saved, ${withAnyEmailCount} with email):\n${formatContactBullets(updatedPeopleDiscovery.contacts)}`,
              );
            } else {
              executionNotes.push(
                "No additional contacts matched those updated target roles across your shortlisted companies.",
              );
            }
          } else if (targetProvider === "website_team") {
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
            meta.peopleSearchUpdated = true;
            meta.peopleSearchProvider = "website_team";
            meta.peopleSearchId = updatedPeopleDiscovery.personSearch?.id;
            meta.peopleResultCount = count;
            meta.awaitingPersonCreditApproval = false;
            meta.actionSummary =
              searchStatus === "completed"
                ? `Updated people cohort via website team scan: ${count} decision-makers.`
                : updatedPeopleDiscovery.personSearch?.failureMessage ??
                  "Website team scan needs review.";
            hasMetadata = true;
            if (searchStatus !== "completed") {
              executionErrors.push(
                updatedPeopleDiscovery.personSearch?.failureMessage ??
                  "Website team extraction could not complete automatically.",
              );
            } else {
              const withAnyEmail = updatedPeopleDiscovery.contacts.filter((c) =>
                Boolean(c.verifiedDetails?.email || c.publicEmail),
              );
              const withPhone = updatedPeopleDiscovery.contacts.filter((c) => Boolean(c.publicPhone));
              const rawReports = Array.isArray(
                updatedPeopleDiscovery.personSearch?.providerReceipt?.company_reports,
              )
                ? (updatedPeopleDiscovery.personSearch.providerReceipt.company_reports as Array<{
                    accountName?: string;
                    note?: string;
                    pagesFetched?: number;
                  }>)
                : [];
              const unreachableCount = rawReports.filter((r) => r.pagesFetched === 0).length;
              if (count > 0) {
                executionNotes.push(
                  `Scanned shortlisted websites. Total saved contacts: ${count} (${withAnyEmail.length} with email${withPhone.length > 0 ? `, ${withPhone.length} with phone` : ""}):\n${formatContactBullets(updatedPeopleDiscovery.contacts)}${unreachableCount > 0 ? `\n\n(${unreachableCount} site(s) were unreachable or blocked automated HTML checks.)` : ""}`,
                );
              } else {
                executionNotes.push(
                  "Website scan checked the shortlisted websites but did not find public emails or named leadership profiles (some clinics only embed JavaScript contact forms).",
                );
              }
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

            if (
              updatedPeopleDiscovery.personSearch?.status === "awaiting_approval" &&
              spendApproved &&
              !creditActionExecutedThisTurn &&
              pu.executeIfApproved !== false
            ) {
              const execRes = await approvePersonSearchForConversation(
                session,
                conversationId,
                updatedPeopleDiscovery.personSearch.id,
              );
              updatedPeopleDiscovery = execRes.peopleDiscovery;
              updatedDropcontact = execRes.dropcontact;
              creditActionExecutedThisTurn = true;
              const count = updatedPeopleDiscovery.contacts.length;
              const searchStatus = updatedPeopleDiscovery.personSearch?.status;
              meta.peopleSearchUpdated = true;
              meta.peopleSearchProvider = "prospeo";
              meta.peopleSearchId = updatedPeopleDiscovery.personSearch?.id;
              meta.peopleResultCount = count;
              meta.awaitingPersonCreditApproval = false;
              meta.actionSummary =
                searchStatus === "completed"
                  ? `Executed decision-maker search: ${count} named buyers.`
                  : maskVendorNamesForDisplay(
                      updatedPeopleDiscovery.personSearch?.failureMessage ??
                        "Person search needs review.",
                    );
              hasMetadata = true;
              if (searchStatus !== "completed") {
                executionErrors.push(
                  maskVendorNamesForDisplay(
                    updatedPeopleDiscovery.personSearch?.failureMessage ??
                      "Decision-maker search could not complete cleanly.",
                  ),
                );
              } else if (count > 0) {
                executionNotes.push(
                  `Ran B2B directory person search, saving ${count} named buyer${count === 1 ? "" : "s"}:\n${formatContactBullets(updatedPeopleDiscovery.contacts)}`,
                );
              } else {
                executionNotes.push(
                  "The directory returned 0 matching people for those shortlisted companies and titles. Try broadening target roles or shortlisting more companies.",
                );
              }
            } else {
              meta.peopleSearchUpdated = true;
              meta.peopleSearchProvider = "prospeo";
              meta.peopleSearchId = updatedPeopleDiscovery.personSearch?.id;
              meta.awaitingPersonCreditApproval = true;
              meta.actionSummary = "Prepared updated decision-maker search preview.";
              hasMetadata = true;
              executionNotes.push(
                `Prepared the Buying Committee search for ${shortlistedAccounts.map((a) => a.name).join(", ")}. Click "Run decision-maker search" below or reply "yes, go ahead" to run it.`,
              );
            }
          }
        } catch (peopleError) {
          executionErrors.push(
            peopleError instanceof Error
              ? peopleError.message
              : "Could not apply the requested buying committee change automatically.",
          );
        }
      }
    }
  }

  // 5. Phase 9A selective email verification (Prospeo or Dropcontact, max 10 contacts).
  const requestedVerificationProvider = chatOutput.verificationUpdate?.providerKey ?? "prospeo";
  if (
    chatOutput.verificationUpdate?.apply &&
    !meta.autopilotRerunTriggered &&
    !(
      creditActionExecutedThisTurn &&
      meta.verificationUpdated &&
      meta.verificationProvider === requestedVerificationProvider
    )
  ) {
    const allContacts = updatedPeopleDiscovery?.contacts ?? [];
    if (allContacts.length === 0) {
      executionNotes.push(
        "Discover named decision-makers first before I can look up and verify their work email addresses.",
      );
    } else if (isAutopilotMode) {
      const hasExplicitSelection = Boolean(chatOutput.verificationUpdate.contactNames?.length);
      const selectedContacts = hasExplicitSelection
        ? selectContactsForChatVerification(allContacts, chatOutput.verificationUpdate)
        : (() => {
            const priority = selectPriorityContactsForWaterfall(allContacts, 10);
            return priority.length > 0
              ? priority
              : selectContactsForChatVerification(allContacts, chatOutput.verificationUpdate);
          })();

      if (selectedContacts.length === 0) {
        const verifiedAlready = allContacts.filter((c) => c.verificationStatus === "verified");
        executionNotes.push(
          verifiedAlready.length > 0
            ? `All matching contacts already have verified work emails:\n${formatContactBullets(verifiedAlready)}`
            : "No matching unverified contacts were found to enrich.",
        );
      } else {
        const resolvedProvider = await resolveBudgetAllowedVerificationProvider(session, {
          requestedProvider: chatOutput.verificationUpdate.providerKey,
          lastRunProvider: updatedPeopleDiscovery?.verificationRun?.providerKey ?? null,
          prospeoAvailable: updatedProspeo.available,
          dropcontactAvailable: updatedDropcontact.available,
        });

        if (!resolvedProvider) {
          executionNotes.push(
            "Additional work-email verification is currently at capacity; your saved verified and public website emails remain ready in People & Emails.",
          );
        } else {
          try {
            const previewRes = await prepareContactVerificationForConversation(
              session,
              conversationId,
              selectedContacts.map((c) => c.id),
              resolvedProvider,
            );
            updatedPeopleDiscovery = previewRes.peopleDiscovery;
            updatedDropcontact = previewRes.dropcontact;
            const runId = updatedPeopleDiscovery.verificationRun?.id;
            if (runId && updatedPeopleDiscovery.verificationRun?.status === "awaiting_approval") {
              const execRes = await approveContactVerificationForConversation(
                session,
                conversationId,
                runId,
              );
              updatedPeopleDiscovery = execRes.peopleDiscovery;
              updatedDropcontact = execRes.dropcontact;
              creditActionExecutedThisTurn = true;
            }
            const verifiedContacts = (updatedPeopleDiscovery?.contacts ?? []).filter(
              (c) => c.verificationStatus === "verified",
            );
            meta.verificationUpdated = true;
            meta.verificationProvider = resolvedProvider;
            meta.verificationRunId = updatedPeopleDiscovery?.verificationRun?.id;
            meta.awaitingVerificationApproval = false;
            meta.verifiedEmailCount = verifiedContacts.length;
            meta.actionSummary = `Completed email verification pass: ${verifiedContacts.length} verified work email${verifiedContacts.length === 1 ? "" : "s"}.`;
            hasMetadata = true;

            updatedAutopilotRun =
              (await recordAutopilotStageSummary(
                session,
                conversationId,
                buildPeopleStageSummary(updatedPeopleDiscovery, [], [`${resolvedProvider}_verify`]),
              )) ?? updatedAutopilotRun;

            const withAnyEmail = (updatedPeopleDiscovery?.contacts ?? []).filter((c) =>
              Boolean(c.verifiedDetails?.email || c.publicEmail),
            );
            executionNotes.push(
              verifiedContacts.length > 0
                ? `Email verification pass complete (${verifiedContacts.length} verified work email${verifiedContacts.length === 1 ? "" : "s"}, ${withAnyEmail.length} total with email):\n${formatContactBullets(verifiedContacts)}`
                : withAnyEmail.length > 0
                  ? `Email verification pass finished; ${withAnyEmail.length} contact(s) carry public website email addresses ready in People & Emails:\n${formatContactBullets(withAnyEmail)}`
                  : "Email verification pass finished with no additional direct work emails matched. Ask me to scan shortlisted company websites or add more companies.",
            );
          } catch (verifyError) {
            executionErrors.push(
              verifyError instanceof Error
                ? verifyError.message
                : "Could not complete email verification automatically.",
            );
          }
        }
      }
    } else {
      const selectedContacts = selectContactsForChatVerification(
        allContacts,
        chatOutput.verificationUpdate,
      );
      if (selectedContacts.length === 0) {
        const verifiedAlready = allContacts.filter((c) => c.verificationStatus === "verified");
        executionNotes.push(
          verifiedAlready.length > 0
            ? `All matching contacts already have verified emails:\n${formatContactBullets(verifiedAlready)}`
            : "No matching unverified contacts were found to enrich.",
        );
      } else {
        const requestedProvider = requestedVerificationProvider;
        if (requestedProvider === "dropcontact" && !updatedDropcontact.available) {
          executionErrors.push(
            "Work email verification is not available right now. Reply \"scan shortlisted company websites\" to pull public company emails instead.",
          );
        } else {
          try {
            const previewRes = await prepareContactVerificationForConversation(
              session,
              conversationId,
              selectedContacts.map((c) => c.id),
              requestedProvider,
            );
            updatedPeopleDiscovery = previewRes.peopleDiscovery;
            updatedDropcontact = previewRes.dropcontact;
            const runId = updatedPeopleDiscovery.verificationRun?.id;

            if (
              runId &&
              updatedPeopleDiscovery.verificationRun?.status === "awaiting_approval" &&
              spendApproved &&
              !creditActionExecutedThisTurn &&
              chatOutput.verificationUpdate.executeIfApproved !== false
            ) {
              const execRes = await approveContactVerificationForConversation(
                session,
                conversationId,
                runId,
              );
              updatedPeopleDiscovery = execRes.peopleDiscovery;
              updatedDropcontact = execRes.dropcontact;
              creditActionExecutedThisTurn = true;
              const verifiedContacts = updatedPeopleDiscovery.contacts.filter(
                (c) => c.verificationStatus === "verified",
              );
              meta.verificationUpdated = true;
              meta.verificationProvider = requestedProvider;
              meta.verificationRunId = updatedPeopleDiscovery.verificationRun?.id;
              meta.awaitingVerificationApproval = false;
              meta.verifiedEmailCount = verifiedContacts.length;
              meta.actionSummary = `Work email verification completed: ${verifiedContacts.length} verified email${verifiedContacts.length === 1 ? "" : "s"}.`;
              hasMetadata = true;
              executionNotes.push(
                verifiedContacts.length > 0
                  ? `Verified emails retrieved:\n${formatContactBullets(verifiedContacts)}`
                  : (() => {
                      const withAnyEmail = updatedPeopleDiscovery.contacts.filter((c) =>
                        Boolean(c.verifiedDetails?.email || c.publicEmail),
                      );
                      return withAnyEmail.length > 0
                        ? `Verification returned 0 additional work emails, and ${withAnyEmail.length} contact(s) now carry public website email addresses:\n${formatContactBullets(withAnyEmail)}`
                        : requestedProvider === "prospeo" && updatedDropcontact.available
                          ? "Verification finished with 0 newly verified emails. Reply \"try another verification pass on unverified contacts\" or \"scan shortlisted company websites\" to pull public company emails from their websites."
                          : "Verification finished with 0 newly verified emails. Reply \"scan shortlisted company websites\" to pull public company emails from their websites.";
                    })(),
              );
            } else {
              meta.verificationUpdated = true;
              meta.verificationProvider =
                updatedPeopleDiscovery.verificationRun?.providerKey ?? requestedProvider;
              meta.verificationRunId = runId;
              meta.awaitingVerificationApproval = true;
              meta.actionSummary = `Prepared work email verification for ${selectedContacts.length} contact(s).`;
              hasMetadata = true;
              executionNotes.push(
                `Prepared work email verification for ${selectedContacts.length} contact${selectedContacts.length === 1 ? "" : "s"} (not executed yet). Click "Verify contacts" below or reply "yes, approved".`,
              );
            }
          } catch (verifyError) {
            executionErrors.push(
              verifyError instanceof Error
                ? verifyError.message
                : "Could not prepare selective email verification.",
            );
          }
        }
      }
    }
  }

  // 6. Phase 9B Outreach Email Templates.
  if (chatOutput.templateUpdate?.apply && !meta.autopilotRerunTriggered) {
    if (synthesis?.decision?.status !== "locked") {
      executionErrors.push(
        "Lock a Phase C target market and industry route first before generating outreach email templates.",
      );
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
        if (isAutopilotMode) {
          updatedAutopilotRun =
            (await recordAutopilotStageSummary(
              session,
              conversationId,
              buildTemplatesStageSummary(updatedTemplatePack),
            )) ?? updatedAutopilotRun;
        }
        const passedCount = updatedTemplatePack.steps.filter((s) => s.lint.passed).length;
        meta.templatePackUpdated = true;
        meta.templatePackVersion = updatedTemplatePack.version;
        meta.lintPassedCount = passedCount;
        meta.actionSummary = `Updated outreach email templates (v${updatedTemplatePack.version}, ${passedCount}/${updatedTemplatePack.steps.length} clean anti-AI check).`;
        hasMetadata = true;
        executionNotes.push(
          `Updated your outreach email sequence (v${updatedTemplatePack.version}, ${passedCount}/${updatedTemplatePack.steps.length} steps passed human-voice checks). Open "Open template studio" below to inspect or copy it.`,
        );
      } catch (templateError) {
        executionErrors.push(
          templateError instanceof Error
            ? templateError.message
            : "Could not update outreach email templates automatically.",
        );
      }
    }
  }

  if (executionErrors.length > 0 && executionNotes.length === 0) {
    replyText = executionErrors.join("\n\n").slice(0, 7_500);
  } else if (executionNotes.length > 0 || executionErrors.length > 0) {
    replyText = [replyText.trim(), ...executionNotes, ...executionErrors]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 7_500);
  } else if (
    /\b(i am (?:initiating|updating|running|scanning|preparing|fetching|checking)|i have (?:updated|initiated|prepared|run|scanned))\b/i.test(
      replyText,
    )
  ) {
    replyText = `${replyText.trim()}\n\nNote: No search or enrichment tool ran on this turn yet. Reply with a direct command such as "scan shortlisted company websites for emails" or "approve the pending search", or use the action buttons in the cards above.`.slice(
      0,
      7_500,
    );
  }

  await appendAssistantMessage(
    session,
    conversationId,
    replyText,
    `assistant:${idempotencyKey}`,
    hasMetadata ? meta : undefined,
  );

  return {
    conversation: await readResearchConversation(session, conversationId),
    autopilotRun: updatedAutopilotRun,
    companySearch: updatedCompanySearch,
    prospeo: updatedProspeo,
    peopleDiscovery: updatedPeopleDiscovery,
    dropcontact: updatedDropcontact,
    templatePack: updatedTemplatePack,
  };
}

async function resumePhaseAFromStoredState(
  session: WorkspaceSession,
  view: ResearchConversationView,
  resume: GraphResume,
  intakeOptions?: {
    autopilotIntake?: boolean;
    productContextText?: string | null;
    productSummary?: string | null;
  },
): Promise<ResearchConversationView> {
  try {
    const config = requirePlannerConfig();
    const model = intakeOptions?.autopilotIntake
      ? createAutopilotIntakePlanningModel(config, {
          productContextText: intakeOptions.productContextText,
          productSummary: intakeOptions.productSummary,
        })
      : createBedrockResearchPlanningModel(config);
    const contextMessages = view.messages
      .filter((msg) => msg.role === "user")
      .map((msg) => ({ id: msg.id, role: "user" as const, text: msg.text }));

    if (
      (resume.kind === "clarification" || resume.kind === "edit") &&
      !contextMessages.some((m) => m.id === resume.messageId)
    ) {
      contextMessages.push({
        id: resume.messageId,
        role: "user" as const,
        text: resume.kind === "clarification" ? resume.answer : resume.instruction,
      });
    }

    let nextBrief: ResearchBrief | null = view.brief;
    let nextQuestion = view.pendingQuestion;
    let nextPlan: ResearchPlan | null = view.plan;
    let nextStatus = view.run.status;
    let currentNode = view.run.currentNode;
    let nextNodes: string[] = [];

    if (resume.kind === "clarification" || resume.kind === "retry") {
      const interpretation = await model.interpret(contextMessages);
      nextBrief = {
        ...interpretation.brief,
        sourceMessageIds: contextMessages.map((m) => m.id),
      };
      if (interpretation.outcome === "needs_context" && interpretation.clarification) {
        nextQuestion = { id: crypto.randomUUID(), ...interpretation.clarification };
        nextStatus = "awaiting_context";
        currentNode = "ask_clarifying_question";
        nextNodes = ["ask_clarifying_question"];
      } else {
        const draft = await model.createPlan(nextBrief);
        nextQuestion = null;
        const autoApprove = Boolean(intakeOptions?.autopilotIntake && nextBrief.intakeComplete);
        nextPlan = {
          ...draft,
          id: crypto.randomUUID(),
          version: (view.plan?.version ?? 0) + 1,
          approvalStatus: autoApprove ? "approved" : "awaiting_approval",
          createdAt: new Date().toISOString(),
        };
        if (autoApprove) {
          nextStatus = "complete_without_research";
          currentNode = "intake_complete_autopilot_ready";
          nextNodes = [];
        } else {
          nextStatus = "awaiting_plan_approval";
          currentNode = "await_plan_approval";
          nextNodes = ["await_plan_approval"];
        }
      }
    } else if (resume.kind === "edit") {
      const editBrief: ResearchBrief = nextBrief ?? {
        offer: contextMessages[0]?.text ?? view.conversation.title,
        goal: "Identify the highest-potential target markets and buyers.",
        marketHints: [],
        locationHints: [],
        buyerHints: [],
        constraints: [],
        unknowns: [],
        sourceMessageIds: contextMessages.map((m) => m.id),
      };
      const draft = await model.createPlan(editBrief, resume.instruction);
      nextQuestion = null;
      nextPlan = {
        ...draft,
        id: crypto.randomUUID(),
        version: (view.plan?.version ?? 0) + 1,
        approvalStatus: "awaiting_approval",
        createdAt: new Date().toISOString(),
        userEditInstruction: resume.instruction,
      };
      nextStatus = "awaiting_plan_approval";
      currentNode = "await_plan_approval";
      nextNodes = ["await_plan_approval"];
    } else {
      if (!view.plan) {
        throw new ResearchConversationServiceError(
          "Ano could not find a saved research plan to update.",
        );
      }
      nextQuestion = null;
      nextPlan = {
        ...view.plan,
        approvalStatus: resume.kind === "approve" ? "approved" : "declined",
      };
      nextStatus = "complete_without_research";
      currentNode = resume.kind === "approve" ? "plan_approved" : "plan_declined";
      nextNodes = [];
    }

    const nextState: ResearchGraphStateValue = {
      workspaceId: session.workspace.id,
      conversationId: view.conversation.id,
      graphRunId: view.run.id,
      submittedMessage: null,
      contextMessages,
      brief: nextBrief,
      pendingQuestion: nextQuestion,
      plan: nextPlan,
      status: nextStatus,
      currentNode,
      lastError: null,
    };

    const syntheticSnapshot: StateSnapshot = {
      values: nextState,
      next: nextNodes,
      config: {
        configurable: {
          thread_id: view.conversation.threadId,
          checkpoint_id: crypto.randomUUID(),
        },
      },
      tasks: [],
    };

    return syncResearchGraphSnapshot(session, view.conversation.id, syntheticSnapshot);
  } catch (error) {
    if (error instanceof ResearchPlanningModelError && error.reason) {
      console.error("[ano:phase-a]", error.message, error.reason);
    }
    const rawErrMessage =
      error instanceof ResearchPlanningModelError ||
      error instanceof ResearchConversationServiceError ||
      error instanceof ResearchConversationPersistenceError
        ? error.message
        : "Ano could not update this research plan right now. Please try again.";
    const errMessage = formatDisplayErrorMessage(rawErrMessage);
    await failResearchConversation(session, view.conversation.id, errMessage).catch(
      () => undefined,
    );
    throw new ResearchConversationServiceError(errMessage);
  }
}

export async function resumeResearchConversation(session: WorkspaceSession, conversationId: string, input: unknown, idempotencyKey: string) {
  const response = graphResumeSchema.safeParse(input);
  if (!response.success) throw new ResearchConversationServiceError("Ano could not understand that response. Please answer the current question or choose a plan decision.");
  const view = await readResearchConversation(session, conversationId);
  const canRetryFailedRun = response.data.kind === "retry" && view.run.status === "failed_safe";
  if (
    view.run.status !== "awaiting_context" &&
    view.run.status !== "awaiting_plan_approval" &&
    !canRetryFailedRun
  ) {
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
  const { fullSources } = await readConversationProductSources(session, conversationId);
  const intakeOptions = {
    autopilotIntake: true,
    productContextText: formatProductSourcesForPrompt(fullSources),
    productSummary: fullSources[0]?.summaryText ?? null,
  };
  if (resume.kind === "retry" || !hasPostgresCheckpointerConfig()) {
    return resumePhaseAFromStoredState(session, view, resume, intakeOptions);
  }
  return advance(session, view, new Command({ resume }), intakeOptions);
}

export async function getCurrentResearchConversation(session: WorkspaceSession) {
  return readLatestResearchConversation(session);
}

export async function listResearchConversations(
  session: WorkspaceSession,
  options: { cursor?: string | null; limit?: number } = {},
) {
  const result = await listResearchConversationSummaries(session, options);
  if (
    !options.cursor &&
    session.kind === "supabase" &&
    result.conversations.length > 0 &&
    result.conversations.some(
      (conv) => needsFriendlyTitleRefresh(conv.title) || !conv.title.includes(" — "),
    )
  ) {
    const backfill = await backfillFriendlyConversationTitles(session, {
      conversationIds: result.conversations.map((conv) => conv.id),
    }).catch(() => null);
    if (backfill && backfill.updatedCount > 0) {
      return {
        ...result,
        conversations: result.conversations.map((conv) =>
          backfill.titles[conv.id] ? { ...conv, title: backfill.titles[conv.id] } : conv,
        ),
      };
    }
  }
  return result;
}

export async function autoRenameWorkspaceConversations(session: WorkspaceSession) {
  return backfillFriendlyConversationTitles(session);
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

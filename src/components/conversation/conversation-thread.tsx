"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  CompanyDiscoveryProvider,
  CompanySearchView,
  ProspeoProviderState,
} from "@/lib/ano/company-discovery";
import type { EvidenceResearchView, ResearchProviderKey } from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type {
  ExecutionProposalType,
  MercuryConnectorState,
  OutreachExecutionView,
} from "@/lib/ano/outreach-execution";
import type {
  OutreachTemplatePackView,
  TemplateCtaStyle,
  TemplateStepKey,
  TemplateTone,
} from "@/lib/ano/outreach-templates";
import type {
  CompanyArchetype,
  ContactVerificationProvider,
  DropcontactProviderState,
  PeopleDiscoveryView,
  PersonDiscoveryProvider,
} from "@/lib/ano/people-playbooks";
import {
  sortChronologicalThreadEntries,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import { useMaterialWeb } from "@/components/material/register";
import { MaterialButton } from "@/components/material/material-button";
import { AccountCohortCard } from "@/components/artifacts/account-cohort-card";
import { CompanyCohortArtifactDrawer } from "@/components/artifacts/company-cohort-artifact-drawer";
import { CompanySearchPreviewCard } from "@/components/artifacts/company-search-preview-card";
import { ContactVerificationCard } from "@/components/artifacts/contact-verification-card";
import { EvidenceCard } from "@/components/artifacts/evidence-card";
import { LeadExportCard } from "@/components/artifacts/lead-export-card";
import { OutreachDraftCard } from "@/components/artifacts/outreach-draft-card";
import { OutreachTemplateDrawer } from "@/components/artifacts/outreach-template-drawer";
import { OutreachTemplatePackCard } from "@/components/artifacts/outreach-template-pack-card";
import { PeopleCohortArtifactDrawer } from "@/components/artifacts/people-cohort-artifact-drawer";
import {
  PeopleDiscoveryCard,
  type BuyingCommitteeActionOptions,
} from "@/components/artifacts/people-discovery-card";
import { PlaybookCard } from "@/components/artifacts/playbook-card";
import { ProviderScopeCard } from "@/components/artifacts/provider-scope-card";
import { RecommendationCard } from "@/components/artifacts/recommendation-card";
import { ResearchPlanCard } from "@/components/artifacts/research-plan-card";
import { TargetDecisionCard } from "@/components/artifacts/target-decision-card";
import { ApprovalCard } from "./approval-card";
import { ArtifactMessage } from "./artifact-message";
import { ConversationMessage } from "./conversation-message";
import { ResearchProgressMessage } from "./research-progress-message";

const STARTER_PROMPTS = [
  "I sell AI workflows that help home-service businesses turn quotes into scheduled jobs. Help me find the best outbound market.",
  "We build automated patient-recall software for multi-chair dental practices. Which country and segment should we target first?",
  "We sell accounts-payable invoice automation for mid-market construction firms. Compare the strongest initial markets.",
];

export interface ConversationThreadProps {
  conversation: ResearchConversationView | null;
  research: EvidenceResearchView | null;
  synthesis: MarketSynthesis | null;
  companySearch?: CompanySearchView | null;
  prospeo?: ProspeoProviderState | null;
  peopleDiscovery?: PeopleDiscoveryView | null;
  dropcontact?: DropcontactProviderState | null;
  outreachExecution?: OutreachExecutionView | null;
  mercury?: MercuryConnectorState | null;
  templatePack?: OutreachTemplatePackView | null;
  provider: {
    provider: ResearchProviderKey;
    available: boolean;
    maximumSearches: number;
    maximumFetches: number;
    pricingNote: string;
  } | null;
  pendingUserMessage?: string | null;
  error: string | null;
  needsSignIn: boolean;
  isWorking: boolean;
  selectedMarketId: string;
  selectedIndustryId: string;
  onSelectStarterPrompt: (prompt: string) => void;
  onApprovePlan: () => void;
  onDeclinePlan: () => void;
  onEditPlan: (instruction: string) => void;
  onPrepareResearch: () => void;
  onStartResearch: () => void;
  onAnalyseEvidence: () => void;
  onSelectMarket: (marketId: string) => void;
  onSelectIndustry: (industryId: string) => void;
  onLockTargetRoute: () => void;
  onPrepareCompanySearch?: (options?: {
    providerKey?: CompanyDiscoveryProvider;
    resolveWebsites?: boolean;
    locationOverrides?: string[];
    keywordOverrides?: string[];
    industryOverrides?: string[];
    excludedCategories?: string[];
  }) => void;
  onRunFreeCompanySearch?: (options?: {
    resolveWebsites?: boolean;
    locationOverrides?: string[];
    keywordOverrides?: string[];
    excludedCategories?: string[];
  }) => void;
  onApproveCompanySearch?: (searchId: string) => void;
  onUpdateAccountState?: (
    accountId: string,
    state: "shortlisted" | "held" | "dismissed",
  ) => void;
  onFocusComposerWithPrompt?: (prefill?: string) => void;
  onProposeBuyerRoles?: (options?: BuyingCommitteeActionOptions | string[]) => void;
  onRunFreePeopleSearch?: (options?: {
    roleOverrides?: string[];
    departments?: string[];
    seniorities?: string[];
    excludeTitles?: string[];
    archetype?: CompanyArchetype;
    providerKey?: PersonDiscoveryProvider;
  }) => void;
  onApprovePersonSearch?: (personSearchId: string) => void;
  onPrepareContactVerification?: (
    contactIds: string[],
    providerKey?: ContactVerificationProvider,
  ) => void;
  onApproveContactVerification?: (verificationRunId: string) => void;
  onGeneratePlaybooks?: () => void;
  onGenerateTemplatePack?: (options?: {
    tone?: TemplateTone;
    ctaStyle?: TemplateCtaStyle;
    entryOffer?: string | null;
    senderName?: string | null;
    includeLinkedIn?: boolean;
  }) => void;
  onEditTemplateStep?: (input: {
    stepKey: TemplateStepKey;
    subject: string;
    body: string;
    senderName?: string | null;
  }) => void;
  onGenerateOutreachDrafts?: (playbookId?: string) => void;
  onEditOutreachDraft?: (draftId: string, subject: string, body: string) => void;
  onCreateExecutionProposal?: (
    draftId: string,
    proposalType: ExecutionProposalType,
    scheduledFor?: string,
    note?: string,
  ) => void;
  onDecideExecutionProposal?: (
    proposalId: string,
    decision: "approved" | "rejected" | "dismissed",
    rationale?: string,
  ) => void;
  onOpenContextRail: () => void;
  onStartNewResearch: () => void;
}

type TimelineRenderEntry = {
  id: string;
  timestamp: string;
  orderHint: number;
  render: () => ReactNode;
};

export function ConversationThread({
  conversation,
  research,
  synthesis,
  companySearch = null,
  prospeo = null,
  peopleDiscovery = null,
  dropcontact = null,
  outreachExecution = null,
  mercury = null,
  templatePack = null,
  provider,
  pendingUserMessage = null,
  error,
  needsSignIn,
  isWorking,
  selectedMarketId,
  selectedIndustryId,
  onSelectStarterPrompt,
  onApprovePlan,
  onDeclinePlan,
  onEditPlan,
  onPrepareResearch,
  onStartResearch,
  onAnalyseEvidence,
  onSelectMarket,
  onSelectIndustry,
  onLockTargetRoute,
  onPrepareCompanySearch,
  onRunFreeCompanySearch,
  onApproveCompanySearch,
  onUpdateAccountState,
  onFocusComposerWithPrompt,
  onProposeBuyerRoles,
  onRunFreePeopleSearch,
  onApprovePersonSearch,
  onPrepareContactVerification,
  onApproveContactVerification,
  onGeneratePlaybooks,
  onGenerateTemplatePack,
  onEditTemplateStep,
  onGenerateOutreachDrafts,
  onEditOutreachDraft,
  onCreateExecutionProposal,
  onDecideExecutionProposal,
  onOpenContextRail,
  onStartNewResearch,
}: ConversationThreadProps) {
  useMaterialWeb();
  const [confirmDeclineOpen, setConfirmDeclineOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerInitialAccountId, setDrawerInitialAccountId] = useState<string | null>(null);
  const [peopleDrawerOpen, setPeopleDrawerOpen] = useState(false);
  const [peopleDrawerInitialContactId, setPeopleDrawerInitialContactId] = useState<string | null>(null);
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [templateDrawerStep, setTemplateDrawerStep] = useState<TemplateStepKey>("initial");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [confirmProspeoApprovalOpen, setConfirmProspeoApprovalOpen] = useState(false);
  const [confirmProspeoPersonApprovalOpen, setConfirmProspeoPersonApprovalOpen] = useState(false);
  const [confirmVerificationApprovalOpen, setConfirmVerificationApprovalOpen] = useState(false);
  const errorBannerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef<number>(conversation?.messages.length ?? 0);

  useEffect(() => {
    if (error) {
      errorBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [error]);

  const plan = conversation?.plan ?? null;
  const visibleMessages = useMemo(
    () => conversation?.messages ?? [],
    [conversation?.messages],
  );

  useEffect(() => {
    const nextCount = visibleMessages.length;
    if (pendingUserMessage || nextCount > prevMessageCountRef.current) {
      bottomAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    prevMessageCountRef.current = nextCount;
  }, [visibleMessages.length, pendingUserMessage]);

  function openArtifactDrawer(accountId?: string | null) {
    setDrawerInitialAccountId(accountId ?? null);
    setDrawerOpen(true);
  }

  function openPeopleArtifactDrawer(contactId?: string | null) {
    setPeopleDrawerInitialContactId(contactId ?? null);
    setPeopleDrawerOpen(true);
  }

  const contacts = useMemo(() => peopleDiscovery?.contacts ?? [], [peopleDiscovery?.contacts]);
  const effectiveSelectedContactIds = useMemo(() => {
    const valid = selectedContactIds.filter((id) => contacts.some((c) => c.id === id));
    if (valid.length > 0) return valid;
    return contacts.filter((c) => c.selectedForVerification).map((c) => c.id);
  }, [selectedContactIds, contacts]);

  const handleToggleContact = useMemo(
    () => (contactId: string, checked: boolean) => {
      setSelectedContactIds((prev) => {
        const base =
          prev.length > 0
            ? prev.filter((id) => contacts.some((c) => c.id === id))
            : contacts.filter((c) => c.selectedForVerification).map((c) => c.id);
        if (checked) {
          if (base.includes(contactId)) return base;
          return [...base, contactId].slice(0, 10);
        }
        return base.filter((id) => id !== contactId);
      });
    },
    [contacts],
  );

  const lockedTargetIndustry = useMemo(
    () =>
      synthesis?.industries.find((item) => item.id === synthesis.decision?.industryProfileId) ??
      null,
    [synthesis?.industries, synthesis?.decision?.industryProfileId],
  );

  const timelineEntries = useMemo(() => {
    const entries: TimelineRenderEntry[] = [];

    visibleMessages.forEach((message, index) => {
      const meta = message.metadata;
      const actionNodes: ReactNode[] = [];
      if (message.role === "assistant" && meta?.companySearchUpdated) {
        if (
          meta.awaitingCreditApproval &&
          companySearch?.status === "awaiting_approval" &&
          companySearch.providerKey === "prospeo"
        ) {
          actionNodes.push(
            <MaterialButton
              key="approve-prospeo-co"
              variant="filled"
              disabled={isWorking}
              onClick={() => setConfirmProspeoApprovalOpen(true)}
            >
              Approve 1-credit Prospeo search
            </MaterialButton>,
          );
        } else if (
          companySearch?.status === "completed" &&
          companySearch.accounts.length > 0
        ) {
          actionNodes.push(
            <MaterialButton
              key="open-company-artifact"
              variant="outlined"
              onClick={() => openArtifactDrawer(null)}
            >
              Open company artifact ({companySearch.accounts.length} companies)
            </MaterialButton>,
          );
        }
      }

      if (message.role === "assistant" && meta?.peopleSearchUpdated) {
        if (
          meta.awaitingPersonCreditApproval &&
          peopleDiscovery?.personSearch?.status === "awaiting_approval" &&
          peopleDiscovery.personSearch.providerKey === "prospeo"
        ) {
          actionNodes.push(
            <MaterialButton
              key="approve-prospeo-people"
              variant="filled"
              disabled={isWorking}
              onClick={() => setConfirmProspeoPersonApprovalOpen(true)}
            >
              Approve 1-credit Prospeo person search
            </MaterialButton>,
          );
        } else if (peopleDiscovery && peopleDiscovery.contacts.length > 0) {
          actionNodes.push(
            <MaterialButton
              key="open-people-artifact"
              variant="outlined"
              onClick={() => openPeopleArtifactDrawer(null)}
            >
              Open people artifact ({peopleDiscovery.contacts.length} people)
            </MaterialButton>,
          );
        }
      }

      if (
        message.role === "assistant" &&
        meta?.shortlistedUpdated &&
        !meta?.companySearchUpdated &&
        companySearch &&
        companySearch.accounts.length > 0
      ) {
        actionNodes.push(
          <MaterialButton
            key="open-shortlisted-companies"
            variant="outlined"
            onClick={() => openArtifactDrawer(null)}
          >
            Open company artifact ({meta.shortlistedCount ?? companySearch.accounts.filter((a) => a.lifecycleState === "shortlisted").length} shortlisted)
          </MaterialButton>,
        );
      }

      if (message.role === "assistant" && meta?.verificationUpdated) {
        if (
          meta.awaitingVerificationApproval &&
          peopleDiscovery?.verificationRun?.status === "awaiting_approval"
        ) {
          const providerLabel =
            peopleDiscovery.verificationRun.providerKey === "prospeo" ? "Prospeo" : "Dropcontact";
          actionNodes.push(
            <MaterialButton
              key="approve-email-verification"
              variant="filled"
              disabled={isWorking}
              onClick={() => setConfirmVerificationApprovalOpen(true)}
            >
              Approve {providerLabel} email verification
            </MaterialButton>,
          );
        } else if (
          !meta?.peopleSearchUpdated &&
          peopleDiscovery &&
          peopleDiscovery.contacts.length > 0
        ) {
          actionNodes.push(
            <MaterialButton
              key="open-verified-people-artifact"
              variant="outlined"
              onClick={() => openPeopleArtifactDrawer(null)}
            >
              Open people artifact ({peopleDiscovery.contacts.length} people)
            </MaterialButton>,
          );
        }
      }

      if (message.role === "assistant" && meta?.templatePackUpdated && templatePack) {
        actionNodes.push(
          <MaterialButton
            key="open-template-studio"
            variant="outlined"
            onClick={() => {
              setTemplateDrawerStep("initial");
              setTemplateDrawerOpen(true);
            }}
          >
            Open template studio
          </MaterialButton>,
        );
      }

      const actionSlot = actionNodes.length > 0 ? <>{actionNodes}</> : null;

      entries.push({
        id: `msg:${message.id}`,
        timestamp: message.createdAt,
        orderHint: index,
        render: () => (
          <ConversationMessage
            key={message.id}
            role={message.role}
            text={message.text}
            createdAt={message.createdAt}
            actionSlot={actionSlot}
          />
        ),
      });
    });

    if (plan) {
      entries.push({
        id: `artifact:plan:${plan.id}`,
        timestamp: plan.createdAt,
        orderHint: 100,
        render: () => (
          <ArtifactMessage
            key={`plan-${plan.id}`}
            label={`Research plan v${plan.version}`}
            timestamp={plan.createdAt}
          >
            <ResearchPlanCard
              plan={plan}
              isWorking={isWorking}
              onApprove={onApprovePlan}
              onDecline={() => setConfirmDeclineOpen(true)}
              onEdit={onEditPlan}
            />
          </ArtifactMessage>
        ),
      });
    }

    if (plan?.approvalStatus === "approved") {
      entries.push({
        id: `artifact:scope:${research?.run.id ?? plan.id}`,
        timestamp: research?.run.createdAt ?? plan.createdAt,
        orderHint: 110,
        render: () => (
          <ArtifactMessage
            key="provider-scope"
            label="Bounded provider scope"
            timestamp={research?.run.createdAt}
          >
            <ProviderScopeCard
              plan={plan}
              research={research}
              provider={provider}
              isWorking={isWorking}
              onPrepareResearch={onPrepareResearch}
              onStartResearch={onStartResearch}
            />
          </ArtifactMessage>
        ),
      });
    }

    if (research) {
      entries.push({
        id: `artifact:progress:${research.run.id}`,
        timestamp: research.run.createdAt,
        orderHint: 120,
        render: () => (
          <ArtifactMessage
            key={`progress-${research.run.id}`}
            label="Research progress"
            timestamp={research.run.updatedAt}
          >
            <ResearchProgressMessage
              research={research}
              synthesis={synthesis}
              providerAvailable={provider?.available ?? false}
              isWorking={isWorking}
              onContinueResearch={onStartResearch}
              onPrepareNewScope={onPrepareResearch}
              onAnalyseEvidence={onAnalyseEvidence}
              onOpenContextRail={onOpenContextRail}
            />
          </ArtifactMessage>
        ),
      });

      if (research.sources.length > 0) {
        entries.push({
          id: `artifact:sources:${research.run.id}`,
          timestamp: research.run.updatedAt,
          orderHint: 130,
          render: () => (
            <ArtifactMessage
              key={`sources-${research.run.id}`}
              label="Saved evidence ledger"
              timestamp={research.run.updatedAt}
            >
              <EvidenceCard research={research} onOpenContextRail={onOpenContextRail} />
            </ArtifactMessage>
          ),
        });
      }
    }

    if (synthesis) {
      entries.push({
        id: `artifact:synthesis:${synthesis.id}`,
        timestamp: synthesis.createdAt,
        orderHint: 140,
        render: () => (
          <ArtifactMessage
            key={`synthesis-${synthesis.id}`}
            label="Cited recommendation"
            timestamp={synthesis.updatedAt}
          >
            <RecommendationCard
              synthesis={synthesis}
              research={research}
              isWorking={isWorking}
              onRetryAnalysis={onAnalyseEvidence}
              onOpenSources={onOpenContextRail}
              onStartNewResearch={onStartNewResearch}
            />
          </ArtifactMessage>
        ),
      });

      if (
        synthesis.status === "ready_for_decision" ||
        (synthesis.status === "ready_for_review" &&
          synthesis.markets.length > 0 &&
          synthesis.industries.length > 0)
      ) {
        const decisionTime = synthesis.decision?.selectedAt ?? synthesis.createdAt;
        entries.push({
          id: `artifact:decision:${synthesis.id}`,
          timestamp: decisionTime,
          orderHint: 150,
          render: () => (
            <ArtifactMessage
              key={`decision-${synthesis.id}`}
              label="Target route decision"
              timestamp={synthesis.decision?.selectedAt ?? synthesis.updatedAt}
            >
              <TargetDecisionCard
                synthesis={synthesis}
                selectedMarketId={selectedMarketId}
                selectedIndustryId={selectedIndustryId}
                onSelectMarket={onSelectMarket}
                onSelectIndustry={onSelectIndustry}
                onLockRoute={onLockTargetRoute}
                isWorking={isWorking}
              />
            </ArtifactMessage>
          ),
        });
      }
    }

    if (synthesis?.decision?.status === "locked") {
      entries.push({
        id: `artifact:company-preview:${companySearch?.id ?? synthesis.decision.id}`,
        timestamp:
          companySearch?.createdAt ?? synthesis.decision.selectedAt ?? synthesis.createdAt,
        orderHint: 160,
        render: () => (
          <ArtifactMessage
            key="company-search-preview"
            label={
              companySearch?.providerKey === "openstreetmap"
                ? "OpenStreetMap company discovery"
                : "Company discovery"
            }
            timestamp={
              companySearch?.updatedAt ?? synthesis.decision?.selectedAt ?? synthesis.updatedAt
            }
          >
            <CompanySearchPreviewCard
              synthesis={synthesis}
              companySearch={companySearch}
              prospeo={prospeo}
              isWorking={isWorking}
              onPreparePreview={(options) => onPrepareCompanySearch?.(options)}
              onRunFreeSearch={(options) => onRunFreeCompanySearch?.(options)}
              onApproveSearch={(searchId) => onApproveCompanySearch?.(searchId)}
            />
          </ArtifactMessage>
        ),
      });
    }

    if (companySearch?.status === "completed" && companySearch.cohort) {
      entries.push({
        id: `artifact:company-cohort:${companySearch.id}`,
        timestamp: companySearch.completedAt ?? companySearch.createdAt,
        orderHint: 170,
        render: () => (
          <ArtifactMessage
            key={`cohort-${companySearch.id}`}
            label="Company cohort artifact"
            timestamp={companySearch.completedAt ?? companySearch.updatedAt}
          >
            <AccountCohortCard
              companySearch={companySearch}
              onOpenArtifact={(accountId) => openArtifactDrawer(accountId)}
              onSuggestChanges={() => onFocusComposerWithPrompt?.()}
            />
          </ArtifactMessage>
        ),
      });
    }

    if (
      peopleDiscovery &&
      (peopleDiscovery.shortlistedCount > 0 ||
        peopleDiscovery.personSearch !== null ||
        (companySearch?.accounts.some((a) => a.lifecycleState === "shortlisted") ?? false))
    ) {
      entries.push({
        id: "artifact:people-discovery",
        timestamp:
          peopleDiscovery.personSearch?.createdAt ??
          companySearch?.completedAt ??
          synthesis?.createdAt ??
          conversation?.conversation.createdAt ??
          "",
        orderHint: 180,
        render: () => (
          <ArtifactMessage
            key="people-discovery"
            label="People & buyer roles"
            timestamp={
              peopleDiscovery.personSearch?.updatedAt ??
              companySearch?.updatedAt ??
              synthesis?.updatedAt
            }
          >
            <PeopleDiscoveryCard
              companySearch={companySearch}
              peopleDiscovery={peopleDiscovery}
              prospeo={prospeo}
              dropcontact={dropcontact}
              targetIndustry={lockedTargetIndustry}
              targetIndustryName={lockedTargetIndustry?.name ?? companySearch?.targetIndustryName}
              researchBrief={conversation?.brief ?? null}
              selectedContactIds={effectiveSelectedContactIds}
              onToggleContact={handleToggleContact}
              isWorking={isWorking}
              onProposeRoles={(options) => onProposeBuyerRoles?.(options)}
              onRunFreePeopleSearch={(options) => onRunFreePeopleSearch?.(options)}
              onApprovePersonSearch={(id) => onApprovePersonSearch?.(id)}
              onPrepareVerification={(ids, providerKey) =>
                onPrepareContactVerification?.(ids, providerKey)
              }
              onGeneratePlaybooks={() => onGeneratePlaybooks?.()}
              onOpenPeopleArtifact={(contactId) => openPeopleArtifactDrawer(contactId)}
              onSuggestChanges={() =>
                onFocusComposerWithPrompt?.(
                  "Adjust the target job titles or departments in our Buying Committee to focus on...",
                )
              }
            />
          </ArtifactMessage>
        ),
      });
    }

    if (peopleDiscovery?.verificationRun) {
      const verification = peopleDiscovery.verificationRun;
      entries.push({
        id: `artifact:verification:${verification.id}`,
        timestamp: verification.createdAt,
        orderHint: 190,
        render: () => (
          <ArtifactMessage
            key={`verification-${verification.id}`}
            label={
              verification.providerKey === "prospeo"
                ? "Prospeo email verification"
                : "Dropcontact verification"
            }
            timestamp={verification.updatedAt}
          >
            <ContactVerificationCard
              verificationRun={verification}
              prospeo={prospeo}
              dropcontact={dropcontact}
              isWorking={isWorking}
              onApproveVerification={(id) => onApproveContactVerification?.(id)}
            />
          </ArtifactMessage>
        ),
      });
    }

    (peopleDiscovery?.playbooks ?? []).forEach((playbook, idx) => {
      entries.push({
        id: `artifact:playbook:${playbook.id}`,
        timestamp: playbook.createdAt,
        orderHint: 200 + idx,
        render: () => (
          <ArtifactMessage
            key={playbook.id}
            label={`Account playbook · ${playbook.accountName}`}
            timestamp={playbook.updatedAt}
          >
            <PlaybookCard playbook={playbook} />
          </ArtifactMessage>
        ),
      });
    });

    const hasShortlistedForTemplates =
      companySearch?.accounts.some((account) => account.lifecycleState === "shortlisted") ?? false;
    const hasPeopleForTemplates = (peopleDiscovery?.contacts.length ?? 0) > 0;
    if (
      Boolean(templatePack) ||
      (synthesis?.decision?.status === "locked" &&
        (hasShortlistedForTemplates || hasPeopleForTemplates))
    ) {
      entries.push({
        id: "artifact:template-pack",
        timestamp:
          templatePack?.createdAt ??
          peopleDiscovery?.playbooks[0]?.createdAt ??
          peopleDiscovery?.personSearch?.createdAt ??
          companySearch?.completedAt ??
          conversation?.conversation.createdAt ??
          "",
        orderHint: 220,
        render: () => (
          <ArtifactMessage
            key="outreach-template-pack"
            label="Outreach email templates"
            timestamp={templatePack?.updatedAt ?? companySearch?.updatedAt}
          >
            <OutreachTemplatePackCard
              templatePack={templatePack}
              targetIndustryName={lockedTargetIndustry?.name ?? companySearch?.targetIndustryName}
              isWorking={isWorking}
              onGenerate={(options) => onGenerateTemplatePack?.(options)}
              onOpenDrawer={(stepKey) => {
                setTemplateDrawerStep(stepKey ?? "initial");
                setTemplateDrawerOpen(true);
              }}
              onSuggestChangesInChat={(prefill) => onFocusComposerWithPrompt?.(prefill)}
            />
          </ArtifactMessage>
        ),
      });
    }

    if (
      conversation &&
      ((peopleDiscovery?.contacts.length ?? 0) > 0 || Boolean(templatePack))
    ) {
      entries.push({
        id: "artifact:lead-export",
        timestamp:
          templatePack?.updatedAt ??
          peopleDiscovery?.verificationRun?.updatedAt ??
          peopleDiscovery?.personSearch?.updatedAt ??
          conversation.conversation.updatedAt ??
          "",
        orderHint: 235,
        render: () => (
          <ArtifactMessage
            key="lead-export-pack"
            label="Leads & templates export"
            timestamp={templatePack?.updatedAt ?? peopleDiscovery?.verificationRun?.updatedAt}
          >
            <LeadExportCard
              conversationId={conversation.conversation.id}
              contacts={peopleDiscovery?.contacts ?? []}
              templatePack={templatePack}
              isWorking={isWorking}
            />
          </ArtifactMessage>
        ),
      });
    }

    if (
      (peopleDiscovery?.playbooks.length ?? 0) > 0 ||
      (outreachExecution?.drafts.length ?? 0) > 0 ||
      (outreachExecution?.proposals.length ?? 0) > 0
    ) {
      entries.push({
        id: "artifact:outreach",
        timestamp:
          outreachExecution?.proposals[0]?.createdAt ??
          outreachExecution?.drafts[0]?.createdAt ??
          peopleDiscovery?.playbooks[0]?.createdAt ??
          conversation?.conversation.createdAt ??
          "",
        orderHint: 250,
        render: () => (
          <ArtifactMessage
            key="outreach-drafts"
            label="Outreach drafts & proposals"
            timestamp={
              outreachExecution?.proposals[0]?.updatedAt ??
              outreachExecution?.drafts[0]?.updatedAt ??
              peopleDiscovery?.playbooks[0]?.updatedAt
            }
          >
            <OutreachDraftCard
              playbooks={peopleDiscovery?.playbooks ?? []}
              outreachExecution={outreachExecution}
              mercury={mercury}
              isWorking={isWorking}
              onGenerateDrafts={(playbookId) => onGenerateOutreachDrafts?.(playbookId)}
              onEditDraft={(draftId, subject, body) =>
                onEditOutreachDraft?.(draftId, subject, body)
              }
              onCreateProposal={(draftId, proposalType, scheduledFor, note) =>
                onCreateExecutionProposal?.(draftId, proposalType, scheduledFor, note)
              }
              onDecideProposal={(proposalId, decision, rationale) =>
                onDecideExecutionProposal?.(proposalId, decision, rationale)
              }
            />
          </ArtifactMessage>
        ),
      });
    }

    return sortChronologicalThreadEntries(entries);
  }, [
    visibleMessages,
    plan,
    research,
    synthesis,
    companySearch,
    prospeo,
    peopleDiscovery,
    dropcontact,
    outreachExecution,
    mercury,
    templatePack,
    provider,
    isWorking,
    selectedMarketId,
    selectedIndustryId,
    conversation?.conversation.id,
    conversation?.conversation.createdAt,
    conversation?.conversation.updatedAt,
    onApprovePlan,
    onEditPlan,
    onPrepareResearch,
    onStartResearch,
    onAnalyseEvidence,
    onOpenContextRail,
    onStartNewResearch,
    onSelectMarket,
    onSelectIndustry,
    onLockTargetRoute,
    onPrepareCompanySearch,
    onRunFreeCompanySearch,
    onApproveCompanySearch,
    onFocusComposerWithPrompt,
    onProposeBuyerRoles,
    onRunFreePeopleSearch,
    onApprovePersonSearch,
    onPrepareContactVerification,
    onApproveContactVerification,
    onGeneratePlaybooks,
    onGenerateTemplatePack,
    onGenerateOutreachDrafts,
    onEditOutreachDraft,
    onCreateExecutionProposal,
    onDecideExecutionProposal,
    lockedTargetIndustry,
    conversation?.brief,
    effectiveSelectedContactIds,
    handleToggleContact,
  ]);

  return (
    <div className="m3-chat-stream" aria-live="polite">
      {needsSignIn && (
        <div className="m3-alert-banner is-warning" role="status">
          <div>
            <strong>Sign in required for durable research</strong>
            <p>
              Authenticate with your Ano workspace account to create research plans, run bounded
              SearXNG evidence discovery, and save recommendations.
            </p>
          </div>
          <Link href="/login" className="m3-alert-link">
            Sign in
          </Link>
        </div>
      )}

      {!conversation && !pendingUserMessage && (
        <section className="m3-chat-welcome">
          <p className="m3-artifact-kicker">SALES RESEARCH COPILOT</p>
          <h1>Find the right market before you find the companies.</h1>
          <p className="m3-welcome-copy">
            Start with your product and goal in plain language. Ano asks at most one clarifying
            question if needed, builds a reviewable research plan, and runs only approval-gated
            public evidence discovery.
          </p>

          <div className="m3-starter-chips">
            <p>Try a starting prompt</p>
            <md-chip-set aria-label="Example sales research prompts">
              {STARTER_PROMPTS.map((prompt) => (
                <md-suggestion-chip
                  key={prompt}
                  onClick={() => onSelectStarterPrompt(prompt)}
                >
                  {prompt}
                </md-suggestion-chip>
              ))}
            </md-chip-set>
          </div>
        </section>
      )}

      {timelineEntries.map((entry) => entry.render())}

      {conversation?.pendingQuestion && (
        <section className="m3-clarification-card" aria-label="Clarifying question">
          <p className="m3-artifact-kicker">ONE QUESTION</p>
          <h2>{conversation.pendingQuestion.question}</h2>
          <p>{conversation.pendingQuestion.purpose}</p>
        </section>
      )}

      {conversation?.run.status === "failed_safe" && (
        <div className="m3-alert-banner is-warning" role="status">
          <div>
            <strong>Ano paused safely</strong>
            <p>
              {conversation.run.failureMessage ??
                "No external research, provider, or sales action was attempted."}
            </p>
          </div>
        </div>
      )}

      {pendingUserMessage && (
        <ConversationMessage role="user" text={pendingUserMessage} optimistic />
      )}

      {pendingUserMessage && isWorking && (
        <ConversationMessage
          role="assistant"
          text="Thinking and reviewing your workspace…"
          optimistic
        />
      )}

      {error && (
        <div ref={errorBannerRef} className="m3-alert-banner is-error" role="alert">
          <div>
            <strong>Action could not continue</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      <div ref={bottomAnchorRef} />

      <CompanyCohortArtifactDrawer
        open={drawerOpen}
        companySearch={companySearch}
        synthesis={synthesis}
        initialSelectedAccountId={drawerInitialAccountId}
        isWorking={isWorking}
        onClose={() => setDrawerOpen(false)}
        onUpdateAccountState={(accountId, state) => onUpdateAccountState?.(accountId, state)}
        onSuggestChangesInChat={(prefill) => onFocusComposerWithPrompt?.(prefill)}
      />

      <PeopleCohortArtifactDrawer
        open={peopleDrawerOpen}
        conversationId={conversation?.conversation.id}
        peopleDiscovery={peopleDiscovery}
        prospeo={prospeo}
        dropcontact={dropcontact}
        initialSelectedContactId={peopleDrawerInitialContactId}
        selectedContactIds={effectiveSelectedContactIds}
        isWorking={isWorking}
        onClose={() => setPeopleDrawerOpen(false)}
        onToggleContact={handleToggleContact}
        onPrepareVerification={(ids, providerKey) =>
          onPrepareContactVerification?.(ids, providerKey)
        }
        onSuggestChangesInChat={(prefill) => onFocusComposerWithPrompt?.(prefill)}
      />

      <OutreachTemplateDrawer
        open={templateDrawerOpen}
        conversationId={conversation?.conversation.id}
        templatePack={templatePack}
        contacts={peopleDiscovery?.contacts ?? []}
        accounts={companySearch?.accounts ?? []}
        initialStepKey={templateDrawerStep}
        isWorking={isWorking}
        onClose={() => setTemplateDrawerOpen(false)}
        onEditStep={(input) => onEditTemplateStep?.(input)}
        onRegenerate={(options) => onGenerateTemplatePack?.(options)}
        onSuggestChangesInChat={(prefill) => onFocusComposerWithPrompt?.(prefill)}
      />

      {companySearch && companySearch.providerKey === "prospeo" && (
        <ApprovalCard
          open={confirmProspeoApprovalOpen}
          title="Approve 1-page Prospeo company search?"
          body={`This runs a single Prospeo /search-company call (page 1, max 25 companies, max 1 credit) for ${companySearch.canonicalLocations.join(", ")}. Ano will not paginate or retry automatically.`}
          confirmLabel="Approve 1-page search"
          cancelLabel="Keep reviewing"
          isWorking={isWorking}
          onConfirm={() => {
            setConfirmProspeoApprovalOpen(false);
            onApproveCompanySearch?.(companySearch.id);
          }}
          onCancel={() => setConfirmProspeoApprovalOpen(false)}
        />
      )}

      {peopleDiscovery?.personSearch && peopleDiscovery.personSearch.providerKey === "prospeo" && (
        <ApprovalCard
          open={confirmProspeoPersonApprovalOpen}
          title="Approve 1-page Prospeo person search?"
          body={`Searches up to 25 named buyers matching [${peopleDiscovery.personSearch.approvedRoles.join(", ")}] across ${peopleDiscovery.personSearch.shortlistedAccountNames.join(", ")} (max 1 credit). Contact email verification remains separate and unrun.`}
          confirmLabel="Approve 1-page person search"
          cancelLabel="Keep reviewing"
          isWorking={isWorking}
          onConfirm={() => {
            setConfirmProspeoPersonApprovalOpen(false);
            onApprovePersonSearch?.(peopleDiscovery.personSearch!.id);
          }}
          onCancel={() => setConfirmProspeoPersonApprovalOpen(false)}
        />
      )}

      {peopleDiscovery?.verificationRun && (
        <ApprovalCard
          open={confirmVerificationApprovalOpen}
          title={`Approve ${peopleDiscovery.verificationRun.providerKey === "prospeo" ? "Prospeo" : "Dropcontact"} email verification?`}
          body={`Verifies emails for ${peopleDiscovery.verificationRun.selectedContactIds.length} selected contact${peopleDiscovery.verificationRun.selectedContactIds.length === 1 ? "" : "s"} (${peopleDiscovery.verificationRun.providerKey === "prospeo" ? "1 Prospeo credit per email found; 0 credits for misses" : `up to ${peopleDiscovery.verificationRun.estimatedCredits} Dropcontact credit${peopleDiscovery.verificationRun.estimatedCredits === 1 ? "" : "s"}`}).`}
          confirmLabel="Approve verification"
          cancelLabel="Keep reviewing"
          isWorking={isWorking}
          onConfirm={() => {
            setConfirmVerificationApprovalOpen(false);
            onApproveContactVerification?.(peopleDiscovery.verificationRun!.id);
          }}
          onCancel={() => setConfirmVerificationApprovalOpen(false)}
        />
      )}

      <ApprovalCard
        open={confirmDeclineOpen}
        title="Decline this research plan?"
        body="Declining stops this plan before any public search or provider scope is prepared. You can still send a new message in this thread later."
        confirmLabel="Decline plan"
        cancelLabel="Keep reviewing"
        isWorking={isWorking}
        onConfirm={() => {
          setConfirmDeclineOpen(false);
          onDeclinePlan();
        }}
        onCancel={() => setConfirmDeclineOpen(false)}
      />
    </div>
  );
}

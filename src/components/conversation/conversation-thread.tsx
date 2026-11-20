"use client";

import Link from "next/link";
import { useState } from "react";

import type {
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
  DropcontactProviderState,
  PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import type { ResearchConversationView } from "@/lib/ano/research-conversation";
import { useMaterialWeb } from "@/components/material/register";
import { AccountCohortCard } from "@/components/artifacts/account-cohort-card";
import { AccountDossierCard } from "@/components/artifacts/account-dossier-card";
import { CompanySearchPreviewCard } from "@/components/artifacts/company-search-preview-card";
import { ContactVerificationCard } from "@/components/artifacts/contact-verification-card";
import { EvidenceCard } from "@/components/artifacts/evidence-card";
import { OutreachDraftCard } from "@/components/artifacts/outreach-draft-card";
import { PeopleDiscoveryCard } from "@/components/artifacts/people-discovery-card";
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
    locationOverrides?: string[];
    excludedCategories?: string[];
  }) => void;
  onApproveCompanySearch?: (searchId: string) => void;
  onUpdateAccountState?: (
    accountId: string,
    state: "shortlisted" | "held" | "dismissed",
  ) => void;
  onProposeBuyerRoles?: (roleOverrides?: string[]) => void;
  onApprovePersonSearch?: (personSearchId: string) => void;
  onPrepareContactVerification?: (contactIds: string[]) => void;
  onApproveContactVerification?: (verificationRunId: string) => void;
  onGeneratePlaybooks?: () => void;
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
  onApproveCompanySearch,
  onUpdateAccountState,
  onProposeBuyerRoles,
  onApprovePersonSearch,
  onPrepareContactVerification,
  onApproveContactVerification,
  onGeneratePlaybooks,
  onGenerateOutreachDrafts,
  onEditOutreachDraft,
  onCreateExecutionProposal,
  onDecideExecutionProposal,
  onOpenContextRail,
  onStartNewResearch,
}: ConversationThreadProps) {
  useMaterialWeb();
  const [confirmDeclineOpen, setConfirmDeclineOpen] = useState(false);

  const plan = conversation?.plan ?? null;
  const visibleMessages = conversation?.messages ?? [];

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

      {error && (
        <div className="m3-alert-banner is-error" role="alert">
          <div>
            <strong>Action could not continue</strong>
            <p>{error}</p>
          </div>
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

      {visibleMessages.map((message) => (
        <ConversationMessage
          key={message.id}
          role={message.role}
          text={message.text}
          createdAt={message.createdAt}
        />
      ))}

      {pendingUserMessage && (
        <ConversationMessage role="user" text={pendingUserMessage} optimistic />
      )}

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

      {plan && (
        <ArtifactMessage label={`Research plan v${plan.version}`} timestamp={plan.createdAt}>
          <ResearchPlanCard
            plan={plan}
            isWorking={isWorking}
            onApprove={onApprovePlan}
            onDecline={() => setConfirmDeclineOpen(true)}
            onEdit={onEditPlan}
          />
        </ArtifactMessage>
      )}

      {plan?.approvalStatus === "approved" && (
        <ArtifactMessage label="Bounded provider scope" timestamp={research?.run.createdAt}>
          <ProviderScopeCard
            plan={plan}
            research={research}
            provider={provider}
            isWorking={isWorking}
            onPrepareResearch={onPrepareResearch}
            onStartResearch={onStartResearch}
          />
        </ArtifactMessage>
      )}

      {research && (
        <ArtifactMessage label="Research progress" timestamp={research.run.updatedAt}>
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
      )}

      {research && research.sources.length > 0 && (
        <ArtifactMessage label="Saved evidence ledger" timestamp={research.run.updatedAt}>
          <EvidenceCard research={research} onOpenContextRail={onOpenContextRail} />
        </ArtifactMessage>
      )}

      {synthesis && (
        <ArtifactMessage label="Cited recommendation" timestamp={synthesis.updatedAt}>
          <RecommendationCard
            synthesis={synthesis}
            research={research}
            isWorking={isWorking}
            onRetryAnalysis={onAnalyseEvidence}
            onOpenSources={onOpenContextRail}
            onStartNewResearch={onStartNewResearch}
          />
        </ArtifactMessage>
      )}

      {synthesis?.status === "ready_for_decision" && (
        <ArtifactMessage
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
      )}

      {synthesis?.decision?.status === "locked" && (
        <ArtifactMessage
          label="Prospeo company discovery"
          timestamp={companySearch?.updatedAt ?? synthesis.decision.selectedAt ?? synthesis.updatedAt}
        >
          <CompanySearchPreviewCard
            synthesis={synthesis}
            companySearch={companySearch}
            prospeo={prospeo}
            isWorking={isWorking}
            onPreparePreview={(options) => onPrepareCompanySearch?.(options)}
            onApproveSearch={(searchId) => onApproveCompanySearch?.(searchId)}
          />
        </ArtifactMessage>
      )}

      {companySearch?.status === "completed" && companySearch.cohort && (
        <ArtifactMessage
          label="Company cohort & signals"
          timestamp={companySearch.completedAt ?? companySearch.updatedAt}
        >
          <AccountCohortCard companySearch={companySearch} />
        </ArtifactMessage>
      )}

      {companySearch?.status === "completed" &&
        companySearch.accounts.map((account) => (
          <ArtifactMessage
            key={account.id}
            label={`Account dossier · ${account.name}`}
            timestamp={account.retrievedAt}
          >
            <AccountDossierCard
              account={account}
              synthesis={synthesis}
              targetMarketName={companySearch.targetMarketName}
              targetIndustryName={companySearch.targetIndustryName}
              isWorking={isWorking}
              onUpdateState={(accountId, state) => onUpdateAccountState?.(accountId, state)}
            />
          </ArtifactMessage>
        ))}

      {peopleDiscovery &&
        (peopleDiscovery.shortlistedCount > 0 ||
          peopleDiscovery.personSearch !== null ||
          (companySearch?.accounts.some((a) => a.lifecycleState === "shortlisted") ?? false)) && (
          <ArtifactMessage
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
              isWorking={isWorking}
              onProposeRoles={(roles) => onProposeBuyerRoles?.(roles)}
              onApprovePersonSearch={(id) => onApprovePersonSearch?.(id)}
              onPrepareVerification={(ids) => onPrepareContactVerification?.(ids)}
              onGeneratePlaybooks={() => onGeneratePlaybooks?.()}
            />
          </ArtifactMessage>
        )}

      {peopleDiscovery?.verificationRun && (
        <ArtifactMessage
          label="Dropcontact verification"
          timestamp={peopleDiscovery.verificationRun.updatedAt}
        >
          <ContactVerificationCard
            verificationRun={peopleDiscovery.verificationRun}
            dropcontact={dropcontact}
            isWorking={isWorking}
            onApproveVerification={(id) => onApproveContactVerification?.(id)}
          />
        </ArtifactMessage>
      )}

      {peopleDiscovery?.playbooks.map((playbook) => (
        <ArtifactMessage
          key={playbook.id}
          label={`Account playbook · ${playbook.accountName}`}
          timestamp={playbook.updatedAt}
        >
          <PlaybookCard playbook={playbook} />
        </ArtifactMessage>
      ))}

      {((peopleDiscovery?.playbooks.length ?? 0) > 0 ||
        (outreachExecution?.drafts.length ?? 0) > 0 ||
        (outreachExecution?.proposals.length ?? 0) > 0) && (
        <ArtifactMessage
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

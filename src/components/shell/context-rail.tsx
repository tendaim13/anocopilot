"use client";

import type {
  CompanySearchView,
  ProspeoProviderState,
} from "@/lib/ano/company-discovery";
import {
  formatSourceProvenanceLabel,
  resolveSourceProvenance,
  type EvidenceResearchView,
  type ResearchProviderKey,
} from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type {
  MercuryConnectorState,
  OutreachExecutionView,
} from "@/lib/ano/outreach-execution";
import type { OutreachTemplatePackView } from "@/lib/ano/outreach-templates";
import type {
  DropcontactProviderState,
  PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import {
  maskVendorNamesForDisplay,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import { MaterialIconButton } from "@/components/material/material-icon-button";
import { CloseIcon } from "./ano-icons";

export type ShellProviderState = {
  provider: ResearchProviderKey;
  available: boolean;
  maximumSearches: number;
  maximumFetches: number;
  pricingNote: string;
};

export interface ContextRailProps {
  open: boolean;
  onClose: () => void;
  conversation: ResearchConversationView | null;
  research: EvidenceResearchView | null;
  synthesis: MarketSynthesis | null;
  provider: ShellProviderState | null;
  companySearch?: CompanySearchView | null;
  prospeo?: ProspeoProviderState | null;
  peopleDiscovery?: PeopleDiscoveryView | null;
  dropcontact?: DropcontactProviderState | null;
  outreachExecution?: OutreachExecutionView | null;
  mercury?: MercuryConnectorState | null;
  templatePack?: OutreachTemplatePackView | null;
}

function approvalLabel(status: string) {
  if (status === "approved") return "Approved";
  if (status === "declined") return "Declined";
  return "Awaiting approval";
}

function runStatusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export function ContextRail({
  open,
  onClose,
  conversation,
  research,
  synthesis,
  companySearch = null,
  peopleDiscovery = null,
  templatePack = null,
}: ContextRailProps) {
  if (!open) return null;

  const plan = conversation?.plan ?? null;
  const events = conversation?.events ?? [];
  const sources = research?.sources ?? [];
  const lockedMarket =
    synthesis?.markets.find((m) => m.id === synthesis?.decision?.marketProfileId) ?? null;
  const lockedIndustry =
    synthesis?.industries.find((i) => i.id === synthesis?.decision?.industryProfileId) ?? null;
  const verifiedCount =
    peopleDiscovery?.contacts.filter((item) => item.verificationStatus === "verified").length ?? 0;

  return (
    <aside className="ano-context-rail" aria-label="Research details">
      <div className="ano-rail-header">
        <div>
          <h2 className="md-typescale-title-medium">Research details</h2>
        </div>
        <MaterialIconButton ariaLabel="Close research details" onClick={onClose}>
          <CloseIcon />
        </MaterialIconButton>
      </div>
      <md-divider />

      <div className="ano-rail-body">
        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3 className="md-typescale-title-small">Brief &amp; scope</h3>
            {plan && (
              <span className={`ano-pill status-${plan.approvalStatus}`}>
                {approvalLabel(plan.approvalStatus)}
              </span>
            )}
          </div>
          {plan ? (
            <>
              <p className="ano-rail-copy">{plan.summary}</p>
              <dl className="ano-rail-dl">
                <div>
                  <dt>Markets</dt>
                  <dd>{plan.plannedScope.markets.join(", ") || "Determined by research"}</dd>
                </div>
                <div>
                  <dt>Industries</dt>
                  <dd>{plan.plannedScope.industries.join(", ") || "Determined by evidence"}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="ano-rail-empty">No research brief saved yet.</p>
          )}
        </section>

        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3 className="md-typescale-title-small">Progress summary</h3>
            {synthesis && (
              <span className="ano-pill status-neutral ano-capitalize">
                {runStatusLabel(synthesis.status)}
              </span>
            )}
          </div>
          {synthesis || companySearch || peopleDiscovery || templatePack ? (
            <>
              {synthesis && <p className="ano-rail-copy">{synthesis.assessment.summary}</p>}
              <dl className="ano-rail-dl">
                {synthesis?.decision && (
                  <div>
                    <dt>Target route</dt>
                    <dd className="ano-capitalize">
                      {lockedMarket && lockedIndustry
                        ? `${lockedMarket.name} · ${lockedIndustry.name}`
                        : runStatusLabel(synthesis.decision.status)}
                    </dd>
                  </div>
                )}
                {companySearch && (
                  <div>
                    <dt>Companies</dt>
                    <dd>
                      {companySearch.accounts.length} found ·{" "}
                      {companySearch.cohort?.shortlistedCount ?? 0} shortlisted
                    </dd>
                  </div>
                )}
                {peopleDiscovery && (
                  <div>
                    <dt>Decision-makers</dt>
                    <dd>
                      {peopleDiscovery.contacts.length} named · {verifiedCount} verified
                    </dd>
                  </div>
                )}
                {templatePack && (
                  <div>
                    <dt>Outreach templates</dt>
                    <dd>{templatePack.steps.length} steps ready</dd>
                  </div>
                )}
              </dl>
            </>
          ) : (
            <p className="ano-rail-empty">
              Market findings, companies, decision-makers, and templates appear here as research progresses.
            </p>
          )}
        </section>

        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3 className="md-typescale-title-small">Saved sources</h3>
            <span className="ano-count-pill">{sources.length}</span>
          </div>
          {sources.length > 0 ? (
            <ul className="ano-rail-sources">
              {sources.map((source) => (
                <li key={source.id}>
                  <span className="ano-source-class">
                    {formatSourceProvenanceLabel(resolveSourceProvenance(source))} · {source.sourceClass}
                  </span>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                  <small>{source.status === "fetched" ? "Retrieved" : "Not retrieved"}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ano-rail-empty">Saved public sources appear here after market research completes.</p>
          )}
        </section>

        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3 className="md-typescale-title-small">Recent activity</h3>
            <span className="ano-count-pill">{events.length}</span>
          </div>
          {events.length > 0 ? (
            <ol className="ano-rail-activity">
              {events.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>{maskVendorNamesForDisplay(event.label)}</strong>
                    <p>{maskVendorNamesForDisplay(event.detail)}</p>
                  </div>
                  <time>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ano-rail-empty">Workspace milestones appear here.</p>
          )}
        </section>
      </div>
    </aside>
  );
}

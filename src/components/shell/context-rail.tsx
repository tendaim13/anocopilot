"use client";

import type {
  CompanySearchView,
  ProspeoProviderState,
} from "@/lib/ano/company-discovery";
import type { EvidenceResearchView, ResearchProviderKey } from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type {
  MercuryConnectorState,
  OutreachExecutionView,
} from "@/lib/ano/outreach-execution";
import type {
  DropcontactProviderState,
  PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import type { ResearchConversationView } from "@/lib/ano/research-conversation";
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
  provider,
  companySearch = null,
  prospeo = null,
  peopleDiscovery = null,
  dropcontact = null,
  outreachExecution = null,
  mercury = null,
}: ContextRailProps) {
  if (!open) return null;

  const plan = conversation?.plan ?? null;
  const events = conversation?.events ?? [];
  const sources = research?.sources ?? [];

  return (
    <aside className="ano-context-rail" aria-label="Research context">
      <div className="ano-rail-header">
        <div>
          <p className="ano-rail-kicker">CONTEXT RAIL</p>
          <h2>Research details</h2>
        </div>
        <MaterialIconButton ariaLabel="Close context rail" onClick={onClose}>
          <CloseIcon />
        </MaterialIconButton>
      </div>

      <div className="ano-rail-body">
        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3>Research plan</h3>
            {plan && <span className={`ano-pill status-${plan.approvalStatus}`}>V{plan.version} · {approvalLabel(plan.approvalStatus)}</span>}
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
            <p className="ano-rail-empty">No research plan created yet.</p>
          )}
        </section>

        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3>Provider budget</h3>
            <span className={`ano-pill ${provider?.available ? "status-ready" : "status-muted"}`}>
              {provider?.available ? "SearXNG ready" : "Not configured"}
            </span>
          </div>
          {research ? (
            <dl className="ano-rail-dl">
              <div>
                <dt>Status</dt>
                <dd className="ano-capitalize">{runStatusLabel(research.run.status)}</dd>
              </div>
              <div>
                <dt>Searches</dt>
                <dd>{research.run.consumedSearches} / {research.run.maximumSearches}</dd>
              </div>
              <div>
                <dt>Source fetches</dt>
                <dd>{research.run.consumedFetches} / {research.run.maximumFetches}</dd>
              </div>
            </dl>
          ) : (
            <p className="ano-rail-empty">
              {plan
                ? `Planned ceiling: up to ${plan.budget.maximumSearches} searches and ${plan.budget.maximumFetches} fetches after separate Phase B approval.`
                : "No external provider scope prepared."}
            </p>
          )}
        </section>

        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3>Evidence summary</h3>
            {synthesis && <span className="ano-pill status-neutral ano-capitalize">{runStatusLabel(synthesis.status)}</span>}
          </div>
          {synthesis ? (
            <>
              <p className="ano-rail-copy">{synthesis.assessment.summary}</p>
              <dl className="ano-rail-dl">
                <div>
                  <dt>Saved sources</dt>
                  <dd>{research?.run.sourceCount ?? sources.length}</dd>
                </div>
                <div>
                  <dt>Target route</dt>
                  <dd className="ano-capitalize">{synthesis.decision ? runStatusLabel(synthesis.decision.status) : "Not locked"}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="ano-rail-empty">
              {research?.run.sourceCount
                ? `${research.run.sourceCount} saved source${research.run.sourceCount === 1 ? "" : "s"} waiting for synthesis.`
                : "Evidence summary appears after public research completes."}
            </p>
          )}
        </section>

        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3>Company discovery</h3>
            <span
              className={`ano-pill ${
                companySearch?.status === "completed"
                  ? "status-ready"
                  : prospeo?.available
                    ? "status-neutral"
                    : "status-muted"
              }`}
            >
              {companySearch
                ? runStatusLabel(companySearch.status)
                : prospeo?.available
                  ? "Prospeo ready"
                  : "Prospeo unconfigured"}
            </span>
          </div>
          {companySearch ? (
            <dl className="ano-rail-dl">
              <div>
                <dt>Canonical locations</dt>
                <dd>{companySearch.canonicalLocations.join(", ")}</dd>
              </div>
              <div>
                <dt>Cap / credits</dt>
                <dd>
                  {companySearch.maximumResults} max ·{" "}
                  {companySearch.providerReceipt.credit_bearing_request
                    ? companySearch.providerReceipt.free
                      ? "0 credits (free)"
                      : "1 credit max"
                    : "0 credits spent"}
                </dd>
              </div>
              <div>
                <dt>Returned / shortlisted</dt>
                <dd>
                  {companySearch.accounts.length} returned ·{" "}
                  {companySearch.cohort?.shortlistedCount ?? 0} shortlisted
                </dd>
              </div>
            </dl>
          ) : (
            <p className="ano-rail-empty">
              {synthesis?.decision?.status === "locked"
                ? "Target locked. Prepare a free Prospeo preview before approving a 1-page search."
                : "Lock a Phase C market and industry route before preparing Prospeo company discovery."}
            </p>
          )}
        </section>

        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3>People & verification</h3>
            <span
              className={`ano-pill ${
                peopleDiscovery?.verificationRun?.status === "completed" ||
                peopleDiscovery?.personSearch?.status === "completed"
                  ? "status-ready"
                  : dropcontact?.available
                    ? "status-neutral"
                    : "status-muted"
              }`}
            >
              {peopleDiscovery?.verificationRun
                ? `Dropcontact ${runStatusLabel(peopleDiscovery.verificationRun.status)}`
                : peopleDiscovery?.personSearch
                  ? runStatusLabel(peopleDiscovery.personSearch.status)
                  : dropcontact?.available
                    ? "Dropcontact ready"
                    : "Dropcontact unconfigured"}
            </span>
          </div>
          {peopleDiscovery && (peopleDiscovery.contacts.length > 0 || peopleDiscovery.playbooks.length > 0 || peopleDiscovery.personSearch) ? (
            <dl className="ano-rail-dl">
              <div>
                <dt>Named candidates</dt>
                <dd>{peopleDiscovery.contacts.length}</dd>
              </div>
              <div>
                <dt>Verified emails</dt>
                <dd>
                  {
                    peopleDiscovery.contacts.filter(
                      (item) => item.verificationStatus === "verified",
                    ).length
                  }
                </dd>
              </div>
              <div>
                <dt>Account playbooks</dt>
                <dd>{peopleDiscovery.playbooks.length}</dd>
              </div>
            </dl>
          ) : (
            <p className="ano-rail-empty">
              Shortlist a company in Phase D to propose buyer roles, selectively verify contacts via Dropcontact, and compile factual playbooks.
            </p>
          )}
        </section>

        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3>Outreach & Mercury</h3>
            <span
              className={`ano-pill ${
                outreachExecution?.proposals.some((p) => p.status === "executed")
                  ? "status-ready"
                  : outreachExecution?.proposals.some((p) => p.status === "awaiting_approval")
                    ? "status-neutral"
                    : "status-muted"
              }`}
            >
              {outreachExecution?.proposals.some((p) => p.status === "awaiting_approval")
                ? "Approval awaiting"
                : mercury?.available
                  ? "Mercury preview"
                  : "Per-action gated"}
            </span>
          </div>
          {outreachExecution && (outreachExecution.drafts.length > 0 || outreachExecution.proposals.length > 0) ? (
            <dl className="ano-rail-dl">
              <div>
                <dt>Draft versions</dt>
                <dd>{outreachExecution.drafts.length}</dd>
              </div>
              <div>
                <dt>Pending proposals</dt>
                <dd>
                  {
                    outreachExecution.proposals.filter(
                      (item) => item.status === "awaiting_approval",
                    ).length
                  }
                </dd>
              </div>
              <div>
                <dt>Executed receipts</dt>
                <dd>
                  {outreachExecution.proposals.filter((item) => item.status === "executed").length}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="ano-rail-empty">
              Compile a Phase E playbook to prepare eligible outreach drafts and per-action Mercury proposals.
            </p>
          )}
        </section>

        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3>Sources</h3>
            <span className="ano-count-pill">{sources.length}</span>
          </div>
          {sources.length > 0 ? (
            <ul className="ano-rail-sources">
              {sources.map((source) => (
                <li key={source.id}>
                  <span className="ano-source-class">{source.sourceClass}</span>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                  <small>{source.status === "fetched" ? "Retrieved" : "Not retrieved"}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ano-rail-empty">Saved public sources appear here after an approved run.</p>
          )}
        </section>

        <section className="ano-rail-card">
          <div className="ano-rail-card-head">
            <h3>Activity</h3>
            <span className="ano-count-pill">{events.length}</span>
          </div>
          {events.length > 0 ? (
            <ol className="ano-rail-activity">
              {events.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>{event.label}</strong>
                    <p>{event.detail}</p>
                  </div>
                  <time>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="ano-rail-empty">Safe graph checkpoints and approvals appear here.</p>
          )}
        </section>

        {conversation && (
          <section className="ano-rail-card" aria-label="Runtime diagnostics">
            <div className="ano-rail-card-head">
              <h3>Diagnostics</h3>
              <span className="ano-pill status-neutral">{conversation.run.graphVersion}</span>
            </div>
            <dl className="ano-rail-dl">
              <div>
                <dt>Graph node</dt>
                <dd>{conversation.run.currentNode}</dd>
              </div>
              <div>
                <dt>Checkpoint</dt>
                <dd>{conversation.run.checkpointRef ? conversation.run.checkpointRef.slice(0, 12) : "Pending"}</dd>
              </div>
              {research && (
                <div>
                  <dt>Research wave</dt>
                  <dd>
                    Wave {Math.max(1, research.run.currentWave)} · Attempt {research.run.attemptNumber}
                  </dd>
                </div>
              )}
              <div>
                <dt>Updated</dt>
                <dd>{new Date(conversation.conversation.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    </aside>
  );
}

"use client";

import type { EvidenceResearchView, ResearchProviderKey } from "@/lib/ano/evidence-research";
import type { ResearchPlan } from "@/lib/ano/research-conversation";
import { MaterialButton } from "@/components/material/material-button";

export interface ProviderScopeCardProps {
  plan: ResearchPlan;
  research: EvidenceResearchView | null;
  provider: {
    provider: ResearchProviderKey;
    available: boolean;
    maximumSearches: number;
    maximumFetches: number;
    pricingNote: string;
  } | null;
  isWorking: boolean;
  onPrepareResearch: () => void;
  onStartResearch: () => void;
}

export function ProviderScopeCard({
  plan,
  research,
  provider,
  isWorking,
  onPrepareResearch,
  onStartResearch,
}: ProviderScopeCardProps) {
  const providerAvailable = provider?.available ?? false;

  if (!research) {
    return (
      <article className="m3-artifact-card" aria-label="Bounded public research scope">
        <header className="m3-artifact-header">
          <div>
            <p className="m3-artifact-kicker">PHASE B · BOUNDED PROVIDER SCOPE</p>
            <h2>Prepare a bounded public-research scope</h2>
          </div>
          <span className={`m3-status-badge ${providerAvailable ? "status-approved" : "status-declined"}`}>
            {providerAvailable ? "Web search ready" : "Web search unavailable"}
          </span>
        </header>

        <p className="m3-artifact-lead">
          Ano generates bounded search queries, executes approved web searches on its server, and
          retrieves only saved public source URLs. Enrichment and outreach remain off.
        </p>

        <div className="m3-metric-strip">
          <div>
            <span>Search ceiling</span>
            <strong>{provider?.maximumSearches ?? plan.budget.maximumSearches}</strong>
          </div>
          <div>
            <span>Fetch ceiling</span>
            <strong>{provider?.maximumFetches ?? plan.budget.maximumFetches}</strong>
          </div>
          <div>
            <span>Stored data</span>
            <strong>Excerpts, hashes & receipts</strong>
          </div>
        </div>

        <p className="m3-helper-note">
          {providerAvailable
            ? "Searches bounded public web sources and stores verified excerpts for market analysis."
            : "Public web search is currently unavailable on this server."}
        </p>

        <footer className="m3-artifact-footer">
          <MaterialButton
            variant="filled"
            disabled={isWorking || !providerAvailable}
            onClick={onPrepareResearch}
          >
            {isWorking ? "Preparing scope…" : "Prepare public-research scope"}
          </MaterialButton>
        </footer>
      </article>
    );
  }

  return (
    <article className="m3-artifact-card" aria-label="Provider scope details">
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">
            PUBLIC EVIDENCE · ATTEMPT {research.run.attemptNumber}
          </p>
          <h2>
            {research.run.status === "awaiting_provider_approval"
              ? "Review and approve research scope"
              : "Approved research scope"}
          </h2>
        </div>
        <span className={`m3-status-badge status-${research.run.status}`}>
          {research.run.status.replaceAll("_", " ")}
        </span>
      </header>

      <div className="m3-metric-strip">
        <div>
          <span>Searches</span>
          <strong>
            {research.run.consumedSearches} / {research.run.maximumSearches}
          </strong>
        </div>
        <div>
          <span>Source fetches</span>
          <strong>
            {research.run.consumedFetches} / {research.run.maximumFetches}
          </strong>
        </div>
        <div>
          <span>Saved sources</span>
          <strong>{research.run.sourceCount}</strong>
        </div>
      </div>

      {research.queries.length > 0 && (
        <section className="m3-artifact-section">
          <h3>Planned & executed queries ({research.queries.length})</h3>
          <ol className="m3-query-list">
            {research.queries.slice(0, 6).map((query) => (
              <li key={query.id}>
                <strong>{query.query}</strong>
                <span>{query.reason}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {research.run.status === "awaiting_provider_approval" && (
        <footer className="m3-artifact-footer">
          <div className="m3-decision-copy">
            <strong>Nothing has been sent to external websites yet.</strong>
            <p>
              Approving runs bounded discovery and source extraction within the limits above.
              Ambiguous network requests are never retried automatically.
            </p>
          </div>
          <div className="m3-action-row">
            <MaterialButton variant="filled" disabled={isWorking} onClick={onStartResearch}>
              {isWorking ? "Running approved research…" : "Run approved public research"}
            </MaterialButton>
          </div>
        </footer>
      )}
    </article>
  );
}

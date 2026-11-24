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
      <article className="m3-artifact-card" aria-label="Market research scope">
        <header className="m3-artifact-header">
          <div>
            <p className="m3-artifact-kicker">Market Research</p>
            <h2>Prepare public market research</h2>
          </div>
          <span className={`m3-status-badge ${providerAvailable ? "status-approved" : "status-declined"}`}>
            {providerAvailable ? "Ready" : "Unavailable"}
          </span>
        </header>

        <p className="m3-artifact-lead">
          Ano prepares targeted web search queries for {plan.plannedScope.markets.join(", ") || plan.summary} and saves key public source excerpts for analysis.
        </p>

        <p className="m3-helper-note">
          {providerAvailable
            ? "Searches public web sources and saves verified excerpts for your market recommendation."
            : "Public web search is currently unavailable on this server."}
        </p>

        <footer className="m3-artifact-footer">
          <MaterialButton
            variant="filled"
            disabled={isWorking || !providerAvailable}
            onClick={onPrepareResearch}
          >
            {isWorking ? "Preparing search…" : "Prepare market research"}
          </MaterialButton>
        </footer>
      </article>
    );
  }

  return (
    <article className="m3-artifact-card" aria-label="Market research details">
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">Market Research</p>
          <h2>
            {research.run.status === "awaiting_provider_approval"
              ? "Review and start market research"
              : "Market research scope"}
          </h2>
        </div>
        <span className={`m3-status-badge status-${research.run.status}`}>
          {research.run.status.replaceAll("_", " ")}
        </span>
      </header>

      <div className="m3-metric-strip">
        <div>
          <span>Saved sources</span>
          <strong>{research.run.sourceCount}</strong>
        </div>
        <div>
          <span>Queries prepared</span>
          <strong>{research.queries.length}</strong>
        </div>
      </div>

      {research.queries.length > 0 && (
        <section className="m3-artifact-section">
          <h3>Search queries ({research.queries.length})</h3>
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
            <strong>Ready to start public research</strong>
            <p>
              Runs the search queries above and gathers public excerpts for your market recommendation.
            </p>
          </div>
          <div className="m3-action-row">
            <MaterialButton variant="filled" disabled={isWorking} onClick={onStartResearch}>
              {isWorking ? "Running research…" : "Start market research"}
            </MaterialButton>
          </div>
        </footer>
      )}
    </article>
  );
}

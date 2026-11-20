"use client";

import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";

export interface ResearchProgressMessageProps {
  research: EvidenceResearchView;
  synthesis: MarketSynthesis | null;
  providerAvailable: boolean;
  isWorking: boolean;
  onContinueResearch: () => void;
  onPrepareNewScope: () => void;
  onAnalyseEvidence: () => void;
  onOpenContextRail: () => void;
}

export function ResearchProgressMessage({
  research,
  synthesis,
  providerAvailable,
  isWorking,
  onContinueResearch,
  onPrepareNewScope,
  onAnalyseEvidence,
  onOpenContextRail,
}: ResearchProgressMessageProps) {
  useMaterialWeb();

  const interruptedAction = research.actions.find(
    (action) =>
      (action.kind === "search" || action.kind === "fetch") &&
      action.status === "requires_manual_review",
  );
  const canContinueApproved =
    research.run.status === "requires_manual_review" && Boolean(interruptedAction);

  if (research.run.status === "running") {
    return (
      <article className="m3-artifact-card m3-progress-card" role="status">
        <div className="m3-artifact-header">
          <div>
            <p className="m3-artifact-kicker">PUBLIC RESEARCH RUNNING</p>
            <h2>Collecting and assessing public sources</h2>
          </div>
          <span className="m3-status-badge status-running">
            Wave {Math.max(1, research.run.currentWave)}
          </span>
        </div>
        <md-linear-progress indeterminate aria-label="Public research running" />
        <p className="m3-artifact-lead">
          {research.run.consumedSearches} of {research.run.maximumSearches} searches ·{" "}
          {research.run.consumedFetches} of {research.run.maximumFetches} fetches ·{" "}
          {research.run.sourceCount} saved sources so far.
        </p>
      </article>
    );
  }

  if (research.run.status === "requires_manual_review" || research.run.status === "failed_safe") {
    return (
      <article className="m3-artifact-card m3-warning-card" role="status">
        <header className="m3-artifact-header">
          <div>
            <p className="m3-artifact-kicker">SAFE STOP</p>
            <h2>
              {canContinueApproved
                ? "One provider request was excluded for manual review"
                : research.run.status === "requires_manual_review"
                  ? "Manual review required"
                  : "Research stopped safely"}
            </h2>
          </div>
        </header>
        <p className="m3-artifact-lead">
          {canContinueApproved
            ? `Ano could not confirm one ${interruptedAction?.kind === "search" ? "SearXNG search" : "source retrieval"}, so it excluded that request without retrying it. You can continue using the remaining approved budget.`
            : research.run.failureMessage ?? "Ano paused and did not retry the provider request."}
        </p>
        <div className="m3-action-row">
          {canContinueApproved && (
            <MaterialButton variant="filled" disabled={isWorking} onClick={onContinueResearch}>
              {isWorking ? "Continuing research…" : "Continue approved research"}
            </MaterialButton>
          )}
          <MaterialButton
            variant="outlined"
            disabled={isWorking || !providerAvailable}
            onClick={onPrepareNewScope}
          >
            Prepare new scope
          </MaterialButton>
        </div>
      </article>
    );
  }

  if (research.run.status === "sources_ready") {
    return (
      <article className="m3-artifact-card m3-evidence-ready-card">
        <header className="m3-artifact-header">
          <div>
            <p className="m3-artifact-kicker">EVIDENCE COLLECTED</p>
            <h2>
              {research.run.sourceCount} saved source{research.run.sourceCount === 1 ? "" : "s"} ready
            </h2>
          </div>
          <MaterialButton variant="text" onClick={onOpenContextRail}>
            Inspect sources & budget
          </MaterialButton>
        </header>

        {research.sources.length > 0 && (
          <ul className="m3-source-preview-list">
            {research.sources.slice(0, 4).map((source) => (
              <li key={source.id}>
                <span className="m3-source-tag">{source.sourceClass}</span>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        )}

        {synthesis?.status === "running" && (
          <div className="m3-synthesis-running">
            <md-linear-progress indeterminate aria-label="Analyzing saved evidence" />
            <p>
              Checking citations across the saved source excerpts. No web search or external
              provider is running.
            </p>
          </div>
        )}

        {!synthesis && (
          <footer className="m3-artifact-footer">
            <div className="m3-decision-copy">
              <strong>Turn saved sources into a cited market recommendation</strong>
              <p>
                Uses only stored source excerpts in your workspace; makes no new search, Prospeo,
                contact, or outreach request.
              </p>
            </div>
            <MaterialButton variant="filled" disabled={isWorking} onClick={onAnalyseEvidence}>
              {isWorking ? "Analyzing saved evidence…" : "Create market recommendation"}
            </MaterialButton>
          </footer>
        )}
      </article>
    );
  }

  return null;
}

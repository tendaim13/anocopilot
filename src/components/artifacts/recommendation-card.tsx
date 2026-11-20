"use client";

import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import { MaterialButton } from "@/components/material/material-button";

export interface RecommendationCardProps {
  synthesis: MarketSynthesis;
  research: EvidenceResearchView | null;
  isWorking: boolean;
  onRetryAnalysis: () => void;
  onOpenSources: () => void;
  onStartNewResearch: () => void;
}

function recommendationLabel(mode: MarketSynthesis["recommendationMode"]) {
  if (mode === "directly_supported") return "Directly supported";
  if (mode === "comparative_inference") return "Comparable evidence";
  if (mode === "exploratory") return "Exploratory route";
  if (mode === "no_usable_evidence") return "No usable evidence";
  return "Preparing report";
}

function strengthLabel(value: "strong" | "moderate" | "limited" | "insufficient") {
  if (value === "strong") return "Strong evidence";
  if (value === "moderate") return "Moderate evidence";
  if (value === "limited") return "Limited evidence";
  return "Insufficient evidence";
}

function claimLabel(kind: MarketSynthesis["claims"][number]["kind"]) {
  if (kind === "observation") return "Source observation";
  if (kind === "comparable") return "Comparable evidence";
  if (kind === "inference") return "Ano inference";
  if (kind === "hypothesis") return "Hypothesis to test";
  return "Unknown / validate next";
}

function EvidenceDrawer({
  claimIds,
  synthesis,
  research,
}: {
  claimIds: string[];
  synthesis: MarketSynthesis;
  research: EvidenceResearchView | null;
}) {
  const claims = synthesis.claims.filter((claim) => claimIds.includes(claim.id));
  const sources = new Map((research?.sources ?? []).map((source) => [source.id, source]));
  if (!claims.length) return null;

  return (
    <details className="m3-evidence-details">
      <summary>
        Why Ano thinks this <span>{claims.length}</span>
      </summary>
      <div className="m3-evidence-drawer-body">
        {claims.map((claim) => (
          <article key={claim.id}>
            <p>
              <span className={`m3-claim-pill kind-${claim.kind}`}>{claimLabel(claim.kind)}</span>
              {claim.statement}
            </p>
            {claim.comparisonBasis && (
              <p className="m3-comparison-basis">
                <strong>Why comparable:</strong> {claim.comparisonBasis}
              </p>
            )}
            <ul>
              {claim.sourceIds.map((sourceId) => {
                const source = sources.get(sourceId);
                return (
                  <li key={sourceId}>
                    {source ? (
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                    ) : (
                      "Saved source reference"
                    )}
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
    </details>
  );
}

export function RecommendationCard({
  synthesis,
  research,
  isWorking,
  onRetryAnalysis,
  onOpenSources,
  onStartNewResearch,
}: RecommendationCardProps) {
  const directClaims = synthesis.claims.filter((claim) => claim.kind === "observation");
  const reasoningClaims = synthesis.claims.filter(
    (claim) => claim.kind === "comparable" || claim.kind === "inference",
  );
  const validationClaims = synthesis.claims.filter(
    (claim) => claim.kind === "hypothesis" || claim.kind === "uncertainty",
  );

  if (synthesis.status === "failed_safe" || synthesis.status === "requires_manual_review") {
    return (
      <article className="m3-artifact-card m3-warning-card">
        <header className="m3-artifact-header">
          <div>
            <p className="m3-artifact-kicker">EVIDENCE SYNTHESIS PAUSED</p>
            <h2>Evidence analysis stopped safely</h2>
          </div>
        </header>
        <p className="m3-artifact-lead">
          {synthesis.failureMessage ??
            "Ano preserved the saved source excerpts and did not retry the interrupted model request automatically."}
        </p>
        <div className="m3-action-row">
          <MaterialButton variant="tonal" disabled={isWorking} onClick={onRetryAnalysis}>
            {isWorking ? "Checking citations…" : "Analyze saved evidence again"}
          </MaterialButton>
        </div>
      </article>
    );
  }

  return (
    <article className="m3-artifact-card m3-recommendation-artifact" aria-label="Cited market recommendation">
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">PHASE C · CITED RECOMMENDATION</p>
          <h2>
            {synthesis.recommendationMode === "no_usable_evidence"
              ? "No usable public evidence was found for this question."
              : synthesis.markets[0]
                ? `Start by testing ${synthesis.markets[0].name}`
                : "Useful context found, no market route proposed yet"}
          </h2>
        </div>
        <span className={`m3-status-badge mode-${synthesis.recommendationMode}`}>
          {recommendationLabel(synthesis.recommendationMode)}
        </span>
      </header>

      <p className="m3-artifact-lead">{synthesis.assessment.summary}</p>

      {synthesis.recommendationMode === "no_usable_evidence" ? (
        <section className="m3-muted-callout">
          <p>
            Ano preserved the completed research record but found no usable source basis for a
            market recommendation. Nothing was invented.
          </p>
          <div className="m3-action-row">
            <MaterialButton variant="outlined" onClick={onOpenSources}>
              Inspect sources
            </MaterialButton>
            <MaterialButton variant="filled" onClick={onStartNewResearch}>
              Start new research
            </MaterialButton>
          </div>
        </section>
      ) : (
        <>
          {directClaims.length > 0 && (
            <section className="m3-artifact-section">
              <h3>What Ano found (Direct findings)</h3>
              <ul className="m3-bullet-list">
                {directClaims.map((claim) => (
                  <li key={claim.id}>{claim.statement}</li>
                ))}
              </ul>
            </section>
          )}

          {reasoningClaims.length > 0 && (
            <section className="m3-artifact-section m3-reasoning-callout">
              <h3>What this may mean for you</h3>
              <ul className="m3-claim-list">
                {reasoningClaims.map((claim) => (
                  <li key={claim.id}>
                    <span className={`m3-claim-pill kind-${claim.kind}`}>{claimLabel(claim.kind)}</span>
                    <span>{claim.statement}</span>
                    {claim.comparisonBasis && (
                      <small className="m3-comparison-basis">
                        Why comparable: {claim.comparisonBasis}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {synthesis.markets.length > 0 && (
            <section className="m3-artifact-section">
              <h3>Market routes</h3>
              <div className="m3-route-grid">
                {synthesis.markets.map((market) => (
                  <article className="m3-route-card" key={market.id}>
                    <div className="m3-route-head">
                      <h4>{market.name}</h4>
                      <span className={`m3-strength-pill strength-${market.evidenceStrength}`}>
                        {strengthLabel(market.evidenceStrength)}
                      </span>
                    </div>
                    <p>{market.summary}</p>
                    {market.unknowns.length > 0 && (
                      <div>
                        <strong>Validate next</strong>
                        <ul className="m3-bullet-list">
                          {market.unknowns.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <EvidenceDrawer claimIds={market.claimIds} synthesis={synthesis} research={research} />
                  </article>
                ))}
              </div>
            </section>
          )}

          {synthesis.industries.length > 0 && (
            <section className="m3-artifact-section">
              <h3>Industry profiles</h3>
              <div className="m3-route-grid">
                {synthesis.industries.map((industry) => (
                  <article className="m3-route-card" key={industry.id}>
                    <div className="m3-route-head">
                      <h4>{industry.name}</h4>
                      <span className={`m3-strength-pill strength-${industry.evidenceStrength}`}>
                        {strengthLabel(industry.evidenceStrength)}
                      </span>
                    </div>
                    <p>{industry.summary}</p>
                    <div>
                      <strong>Operational problems</strong>
                      <ul className="m3-bullet-list">
                        {industry.operationalProblems.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>Buyer-role hypotheses</strong>
                      <ul className="m3-bullet-list">
                        {industry.buyerRoleHypotheses.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <EvidenceDrawer claimIds={industry.claimIds} synthesis={synthesis} research={research} />
                  </article>
                ))}
              </div>
            </section>
          )}

          {validationClaims.length > 0 && (
            <section className="m3-artifact-section m3-muted-callout">
              <h3>What to validate next</h3>
              <ul className="m3-bullet-list">
                {validationClaims.map((claim) => (
                  <li key={claim.id}>{claim.statement}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {synthesis.assessment.contradictions.length > 0 && (
        <section className="m3-artifact-section m3-warning-callout">
          <h3>Conflicting evidence</h3>
          <ul className="m3-bullet-list">
            {synthesis.assessment.contradictions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

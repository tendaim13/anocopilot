"use client";

import type {
  AccountCandidateDossier,
  AccountLifecycleState,
} from "@/lib/ano/company-discovery";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import { MaterialButton } from "@/components/material/material-button";

export interface AccountDossierCardProps {
  account: AccountCandidateDossier;
  synthesis?: MarketSynthesis | null;
  targetMarketName?: string;
  targetIndustryName?: string;
  isWorking: boolean;
  onUpdateState: (
    accountId: string,
    state: "shortlisted" | "held" | "dismissed",
  ) => void;
}

function stateBadgeLabel(state: AccountLifecycleState) {
  if (state === "shortlisted") return "Shortlisted";
  if (state === "held" || state === "review") return "Held";
  if (state === "dismissed") return "Dismissed";
  return "Discovered";
}

function stateBadgeClass(state: AccountLifecycleState) {
  if (state === "shortlisted") return "status-approved";
  if (state === "held" || state === "review") return "status-awaiting_approval";
  if (state === "dismissed") return "status-declined";
  return "";
}

export function AccountDossierCard({
  account,
  synthesis = null,
  targetMarketName,
  targetIndustryName,
  isWorking,
  onUpdateState,
}: AccountDossierCardProps) {
  const linkedClaims = (synthesis?.claims ?? []).filter((claim) =>
    account.claimIds.includes(claim.id),
  );

  return (
    <article
      className="m3-artifact-card"
      aria-label={`Account dossier for ${account.name}`}
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">
            ACCOUNT DOSSIER · FIT {account.fit.totalScore}/100 ({account.fit.confidence.toUpperCase()} CONFIDENCE)
          </p>
          <h2>{account.name}</h2>
          <p className="m3-helper-note">
            {[account.location, account.industry, account.employeeBand]
              .filter(Boolean)
              .join(" · ") || "Observed company attributes"}
          </p>
        </div>
        <span className={`m3-status-badge ${stateBadgeClass(account.lifecycleState)}`}>
          {stateBadgeLabel(account.lifecycleState)}
        </span>
      </header>

      {(account.description || targetMarketName || targetIndustryName) && (
        <p className="m3-artifact-lead">
          {account.description ??
            `Candidate discovered under ${targetMarketName ?? "locked market"} · ${targetIndustryName ?? "locked industry"}.`}
        </p>
      )}

      <div className="m3-metric-strip">
        <div>
          <span>Location fit</span>
          <strong>{account.fit.locationScore} / 40</strong>
        </div>
        <div>
          <span>Industry alignment</span>
          <strong>{account.fit.industryScore} / 35</strong>
        </div>
        <div>
          <span>Profile signals</span>
          <strong>{account.fit.signalScore} / 25</strong>
        </div>
        <div>
          <span>Retrieved</span>
          <strong>{new Date(account.retrievedAt).toLocaleDateString()}</strong>
        </div>
      </div>

      <section className="m3-artifact-section">
        <h3>Confirmed company signals</h3>
        <div className="m3-evidence-source-grid">
          {account.signals.map((signal) => (
            <div key={signal.id} className="m3-evidence-source-item">
              <div className="m3-evidence-source-top">
                <span className="m3-claim-pill">{signal.label}</span>
                <span className="m3-source-tag">{signal.sourceAttribution}</span>
              </div>
              <p>{signal.explanation}</p>
              <small>
                {signal.evidenceUrl ? (
                  <a href={signal.evidenceUrl} target="_blank" rel="noreferrer">
                    {signal.evidenceUrl}
                  </a>
                ) : (
                  `Captured ${new Date(signal.capturedAt).toLocaleDateString()}`
                )}
              </small>
            </div>
          ))}
        </div>
      </section>

      <section className="m3-muted-callout">
        <strong>Market-level hypothesis boundary (Phase C claims)</strong>
        <p className="m3-helper-note">{account.fit.industryHypothesisNote}</p>
        {linkedClaims.length > 0 && (
          <ul className="m3-bullet-list">
            {linkedClaims.slice(0, 3).map((claim) => (
              <li key={claim.id}>{claim.statement}</li>
            ))}
          </ul>
        )}
      </section>

      {account.unknowns.length > 0 && (
        <section className="m3-artifact-section">
          <h3>Unknowns / validate next</h3>
          <ul className="m3-bullet-list">
            {account.unknowns.map((unknown) => (
              <li key={unknown}>{unknown}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="m3-artifact-footer">
        <div className="m3-action-row">
          <MaterialButton
            variant={account.lifecycleState === "shortlisted" ? "filled" : "tonal"}
            disabled={isWorking || account.lifecycleState === "shortlisted"}
            onClick={() => onUpdateState(account.id, "shortlisted")}
          >
            Shortlist
          </MaterialButton>
          <MaterialButton
            variant={account.lifecycleState === "held" ? "filled" : "outlined"}
            disabled={isWorking || account.lifecycleState === "held"}
            onClick={() => onUpdateState(account.id, "held")}
          >
            Hold
          </MaterialButton>
          <MaterialButton
            variant={account.lifecycleState === "dismissed" ? "tonal" : "text"}
            disabled={isWorking || account.lifecycleState === "dismissed"}
            onClick={() => onUpdateState(account.id, "dismissed")}
          >
            Dismiss
          </MaterialButton>

          {account.website && (
            <a
              href={account.website}
              target="_blank"
              rel="noreferrer"
              className="m3-text-link"
            >
              Website
            </a>
          )}
          {account.linkedInUrl && (
            <a
              href={account.linkedInUrl}
              target="_blank"
              rel="noreferrer"
              className="m3-text-link"
            >
              LinkedIn
            </a>
          )}
        </div>
      </footer>
    </article>
  );
}

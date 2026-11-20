"use client";

import Link from "next/link";

import type { CompanySearchView } from "@/lib/ano/company-discovery";
import { useMaterialWeb } from "@/components/material/register";

export interface AccountCohortCardProps {
  companySearch: CompanySearchView;
}

export function AccountCohortCard({ companySearch }: AccountCohortCardProps) {
  useMaterialWeb();

  if (companySearch.status !== "completed" || !companySearch.cohort) {
    return null;
  }

  const { cohort } = companySearch;

  return (
    <article
      className="m3-artifact-card"
      aria-label="Discovered company cohort summary"
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">COMPANY COHORT & SIGNAL DISTRIBUTION</p>
          <h2>
            {cohort.totalReturned} candidate account
            {cohort.totalReturned === 1 ? "" : "s"} returned
          </h2>
        </div>
        <Link href="/companies" className="m3-text-link">
          Open Companies directory
        </Link>
      </header>

      <p className="m3-artifact-lead">{cohort.cohortExplanation}</p>

      <div className="m3-metric-strip">
        <div>
          <span>Average fit score</span>
          <strong>{cohort.averageFitScore} / 100</strong>
        </div>
        <div>
          <span>Shortlisted</span>
          <strong>{cohort.shortlistedCount}</strong>
        </div>
        <div>
          <span>Held for review</span>
          <strong>{cohort.heldCount}</strong>
        </div>
        <div>
          <span>Dismissed</span>
          <strong>{cohort.dismissedCount}</strong>
        </div>
      </div>

      {cohort.signalBreakdown.length > 0 && (
        <section className="m3-artifact-section">
          <h3>Confirmed company-level signals</h3>
          <md-chip-set aria-label="Confirmed company-level signals">
            {cohort.signalBreakdown.map((item) => (
              <md-assist-chip key={item.signalType}>
                {item.label} · {item.count}
              </md-assist-chip>
            ))}
          </md-chip-set>
        </section>
      )}

      <section className="m3-reasoning-callout">
        <strong>Separation of evidence layers</strong>
        <p className="m3-helper-note">{cohort.separationNote}</p>
      </section>
    </article>
  );
}

"use client";

import Link from "next/link";

import {
  formatAccountForCohortTable,
  type AccountLifecycleState,
  type CompanySearchView,
} from "@/lib/ano/company-discovery";
import { maskVendorNamesForDisplay } from "@/lib/ano/research-conversation";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";

export interface AccountCohortCardProps {
  companySearch: CompanySearchView;
  onOpenArtifact?: (accountId?: string | null) => void;
  onSuggestChanges?: () => void;
}

function stateBadgeLabel(state: AccountLifecycleState) {
  if (state === "shortlisted") return "Shortlisted";
  if (state === "held" || state === "review") return "Held";
  if (state === "dismissed") return "Dismissed";
  return "Unreviewed";
}

function stateBadgeClass(state: AccountLifecycleState) {
  if (state === "shortlisted") return "status-approved";
  if (state === "held" || state === "review") return "status-awaiting_approval";
  if (state === "dismissed") return "status-declined";
  return "";
}

export function AccountCohortCard({
  companySearch,
  onOpenArtifact,
  onSuggestChanges,
}: AccountCohortCardProps) {
  useMaterialWeb();

  if (companySearch.status !== "completed" || !companySearch.cohort) {
    return null;
  }

  const { cohort } = companySearch;
  const previewRows = companySearch.accounts.slice(0, 5).map(formatAccountForCohortTable);

  return (
    <article
      className="m3-artifact-card"
      aria-label="Discovered company cohort artifact"
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">
            COMPANY COHORT ARTIFACT ·{" "}
            {companySearch.providerKey === "openstreetmap" ? "LOCAL BUSINESS" : "B2B DIRECTORY"}
          </p>
          <h2>
            {cohort.totalReturned} candidate account
            {cohort.totalReturned === 1 ? "" : "s"} returned
          </h2>
        </div>
        <Link href="/companies" className="m3-text-link">
          Open Companies directory
        </Link>
      </header>

      <p className="m3-artifact-lead">{maskVendorNamesForDisplay(cohort.cohortExplanation)}</p>

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

      {previewRows.length > 0 && (
        <section className="m3-artifact-section">
          <h3>Company preview table (click any row to inspect &amp; edit)</h3>
          <div className="m3-cohort-table-wrap">
            <table className="m3-cohort-table">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Specialisation</th>
                  <th scope="col">City</th>
                  <th scope="col">Country</th>
                  <th scope="col">Fit</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr
                    key={row.id}
                    className="m3-cohort-row-clickable"
                    tabIndex={0}
                    onClick={() => onOpenArtifact?.(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenArtifact?.(row.id);
                      }
                    }}
                  >
                    <td>
                      <div className="m3-table-company-cell">
                        <strong>{row.name}</strong>
                        <span>{row.domain ?? "No domain yet"}</span>
                      </div>
                    </td>
                    <td>{row.specialisation}</td>
                    <td>{row.city}</td>
                    <td>{row.country}</td>
                    <td>
                      <strong>{row.fitScore}/100</strong>
                    </td>
                    <td>
                      <span className={`m3-status-badge ${stateBadgeClass(row.lifecycleState)}`}>
                        {stateBadgeLabel(row.lifecycleState)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {companySearch.accounts.length > 5 && (
            <p className="m3-helper-note">
              Showing top 5 of {companySearch.accounts.length} companies. Open the interactive artifact to review, search, or shortlist all {companySearch.accounts.length}.
            </p>
          )}
        </section>
      )}

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
        <p className="m3-helper-note">{maskVendorNamesForDisplay(cohort.separationNote)}</p>
      </section>

      <footer className="m3-artifact-footer">
        <div className="m3-action-row">
          {companySearch.accounts.length > 0 && (
            <MaterialButton
              variant="filled"
              onClick={() => onOpenArtifact?.(null)}
            >
              Open company artifact ({companySearch.accounts.length} companies)
            </MaterialButton>
          )}
          <MaterialButton variant="outlined" onClick={() => onSuggestChanges?.()}>
            Suggest changes in chat
          </MaterialButton>
        </div>
      </footer>
    </article>
  );
}

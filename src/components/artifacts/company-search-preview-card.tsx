"use client";

import { useState } from "react";

import type {
  CompanySearchView,
  ProspeoProviderState,
} from "@/lib/ano/company-discovery";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import { ApprovalCard } from "@/components/conversation/approval-card";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";

export interface CompanySearchPreviewCardProps {
  synthesis: MarketSynthesis;
  companySearch: CompanySearchView | null;
  prospeo: ProspeoProviderState | null;
  isWorking: boolean;
  onPreparePreview: (options?: {
    locationOverrides?: string[];
    excludedCategories?: string[];
  }) => void;
  onApproveSearch: (searchId: string) => void;
}

function splitCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function CompanySearchPreviewCard({
  synthesis,
  companySearch,
  prospeo,
  isWorking,
  onPreparePreview,
  onApproveSearch,
}: CompanySearchPreviewCardProps) {
  useMaterialWeb();
  const lockedMarket = synthesis.markets.find(
    (item) => item.id === synthesis.decision?.marketProfileId,
  );
  const lockedIndustry = synthesis.industries.find(
    (item) => item.id === synthesis.decision?.industryProfileId,
  );

  const [locationInput, setLocationInput] = useState(
    () => companySearch?.requestedLocations.join(", ") ?? lockedMarket?.name ?? "",
  );
  const [excludeInput, setExcludeInput] = useState(
    () => companySearch?.excludedCategories.join(", ") ?? "",
  );
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);

  if (synthesis.decision?.status !== "locked") {
    return null;
  }

  const prospeoAvailable = prospeo?.available ?? false;
  const linkedClaimCount =
    companySearch?.linkedClaimIds.length ??
    new Set([
      ...(lockedMarket?.claimIds ?? []),
      ...(lockedIndustry?.claimIds ?? []),
    ]).size;

  const isCompleted = companySearch?.status === "completed";
  const isManualReview =
    companySearch?.status === "requires_manual_review" ||
    companySearch?.status === "failed_safe";
  const isRunning = companySearch?.status === "running";

  return (
    <article
      className="m3-artifact-card"
      aria-label="Prospeo company search preview"
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">PHASE D · PROSPEO COMPANY DISCOVERY</p>
          <h2>
            {!companySearch
              ? "Prepare a free Prospeo location & query preview"
              : companySearch.status === "awaiting_approval"
                ? "Review canonical Prospeo filters before spending 1 credit"
                : isRunning
                  ? "Running approved 1-page company search…"
                  : isCompleted
                    ? "Approved 1-page Prospeo search completed"
                    : "Prospeo search paused safely for review"}
          </h2>
        </div>
        <span
          className={`m3-status-badge ${
            !companySearch
              ? prospeoAvailable
                ? "status-approved"
                : "status-declined"
              : `status-${companySearch.status}`
          }`}
        >
          {!companySearch
            ? prospeoAvailable
              ? "Prospeo ready"
              : "Prospeo key missing"
            : companySearch.status.replaceAll("_", " ")}
        </span>
      </header>

      <p className="m3-artifact-lead">
        {!companySearch
          ? `Canonicalizing locations with Prospeo’s suggestion endpoint is free. Ano strictly caps company discovery to 1 page (max 25 companies, max 1 credit) with zero automatic retries.`
          : companySearch.estimateDetail}
      </p>

      <div className="m3-metric-strip">
        <div>
          <span>Locked route</span>
          <strong>
            {lockedMarket?.name ?? companySearch?.targetMarketName ?? "Selected market"} ·{" "}
            {lockedIndustry?.name ?? companySearch?.targetIndustryName ?? "Selected industry"}
          </strong>
        </div>
        <div>
          <span>Page & result ceiling</span>
          <strong>1 page · max 25 companies</strong>
        </div>
        <div>
          <span>Credit cap</span>
          <strong>Max 1 credit</strong>
        </div>
        <div>
          <span>Linked Phase C claims</span>
          <strong>
            {linkedClaimCount} cited claim{linkedClaimCount === 1 ? "" : "s"}
          </strong>
        </div>
      </div>

      {(!companySearch || companySearch.status === "awaiting_approval") && (
        <div className="m3-inline-edit">
          <div className="m3-artifact-grid">
            <MaterialTextField
              label="Target location(s) to canonicalize"
              value={locationInput}
              onValueChange={setLocationInput}
              placeholder="e.g. Malaysia, Singapore"
              supportingText="Comma-separated locations verified free against Prospeo suggestions."
              disabled={isWorking || !prospeoAvailable}
            />
            <MaterialTextField
              label="Excluded categories (review metadata)"
              value={excludeInput}
              onValueChange={setExcludeInput}
              placeholder="e.g. staffing agencies, resellers"
              supportingText="Stored on the cohort brief so reviewers flag exclusions."
              disabled={isWorking || !prospeoAvailable}
            />
          </div>
          {!prospeoAvailable && (
            <p className="m3-helper-note">
              Add PROSPEO_KEY to the server environment before preparing a live Prospeo location
              preview.
            </p>
          )}
        </div>
      )}

      {companySearch && (
        <section className="m3-artifact-section">
          <h3>Canonical filters & provenance</h3>
          <md-chip-set aria-label="Canonical filters">
            {companySearch.canonicalLocations.map((location) => (
              <md-assist-chip key={location}>Location: {location}</md-assist-chip>
            ))}
            {companySearch.excludedCategories.map((excluded) => (
              <md-assist-chip key={excluded}>Exclude: {excluded}</md-assist-chip>
            ))}
          </md-chip-set>
          <ul className="m3-bullet-list">
            {companySearch.criteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
          <pre className="m3-json-preview" aria-label="Canonical Prospeo request filters">
            {JSON.stringify({ page: 1, filters: companySearch.providerFilters }, null, 2)}
          </pre>
        </section>
      )}

      {isManualReview && companySearch?.failureMessage && (
        <div className="m3-warning-callout" role="status">
          <strong>No automatic retry was attempted</strong>
          <p>{companySearch.failureMessage}</p>
        </div>
      )}

      {(!companySearch || companySearch.status === "awaiting_approval") && (
        <footer className="m3-artifact-footer">
          <div className="m3-decision-copy">
            <strong>
              {companySearch
                ? "No company search has run yet and 0 search credits have been spent."
                : "Preparing a preview only calls Prospeo’s free location-suggestion endpoint."}
            </strong>
            <p>
              People discovery, Dropcontact verification, CRM writes, and outreach remain strictly
              off in Phase D.
            </p>
          </div>
          <div className="m3-action-row">
            <MaterialButton
              variant={companySearch ? "outlined" : "filled"}
              disabled={isWorking || !prospeoAvailable}
              onClick={() => {
                const locationOverrides = splitCommaList(locationInput);
                const excludedCategories = splitCommaList(excludeInput);
                onPreparePreview({
                  locationOverrides: locationOverrides.length ? locationOverrides : undefined,
                  excludedCategories,
                });
              }}
            >
              {isWorking
                ? "Verifying with Prospeo…"
                : companySearch
                  ? "Refresh free preview"
                  : "Prepare free Prospeo preview"}
            </MaterialButton>

            {companySearch?.status === "awaiting_approval" && (
              <MaterialButton
                variant="filled"
                disabled={isWorking || !prospeoAvailable}
                onClick={() => setConfirmApproveOpen(true)}
              >
                Approve 1-page company search
              </MaterialButton>
            )}
          </div>
        </footer>
      )}

      {companySearch && (
        <ApprovalCard
          open={confirmApproveOpen}
          title="Approve 1-page Prospeo company search?"
          body={`This runs a single Prospeo /search-company call (page 1, max 25 companies, max 1 credit) for ${companySearch.canonicalLocations.join(", ")}. Ano will not paginate or retry automatically.`}
          confirmLabel="Approve 1-page search"
          cancelLabel="Keep reviewing"
          isWorking={isWorking}
          onConfirm={() => {
            setConfirmApproveOpen(false);
            onApproveSearch(companySearch.id);
          }}
          onCancel={() => setConfirmApproveOpen(false)}
        />
      )}
    </article>
  );
}

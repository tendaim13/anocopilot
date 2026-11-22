"use client";

import { useState } from "react";

import type {
  CompanyDiscoveryProvider,
  CompanySearchView,
  ProspeoProviderState,
} from "@/lib/ano/company-discovery";
import {
  deriveOsmTagFilters,
  deriveProspeoIndustryCandidates,
  deriveSearchKeywords,
  recommendDiscoveryProvider,
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
    providerKey?: CompanyDiscoveryProvider;
    resolveWebsites?: boolean;
    locationOverrides?: string[];
    keywordOverrides?: string[];
    industryOverrides?: string[];
    excludedCategories?: string[];
  }) => void;
  onRunFreeSearch?: (options?: {
    resolveWebsites?: boolean;
    locationOverrides?: string[];
    keywordOverrides?: string[];
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

function splitLocationInput(value: string) {
  const delimiter = /[;\n]/.test(value) ? /[;\n]+/ : /,+/;
  return value
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLikelyGeographicHint(value?: string | null) {
  if (!value) return false;
  return !/\b(market|industry|industries|segment|units|software|platform|practices|clinics|solutions|global|other|unspecified)\b/i.test(
    value,
  );
}

export function CompanySearchPreviewCard({
  synthesis,
  companySearch,
  prospeo,
  isWorking,
  onPreparePreview,
  onRunFreeSearch,
  onApproveSearch,
}: CompanySearchPreviewCardProps) {
  useMaterialWeb();
  const lockedMarket = synthesis.markets.find(
    (item) => item.id === synthesis.decision?.marketProfileId,
  );
  const lockedIndustry = synthesis.industries.find(
    (item) => item.id === synthesis.decision?.industryProfileId,
  );

  const defaultKeywords = lockedIndustry ? deriveSearchKeywords(lockedIndustry, null) : [];
  const [providerKey, setProviderKey] = useState<CompanyDiscoveryProvider>(
    () =>
      companySearch?.providerKey ??
      recommendDiscoveryProvider(lockedIndustry?.name ?? "", defaultKeywords),
  );
  const [resolveWebsites, setResolveWebsites] = useState<boolean>(() => {
    const raw = companySearch?.providerFilters?.resolve_missing_websites_via_searxng;
    return typeof raw === "boolean" ? raw : true;
  });
  const [locationInput, setLocationInput] = useState(() => {
    if (companySearch?.requestedLocations.length) {
      return companySearch.requestedLocations.join("; ");
    }
    return isLikelyGeographicHint(lockedMarket?.name) ? lockedMarket?.name ?? "" : "";
  });
  const [keywordInput, setKeywordInput] = useState(() => {
    const existing = companySearch?.industryKeywords ?? [];
    if (existing.length > 0) {
      return (
        existing.filter((item) => !/industry|market/i.test(item)).join(", ") ||
        existing.join(", ")
      );
    }
    return defaultKeywords.join(", ");
  });
  const [industryInput, setIndustryInput] = useState(
    () => companySearch?.canonicalIndustries?.join(", ") ?? "",
  );
  const [excludeInput, setExcludeInput] = useState(
    () => companySearch?.excludedCategories.join(", ") ?? "",
  );
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isEditingFilters, setIsEditingFilters] = useState(false);
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);

  if (synthesis.decision?.status !== "locked") {
    return null;
  }

  const prospeoAvailable = prospeo?.available ?? false;
  const formBlockedByMissingKey = providerKey === "prospeo" && !prospeoAvailable;
  const approveBlockedByMissingKey =
    companySearch?.providerKey === "prospeo" && !prospeoAvailable;
  const isOsmSelected = providerKey === "openstreetmap";
  const displayedProvider: CompanyDiscoveryProvider =
    companySearch?.providerKey ?? providerKey;
  const previewOsmTags = deriveOsmTagFilters(
    lockedIndustry?.name ?? companySearch?.targetIndustryName ?? "",
    splitCommaList(keywordInput),
  );

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
  const showFilterEditor =
    !companySearch ||
    companySearch.status === "awaiting_approval" ||
    isManualReview ||
    isEditingFilters;

  function handleSelectProvider(nextProvider: CompanyDiscoveryProvider) {
    setProviderKey(nextProvider);
    setLocationError(null);
    if (nextProvider === "prospeo" && !industryInput.trim()) {
      const candidates = deriveProspeoIndustryCandidates(
        lockedIndustry?.name ?? companySearch?.targetIndustryName ?? "",
        splitCommaList(keywordInput),
      );
      if (
        candidates.length > 0 &&
        candidates[0].toLowerCase() !==
          (lockedIndustry?.name ?? companySearch?.targetIndustryName ?? "").toLowerCase()
      ) {
        setIndustryInput(candidates.join(", "));
      }
    }
  }

  return (
    <article
      className="m3-artifact-card"
      aria-label="Company discovery preview"
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">
            PHASE D · {displayedProvider === "openstreetmap" ? "OPENSTREETMAP LOCAL DISCOVERY" : "PROSPEO COMPANY DISCOVERY"}
          </p>
          <h2>
            {!companySearch
              ? isOsmSelected
                ? "Prepare a free OpenStreetMap local business preview"
                : "Prepare a free Prospeo location & query preview"
              : companySearch.status === "awaiting_approval"
                ? companySearch.providerKey === "openstreetmap"
                  ? "Review OpenStreetMap area & category tags ($0 credits)"
                  : "Review canonical Prospeo filters before spending 1 credit"
                : isRunning
                  ? "Running approved bounded company search…"
                  : isCompleted
                    ? companySearch.providerKey === "openstreetmap"
                      ? "Approved OpenStreetMap local search completed"
                      : "Approved 1-page Prospeo search completed"
                    : "Company search paused safely for review"}
          </h2>
        </div>
        <span
          className={`m3-status-badge ${
            !companySearch
              ? isOsmSelected || prospeoAvailable
                ? "status-approved"
                : "status-declined"
              : `status-${companySearch.status}`
          }`}
        >
          {!companySearch
            ? isOsmSelected
              ? "OpenStreetMap ready (Free)"
              : prospeoAvailable
                ? "Prospeo ready"
                : "Prospeo key missing"
            : companySearch.status.replaceAll("_", " ")}
        </span>
      </header>

      <p className="m3-artifact-lead">
        {!companySearch
          ? isOsmSelected
            ? "OpenStreetMap finds real local physical businesses (like dental clinics) by area and map category tags for 0 credits, with optional free SearXNG official-website resolution."
            : "Canonicalizing locations and industries with Prospeo’s suggestion endpoint is free. Company searches use profile-only keyword matching (no blog/page noise) and stay capped at 1 page (25 companies, max 1 credit)."
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
          <span>Result ceiling</span>
          <strong>Max 25 companies</strong>
        </div>
        <div>
          <span>Credit cost</span>
          <strong>
            {displayedProvider === "openstreetmap" ? "0 credits (Free)" : "Max 1 credit"}
          </strong>
        </div>
        <div>
          <span>Linked Phase C claims</span>
          <strong>
            {linkedClaimCount} cited claim{linkedClaimCount === 1 ? "" : "s"}
          </strong>
        </div>
      </div>

      {showFilterEditor && (
        <div className="m3-inline-edit">
          <div className="m3-action-row" role="group" aria-label="Discovery source selector">
            <MaterialButton
              variant={providerKey === "openstreetmap" ? "filled" : "outlined"}
              disabled={isWorking}
              onClick={() => handleSelectProvider("openstreetmap")}
            >
              OpenStreetMap Local Map (Free)
            </MaterialButton>
            <MaterialButton
              variant={providerKey === "prospeo" ? "filled" : "outlined"}
              disabled={isWorking}
              onClick={() => handleSelectProvider("prospeo")}
            >
              Prospeo B2B Database (1 credit max)
            </MaterialButton>
          </div>

          <div className="m3-artifact-grid">
            <MaterialTextField
              label={
                isOsmSelected
                  ? "Target cities or regions (OpenStreetMap)"
                  : "Target location(s) to canonicalize"
              }
              value={locationInput}
              onValueChange={(nextValue) => {
                setLocationInput(nextValue);
                if (locationError) setLocationError(null);
              }}
              placeholder={
                isOsmSelected
                  ? "e.g. Kuala Lumpur, Malaysia; Melbourne, Australia; Singapore"
                  : "e.g. Australia, Malaysia, Singapore"
              }
              supportingText={
                isOsmSelected
                  ? "Separate multiple locations with semicolons (or commas). Specific cities/metros work fastest on OpenStreetMap."
                  : "Comma-separated countries, states, or cities verified free against Prospeo suggestions."
              }
              error={Boolean(locationError)}
              errorText={locationError ?? undefined}
              disabled={isWorking || formBlockedByMissingKey}
            />
            <MaterialTextField
              label={
                isOsmSelected
                  ? "Business category keywords (maps to OSM tags)"
                  : "Target company keywords (profile-only OR match)"
              }
              value={keywordInput}
              onValueChange={setKeywordInput}
              placeholder="e.g. dental clinic, dental practice, dentist"
              supportingText={
                isOsmSelected
                  ? "Maps your niche to structured OpenStreetMap POI tags (e.g. amenity=dentist, healthcare=dentist)."
                  : "Searches company profiles & descriptions only (excludes blog/marketing webpages to prevent SaaS & insurer noise)."
              }
              disabled={isWorking || formBlockedByMissingKey}
            />
            {!isOsmSelected && (
              <MaterialTextField
                label="Prospeo industry category (recommended)"
                value={industryInput}
                onValueChange={setIndustryInput}
                placeholder="e.g. Medical Practices, Hospitals and Health Care"
                supportingText="Verified free against Prospeo taxonomy; defaults automatically when blank for healthcare/B2B routes."
                disabled={isWorking || formBlockedByMissingKey}
              />
            )}
            <MaterialTextField
              label={isOsmSelected ? "Excluded name/category words" : "Excluded keywords (Prospeo exclude filter)"}
              value={excludeInput}
              onValueChange={setExcludeInput}
              placeholder="e.g. investment, capital, laboratory, supplier"
              supportingText="Filters out mismatches before returning your 25-company cohort."
              disabled={isWorking || formBlockedByMissingKey}
            />
          </div>

          {isOsmSelected && (
            <>
              <md-chip-set aria-label="Mapped OpenStreetMap tags">
                {previewOsmTags.length > 0 ? (
                  previewOsmTags.map((tag) => (
                    <md-assist-chip key={`${tag.key}=${tag.value}`}>
                      OSM tag: {tag.key}={tag.value}
                    </md-assist-chip>
                  ))
                ) : (
                  <md-assist-chip>Add a physical category keyword (e.g. dentist, clinic, plumber)</md-assist-chip>
                )}
              </md-chip-set>

              <div className="m3-person-row">
                <div className="m3-checkbox-wrap">
                  <md-checkbox
                    aria-label="Resolve missing clinic websites via private SearXNG"
                    checked={resolveWebsites || undefined}
                    disabled={isWorking || undefined}
                    onChange={(event) => {
                      const target = event.currentTarget as unknown as { checked?: boolean };
                      setResolveWebsites(Boolean(target.checked));
                    }}
                  />
                </div>
                <div className="m3-person-meta">
                  <strong>Resolve missing websites via private SearXNG (Free, up to 10)</strong>
                  <p className="m3-helper-note">
                    Looks up official clinic domains when OpenStreetMap lacks a website tag, unlocking Phase E decision-maker lookup.
                  </p>
                </div>
              </div>
            </>
          )}

          {formBlockedByMissingKey && (
            <p className="m3-helper-note">
              Add PROSPEO_KEY to the server environment before preparing a live Prospeo preview, or
              switch to OpenStreetMap Local Map above for free discovery.
            </p>
          )}
        </div>
      )}

      {companySearch && (
        <section className="m3-artifact-section">
          <h3>Canonical filters & provenance</h3>
          <md-chip-set aria-label="Canonical filters">
            <md-assist-chip>
              Source: {companySearch.providerKey === "openstreetmap" ? "OpenStreetMap" : "Prospeo"}
            </md-assist-chip>
            {companySearch.canonicalLocations.map((location) => (
              <md-assist-chip key={location}>Location: {location}</md-assist-chip>
            ))}
            {(companySearch.canonicalIndustries ?? []).map((ind) => (
              <md-assist-chip key={ind}>Industry: {ind}</md-assist-chip>
            ))}
            {companySearch.industryKeywords.map((kw) => (
              <md-assist-chip key={kw}>Keyword: {kw}</md-assist-chip>
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
          <pre className="m3-json-preview" aria-label="Canonical company search request filters">
            {JSON.stringify(
              companySearch.providerKey === "openstreetmap"
                ? companySearch.providerFilters
                : { page: 1, filters: companySearch.providerFilters },
              null,
              2,
            )}
          </pre>
        </section>
      )}

      {isManualReview && companySearch?.failureMessage && (
        <div className="m3-warning-callout" role="status">
          <strong>No automatic retry was attempted</strong>
          <p>{companySearch.failureMessage}</p>
        </div>
      )}

      {(showFilterEditor || isCompleted) && (
        <footer className="m3-artifact-footer">
          <div className="m3-decision-copy">
            <strong>
              {showFilterEditor
                ? companySearch && !isCompleted
                  ? "No search has run with these filters yet and 0 search credits have been spent."
                  : isOsmSelected
                    ? "Preparing a preview resolves your areas via free OpenStreetMap Nominatim."
                    : "Preparing a preview only calls Prospeo’s free location and industry suggestion endpoints."
                : "Want narrower, more relevant businesses for your product?"}
            </strong>
            <p>
              People discovery, Dropcontact verification, CRM writes, and outreach remain strictly
              off in Phase D.
            </p>
          </div>
          <div className="m3-action-row">
            {isCompleted && !isEditingFilters && (
              <MaterialButton
                variant="outlined"
                disabled={isWorking}
                onClick={() => setIsEditingFilters(true)}
              >
                Revise filters & prepare new preview
              </MaterialButton>
            )}

            {showFilterEditor && (
              <>
                {isCompleted && (
                  <MaterialButton
                    variant="text"
                    disabled={isWorking}
                    onClick={() => setIsEditingFilters(false)}
                  >
                    Cancel
                  </MaterialButton>
                )}
                <MaterialButton
                  variant={companySearch?.status === "awaiting_approval" ? "outlined" : "filled"}
                  disabled={isWorking || formBlockedByMissingKey}
                  onClick={() => {
                    const locationOverrides = splitLocationInput(locationInput);
                    const keywordOverrides = splitCommaList(keywordInput).filter(
                      (item) => item.length >= 3 && item.length <= 100,
                    );
                    const industryOverrides = splitCommaList(industryInput);
                    const excludedCategories = splitCommaList(excludeInput);
                    if (locationOverrides.length === 0) {
                      setLocationError(
                        isOsmSelected
                          ? "Enter at least one city or region (for example, Kuala Lumpur, Malaysia; Melbourne, Australia)."
                          : "Enter at least one country, state, or city (for example, Australia, United Kingdom, or United States).",
                      );
                      return;
                    }
                    setLocationError(null);
                    setIsEditingFilters(false);
                    if (isOsmSelected && onRunFreeSearch) {
                      onRunFreeSearch({
                        resolveWebsites,
                        locationOverrides,
                        keywordOverrides,
                        excludedCategories,
                      });
                      return;
                    }
                    onPreparePreview({
                      providerKey,
                      resolveWebsites,
                      locationOverrides,
                      keywordOverrides,
                      industryOverrides:
                        !isOsmSelected && industryInput.trim().length > 0
                          ? industryOverrides
                          : undefined,
                      excludedCategories,
                    });
                  }}
                >
                  {isWorking
                    ? isOsmSelected
                      ? "Finding local businesses…"
                      : "Verifying with Prospeo…"
                    : isOsmSelected && onRunFreeSearch
                      ? companySearch
                        ? "Update OpenStreetMap list (Free)"
                        : "Find local businesses (Free)"
                      : companySearch
                        ? "Refresh free preview"
                        : isOsmSelected
                          ? "Prepare free OpenStreetMap preview"
                          : "Prepare free Prospeo preview"}
                </MaterialButton>
              </>
            )}

            {companySearch?.status === "awaiting_approval" && (
              <MaterialButton
                variant="filled"
                disabled={isWorking || approveBlockedByMissingKey}
                onClick={() => {
                  if (companySearch.providerKey === "openstreetmap") {
                    onApproveSearch(companySearch.id);
                    return;
                  }
                  setConfirmApproveOpen(true);
                }}
              >
                {companySearch.providerKey === "openstreetmap"
                  ? "Run free OpenStreetMap search"
                  : "Approve 1-page company search"}
              </MaterialButton>
            )}
          </div>
        </footer>
      )}

      {companySearch && companySearch.providerKey !== "openstreetmap" && (
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

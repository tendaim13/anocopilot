"use client";

import { useMemo, useState } from "react";

import type { CompanySearchView, ProspeoProviderState } from "@/lib/ano/company-discovery";
import type { IndustryProfile } from "@/lib/ano/market-synthesis";
import {
  deriveBuyingCommitteeCriteria,
  formatContactForCohortTable,
  inferDefaultSeniorities,
  PROSPEO_DEPARTMENT_OPTIONS,
  PROSPEO_SENIORITY_OPTIONS,
  recommendPersonDiscoveryProvider,
  type CompanyArchetype,
  type ContactVerificationProvider,
  type DropcontactProviderState,
  type PeopleDiscoveryView,
  type PersonDiscoveryProvider,
} from "@/lib/ano/people-playbooks";
import type { ResearchBrief } from "@/lib/ano/research-conversation";
import { ApprovalCard } from "@/components/conversation/approval-card";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";

export interface BuyingCommitteeActionOptions {
  providerKey?: PersonDiscoveryProvider;
  roleOverrides?: string[];
  departments?: string[];
  seniorities?: string[];
  excludeTitles?: string[];
  archetype?: CompanyArchetype;
}

export interface PeopleDiscoveryCardProps {
  companySearch: CompanySearchView | null;
  peopleDiscovery: PeopleDiscoveryView;
  prospeo: ProspeoProviderState | null;
  dropcontact: DropcontactProviderState | null;
  targetIndustry?: IndustryProfile | null;
  targetIndustryName?: string;
  researchBrief?: ResearchBrief | null;
  selectedContactIds?: string[];
  onToggleContact?: (contactId: string, checked: boolean) => void;
  isWorking: boolean;
  onProposeRoles: (options?: BuyingCommitteeActionOptions | string[]) => void;
  onRunFreePeopleSearch?: (options?: Omit<BuyingCommitteeActionOptions, "providerKey">) => void;
  onApprovePersonSearch: (personSearchId: string) => void;
  onPrepareVerification: (
    contactIds: string[],
    providerKey?: ContactVerificationProvider,
  ) => void;
  onGeneratePlaybooks: () => void;
  onOpenPeopleArtifact?: (contactId?: string | null) => void;
  onSuggestChanges?: () => void;
}

function splitCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleStringItem(list: string[], value: string, maxItems: number): string[] {
  const exists = list.some((item) => item.toLowerCase() === value.toLowerCase());
  if (exists) {
    const next = list.filter((item) => item.toLowerCase() !== value.toLowerCase());
    return next.length > 0 ? next : list;
  }
  return [...list, value].slice(0, maxItems);
}

export function PeopleDiscoveryCard({
  companySearch,
  peopleDiscovery,
  prospeo,
  dropcontact,
  targetIndustry = null,
  targetIndustryName,
  researchBrief = null,
  selectedContactIds,
  onToggleContact,
  isWorking,
  onProposeRoles,
  onRunFreePeopleSearch,
  onApprovePersonSearch,
  onPrepareVerification,
  onGeneratePlaybooks,
  onOpenPeopleArtifact,
  onSuggestChanges,
}: PeopleDiscoveryCardProps) {
  useMaterialWeb();

  const shortlistedAccounts = useMemo(
    () =>
      (companySearch?.accounts ?? []).filter(
        (account) => account.lifecycleState === "shortlisted",
      ),
    [companySearch?.accounts],
  );

  const fallbackIndustry: IndustryProfile = useMemo(
    () =>
      targetIndustry ?? {
        id: "00000000-0000-4000-8000-000000000001",
        marketProfileId: null,
        name: targetIndustryName ?? companySearch?.targetIndustryName ?? "Target industry",
        summary: "Target industry from locked Phase C route.",
        operationalProblems: [],
        solutionFit: [],
        buyerRoleHypotheses: peopleDiscovery.personSearch?.approvedRoles ?? [],
        evidenceStrength: "moderate",
        claimIds: [],
        unknowns: [],
      },
    [targetIndustry, targetIndustryName, companySearch?.targetIndustryName, peopleDiscovery.personSearch?.approvedRoles],
  );

  const defaultCommittee = useMemo(
    () =>
      peopleDiscovery.personSearch?.buyingCommittee ??
      deriveBuyingCommitteeCriteria({
        industry: fallbackIndustry,
        brief: researchBrief,
        shortlistedAccounts,
      }),
    [peopleDiscovery.personSearch?.buyingCommittee, fallbackIndustry, researchBrief, shortlistedAccounts],
  );

  const personSearch = peopleDiscovery.personSearch;
  const contacts = peopleDiscovery.contacts;

  const [providerKey, setProviderKey] = useState<PersonDiscoveryProvider>(
    () =>
      personSearch?.providerKey ??
      recommendPersonDiscoveryProvider(shortlistedAccounts, fallbackIndustry.name),
  );
  const [archetype, setArchetype] = useState<CompanyArchetype>(defaultCommittee.archetype);
  const [departments, setDepartments] = useState<string[]>(defaultCommittee.departments);
  const [seniorities, setSeniorities] = useState<string[]>(defaultCommittee.seniorities);
  const [roleInput, setRoleInput] = useState(() =>
    (personSearch?.approvedRoles ?? defaultCommittee.includeTitles).join(", "),
  );
  const [excludeInput, setExcludeInput] = useState(() =>
    defaultCommittee.excludeTitles.join(", "),
  );
  const [isEditingCommittee, setIsEditingCommittee] = useState(false);

  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>(() =>
    contacts.filter((c) => c.selectedForVerification).map((c) => c.id),
  );
  const [verificationProvider, setVerificationProvider] = useState<ContactVerificationProvider>(
    () =>
      peopleDiscovery.verificationRun?.providerKey ??
      (prospeo?.available || !dropcontact?.available ? "prospeo" : "dropcontact"),
  );
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);

  if (shortlistedAccounts.length === 0 && !personSearch) {
    return null;
  }

  const prospeoAvailable = prospeo?.available ?? false;
  const isWebsiteSelected = providerKey === "website_team";
  const effectiveSelectedIds =
    selectedContactIds !== undefined
      ? selectedContactIds.filter((id) => contacts.some((c) => c.id === id))
      : localSelectedIds.length > 0
        ? localSelectedIds.filter((id) => contacts.some((c) => c.id === id))
        : contacts.filter((c) => c.selectedForVerification).map((c) => c.id);

  function handleCheckboxToggle(contactId: string, checked: boolean) {
    if (onToggleContact) {
      onToggleContact(contactId, checked);
      return;
    }
    setLocalSelectedIds((prev) => {
      const base =
        prev.length > 0
          ? prev
          : contacts.filter((c) => c.selectedForVerification).map((c) => c.id);
      if (checked) {
        if (base.includes(contactId)) return base;
        return [...base, contactId].slice(0, 10);
      }
      return base.filter((id) => id !== contactId);
    });
  }

  function handleArchetypeSelect(next: CompanyArchetype) {
    setArchetype(next);
    setSeniorities(inferDefaultSeniorities(next));
  }

  function buildActionOptions() {
    const roleOverrides = splitCommaList(roleInput);
    const excludeTitles = splitCommaList(excludeInput);
    return {
      archetype,
      departments,
      seniorities,
      roleOverrides: roleOverrides.length > 0 ? roleOverrides : defaultCommittee.includeTitles,
      excludeTitles,
    };
  }

  const previewRows = contacts.slice(0, 5).map(formatContactForCohortTable);
  const showCommitteeForm =
    !personSearch || personSearch.status === "awaiting_approval" || isEditingCommittee;

  const liveProspeoFiltersPreview = useMemo(() => {
    const domains = shortlistedAccounts.map((a) => a.domain).filter(Boolean);
    const includeTitles = splitCommaList(roleInput);
    const excludeTitles = splitCommaList(excludeInput);
    return {
      page: 1,
      filters: {
        company:
          domains.length > 0
            ? { websites: { include: domains } }
            : { names: { include: shortlistedAccounts.map((a) => a.name) } },
        ...(seniorities.length > 0 ? { person_seniority: { include: seniorities } } : {}),
        ...(departments.length > 0 ? { person_department: { include: departments } } : {}),
        person_job_title: {
          include: includeTitles.length > 0 ? includeTitles : defaultCommittee.includeTitles,
          ...(excludeTitles.length > 0 ? { exclude: excludeTitles } : {}),
        },
      },
    };
  }, [shortlistedAccounts, roleInput, excludeInput, seniorities, departments, defaultCommittee.includeTitles]);

  return (
    <article
      className="m3-artifact-card"
      aria-label="Phase E people and buying committee discovery"
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">
            PHASE E · BUYING COMMITTEE &amp; PEOPLE (
            {isWebsiteSelected ? "WEBSITE TEAM" : "PROSPEO PEOPLE"})
          </p>
          <h2>
            {!personSearch
              ? "Configure buying committee for shortlisted companies"
              : personSearch.status === "awaiting_approval"
                ? personSearch.providerKey === "website_team"
                  ? "Ready to scan shortlisted company websites"
                  : "Review buying committee & Prospeo people search"
                : personSearch.status === "running"
                  ? "Discovering decision-makers…"
                  : personSearch.status === "completed"
                    ? `${contacts.length} named decision-maker${contacts.length === 1 ? "" : "s"} found`
                    : "Person discovery stopped safely for review"}
          </h2>
        </div>
        <span
          className={`m3-status-badge ${
            personSearch ? `status-${personSearch.status}` : "status-approved"
          }`}
        >
          {personSearch
            ? personSearch.status.replaceAll("_", " ")
            : `${shortlistedAccounts.length} shortlisted`}
        </span>
      </header>

      <p className="m3-artifact-lead">
        {personSearch
          ? personSearch.providerKey === "website_team"
            ? "Scans shortlisted company websites (up to 3 pages per site) to extract named owners, directors, and managers with public emails."
            : "Returns up to 25 named decision-makers matching your Buying Committee filters across shortlisted companies."
          : "Ano infers target departments, seniority bands, and job titles from your product and shortlisted company size. Run a website team scan first or query Prospeo with structured filters."}
      </p>

      <div className="m3-metric-strip">
        <div>
          <span>Shortlisted companies</span>
          <strong>{shortlistedAccounts.length}</strong>
        </div>
        <div>
          <span>People source</span>
          <strong>{isWebsiteSelected ? "Company websites" : "Prospeo directory"}</strong>
        </div>
        <div>
          <span>Email verification</span>
          <strong>
            {prospeo?.available && dropcontact?.available
              ? "Prospeo or Dropcontact"
              : prospeo?.available
                ? "Prospeo Verify"
                : dropcontact?.available
                  ? "Dropcontact Verify"
                  : "No verifier key configured"}
          </strong>
        </div>
      </div>

      {showCommitteeForm ? (
        <div className="m3-buying-committee-grid">
          <div className="m3-chip-group">
            <span className="m3-chip-group-label">People discovery source</span>
            <div className="m3-action-row" role="group" aria-label="People discovery source">
              <MaterialButton
                variant={isWebsiteSelected ? "filled" : "outlined"}
                disabled={isWorking}
                onClick={() => setProviderKey("website_team")}
              >
                Company Website Team Pages
              </MaterialButton>
              <MaterialButton
                variant={!isWebsiteSelected ? "filled" : "outlined"}
                disabled={isWorking}
                onClick={() => setProviderKey("prospeo")}
              >
                Prospeo People Directory
              </MaterialButton>
            </div>
          </div>

          <div className="m3-chip-group">
            <span className="m3-chip-group-label">
              Company size / org structure preset
            </span>
            <div className="m3-action-row" role="group" aria-label="Company archetype preset">
              {(
                [
                  ["local_smb", "Local SMB (<50 staff)"],
                  ["mid_market", "Mid-Market (50–500)"],
                  ["enterprise", "Enterprise (500+)"],
                ] as Array<[CompanyArchetype, string]>
              ).map(([value, label]) => (
                <MaterialButton
                  key={value}
                  variant={archetype === value ? "tonal" : "outlined"}
                  disabled={isWorking}
                  onClick={() => handleArchetypeSelect(value)}
                >
                  {label}
                </MaterialButton>
              ))}
            </div>
          </div>

          <div className="m3-chip-group">
            <span className="m3-chip-group-label">Seniority band (Prospeo &amp; website scoring)</span>
            <md-chip-set aria-label="Target seniority levels">
              {PROSPEO_SENIORITY_OPTIONS.map((option) => (
                <md-filter-chip
                  key={option}
                  selected={seniorities.some((s) => s.toLowerCase() === option.toLowerCase())}
                  onClick={() => setSeniorities((prev) => toggleStringItem(prev, option, 6))}
                >
                  {option}
                </md-filter-chip>
              ))}
            </md-chip-set>
          </div>

          <div className="m3-chip-group">
            <span className="m3-chip-group-label">Function / Department</span>
            <md-chip-set aria-label="Target functional departments">
              {PROSPEO_DEPARTMENT_OPTIONS.map((option) => (
                <md-filter-chip
                  key={option}
                  selected={departments.some((d) => d.toLowerCase() === option.toLowerCase())}
                  onClick={() => setDepartments((prev) => toggleStringItem(prev, option, 6))}
                >
                  {option}
                </md-filter-chip>
              ))}
            </md-chip-set>
          </div>

          <MaterialTextField
            label="Target job titles (comma-separated)"
            value={roleInput}
            onValueChange={setRoleInput}
            placeholder="e.g. Principal Dentist, Practice Manager, COO, CEO"
            supportingText="Ordered priority titles matched on company pages and Prospeo person_job_title.include."
            disabled={isWorking}
          />

          <MaterialTextField
            label="Exclude non-buyer titles (comma-separated)"
            value={excludeInput}
            onValueChange={setExcludeInput}
            placeholder="e.g. Intern, Assistant, Receptionist, Hygienist"
            supportingText="Filtered out during website extraction and sent in Prospeo person_job_title.exclude."
            disabled={isWorking}
          />

          <details className="m3-details-preview">
            <summary>
              {isWebsiteSelected
                ? "Inspect website team crawl scope"
                : "Inspect Prospeo /search-person JSON payload"}
            </summary>
            <pre className="m3-json-preview" aria-label="Person search query preview">
              {JSON.stringify(
                isWebsiteSelected
                  ? {
                      source: "website_team",
                      target_websites: shortlistedAccounts
                        .map((a) => a.website ?? (a.domain ? `https://${a.domain}` : null))
                        .filter(Boolean),
                      departments,
                      seniorities,
                      include_titles: splitCommaList(roleInput),
                      exclude_titles: splitCommaList(excludeInput),
                      max_pages_per_company: 3,
                    }
                  : liveProspeoFiltersPreview,
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      ) : (
        <section className="m3-artifact-section">
          <div className="m3-person-title-row">
            <h3>Active Buying Committee</h3>
            <MaterialButton
              variant="text"
              disabled={isWorking}
              onClick={() => setIsEditingCommittee(true)}
            >
              Edit buying committee
            </MaterialButton>
          </div>
          <md-chip-set aria-label="Active buying committee criteria">
            {departments.map((dept) => (
              <md-assist-chip key={`dept:${dept}`}>Dept: {dept}</md-assist-chip>
            ))}
            {seniorities.map((sen) => (
              <md-assist-chip key={`sen:${sen}`}>{sen}</md-assist-chip>
            ))}
            {personSearch.approvedRoles.slice(0, 6).map((role) => (
              <md-assist-chip key={`role:${role}`}>{role}</md-assist-chip>
            ))}
          </md-chip-set>
        </section>
      )}

      {personSearch?.failureMessage && personSearch.status === "requires_manual_review" && (
        <div className="m3-warning-callout" role="status">
          <strong>No automatic retry attempted</strong>
          <p>{personSearch.failureMessage}</p>
        </div>
      )}

      {previewRows.length > 0 && (
        <section className="m3-artifact-section">
          <h3>People cohort preview (click any row to inspect &amp; verify)</h3>
          <div className="m3-cohort-table-wrap">
            <table className="m3-cohort-table">
              <thead>
                <tr>
                  <th scope="col">Verify</th>
                  <th scope="col">Person</th>
                  <th scope="col">Job Title</th>
                  <th scope="col">Company</th>
                  <th scope="col">Source</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => {
                  const rawContact = contacts.find((c) => c.id === row.id);
                  const isChecked = effectiveSelectedIds.includes(row.id);
                  const isLocked =
                    row.verificationStatus === "verified" ||
                    row.verificationStatus === "running";
                  return (
                    <tr
                      key={row.id}
                      className="m3-cohort-row-clickable"
                      tabIndex={0}
                      onClick={() => onOpenPeopleArtifact?.(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenPeopleArtifact?.(row.id);
                        }
                      }}
                    >
                      <td onClick={(event) => event.stopPropagation()}>
                        <md-checkbox
                          aria-label={`Select ${row.fullName} for email verification`}
                          checked={isChecked || undefined}
                          disabled={isWorking || isLocked || undefined}
                          onChange={(event) => {
                            const target = event.currentTarget as unknown as {
                              checked?: boolean;
                            };
                            if (rawContact) {
                              handleCheckboxToggle(rawContact.id, Boolean(target.checked));
                            }
                          }}
                        />
                      </td>
                      <td>
                        <div className="m3-table-company-cell">
                          <strong>{row.fullName}</strong>
                          <span>
                            {row.bestEmail
                              ? `${row.bestEmail} (${row.emailSourceLabel})`
                              : `${row.department} · ${row.seniority}`}
                            {row.publicPhone ? ` · ${row.publicPhone}` : ""}
                          </span>
                        </div>
                      </td>
                      <td>{row.title}</td>
                      <td>{row.accountName}</td>
                      <td>{row.sourceLabel}</td>
                      <td>
                        <span className={`m3-status-badge status-${row.verificationStatus}`}>
                          {row.verificationStatus === "verified"
                            ? "Verified work email"
                            : row.publicEmail
                              ? row.publicEmailKind === "direct_public"
                                ? "Public website email"
                                : "Public website inbox"
                              : row.verificationStatus === "not_requested"
                                ? "Named only"
                                : row.verificationStatus.replaceAll("_", " ")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {contacts.length > 5 && (
            <p className="m3-helper-note">
              Showing top 5 of {contacts.length} decision-makers. Open the interactive people artifact to review, filter, and select from all {contacts.length}.
            </p>
          )}
        </section>
      )}

      <footer className="m3-artifact-footer">
        <div className="m3-action-row">
          {showCommitteeForm && (
            <MaterialButton
              variant={
                isWebsiteSelected || personSearch?.status !== "awaiting_approval"
                  ? "filled"
                  : "outlined"
              }
              disabled={isWorking || shortlistedAccounts.length === 0}
              onClick={() => {
                setIsEditingCommittee(false);
                const opts = buildActionOptions();
                if (isWebsiteSelected && onRunFreePeopleSearch) {
                  onRunFreePeopleSearch(opts);
                  return;
                }
                onProposeRoles({ providerKey, ...opts });
              }}
            >
              {isWorking
                ? isWebsiteSelected
                  ? "Scanning company websites…"
                  : "Preparing Prospeo preview…"
                : isWebsiteSelected && onRunFreePeopleSearch
                  ? contacts.length > 0
                    ? "Refresh website people"
                    : "Find decision-makers on websites"
                  : personSearch
                    ? "Refresh Prospeo preview"
                    : "Prepare Prospeo people preview"}
            </MaterialButton>
          )}

          {personSearch?.status === "awaiting_approval" && (
            <MaterialButton
              variant="filled"
              disabled={
                isWorking || (personSearch.providerKey === "prospeo" && !prospeoAvailable)
              }
              onClick={() => {
                if (personSearch.providerKey === "website_team") {
                  onApprovePersonSearch(personSearch.id);
                  return;
                }
                setConfirmApproveOpen(true);
              }}
            >
              {personSearch.providerKey === "website_team"
                ? "Run website team scan"
                : "Run Prospeo people search"}
            </MaterialButton>
          )}

          {contacts.length > 0 && onOpenPeopleArtifact && (
            <MaterialButton variant="tonal" onClick={() => onOpenPeopleArtifact(null)}>
              Open people artifact ({contacts.length} people)
            </MaterialButton>
          )}

          {onSuggestChanges && (
            <MaterialButton variant="outlined" onClick={() => onSuggestChanges()}>
              Suggest changes in chat
            </MaterialButton>
          )}

          {contacts.length > 0 && (
            <>
              <div className="m3-action-row" role="group" aria-label="Email verification provider">
                <MaterialButton
                  variant={verificationProvider === "prospeo" ? "tonal" : "outlined"}
                  disabled={isWorking}
                  onClick={() => setVerificationProvider("prospeo")}
                >
                  Prospeo Verify
                </MaterialButton>
                <MaterialButton
                  variant={verificationProvider === "dropcontact" ? "tonal" : "outlined"}
                  disabled={isWorking}
                  onClick={() => setVerificationProvider("dropcontact")}
                >
                  Dropcontact Verify
                </MaterialButton>
              </div>
              <MaterialButton
                variant="outlined"
                disabled={isWorking || effectiveSelectedIds.length === 0}
                onClick={() => onPrepareVerification(effectiveSelectedIds, verificationProvider)}
              >
                {`Find & verify emails (${effectiveSelectedIds.length})`}
              </MaterialButton>
            </>
          )}

          {shortlistedAccounts.length > 0 && (
            <MaterialButton variant="outlined" disabled={isWorking} onClick={onGeneratePlaybooks}>
              {peopleDiscovery.playbooks.length > 0
                ? "Refresh factual playbooks"
                : "Compile factual playbooks"}
            </MaterialButton>
          )}
        </div>
        {personSearch?.status === "awaiting_approval" &&
          personSearch.providerKey === "prospeo" &&
          !prospeoAvailable && (
            <p className="m3-helper-note">
              Add PROSPEO_KEY on the server before running a Prospeo person search, or switch to Website Team Pages above.
            </p>
          )}
      </footer>

      {personSearch && personSearch.providerKey === "prospeo" && (
        <ApprovalCard
          open={confirmApproveOpen}
          title="Run Prospeo people search?"
          body={`Searches up to 25 named buyers matching [${personSearch.approvedRoles.join(", ")}] across ${personSearch.shortlistedAccountNames.join(", ")}. Email verification runs separately.`}
          confirmLabel="Run people search"
          cancelLabel="Keep reviewing"
          isWorking={isWorking}
          onConfirm={() => {
            setConfirmApproveOpen(false);
            onApprovePersonSearch(personSearch.id);
          }}
          onCancel={() => setConfirmApproveOpen(false)}
        />
      )}
    </article>
  );
}

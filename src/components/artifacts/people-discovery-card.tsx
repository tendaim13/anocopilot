"use client";

import { useMemo, useState } from "react";

import type { CompanySearchView, ProspeoProviderState } from "@/lib/ano/company-discovery";
import type {
  DropcontactProviderState,
  PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import { ApprovalCard } from "@/components/conversation/approval-card";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";

export interface PeopleDiscoveryCardProps {
  companySearch: CompanySearchView | null;
  peopleDiscovery: PeopleDiscoveryView;
  prospeo: ProspeoProviderState | null;
  dropcontact: DropcontactProviderState | null;
  isWorking: boolean;
  onProposeRoles: (roleOverrides?: string[]) => void;
  onApprovePersonSearch: (personSearchId: string) => void;
  onPrepareVerification: (contactIds: string[]) => void;
  onGeneratePlaybooks: () => void;
}

function splitRoles(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function PeopleDiscoveryCard({
  companySearch,
  peopleDiscovery,
  prospeo,
  dropcontact,
  isWorking,
  onProposeRoles,
  onApprovePersonSearch,
  onPrepareVerification,
  onGeneratePlaybooks,
}: PeopleDiscoveryCardProps) {
  useMaterialWeb();

  const shortlistedAccounts = useMemo(
    () =>
      (companySearch?.accounts ?? []).filter(
        (account) => account.lifecycleState === "shortlisted",
      ),
    [companySearch?.accounts],
  );

  const personSearch = peopleDiscovery.personSearch;
  const contacts = peopleDiscovery.contacts;
  const [roleInput, setRoleInput] = useState(
    () => personSearch?.approvedRoles.join(", ") ?? "",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    contacts.filter((c) => c.selectedForVerification).map((c) => c.id),
  );
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);

  if (shortlistedAccounts.length === 0 && !personSearch) {
    return null;
  }

  const prospeoAvailable = prospeo?.available ?? false;
  const effectiveSelectedIds =
    selectedIds.length > 0
      ? selectedIds.filter((id) => contacts.some((c) => c.id === id))
      : contacts.filter((c) => c.selectedForVerification).map((c) => c.id);

  function toggleContact(contactId: string, checked: boolean) {
    setSelectedIds((prev) => {
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

  return (
    <article
      className="m3-artifact-card"
      aria-label="Phase E people and buyer role discovery"
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">PHASE E · PEOPLE & BUYER ROLES</p>
          <h2>
            {!personSearch
              ? "Propose buyer roles for shortlisted companies"
              : personSearch.status === "awaiting_approval"
                ? "Review buyer roles & 1-page person search"
                : personSearch.status === "running"
                  ? "Searching shortlisted companies for named people…"
                  : personSearch.status === "completed"
                    ? `${contacts.length} named buyer candidate${contacts.length === 1 ? "" : "s"} found`
                    : "Person search stopped safely for review"}
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
          ? personSearch.estimateDetail
          : "Ano proposes evidence-backed buyer personas for your shortlisted companies only. Named people are stored separately from verified contact details."}
      </p>

      <div className="m3-metric-strip">
        <div>
          <span>Shortlisted companies</span>
          <strong>{shortlistedAccounts.length}</strong>
        </div>
        <div>
          <span>Person search cap</span>
          <strong>1 page · max 25 people</strong>
        </div>
        <div>
          <span>Email verification</span>
          <strong>
            {dropcontact?.available ? "Dropcontact selective" : "Dropcontact key missing"}
          </strong>
        </div>
      </div>

      {(!personSearch || personSearch.status === "awaiting_approval") && (
        <div className="m3-inline-edit">
          <MaterialTextField
            label="Target buyer role titles (comma-separated)"
            value={roleInput}
            onValueChange={setRoleInput}
            placeholder="e.g. Managing Director, Operations Manager, Finance Controller"
            supportingText="Leave blank to derive role criteria directly from Phase C industry hypotheses."
            disabled={isWorking}
          />
        </div>
      )}

      {personSearch && (
        <section className="m3-artifact-section">
          <h3>Buyer role rationale & Prospeo filters</h3>
          <ul className="m3-claim-list">
            {personSearch.roleRecommendations.map((role) => (
              <li key={role.title}>
                <span className="m3-claim-pill">{role.title}</span>
                <span>{role.rationale}</span>
              </li>
            ))}
          </ul>
          <pre className="m3-json-preview" aria-label="Prospeo person search filters">
            {JSON.stringify({ page: 1, filters: personSearch.providerFilters }, null, 2)}
          </pre>
        </section>
      )}

      {personSearch?.failureMessage && personSearch.status === "requires_manual_review" && (
        <div className="m3-warning-callout" role="status">
          <strong>No automatic retry attempted</strong>
          <p>{personSearch.failureMessage}</p>
        </div>
      )}

      {contacts.length > 0 && (
        <section className="m3-artifact-section">
          <h3>
            Named candidates — select 1–10 people to preview Dropcontact verification
          </h3>
          <div className="m3-person-list">
            {contacts.map((contact) => {
              const isChecked = effectiveSelectedIds.includes(contact.id);
              const isLockedAfterVerify =
                contact.verificationStatus === "verified" ||
                contact.verificationStatus === "running";
              return (
                <div key={contact.id} className="m3-person-row">
                  <div className="m3-checkbox-wrap">
                    <md-checkbox
                      aria-label={`Select ${contact.fullName} for Dropcontact verification`}
                      checked={isChecked || undefined}
                      disabled={isWorking || isLockedAfterVerify || undefined}
                      onChange={(event) => {
                        const target = event.currentTarget as unknown as {
                          checked?: boolean;
                        };
                        toggleContact(contact.id, Boolean(target.checked));
                      }}
                    />
                  </div>
                  <div className="m3-person-meta">
                    <div className="m3-person-title-row">
                      <strong>{contact.fullName}</strong>
                      <span
                        className={`m3-status-badge status-${contact.verificationStatus}`}
                      >
                        {contact.verificationStatus === "not_requested"
                          ? "Named only"
                          : contact.verificationStatus.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p className="m3-helper-note">
                      {[contact.title, contact.accountName, contact.location]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {contact.verifiedDetails?.email ? (
                      <p className="m3-verified-contact-line">
                        Verified email: <strong>{contact.verifiedDetails.email}</strong>
                        {contact.verifiedDetails.emailQualification
                          ? ` (${contact.verifiedDetails.emailQualification})`
                          : ""}
                        {contact.verifiedDetails.phone
                          ? ` · Phone: ${contact.verifiedDetails.phone}`
                          : ""}
                      </p>
                    ) : (
                      <p className="m3-helper-note">
                        {contact.roleRationale ??
                          "No email or phone is stored until selective Dropcontact approval."}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <footer className="m3-artifact-footer">
        <div className="m3-action-row">
          {(!personSearch || personSearch.status === "awaiting_approval") && (
            <MaterialButton
              variant={personSearch ? "outlined" : "filled"}
              disabled={isWorking || shortlistedAccounts.length === 0}
              onClick={() => {
                const overrides = splitRoles(roleInput);
                onProposeRoles(overrides.length > 0 ? overrides : undefined);
              }}
            >
              {isWorking
                ? "Preparing role preview…"
                : personSearch
                  ? "Refresh role preview"
                  : "Propose buyer roles & preview (0 credits)"}
            </MaterialButton>
          )}

          {personSearch?.status === "awaiting_approval" && (
            <MaterialButton
              variant="filled"
              disabled={isWorking || !prospeoAvailable}
              onClick={() => setConfirmApproveOpen(true)}
            >
              Approve 1-page person search
            </MaterialButton>
          )}

          {contacts.length > 0 && (
            <MaterialButton
              variant="tonal"
              disabled={isWorking || effectiveSelectedIds.length === 0}
              onClick={() => onPrepareVerification(effectiveSelectedIds)}
            >
              {`Preview Dropcontact verification (${effectiveSelectedIds.length})`}
            </MaterialButton>
          )}

          {shortlistedAccounts.length > 0 && (
            <MaterialButton
              variant="outlined"
              disabled={isWorking}
              onClick={onGeneratePlaybooks}
            >
              {peopleDiscovery.playbooks.length > 0
                ? "Refresh factual playbooks"
                : "Compile factual playbooks"}
            </MaterialButton>
          )}
        </div>
        {personSearch?.status === "awaiting_approval" && !prospeoAvailable && (
          <p className="m3-helper-note">
            Add PROSPEO_KEY on the server before approving a Prospeo person search.
          </p>
        )}
      </footer>

      {personSearch && (
        <ApprovalCard
          open={confirmApproveOpen}
          title="Approve 1-page Prospeo person search?"
          body={`Searches up to 25 named buyers matching [${personSearch.approvedRoles.join(", ")}] across ${personSearch.shortlistedAccountNames.join(", ")} (max 1 credit). Contact email verification remains separate and unrun.`}
          confirmLabel="Approve 1-page person search"
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

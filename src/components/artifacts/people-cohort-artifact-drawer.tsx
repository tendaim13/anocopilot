"use client";

import { useEffect, useMemo, useState } from "react";

import type { ProspeoProviderState } from "@/lib/ano/company-discovery";
import {
  formatContactForCohortTable,
  type ContactCandidateView,
  type ContactVerificationProvider,
  type DropcontactProviderState,
  type PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import { downloadExportEndpoint } from "@/components/artifacts/lead-export-card";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialIconButton } from "@/components/material/material-icon-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";
import { CloseIcon } from "@/components/shell/ano-icons";

type PeopleDrawerFilter = "all" | "website_team" | "prospeo" | "selected" | "verified";

export interface PeopleCohortArtifactDrawerProps {
  open: boolean;
  conversationId?: string;
  peopleDiscovery: PeopleDiscoveryView | null;
  prospeo?: ProspeoProviderState | null;
  dropcontact?: DropcontactProviderState | null;
  initialSelectedContactId?: string | null;
  selectedContactIds: string[];
  isWorking: boolean;
  onClose: () => void;
  onToggleContact: (contactId: string, checked: boolean) => void;
  onPrepareVerification: (
    contactIds: string[],
    providerKey?: ContactVerificationProvider,
  ) => void;
  onSuggestChangesInChat: (prefill?: string) => void;
}

function verificationBadgeLabel(contact: ContactCandidateView) {
  if (contact.verificationStatus === "verified") return "Verified work email";
  if (contact.publicEmail) {
    return contact.publicEmailKind === "direct_public"
      ? "Public website email"
      : "Public website inbox";
  }
  if (contact.verificationStatus === "not_requested") return "Named only";
  return contact.verificationStatus.replaceAll("_", " ");
}

export function PeopleCohortArtifactDrawer({
  open,
  conversationId,
  peopleDiscovery,
  prospeo = null,
  dropcontact = null,
  initialSelectedContactId = null,
  selectedContactIds,
  isWorking,
  onClose,
  onToggleContact,
  onPrepareVerification,
  onSuggestChangesInChat,
}: PeopleCohortArtifactDrawerProps) {
  useMaterialWeb();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<PeopleDrawerFilter>("all");
  const verificationProvider: ContactVerificationProvider =
    peopleDiscovery?.verificationRun?.providerKey ??
    (prospeo?.available || !dropcontact?.available ? "prospeo" : "dropcontact");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    initialSelectedContactId,
  );

  useEffect(() => {
    if (open) {
      setSelectedContactId(initialSelectedContactId ?? null);
    }
  }, [open, initialSelectedContactId]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const contacts = useMemo(() => peopleDiscovery?.contacts ?? [], [peopleDiscovery?.contacts]);

  const counts = useMemo(
    () => ({
      all: contacts.length,
      website_team: contacts.filter(
        (c) => c.discoveryProvider === "website_team" || c.sourceKey.startsWith("website-team:"),
      ).length,
      prospeo: contacts.filter(
        (c) => c.discoveryProvider !== "website_team" && !c.sourceKey.startsWith("website-team:"),
      ).length,
      selected: contacts.filter((c) => selectedContactIds.includes(c.id)).length,
      verified: contacts.filter((c) => c.verificationStatus === "verified").length,
    }),
    [contacts, selectedContactIds],
  );

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return contacts
      .filter((contact) => {
        const isWebsite =
          contact.discoveryProvider === "website_team" ||
          contact.sourceKey.startsWith("website-team:");
        if (filterMode === "website_team" && !isWebsite) return false;
        if (filterMode === "prospeo" && isWebsite) return false;
        if (filterMode === "selected" && !selectedContactIds.includes(contact.id)) return false;
        if (filterMode === "verified" && contact.verificationStatus !== "verified") return false;
        if (!query) return true;
        const row = formatContactForCohortTable(contact);
        const haystack =
          `${row.fullName} ${row.title} ${row.department} ${row.seniority} ${row.accountName} ${row.sourceLabel}`.toLowerCase();
        return haystack.includes(query);
      })
      .map((contact) => ({
        contact,
        row: formatContactForCohortTable(contact),
      }));
  }, [contacts, filterMode, searchQuery, selectedContactIds]);

  const activeContact: ContactCandidateView | null =
    contacts.find((c) => c.id === selectedContactId) ?? null;

  if (!open || !peopleDiscovery) {
    return null;
  }

  const activeRow = activeContact ? formatContactForCohortTable(activeContact) : null;

  return (
    <div
      className="m3-artifact-drawer-root"
      role="dialog"
      aria-modal="true"
      aria-label="People cohort artifact"
    >
      <div className="m3-artifact-drawer-backdrop" onClick={onClose} aria-hidden="true" />

      <aside className="m3-artifact-drawer">
        <header className="m3-artifact-drawer-header">
          <div>
            <p className="m3-artifact-kicker">
              ARTIFACT ·{" "}
              {peopleDiscovery.personSearch?.providerKey === "website_team"
                ? "WEBSITE TEAM EXTRACTION"
                : "BUYING COMMITTEE PEOPLE"}
            </p>
            <h2>
              {contacts.length} decision-maker{contacts.length === 1 ? "" : "s"} across{" "}
              {peopleDiscovery.shortlistedCount} shortlisted compan
              {peopleDiscovery.shortlistedCount === 1 ? "y" : "ies"}
            </h2>
          </div>
          <div className="m3-action-row">
            {conversationId && contacts.length > 0 && (
              <MaterialButton
                variant="tonal"
                disabled={isWorking}
                onClick={() => {
                  const scope = filterMode === "verified" ? "verified_only" : "all";
                  void downloadExportEndpoint(
                    `/api/v1/conversations/${conversationId}/export?format=leads_csv&scope=${scope}`,
                    `ano-leads-${scope}.csv`,
                  );
                }}
              >
                Download Leads CSV
              </MaterialButton>
            )}
            <MaterialButton
              variant="outlined"
              onClick={() => {
                onClose();
                onSuggestChangesInChat();
              }}
            >
              Suggest role changes in chat
            </MaterialButton>
            <MaterialIconButton ariaLabel="Close people cohort artifact" onClick={onClose}>
              <CloseIcon />
            </MaterialIconButton>
          </div>
        </header>

        <div className="m3-artifact-drawer-body">
          {activeContact && activeRow ? (
            <div className="m3-drawer-detail-view">
              <div className="m3-action-row">
                <MaterialButton variant="outlined" onClick={() => setSelectedContactId(null)}>
                  ← Back to people list
                </MaterialButton>
                <MaterialButton
                  variant="text"
                  onClick={() => {
                    onClose();
                    onSuggestChangesInChat(
                      `What do you think of targeting ${activeContact.fullName} (${activeContact.title ?? "decision maker"} at ${activeContact.accountName})?`,
                    );
                  }}
                >
                  Ask Ano about {activeContact.fullName}
                </MaterialButton>
              </div>

              <article className="m3-artifact-card">
                <header className="m3-artifact-header">
                  <div>
                    <p className="m3-artifact-kicker">
                      {activeRow.sourceLabel.toUpperCase()} ·{" "}
                      {activeContact.confidence.toUpperCase()} ROLE CONFIDENCE
                    </p>
                    <h2>{activeContact.fullName}</h2>
                    <p className="m3-helper-note">
                      {[activeRow.title, activeRow.accountName, activeContact.location]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className={`m3-status-badge status-${activeContact.verificationStatus}`}>
                    {verificationBadgeLabel(activeContact)}
                  </span>
                </header>

                <div className="m3-metric-strip">
                  <div>
                    <span>Department</span>
                    <strong>{activeRow.department}</strong>
                  </div>
                  <div>
                    <span>Seniority</span>
                    <strong>{activeRow.seniority}</strong>
                  </div>
                  <div>
                    <span>Discovery source</span>
                    <strong>{activeRow.sourceLabel}</strong>
                  </div>
                </div>

                {activeContact.roleRationale && (
                  <section className="m3-reasoning-callout">
                    <strong>Buying-committee rationale</strong>
                    <p className="m3-helper-note">{activeContact.roleRationale}</p>
                  </section>
                )}

                <section className="m3-artifact-section">
                  <h3>Provenance &amp; contact verification</h3>
                  <div className="m3-action-row">
                    {activeContact.sourceUrl && (
                      <a
                        href={activeContact.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="m3-text-link"
                      >
                        View company source page ↗
                      </a>
                    )}
                    {activeContact.linkedInUrl && (
                      <a
                        href={activeContact.linkedInUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="m3-text-link"
                      >
                        LinkedIn profile ↗
                      </a>
                    )}
                  </div>
                  {activeContact.verifiedDetails?.email ? (
                    <p className="m3-verified-contact-line">
                      Verified work email:{" "}
                      <strong>{activeContact.verifiedDetails.email}</strong>
                      {activeContact.verifiedDetails.emailQualification
                        ? ` (${activeContact.verifiedDetails.emailQualification})`
                        : ""}
                      {activeContact.verifiedDetails.phone
                        ? ` · Phone: ${activeContact.verifiedDetails.phone}`
                        : ""}
                    </p>
                  ) : activeContact.publicEmail ? (
                    <p className="m3-verified-contact-line">
                      Public website email (
                      {activeContact.publicEmailKind === "direct_public"
                        ? "direct person match"
                        : "office inbox"}
                      ): <strong>{activeContact.publicEmail}</strong>
                      {activeContact.publicPhone ? ` · Phone: ${activeContact.publicPhone}` : ""}
                      {" "}— unverified until work email verification completes.
                    </p>
                  ) : (
                    <p className="m3-helper-note">
                      Named decision-maker only
                      {activeContact.publicPhone
                        ? ` (public website phone: ${activeContact.publicPhone})`
                        : ""}{" "}
                      — no email has been verified until you select contacts and run work email
                      verification.
                    </p>
                  )}
                </section>

                <footer className="m3-artifact-footer">
                  <div className="m3-action-row">
                    <MaterialButton
                      variant={selectedContactIds.includes(activeContact.id) ? "outlined" : "filled"}
                      disabled={
                        isWorking ||
                        activeContact.verificationStatus === "verified" ||
                        activeContact.verificationStatus === "running"
                      }
                      onClick={() =>
                        onToggleContact(
                          activeContact.id,
                          !selectedContactIds.includes(activeContact.id),
                        )
                      }
                    >
                      {selectedContactIds.includes(activeContact.id)
                        ? "Deselect from verification batch"
                        : "Select for email verification"}
                    </MaterialButton>
                  </div>
                </footer>
              </article>
            </div>
          ) : (
            <>
              <div className="m3-drawer-toolbar">
                <MaterialTextField
                  label="Filter decision-makers"
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder="Search by name, title, department, seniority, or company…"
                />
                <div className="m3-action-row" role="group" aria-label="People cohort filters">
                  {(
                    [
                      ["all", `All (${counts.all})`],
                      ["website_team", `Website (${counts.website_team})`],
                      ["prospeo", `Directory (${counts.prospeo})`],
                      ["selected", `Selected (${counts.selected})`],
                      ["verified", `Verified (${counts.verified})`],
                    ] as Array<[PeopleDrawerFilter, string]>
                  ).map(([value, label]) => (
                    <MaterialButton
                      key={value}
                      variant={filterMode === value ? "filled" : "outlined"}
                      onClick={() => setFilterMode(value)}
                    >
                      {label}
                    </MaterialButton>
                  ))}
                </div>
              </div>

              {filteredRows.length > 0 ? (
                <div className="m3-cohort-table-wrap">
                  <table className="m3-cohort-table">
                    <thead>
                      <tr>
                        <th scope="col">Verify</th>
                        <th scope="col">Person</th>
                        <th scope="col">Job Title</th>
                        <th scope="col">Dept / Seniority</th>
                        <th scope="col">Company</th>
                        <th scope="col">Source</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map(({ contact, row }) => {
                        const isChecked = selectedContactIds.includes(contact.id);
                        const isLocked =
                          contact.verificationStatus === "verified" ||
                          contact.verificationStatus === "running";
                        return (
                          <tr
                            key={row.id}
                            className="m3-cohort-row-clickable"
                            tabIndex={0}
                            onClick={() => setSelectedContactId(row.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedContactId(row.id);
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
                                  onToggleContact(contact.id, Boolean(target.checked));
                                }}
                              />
                            </td>
                            <td>
                              <div className="m3-table-company-cell">
                                <strong>{row.fullName}</strong>
                                <span>
                                  {row.bestEmail
                                    ? `${row.bestEmail} (${row.emailSourceLabel})`
                                    : row.accountDomain ?? "No email yet"}
                                  {row.publicPhone ? ` · ${row.publicPhone}` : ""}
                                </span>
                              </div>
                            </td>
                            <td>{row.title}</td>
                            <td>
                              {row.department} · {row.seniority}
                            </td>
                            <td>{row.accountName}</td>
                            <td onClick={(event) => event.stopPropagation()}>
                              {row.sourceUrl ? (
                                <a
                                  href={row.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="m3-text-link"
                                >
                                  Website ↗
                                </a>
                              ) : row.linkedInUrl ? (
                                <a
                                  href={row.linkedInUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="m3-text-link"
                                >
                                  LinkedIn ↗
                                </a>
                              ) : (
                                row.sourceLabel
                              )}
                            </td>
                            <td>
                              <span
                                className={`m3-status-badge status-${contact.verificationStatus}`}
                              >
                                {verificationBadgeLabel(contact)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="m3-muted-callout">
                  <strong>No people match the active filter</strong>
                  <p className="m3-helper-note">
                    Clear your search text or switch tabs, or click &ldquo;Suggest role changes in chat&rdquo; to refine your buying committee.
                  </p>
                </div>
              )}

              {selectedContactIds.length > 0 && (
                <div className="m3-action-row">
                  <MaterialButton
                    variant="filled"
                    disabled={isWorking}
                    onClick={() => {
                      onClose();
                      onPrepareVerification(selectedContactIds, verificationProvider);
                    }}
                  >
                    {`Verify selected emails (${selectedContactIds.length})`}
                  </MaterialButton>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

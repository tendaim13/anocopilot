"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  AccountCandidateDossier,
  AccountLifecycleState,
  CompanySearchView,
} from "@/lib/ano/company-discovery";
import { formatAccountForCohortTable } from "@/lib/ano/company-discovery";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import { AccountDossierCard } from "@/components/artifacts/account-dossier-card";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { MaterialIconButton } from "@/components/material/material-icon-button";
import { CloseIcon } from "@/components/shell/ano-icons";
import { useMaterialWeb } from "@/components/material/register";

type DrawerFilter = "all" | "shortlisted" | "held" | "discovered" | "dismissed";

export interface CompanyCohortArtifactDrawerProps {
  open: boolean;
  companySearch: CompanySearchView | null;
  synthesis?: MarketSynthesis | null;
  initialSelectedAccountId?: string | null;
  isWorking: boolean;
  onClose: () => void;
  onUpdateAccountState: (
    accountId: string,
    state: "shortlisted" | "held" | "dismissed",
  ) => void;
  onSuggestChangesInChat: (prefill?: string) => void;
}

function statusBadgeLabel(state: AccountLifecycleState) {
  if (state === "shortlisted") return "Shortlisted";
  if (state === "held" || state === "review") return "Held";
  if (state === "dismissed") return "Dismissed";
  return "Unreviewed";
}

function statusBadgeClass(state: AccountLifecycleState) {
  if (state === "shortlisted") return "status-approved";
  if (state === "held" || state === "review") return "status-awaiting_approval";
  if (state === "dismissed") return "status-declined";
  return "";
}

export function CompanyCohortArtifactDrawer({
  open,
  companySearch,
  synthesis = null,
  initialSelectedAccountId = null,
  isWorking,
  onClose,
  onUpdateAccountState,
  onSuggestChangesInChat,
}: CompanyCohortArtifactDrawerProps) {
  useMaterialWeb();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterState, setFilterState] = useState<DrawerFilter>("all");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    initialSelectedAccountId,
  );

  useEffect(() => {
    if (open) {
      setSelectedAccountId(initialSelectedAccountId ?? null);
    }
  }, [open, initialSelectedAccountId]);

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

  const accounts = useMemo(() => companySearch?.accounts ?? [], [companySearch?.accounts]);

  const counts = useMemo(
    () => ({
      all: accounts.length,
      shortlisted: accounts.filter((a) => a.lifecycleState === "shortlisted").length,
      held: accounts.filter(
        (a) => a.lifecycleState === "held" || a.lifecycleState === "review",
      ).length,
      discovered: accounts.filter((a) => a.lifecycleState === "discovered").length,
      dismissed: accounts.filter((a) => a.lifecycleState === "dismissed").length,
    }),
    [accounts],
  );

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return accounts
      .filter((account) => {
        if (filterState === "held") {
          if (account.lifecycleState !== "held" && account.lifecycleState !== "review") {
            return false;
          }
        } else if (filterState !== "all" && account.lifecycleState !== filterState) {
          return false;
        }
        if (!query) return true;
        const row = formatAccountForCohortTable(account);
        const haystack =
          `${row.name} ${row.specialisation} ${row.city} ${row.country} ${row.domain ?? ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .map((account) => ({
        account,
        row: formatAccountForCohortTable(account),
      }));
  }, [accounts, filterState, searchQuery]);

  const selectedAccount: AccountCandidateDossier | null =
    accounts.find((a) => a.id === selectedAccountId) ?? null;

  if (!open || !companySearch) {
    return null;
  }

  return (
    <div className="m3-artifact-drawer-root" role="dialog" aria-modal="true" aria-label="Company cohort artifact">
      <div className="m3-artifact-drawer-backdrop" onClick={onClose} aria-hidden="true" />

      <aside className="m3-artifact-drawer">
        <header className="m3-artifact-drawer-header">
          <div>
            <p className="m3-artifact-kicker">
              ARTIFACT · {companySearch.providerKey === "openstreetmap" ? "LOCAL BUSINESS COHORT" : "B2B DIRECTORY COHORT"}
            </p>
            <h2>
              {companySearch.targetMarketName} · {companySearch.accounts.length} companies
            </h2>
          </div>
          <div className="m3-action-row">
            <MaterialButton
              variant="outlined"
              onClick={() => {
                onClose();
                onSuggestChangesInChat();
              }}
            >
              Suggest changes in chat
            </MaterialButton>
            <MaterialIconButton ariaLabel="Close company cohort artifact" onClick={onClose}>
              <CloseIcon />
            </MaterialIconButton>
          </div>
        </header>

        <div className="m3-artifact-drawer-body">
          {selectedAccount ? (
            <div className="m3-drawer-detail-view">
              <div className="m3-action-row">
                <MaterialButton variant="outlined" onClick={() => setSelectedAccountId(null)}>
                  ← Back to company list
                </MaterialButton>
                <MaterialButton
                  variant="text"
                  onClick={() => {
                    onClose();
                    onSuggestChangesInChat(
                      `Tell me more about ${selectedAccount.name} and whether it fits our target customer profile.`,
                    );
                  }}
                >
                  Ask Ano about {selectedAccount.name}
                </MaterialButton>
              </div>
              <AccountDossierCard
                account={selectedAccount}
                synthesis={synthesis}
                targetMarketName={companySearch.targetMarketName}
                targetIndustryName={companySearch.targetIndustryName}
                isWorking={isWorking}
                onUpdateState={onUpdateAccountState}
              />
            </div>
          ) : (
            <>
              <div className="m3-drawer-toolbar">
                <MaterialTextField
                  label="Filter companies"
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder="Search by company, specialisation, city, country, or domain…"
                />
                <div className="m3-action-row" role="group" aria-label="Lifecycle filters">
                  {(
                    [
                      ["all", `All (${counts.all})`],
                      ["shortlisted", `Shortlisted (${counts.shortlisted})`],
                      ["held", `Held (${counts.held})`],
                      ["discovered", `Unreviewed (${counts.discovered})`],
                      ["dismissed", `Dismissed (${counts.dismissed})`],
                    ] as Array<[DrawerFilter, string]>
                  ).map(([value, label]) => (
                    <MaterialButton
                      key={value}
                      variant={filterState === value ? "filled" : "outlined"}
                      onClick={() => setFilterState(value)}
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
                        <th scope="col">Company</th>
                        <th scope="col">Specialisation</th>
                        <th scope="col">City</th>
                        <th scope="col">Country</th>
                        <th scope="col">Fit</th>
                        <th scope="col">Status</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map(({ account, row }) => (
                        <tr
                          key={row.id}
                          className="m3-cohort-row-clickable"
                          tabIndex={0}
                          onClick={() => setSelectedAccountId(row.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedAccountId(row.id);
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
                            <span
                              className={`m3-status-badge ${statusBadgeClass(account.lifecycleState)}`}
                            >
                              {statusBadgeLabel(account.lifecycleState)}
                            </span>
                          </td>
                          <td>
                            <div
                              className="m3-table-row-actions"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                className={`m3-row-action-btn${account.lifecycleState === "shortlisted" ? " is-active" : ""}`}
                                disabled={isWorking || account.lifecycleState === "shortlisted"}
                                onClick={() => onUpdateAccountState(row.id, "shortlisted")}
                              >
                                Shortlist
                              </button>
                              <button
                                type="button"
                                className="m3-row-action-btn"
                                disabled={isWorking || account.lifecycleState === "held"}
                                onClick={() => onUpdateAccountState(row.id, "held")}
                              >
                                Hold
                              </button>
                              <button
                                type="button"
                                className="m3-row-action-btn"
                                disabled={isWorking || account.lifecycleState === "dismissed"}
                                onClick={() => onUpdateAccountState(row.id, "dismissed")}
                              >
                                Dismiss
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="m3-muted-callout">
                  <strong>No companies match the active filter</strong>
                  <p className="m3-helper-note">
                    Clear your search text or switch tabs, or click &ldquo;Suggest changes in chat&rdquo; to refine the cohort.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

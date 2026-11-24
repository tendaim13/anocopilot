"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { LeadExportScope } from "@/lib/ano/lead-export";
import type { WorkspaceContactDirectoryItem } from "@/lib/ano/people-playbooks";
import { downloadExportEndpoint } from "@/components/artifacts/lead-export-card";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";
import { useAppShell } from "@/components/shell/app-shell";

type PeopleFilter = "all" | "verified" | "awaiting_approval" | "not_requested" | "unverified";

const FILTER_TABS: Array<{ value: PeopleFilter; label: string }> = [
  { value: "all", label: "All people" },
  { value: "verified", label: "Verified" },
  { value: "awaiting_approval", label: "Previewing" },
  { value: "not_requested", label: "Named only" },
  { value: "unverified", label: "Unverified" },
];

function PeopleContent() {
  useMaterialWeb();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shell = useAppShell();

  const rawState = searchParams.get("status");
  const filter: PeopleFilter =
    rawState === "verified" ||
    rawState === "awaiting_approval" ||
    rawState === "not_requested" ||
    rawState === "unverified"
      ? rawState
      : "all";

  const [contacts, setContacts] = useState<WorkspaceContactDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportScope, setExportScope] = useState<LeadExportScope>("with_email");
  const [exporting, setExporting] = useState(false);

  const loadPeople = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/people");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Ano could not load workspace people candidates.",
        );
      }
      setContacts(
        Array.isArray(payload?.contacts)
          ? (payload.contacts as WorkspaceContactDirectoryItem[])
          : [],
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Ano could not load workspace people candidates.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (shell?.mode === "supabase") {
      void loadPeople();
    } else {
      setContacts([]);
      setLoading(false);
    }
  }, [shell?.mode, loadPeople]);

  const counts = useMemo(
    () => ({
      all: contacts.length,
      verified: contacts.filter((c) => c.verificationStatus === "verified").length,
      awaiting_approval: contacts.filter((c) => c.verificationStatus === "awaiting_approval").length,
      not_requested: contacts.filter((c) => c.verificationStatus === "not_requested").length,
      unverified: contacts.filter((c) => c.verificationStatus === "unverified").length,
    }),
    [contacts],
  );

  const visibleContacts = useMemo(() => {
    if (filter === "all") return contacts;
    return contacts.filter((c) => c.verificationStatus === filter);
  }, [contacts, filter]);

  return (
    <section className="ano-section-page">
      <header className="ano-section-header">
        <div>
          <p className="ano-rail-kicker">PIPELINE · PHASE E / 9C</p>
          <h1>People &amp; contact export</h1>
          <p>
            Named buyers discovered for shortlisted companies alongside verified work email and
            public website email status. Verify contacts inside a thread or export a CSV.
          </p>
        </div>
        <div className="m3-action-row">
          {(
            [
              ["with_email", "With email"],
              ["verified_only", "Verified only"],
              ["all", "All leads"],
            ] as Array<[LeadExportScope, string]>
          ).map(([value, label]) => (
            <MaterialButton
              key={value}
              variant={exportScope === value ? "tonal" : "outlined"}
              disabled={exporting}
              onClick={() => setExportScope(value)}
            >
              {label}
            </MaterialButton>
          ))}
          <MaterialButton
            variant="filled"
            disabled={exporting || contacts.length === 0}
            onClick={() => {
              setExporting(true);
              setError(null);
              void downloadExportEndpoint(
                `/api/v1/people/export?scope=${exportScope}`,
                `ano-workspace-leads-${exportScope}.csv`,
              )
                .catch((err) => {
                  setError(
                    err instanceof Error ? err.message : "Ano could not export the leads CSV.",
                  );
                })
                .finally(() => setExporting(false));
            }}
          >
            {exporting ? "Exporting CSV…" : "Export Leads CSV"}
          </MaterialButton>
          <MaterialButton variant="outlined" onClick={() => router.push("/companies")}>
            View shortlisted companies
          </MaterialButton>
        </div>
      </header>

      <div className="ano-tabs-bar">
        <md-tabs
          aria-label="People verification filters"
          onChange={(event) => {
            const target = event.currentTarget as unknown as { activeTabIndex?: number };
            const tab = FILTER_TABS[target.activeTabIndex ?? 0] ?? FILTER_TABS[0];
            router.push(tab.value === "all" ? "/people" : `/people?status=${tab.value}`);
          }}
        >
          {FILTER_TABS.map((tab) => (
            <md-primary-tab
              key={tab.value}
              active={filter === tab.value}
              onClick={() =>
                router.push(tab.value === "all" ? "/people" : `/people?status=${tab.value}`)
              }
            >
              {tab.label} ({counts[tab.value]})
            </md-primary-tab>
          ))}
        </md-tabs>
      </div>

      {error && (
        <article className="ano-surface-card" role="alert">
          <strong>Could not load people</strong>
          <p>{error}</p>
        </article>
      )}

      {loading || shell?.loading ? (
        <article className="ano-surface-card">
          <p>Loading discovered workspace people…</p>
        </article>
      ) : visibleContacts.length > 0 ? (
        <div className="ano-queue-list">
          {visibleContacts.map((contact) => (
            <div key={contact.id} className="ano-company-directory-item">
              <div className="ano-company-source-bar">
                <span>
                  {contact.accountName} · {contact.targetMarketName} · {contact.targetIndustryName}
                </span>
                <Link href={`/research/${contact.conversationId}`} className="m3-text-link">
                  {contact.conversationTitle}
                </Link>
              </div>
              <article className="m3-artifact-card">
                <header className="m3-artifact-header">
                  <div>
                    <p className="m3-artifact-kicker">
                      PERSON RECORD · {contact.confidence.toUpperCase()} ROLE CONFIDENCE
                    </p>
                    <h2>{contact.fullName}</h2>
                    <p className="m3-helper-note">
                      {[contact.title, contact.accountName, contact.location]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className={`m3-status-badge status-${contact.verificationStatus}`}>
                    {contact.verificationStatus === "not_requested"
                      ? "Named only"
                      : contact.verificationStatus.replaceAll("_", " ")}
                  </span>
                </header>
                {contact.verifiedDetails?.email ? (
                  <p className="m3-verified-contact-line">
                    Verified work email:{" "}
                    <strong>{contact.verifiedDetails.email}</strong>
                    {contact.verifiedDetails.emailQualification
                      ? ` (${contact.verifiedDetails.emailQualification})`
                      : ""}
                    {contact.verifiedDetails.phone
                      ? ` · Phone: ${contact.verifiedDetails.phone}`
                      : ""}
                  </p>
                ) : contact.publicEmail ? (
                  <p className="m3-verified-contact-line">
                    Public website email (
                    {contact.publicEmailKind === "direct_public"
                      ? "direct match"
                      : "office inbox"}
                    ): <strong>{contact.publicEmail}</strong>
                    {contact.publicPhone ? ` · Phone: ${contact.publicPhone}` : ""}
                    {contact.sourceUrl ? (
                      <>
                        {" "}
                        <a
                          href={contact.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="m3-text-link"
                        >
                          Source page ↗
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="m3-helper-note">
                    {contact.roleRationale ??
                      (contact.discoveryProvider === "website_team" ||
                      contact.sourceKey.startsWith("website-team:")
                        ? "Named candidate from company website. Open the research thread to verify their work email."
                        : "Named candidate from B2B directory. Open the research thread to verify their work email.")}
                    {contact.publicPhone ? ` · Phone: ${contact.publicPhone}` : ""}
                    {contact.sourceUrl ? (
                      <>
                        {" "}
                        <a
                          href={contact.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="m3-text-link"
                        >
                          Source page ↗
                        </a>
                      </>
                    ) : null}
                  </p>
                )}
              </article>
            </div>
          ))}
        </div>
      ) : (
        <article className="ano-surface-card">
          <h2>
            {shell?.mode !== "supabase"
              ? "Sign in to inspect workspace people"
              : "No discovered buyer candidates yet"}
          </h2>
          <p>
            {shell?.mode !== "supabase"
              ? "Authenticate with your Ano workspace account to browse discovered people and verification receipts."
              : "Shortlist one or more companies, then propose buyer roles and approve a decision-maker search."}
          </p>
        </article>
      )}
    </section>
  );
}

export default function PeoplePage() {
  return (
    <Suspense
      fallback={
        <section className="ano-section-page">
          <p>Loading people directory…</p>
        </section>
      }
    >
      <PeopleContent />
    </Suspense>
  );
}

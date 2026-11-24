"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { WorkspaceAccountDirectoryItem } from "@/lib/ano/company-discovery";
import { AccountDossierCard } from "@/components/artifacts/account-dossier-card";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";
import { useAppShell } from "@/components/shell/app-shell";

type DirectoryFilter = "all" | "shortlisted" | "held" | "discovered" | "dismissed";

const FILTER_TABS: Array<{ value: DirectoryFilter; label: string }> = [
  { value: "all", label: "All companies" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "held", label: "Held" },
  { value: "discovered", label: "Unreviewed" },
  { value: "dismissed", label: "Dismissed" },
];

function CompaniesContent() {
  useMaterialWeb();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shell = useAppShell();

  const rawView = searchParams.get("state");
  const activeFilter: DirectoryFilter =
    rawView === "shortlisted" ||
    rawView === "held" ||
    rawView === "discovered" ||
    rawView === "dismissed"
      ? rawView
      : "all";

  const [accounts, setAccounts] = useState<WorkspaceAccountDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/companies");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Ano could not load workspace company candidates.",
        );
      }
      setAccounts(
        Array.isArray(payload?.accounts)
          ? (payload.accounts as WorkspaceAccountDirectoryItem[])
          : [],
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Ano could not load workspace company candidates.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (shell?.mode === "supabase") {
      void loadAccounts();
    } else {
      setAccounts([]);
      setLoading(false);
    }
  }, [shell?.mode, loadAccounts]);

  async function handleUpdateState(
    account: WorkspaceAccountDirectoryItem,
    nextState: "shortlisted" | "held" | "dismissed",
  ) {
    setWorkingId(account.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${account.conversationId}/accounts/${account.id}/state`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: nextState }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Ano could not update that company candidate.",
        );
      }
      setAccounts((prev) =>
        prev.map((item) =>
          item.id === account.id ? { ...item, lifecycleState: nextState } : item,
        ),
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Ano could not update that company candidate.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  const counts = useMemo(
    () => ({
      all: accounts.length,
      shortlisted: accounts.filter((item) => item.lifecycleState === "shortlisted").length,
      held: accounts.filter(
        (item) => item.lifecycleState === "held" || item.lifecycleState === "review",
      ).length,
      discovered: accounts.filter((item) => item.lifecycleState === "discovered").length,
      dismissed: accounts.filter((item) => item.lifecycleState === "dismissed").length,
    }),
    [accounts],
  );

  const visibleAccounts = useMemo(() => {
    if (activeFilter === "all") return accounts;
    if (activeFilter === "held") {
      return accounts.filter(
        (item) => item.lifecycleState === "held" || item.lifecycleState === "review",
      );
    }
    return accounts.filter((item) => item.lifecycleState === activeFilter);
  }, [accounts, activeFilter]);

  return (
    <section className="ano-section-page">
      <header className="ano-section-header">
        <div>
          <p className="ano-rail-kicker">PIPELINE · PHASE D</p>
          <h1>Companies directory</h1>
          <p>
            Signal-backed company candidates anchored to your locked Phase C target routes.
            Every dossier preserves retrieval provenance separately from industry claims.
          </p>
        </div>
        <MaterialButton variant="filled" onClick={() => router.push("/research")}>
          New research
        </MaterialButton>
      </header>

      <div className="ano-tabs-bar">
        <md-tabs
          aria-label="Company lifecycle filters"
          onChange={(event) => {
            const target = event.currentTarget as unknown as { activeTabIndex?: number };
            const tab = FILTER_TABS[target.activeTabIndex ?? 0] ?? FILTER_TABS[0];
            router.push(tab.value === "all" ? "/companies" : `/companies?state=${tab.value}`);
          }}
        >
          {FILTER_TABS.map((tab) => (
            <md-primary-tab
              key={tab.value}
              active={activeFilter === tab.value}
              onClick={() =>
                router.push(tab.value === "all" ? "/companies" : `/companies?state=${tab.value}`)
              }
            >
              {tab.label} ({counts[tab.value]})
            </md-primary-tab>
          ))}
        </md-tabs>
      </div>

      {error && (
        <article className="ano-surface-card" role="alert">
          <strong>Could not complete request</strong>
          <p>{error}</p>
        </article>
      )}

      {loading || shell?.loading ? (
        <article className="ano-surface-card">
          <p>Loading discovered workspace companies…</p>
        </article>
      ) : visibleAccounts.length > 0 ? (
        <div className="ano-queue-list">
          {visibleAccounts.map((account) => (
            <div key={account.id} className="ano-company-directory-item">
              <div className="ano-company-source-bar">
                <span>
                  Target route: <strong>{account.targetMarketName}</strong> ·{" "}
                  {account.targetIndustryName}
                </span>
                <Link href={`/research/${account.conversationId}`} className="m3-text-link">
                  {account.conversationTitle}
                </Link>
              </div>
              <AccountDossierCard
                account={account}
                targetMarketName={account.targetMarketName}
                targetIndustryName={account.targetIndustryName}
                isWorking={workingId === account.id}
                onUpdateState={(_accountId, nextState) => void handleUpdateState(account, nextState)}
              />
            </div>
          ))}
        </div>
      ) : (
        <article className="ano-surface-card">
          <h2>
            {shell?.mode !== "supabase"
              ? "Sign in to inspect discovered companies"
              : "No companies match this filter yet"}
          </h2>
          <p>
            {shell?.mode !== "supabase"
              ? "Authenticate with your Ano workspace account to preview and save company cohorts."
              : "Lock a target market and industry in any research thread, then approve a company discovery search."}
          </p>
        </article>
      )}
    </section>
  );
}

export default function CompaniesPage() {
  return (
    <Suspense
      fallback={
        <section className="ano-section-page">
          <p>Loading companies directory…</p>
        </section>
      }
    >
      <CompaniesContent />
    </Suspense>
  );
}

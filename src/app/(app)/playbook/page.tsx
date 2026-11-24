"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { WorkspacePlaybookDirectoryItem } from "@/lib/ano/people-playbooks";
import { PlaybookCard } from "@/components/artifacts/playbook-card";
import { MaterialButton } from "@/components/material/material-button";
import { useAppShell } from "@/components/shell/app-shell";

function PlaybooksContent() {
  const router = useRouter();
  const shell = useAppShell();

  const [playbooks, setPlaybooks] = useState<WorkspacePlaybookDirectoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlaybooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/playbooks");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Ano could not load workspace account playbooks.",
        );
      }
      setPlaybooks(
        Array.isArray(payload?.playbooks)
          ? (payload.playbooks as WorkspacePlaybookDirectoryItem[])
          : [],
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Ano could not load workspace account playbooks.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (shell?.mode === "supabase") {
      void loadPlaybooks();
    } else {
      setPlaybooks([]);
      setLoading(false);
    }
  }, [shell?.mode, loadPlaybooks]);

  return (
    <section className="ano-section-page">
      <header className="ano-section-header">
        <div>
          <p className="ano-rail-kicker">Playbooks</p>
          <h1>Factual account playbooks</h1>
          <p>
            Evidence-grounded account, industry, and buyer playbooks compiled exclusively from
            approved research claims, company signals, and verified or named buyer records.
          </p>
        </div>
        <MaterialButton variant="filled" onClick={() => router.push("/companies")}>
          View companies
        </MaterialButton>
      </header>

      {error && (
        <article className="ano-surface-card" role="alert">
          <strong>Could not load playbooks</strong>
          <p>{error}</p>
        </article>
      )}

      {loading || shell?.loading ? (
        <article className="ano-surface-card">
          <p>Loading factual account playbooks…</p>
        </article>
      ) : playbooks.length > 0 ? (
        <div className="ano-queue-list">
          {playbooks.map((playbook) => (
            <div key={playbook.id} className="ano-company-directory-item">
              <div className="ano-company-source-bar">
                <span>
                  {playbook.accountName} · {playbook.targetMarketName} ·{" "}
                  {playbook.targetIndustryName}
                </span>
                <Link href={`/research/${playbook.conversationId}`} className="m3-text-link">
                  {playbook.conversationTitle}
                </Link>
              </div>
              <PlaybookCard playbook={playbook} />
            </div>
          ))}
        </div>
      ) : (
        <article className="ano-surface-card">
          <h2>
            {shell?.mode !== "supabase"
              ? "Sign in to view account playbooks"
              : "No factual playbooks compiled yet"}
          </h2>
          <p>
            {shell?.mode !== "supabase"
              ? "Authenticate with your Ano workspace account to inspect factual sales playbooks."
              : "Shortlist an account and compile factual playbooks inside a research thread."}
          </p>
        </article>
      )}
    </section>
  );
}

export default function PlaybookPage() {
  return (
    <Suspense
      fallback={
        <section className="ano-section-page">
          <p>Loading playbooks…</p>
        </section>
      }
    >
      <PlaybooksContent />
    </Suspense>
  );
}

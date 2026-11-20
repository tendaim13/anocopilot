"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useMaterialWeb } from "@/components/material/register";
import { useAppShell } from "@/components/shell/app-shell";

function LibraryContent() {
  useMaterialWeb();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "briefs" ? "briefs" : "sources";
  const shell = useAppShell();
  const conversations = shell?.conversations ?? [];

  return (
    <section className="ano-section-page">
      <header className="ano-section-header">
        <div>
          <p className="ano-rail-kicker">LIBRARY</p>
          <h1>{view === "briefs" ? "Saved briefs & plans" : "Sources & research records"}</h1>
          <p>
            Read-only access to saved research conversations and source records. Opening a record
            never triggers duplicate provider calls.
          </p>
        </div>
      </header>

      <div className="ano-tabs-bar">
        <md-tabs
          aria-label="Library sections"
          onChange={(event) => {
            const target = event.currentTarget as unknown as { activeTabIndex?: number };
            router.push(target.activeTabIndex === 1 ? "/library?view=briefs" : "/library");
          }}
        >
          <md-primary-tab
            active={view === "sources"}
            onClick={() => router.push("/library")}
          >
            Sources
          </md-primary-tab>
          <md-primary-tab
            active={view === "briefs"}
            onClick={() => router.push("/library?view=briefs")}
          >
            Saved briefs ({conversations.length})
          </md-primary-tab>
        </md-tabs>
      </div>

      {shell?.loading ? (
        <article className="ano-surface-card">
          <p>Loading workspace library…</p>
        </article>
      ) : conversations.length > 0 ? (
        <div className="ano-queue-list">
          {conversations.map((item) => (
            <Link key={item.id} href={`/research/${item.id}`} className="ano-queue-row">
              <div>
                <strong>{item.title}</strong>
                <small>
                  Saved {new Date(item.createdAt).toLocaleDateString()} · Open conversation to
                  inspect saved sources and plans
                </small>
              </div>
              <md-assist-chip>{item.status.replaceAll("_", " ")}</md-assist-chip>
            </Link>
          ))}
        </div>
      ) : (
        <article className="ano-surface-card">
          <h2>No saved research records yet</h2>
          <p>
            {shell?.mode !== "supabase"
              ? "Sign in to access saved sources and briefs in your workspace."
              : "Saved sources, excerpts, and briefs appear here after you start a research conversation."}
          </p>
        </article>
      )}
    </section>
  );
}

export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <section className="ano-section-page">
          <p>Loading library…</p>
        </section>
      }
    >
      <LibraryContent />
    </Suspense>
  );
}

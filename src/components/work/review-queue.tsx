"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";
import { useAppShell } from "@/components/shell/app-shell";
import type { WorkQueueCategory } from "@/lib/ano/work-queue";

type CategoryFilter = "all" | Exclude<WorkQueueCategory, "active_running">;

const FILTER_OPTIONS: Array<{ value: CategoryFilter; label: string }> = [
  { value: "all", label: "All pending" },
  { value: "needs_clarification", label: "Clarifications" },
  { value: "plan_approval_required", label: "Plan approvals" },
  { value: "provider_scope_approval_required", label: "Provider & synthesis" },
  { value: "manual_review_required", label: "Manual review" },
  { value: "target_decision_required", label: "Target decisions" },
];

export function ReviewQueue() {
  useMaterialWeb();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shell = useAppShell();
  const view = searchParams.get("view") === "active" ? "active" : "review";
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  const workQueue = shell?.workQueue ?? {
    needsReviewCount: 0,
    activeResearchCount: 0,
    items: [],
  };

  const reviewItems = useMemo(
    () => workQueue.items.filter((item) => item.bucket === "needs_review"),
    [workQueue.items],
  );
  const activeItems = useMemo(
    () => workQueue.items.filter((item) => item.bucket === "active_research"),
    [workQueue.items],
  );

  const visibleItems = useMemo(() => {
    if (view === "active") return activeItems;
    if (categoryFilter === "all") return reviewItems;
    return reviewItems.filter((item) => item.category === categoryFilter);
  }, [view, activeItems, reviewItems, categoryFilter]);

  return (
    <section className="ano-section-page">
      <header className="ano-section-header">
        <div>
          <p className="ano-rail-kicker">WORK QUEUE</p>
          <h1>{view === "active" ? "Active research" : "Needs review"}</h1>
          <p>
            {view === "active"
              ? "Conversations actively running planning, public web discovery, or citation synthesis."
              : "Actionable clarifications, research plans, search scopes, manual reviews, and target decisions."}
          </p>
        </div>
        <MaterialButton variant="filled" onClick={() => router.push("/research")}>
          New research
        </MaterialButton>
      </header>

      <div className="ano-tabs-bar">
        <md-tabs
          aria-label="Work queue views"
          onChange={(event) => {
            const target = event.currentTarget as unknown as { activeTabIndex?: number };
            router.push(target.activeTabIndex === 1 ? "/work?view=active" : "/work");
          }}
        >
          <md-primary-tab
            active={view === "review"}
            onClick={() => router.push("/work")}
          >
            Needs review ({workQueue.needsReviewCount})
          </md-primary-tab>
          <md-primary-tab
            active={view === "active"}
            onClick={() => router.push("/work?view=active")}
          >
            Active research ({workQueue.activeResearchCount})
          </md-primary-tab>
        </md-tabs>
      </div>

      {view === "review" && reviewItems.length > 0 && (
        <md-chip-set aria-label="Filter pending review items">
          {FILTER_OPTIONS.map((option) => (
            <md-filter-chip
              key={option.value}
              selected={categoryFilter === option.value}
              onClick={() => setCategoryFilter(option.value)}
            >
              {option.label}
            </md-filter-chip>
          ))}
        </md-chip-set>
      )}

      {shell?.loading ? (
        <article className="ano-surface-card">
          <p>Loading durable workspace work queue…</p>
        </article>
      ) : visibleItems.length > 0 ? (
        <div className="ano-queue-list">
          {visibleItems.map((item) => (
            <Link key={item.id} href={`/research/${item.conversationId}`} className="ano-queue-row">
              <div>
                <strong>{item.conversationTitle}</strong>
                <small>
                  {item.detail} · Updated {new Date(item.updatedAt).toLocaleString()}
                </small>
              </div>
              <md-assist-chip>{item.label}</md-assist-chip>
            </Link>
          ))}
        </div>
      ) : (
        <article className="ano-surface-card">
          <h2>{view === "active" ? "No active research runs" : "Nothing waiting on your review"}</h2>
          <p>
            {shell?.mode !== "supabase"
              ? "Sign in to view durable workspace approvals and active runs."
              : view === "review" && categoryFilter !== "all"
                ? "No pending items match the selected filter."
                : "Start a new research conversation or open an existing thread from the sidebar."}
          </p>
        </article>
      )}
    </section>
  );
}

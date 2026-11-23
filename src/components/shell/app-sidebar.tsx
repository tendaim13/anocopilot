"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import type { GraphRunStatus, ResearchConversationSummary } from "@/lib/ano/research-conversation";
import { ConversationHistory } from "@/components/conversation/conversation-history";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialIconButton } from "@/components/material/material-icon-button";
import { useMaterialWeb } from "@/components/material/register";
import { AddIcon, CloseIcon } from "./ano-icons";

export interface AppSidebarProps {
  workspaceName: string;
  mode: "supabase" | "demo" | "unauthenticated";
  actorEmail?: string | null;
  onSignOut?: () => void;
  conversations: ResearchConversationSummary[];
  activeConversationId: string | null;
  needsReviewCount?: number;
  activeResearchCount?: number;
  hasMoreConversations?: boolean;
  loadingMoreConversations?: boolean;
  onLoadMoreConversations?: () => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  onNavigate?: () => void;
}

const NEEDS_REVIEW_STATUSES = new Set<GraphRunStatus>([
  "awaiting_context",
  "awaiting_plan_approval",
  "requires_manual_review",
]);

export function AppSidebar({
  workspaceName,
  mode,
  actorEmail = null,
  onSignOut,
  conversations,
  activeConversationId,
  needsReviewCount,
  activeResearchCount = 0,
  hasMoreConversations = false,
  loadingMoreConversations = false,
  onLoadMoreConversations,
  mobileOpen = false,
  onCloseMobile,
  onNavigate,
}: AppSidebarProps) {
  useMaterialWeb();
  const pathname = usePathname();
  const router = useRouter();

  const resolvedReviewCount =
    needsReviewCount ??
    conversations.filter((item) => NEEDS_REVIEW_STATUSES.has(item.status)).length;

  function navigateTo(href: string) {
    onNavigate?.();
    router.push(href);
  }

  return (
    <aside
      className={`ano-sidebar${mobileOpen ? " is-mobile-open" : ""}`}
      aria-label="Primary navigation"
    >
      <div className="ano-sidebar-brand">
        <Link href="/research" className="ano-brand-link" onClick={onNavigate}>
          <span className="ano-brand-mark" aria-hidden="true">
            ◖◗
          </span>
          <div>
            <strong>Ano</strong>
            <small>Sales copilot</small>
          </div>
        </Link>
        {onCloseMobile && (
          <div className="ano-sidebar-close">
            <MaterialIconButton ariaLabel="Close navigation drawer" onClick={onCloseMobile}>
              <CloseIcon />
            </MaterialIconButton>
          </div>
        )}
      </div>

      <div className="ano-sidebar-cta">
        <MaterialButton
          variant="filled"
          className="ano-new-research-btn"
          onClick={() => navigateTo("/research")}
        >
          <AddIcon />
          New research
        </MaterialButton>
      </div>

      <div className="ano-sidebar-scroll">
        <section className="ano-nav-group" aria-label="Research conversations">
          <p className="ano-nav-heading">Research</p>
          <ConversationHistory
            conversations={conversations}
            activeConversationId={activeConversationId}
            mode={mode}
            hasMore={hasMoreConversations}
            loadingMore={loadingMoreConversations}
            onSelectConversation={(id) => navigateTo(`/research/${id}`)}
            onLoadMore={onLoadMoreConversations}
          />
        </section>

        <nav className="ano-nav-group" aria-label="Work">
          <p className="ano-nav-heading">Work</p>
          <md-list className="ano-nav-list" aria-label="Work views">
            <md-list-item
              type="button"
              className={`ano-nav-list-item${pathname === "/work" ? " is-active" : ""}`}
              aria-current={pathname === "/work" ? "page" : undefined}
              onClick={() => navigateTo("/work")}
            >
              <span slot="headline">Needs review</span>
              {resolvedReviewCount > 0 && (
                <em slot="end" className="ano-nav-badge">{resolvedReviewCount}</em>
              )}
            </md-list-item>
            <md-list-item
              type="button"
              className="ano-nav-list-item"
              onClick={() => navigateTo("/work?view=active")}
            >
              <span slot="headline">Active research</span>
              {activeResearchCount > 0 && (
                <em slot="end" className="ano-nav-badge">{activeResearchCount}</em>
              )}
            </md-list-item>
          </md-list>
        </nav>

        <nav className="ano-nav-group" aria-label="Pipeline">
          <p className="ano-nav-heading">Pipeline</p>
          <md-list className="ano-nav-list" aria-label="Pipeline views">
            <md-list-item
              type="button"
              className={`ano-nav-list-item${pathname === "/companies" ? " is-active" : ""}`}
              aria-current={pathname === "/companies" ? "page" : undefined}
              onClick={() => navigateTo("/companies")}
            >
              <span slot="headline">Companies</span>
            </md-list-item>
            <md-list-item
              type="button"
              className={`ano-nav-list-item${pathname === "/people" ? " is-active" : ""}`}
              aria-current={pathname === "/people" ? "page" : undefined}
              onClick={() => navigateTo("/people")}
            >
              <span slot="headline">People</span>
            </md-list-item>
            <md-list-item
              type="button"
              className={`ano-nav-list-item${pathname === "/playbook" ? " is-active" : ""}`}
              aria-current={pathname === "/playbook" ? "page" : undefined}
              onClick={() => navigateTo("/playbook")}
            >
              <span slot="headline">Playbook</span>
            </md-list-item>
          </md-list>
        </nav>

        <nav className="ano-nav-group" aria-label="Library">
          <p className="ano-nav-heading">Library</p>
          <md-list className="ano-nav-list" aria-label="Library views">
            <md-list-item
              type="button"
              className={`ano-nav-list-item${pathname === "/library" ? " is-active" : ""}`}
              aria-current={pathname === "/library" ? "page" : undefined}
              onClick={() => navigateTo("/library")}
            >
              <span slot="headline">Sources</span>
            </md-list-item>
            <md-list-item
              type="button"
              className="ano-nav-list-item"
              onClick={() => navigateTo("/library?view=briefs")}
            >
              <span slot="headline">Saved briefs</span>
            </md-list-item>
          </md-list>
        </nav>

        <nav className="ano-nav-group" aria-label="System">
          <p className="ano-nav-heading">System</p>
          <md-list className="ano-nav-list" aria-label="System views">
            <md-list-item
              type="button"
              className={`ano-nav-list-item${pathname === "/settings" ? " is-active" : ""}`}
              aria-current={pathname === "/settings" ? "page" : undefined}
              onClick={() => navigateTo("/settings")}
            >
              <span slot="headline">Settings</span>
            </md-list-item>
          </md-list>
        </nav>
      </div>

      <div className="ano-sidebar-footer">
        <div className="ano-workspace-badge">
          <span className="ano-safe-dot" aria-hidden="true" />
          <div>
            <strong>{workspaceName}</strong>
            <small>{actorEmail ?? "Approval-gated workspace"}</small>
          </div>
        </div>
        {mode === "supabase" && onSignOut && (
          <button type="button" className="ano-sidebar-signout" onClick={onSignOut}>
            Sign out
          </button>
        )}
        {mode !== "supabase" && (
          <div className="ano-sidebar-auth-links">
            <Link href="/login" className="ano-sidebar-signin" onClick={onNavigate}>
              Sign in
            </Link>
            <Link href="/signup" className="ano-sidebar-signin" onClick={onNavigate}>
              Create account
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}

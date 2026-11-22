"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { WorkspaceIdentity } from "@/contracts/ano";
import type {
  CompanySearchView,
  ProspeoProviderState,
} from "@/lib/ano/company-discovery";
import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type {
  MercuryConnectorState,
  OutreachExecutionView,
} from "@/lib/ano/outreach-execution";
import type { OutreachTemplatePackView } from "@/lib/ano/outreach-templates";
import type {
  DropcontactProviderState,
  PeopleDiscoveryView,
} from "@/lib/ano/people-playbooks";
import type { ResearchConversationSummary, ResearchConversationView } from "@/lib/ano/research-conversation";
import type { WorkQueueSummary } from "@/lib/ano/work-queue";
import { ApprovalCard } from "@/components/conversation/approval-card";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialIconButton } from "@/components/material/material-icon-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";
import { AppSidebar } from "./app-sidebar";
import { ContextRail, type ShellProviderState } from "./context-rail";
import { MobileToolbar } from "./mobile-toolbar";
import { MoonIcon, PanelRightIcon, SunIcon } from "./ano-icons";

export type AnoThemeMode = "light" | "dark";
const THEME_STORAGE_KEY = "ano-theme";

export type ShellActiveContext = {
  conversation: ResearchConversationView | null;
  research: EvidenceResearchView | null;
  synthesis: MarketSynthesis | null;
  provider: ShellProviderState | null;
  companySearch?: CompanySearchView | null;
  prospeo?: ProspeoProviderState | null;
  peopleDiscovery?: PeopleDiscoveryView | null;
  dropcontact?: DropcontactProviderState | null;
  outreachExecution?: OutreachExecutionView | null;
  mercury?: MercuryConnectorState | null;
  templatePack?: OutreachTemplatePackView | null;
};

export type AppShellContextValue = {
  workspace: WorkspaceIdentity | null;
  mode: "supabase" | "demo" | "unauthenticated";
  conversations: ResearchConversationSummary[];
  workQueue: WorkQueueSummary;
  nextCursor: string | null;
  loadingMore: boolean;
  loading: boolean;
  refreshConversations: () => Promise<void>;
  loadMoreConversations: () => Promise<void>;
  activeContext: ShellActiveContext;
  setActiveContext: (context: ShellActiveContext) => void;
  contextRailOpen: boolean;
  setContextRailOpen: (open: boolean) => void;
  theme: AnoThemeMode;
  setTheme: (theme: AnoThemeMode) => void;
  toggleTheme: () => void;
};

const EMPTY_CONTEXT: ShellActiveContext = {
  conversation: null,
  research: null,
  synthesis: null,
  provider: null,
  companySearch: null,
  prospeo: null,
  peopleDiscovery: null,
  dropcontact: null,
  outreachExecution: null,
  mercury: null,
  templatePack: null,
};

const EMPTY_WORK_QUEUE: WorkQueueSummary = {
  needsReviewCount: 0,
  activeResearchCount: 0,
  items: [],
};

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShell() {
  return useContext(AppShellContext);
}

function sectionTitleForPath(pathname: string, conversationTitle?: string) {
  if (conversationTitle) return conversationTitle;
  if (pathname === "/research") return "New research";
  if (pathname.startsWith("/research/")) return "Research conversation";
  if (pathname === "/work") return "Work queue";
  if (pathname === "/companies") return "Companies";
  if (pathname === "/people") return "People";
  if (pathname === "/playbook") return "Playbooks";
  if (pathname === "/library") return "Library";
  if (pathname === "/settings") return "Settings";
  return "Ano workspace";
}

function statusBadgeLabel(context: ShellActiveContext) {
  const { conversation, research, synthesis, companySearch, peopleDiscovery, outreachExecution } = context;
  if (!conversation) return "Ready";
  if (outreachExecution?.proposals.some((p) => p.status === "awaiting_approval")) {
    return "Proposal approval";
  }
  if (outreachExecution?.proposals.some((p) => p.status === "executed")) {
    return "Outreach recorded";
  }
  if ((outreachExecution?.drafts.length ?? 0) > 0) return "Outreach drafts";
  if (peopleDiscovery?.playbooks && peopleDiscovery.playbooks.length > 0) return "Playbook ready";
  if (peopleDiscovery?.verificationRun?.status === "awaiting_approval") return "Dropcontact approval";
  if (peopleDiscovery?.verificationRun?.status === "running") return "Verifying contacts";
  if (peopleDiscovery?.verificationRun?.status === "completed") return "Contacts verified";
  if (peopleDiscovery?.personSearch?.status === "awaiting_approval") return "Person search approval";
  if (peopleDiscovery?.personSearch?.status === "running") return "Person search running";
  if (companySearch?.status === "completed") return "Company cohort ready";
  if (companySearch?.status === "running") return "Company search running";
  if (companySearch?.status === "awaiting_approval") return "Company search approval";
  if (
    companySearch?.status === "requires_manual_review" ||
    companySearch?.status === "failed_safe"
  ) {
    return "Company search review";
  }
  if (synthesis?.decision?.status === "locked") return "Target route locked";
  if (synthesis?.status === "ready_for_decision") return "Decision ready";
  if (synthesis?.status === "ready_for_review") return "Report ready";
  if (research?.run.status === "running") return "Research running";
  if (research?.run.status === "awaiting_provider_approval") return "Provider approval";
  if (research?.run.status === "sources_ready") return "Sources ready";
  if (research?.run.status === "requires_manual_review") return "Manual review";
  if (conversation.conversation.status === "awaiting_context") return "Awaiting answer";
  if (conversation.conversation.status === "awaiting_plan_approval") return "Plan review";
  if (conversation.plan?.approvalStatus === "approved") return "Plan approved";
  if (conversation.plan?.approvalStatus === "declined") return "Plan declined";
  return conversation.conversation.status.replaceAll("_", " ");
}

export function AppShell({ children }: { children: ReactNode }) {
  useMaterialWeb();
  const pathname = usePathname();
  const router = useRouter();
  const renameDialogRef = useRef<HTMLElement>(null);

  const [workspace, setWorkspace] = useState<WorkspaceIdentity | null>(null);
  const [mode, setMode] = useState<"supabase" | "demo" | "unauthenticated">("demo");
  const [conversations, setConversations] = useState<ResearchConversationSummary[]>([]);
  const [workQueue, setWorkQueue] = useState<WorkQueueSummary>(EMPTY_WORK_QUEUE);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [contextRailOpen, setContextRailOpen] = useState(false);
  const [theme, setThemeState] = useState<AnoThemeMode>("light");
  const [activeContext, setActiveContext] = useState<ShellActiveContext>(EMPTY_CONTEXT);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const activeConversationId = useMemo(() => {
    if (!pathname.startsWith("/research/")) return null;
    const segment = pathname.slice("/research/".length).split("/")[0];
    return segment || null;
  }, [pathname]);

  const refreshConversations = useCallback(async () => {
    try {
      const [workspaceRes, convRes, queueRes] = await Promise.all([
        fetch("/api/v1/workspace"),
        fetch("/api/v1/conversations?limit=25"),
        fetch("/api/v1/work-queue"),
      ]);
      const [workspacePayload, convPayload, queuePayload] = await Promise.all([
        workspaceRes.json().catch(() => null),
        convRes.json().catch(() => null),
        queueRes.json().catch(() => null),
      ]);

      if (
        workspaceRes.ok &&
        workspacePayload &&
        typeof workspacePayload === "object" &&
        "workspace" in workspacePayload
      ) {
        setWorkspace(workspacePayload.workspace as WorkspaceIdentity);
        setMode(workspacePayload.mode === "supabase" ? "supabase" : "demo");
      } else {
        setWorkspace(null);
        setMode("unauthenticated");
      }

      if (
        convRes.ok &&
        convPayload &&
        typeof convPayload === "object" &&
        "conversations" in convPayload &&
        Array.isArray(convPayload.conversations)
      ) {
        setConversations(convPayload.conversations as ResearchConversationSummary[]);
        setNextCursor(typeof convPayload.nextCursor === "string" ? convPayload.nextCursor : null);
      } else {
        setConversations([]);
        setNextCursor(null);
      }

      if (
        queueRes.ok &&
        queuePayload &&
        typeof queuePayload === "object" &&
        "workQueue" in queuePayload &&
        queuePayload.workQueue
      ) {
        setWorkQueue(queuePayload.workQueue as WorkQueueSummary);
      } else {
        setWorkQueue(EMPTY_WORK_QUEUE);
      }
    } catch {
      // Keep prior shell state if a background refresh fails transiently.
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreConversations = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/v1/conversations?cursor=${encodeURIComponent(nextCursor)}&limit=25`,
      );
      const payload = await response.json().catch(() => null);
      if (
        response.ok &&
        payload &&
        typeof payload === "object" &&
        "conversations" in payload &&
        Array.isArray(payload.conversations)
      ) {
        const nextItems = payload.conversations as ResearchConversationSummary[];
        setConversations((prev) => {
          const seen = new Set(prev.map((item) => item.id));
          return [...prev, ...nextItems.filter((item) => !seen.has(item.id))];
        });
        setNextCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem(THEME_STORAGE_KEY) : null;
    const initial: AnoThemeMode = stored === "dark" ? "dark" : "light";
    setThemeState(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  const setTheme = useCallback((nextTheme: AnoThemeMode) => {
    setThemeState(nextTheme);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = nextTheme;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: AnoThemeMode = prev === "dark" ? "light" : "dark";
      if (typeof document !== "undefined") {
        document.documentElement.dataset.theme = next;
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setMobileSidebarOpen(false);
    if (pathname.startsWith("/research/")) {
      setContextRailOpen(typeof window === "undefined" ? false : window.innerWidth >= 1120);
    } else {
      setContextRailOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSidebarOpen]);

  useEffect(() => {
    const dialog = renameDialogRef.current;
    if (!dialog) return;
    function handleClosed() {
      setRenameOpen(false);
      setRenameError(null);
    }
    dialog.addEventListener("closed", handleClosed);
    return () => dialog.removeEventListener("closed", handleClosed);
  }, []);

  function openRenameDialog() {
    if (!activeContext.conversation) return;
    setRenameTitle(activeContext.conversation.conversation.title);
    setRenameError(null);
    setRenameOpen(true);
  }

  async function submitRename() {
    const targetId = activeContext.conversation?.conversation.id;
    const trimmed = renameTitle.trim();
    if (!targetId || !trimmed) return;
    setRenameSaving(true);
    setRenameError(null);
    try {
      const response = await fetch(`/api/v1/conversations/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.conversation) {
        throw new Error(
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Ano could not rename this conversation.",
        );
      }
      setActiveContext((prev) => ({
        ...prev,
        conversation: payload.conversation as ResearchConversationView,
      }));
      setRenameOpen(false);
      void refreshConversations();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Ano could not rename this conversation.");
    } finally {
      setRenameSaving(false);
    }
  }

  async function confirmArchive() {
    const targetId = activeContext.conversation?.conversation.id;
    if (!targetId) return;
    setArchiving(true);
    try {
      const response = await fetch(`/api/v1/conversations/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (!response.ok) return;
      setArchiveOpen(false);
      setActiveContext(EMPTY_CONTEXT);
      await refreshConversations();
      router.push("/research");
    } finally {
      setArchiving(false);
    }
  }

  const headerTitle = sectionTitleForPath(pathname, activeContext.conversation?.conversation.title);
  const headerStatus = activeContext.conversation ? statusBadgeLabel(activeContext) : undefined;

  const value = useMemo<AppShellContextValue>(
    () => ({
      workspace,
      mode,
      conversations,
      workQueue,
      nextCursor,
      loadingMore,
      loading,
      refreshConversations,
      loadMoreConversations,
      activeContext,
      setActiveContext,
      contextRailOpen,
      setContextRailOpen,
      theme,
      setTheme,
      toggleTheme,
    }),
    [
      workspace,
      mode,
      conversations,
      workQueue,
      nextCursor,
      loadingMore,
      loading,
      refreshConversations,
      loadMoreConversations,
      activeContext,
      contextRailOpen,
      theme,
      setTheme,
      toggleTheme,
    ],
  );

  return (
    <AppShellContext.Provider value={value}>
      <div className="ano-app-shell">
        {mobileSidebarOpen && (
          <div
            className="ano-sidebar-backdrop"
            aria-hidden="true"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}

        <AppSidebar
          workspaceName={workspace?.name ?? "Ano workspace"}
          mode={mode}
          conversations={conversations}
          activeConversationId={activeConversationId}
          needsReviewCount={workQueue.needsReviewCount}
          activeResearchCount={workQueue.activeResearchCount}
          hasMoreConversations={Boolean(nextCursor)}
          loadingMoreConversations={loadingMore}
          onLoadMoreConversations={() => void loadMoreConversations()}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          onNavigate={() => setMobileSidebarOpen(false)}
        />

        <div className="ano-main-column">
          <MobileToolbar
            title={headerTitle}
            statusLabel={headerStatus}
            theme={theme}
            onToggleTheme={toggleTheme}
            onOpenSidebar={() => setMobileSidebarOpen(true)}
            onToggleContextRail={() => setContextRailOpen((open) => !open)}
            contextRailOpen={contextRailOpen}
          />

          <header className="ano-topbar">
            <div className="ano-topbar-title">
              <span className="ano-topbar-workspace">{workspace?.name ?? "Ano workspace"}</span>
              <span className="ano-topbar-sep" aria-hidden="true">/</span>
              <strong>{headerTitle}</strong>
            </div>

            <div className="ano-topbar-actions">
              {headerStatus && <span className="ano-status-pill">{headerStatus}</span>}
              {activeContext.conversation && mode === "supabase" && (
                <>
                  <MaterialButton variant="text" onClick={openRenameDialog}>
                    Rename
                  </MaterialButton>
                  <MaterialButton variant="text" onClick={() => setArchiveOpen(true)}>
                    Archive
                  </MaterialButton>
                </>
              )}
              {mode !== "supabase" && (
                <MaterialButton variant="outlined" onClick={() => router.push("/login")}>
                  Sign in
                </MaterialButton>
              )}
              <MaterialButton
                variant="outlined"
                ariaLabel={
                  theme === "dark" ? "Switch to orange and white light theme" : "Switch to black and grey dark theme"
                }
                onClick={toggleTheme}
              >
                {theme === "dark" ? <SunIcon slot="icon" /> : <MoonIcon slot="icon" />}
                {theme === "dark" ? "Light" : "Dark"}
              </MaterialButton>
              <MaterialIconButton
                ariaLabel={contextRailOpen ? "Hide research context" : "Show research context"}
                variant={contextRailOpen ? "filled" : "outlined"}
                toggle
                selected={contextRailOpen}
                ariaExpanded={contextRailOpen}
                onClick={() => setContextRailOpen((open) => !open)}
              >
                <PanelRightIcon />
              </MaterialIconButton>
            </div>
          </header>

          <div className="ano-body-row">
            <main className="ano-main-scroll">{children}</main>
            <ContextRail
              open={contextRailOpen}
              onClose={() => setContextRailOpen(false)}
              conversation={activeContext.conversation}
              research={activeContext.research}
              synthesis={activeContext.synthesis}
              provider={activeContext.provider}
              companySearch={activeContext.companySearch}
              prospeo={activeContext.prospeo}
              peopleDiscovery={activeContext.peopleDiscovery}
              dropcontact={activeContext.dropcontact}
              outreachExecution={activeContext.outreachExecution}
              mercury={activeContext.mercury}
              templatePack={activeContext.templatePack}
            />
          </div>
        </div>

        <md-dialog ref={renameDialogRef} open={renameOpen || undefined}>
          <div slot="headline">Rename conversation</div>
          <div slot="content" className="ano-dialog-body">
            <MaterialTextField
              label="Conversation title"
              value={renameTitle}
              onValueChange={setRenameTitle}
              maxLength={160}
              disabled={renameSaving}
            />
            {renameError && (
              <p className="ano-dialog-error" role="alert">
                {renameError}
              </p>
            )}
          </div>
          <div slot="actions">
            <MaterialButton
              variant="text"
              disabled={renameSaving}
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </MaterialButton>
            <MaterialButton
              variant="filled"
              disabled={renameSaving || !renameTitle.trim()}
              onClick={() => void submitRename()}
            >
              {renameSaving ? "Saving…" : "Save"}
            </MaterialButton>
          </div>
        </md-dialog>

        <ApprovalCard
          open={archiveOpen}
          title="Archive this research conversation?"
          body="Archiving hides this conversation from the active sidebar while preserving its audit trail, saved sources, and provider receipts."
          confirmLabel="Archive conversation"
          isWorking={archiving}
          onConfirm={() => void confirmArchive()}
          onCancel={() => setArchiveOpen(false)}
        />
      </div>
    </AppShellContext.Provider>
  );
}

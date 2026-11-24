"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AutopilotExecutableStage, AutopilotRunView } from "@/lib/ano/autopilot";
import type {
  CompanySearchView,
  ProspeoProviderState,
} from "@/lib/ano/company-discovery";
import type { EvidenceResearchView, ResearchProviderKey } from "@/lib/ano/evidence-research";
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
import type { ResearchConversationView } from "@/lib/ano/research-conversation";
import { ConversationComposer } from "@/components/conversation/conversation-composer";
import { ConversationThread } from "@/components/conversation/conversation-thread";
import { useAppShell } from "@/components/shell/app-shell";

type WorkspaceState = {
  workspace: { name: string };
  mode: "supabase" | "demo";
};

type ResearchProviderState = {
  provider: ResearchProviderKey;
  available: boolean;
  maximumSearches: number;
  maximumFetches: number;
  pricingNote: string;
};

export interface ResearchConversationWorkbenchProps {
  conversationId?: string;
  embeddedInShell?: boolean;
}

function errorText(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

export function ResearchConversationWorkbench({
  conversationId,
  embeddedInShell = false,
}: ResearchConversationWorkbenchProps = {}) {
  const router = useRouter();
  const shell = useAppShell();
  const setShellContext = shell?.setActiveContext;
  const setContextRailOpen = shell?.setContextRailOpen;
  const refreshShellConversations = shell?.refreshConversations;

  const [conversation, setConversation] = useState<ResearchConversationView | null>(null);
  const [research, setResearch] = useState<EvidenceResearchView | null>(null);
  const [synthesis, setSynthesis] = useState<MarketSynthesis | null>(null);
  const [provider, setProvider] = useState<ResearchProviderState | null>(null);
  const [companySearch, setCompanySearch] = useState<CompanySearchView | null>(null);
  const [prospeo, setProspeo] = useState<ProspeoProviderState | null>(null);
  const [peopleDiscovery, setPeopleDiscovery] = useState<PeopleDiscoveryView | null>(null);
  const [dropcontact, setDropcontact] = useState<DropcontactProviderState | null>(null);
  const [outreachExecution, setOutreachExecution] = useState<OutreachExecutionView | null>(null);
  const [mercury, setMercury] = useState<MercuryConnectorState | null>(null);
  const [templatePack, setTemplatePack] = useState<OutreachTemplatePackView | null>(null);
  const [autopilotRun, setAutopilotRun] = useState<AutopilotRunView | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [marketChoice, setMarketChoice] = useState("");
  const [industryChoice, setIndustryChoice] = useState("");
  const autoStartedConversationRef = useRef<string | null>(null);
  const lastRetryActionRef = useRef<(() => Promise<void>) | null>(null);

  async function loadResearch(targetConversationId: string) {
    try {
      const response = await fetch(`/api/v1/conversations/${targetConversationId}/research-run`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "Ano could not load the public-research record."));
      }
      setResearch((payload.research ?? null) as EvidenceResearchView | null);
      setProvider((payload.provider ?? null) as ResearchProviderState | null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Ano could not load the public-research record.",
      );
    }
  }

  async function loadSynthesis(targetConversationId: string) {
    try {
      const response = await fetch(`/api/v1/conversations/${targetConversationId}/market-synthesis`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "Ano could not load the saved market findings."));
      }
      setSynthesis((payload.synthesis ?? null) as MarketSynthesis | null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Ano could not load the saved market findings.",
      );
    }
  }

  useEffect(() => {
    if (!embeddedInShell) {
      let cancelled = false;
      Promise.all([
        fetch("/api/v1/workspace").then(async (response) => ({
          response,
          payload: await response.json(),
        })),
        fetch("/api/v1/conversations").then(async (response) => ({
          response,
          payload: await response.json(),
        })),
      ])
        .then(([workspaceResult, conversationResult]) => {
          if (cancelled) return;
          if (
            workspaceResult.response.ok &&
            workspaceResult.payload &&
            "workspace" in workspaceResult.payload
          ) {
            setWorkspace(workspaceResult.payload as WorkspaceState);
          }
          if (
            conversationResult.response.ok &&
            conversationResult.payload &&
            "conversation" in conversationResult.payload
          ) {
            const nextConversation = conversationResult.payload
              .conversation as ResearchConversationView | null;
            setConversation(nextConversation);
            if (nextConversation) {
              void loadResearch(nextConversation.conversation.id);
              void loadSynthesis(nextConversation.conversation.id);
            }
          }
          if (!conversationResult.response.ok) {
            setError(
              errorText(
                conversationResult.payload,
                "Ano could not load your research conversation.",
              ),
            );
          }
        })
        .catch(() => {
          if (!cancelled) {
            setError("Ano could not reach the workspace. Refresh and try again.");
          }
        });
      return () => {
        cancelled = true;
      };
    }

    setConversation(null);
    setResearch(null);
    setSynthesis(null);
    setProvider(null);
    setCompanySearch(null);
    setProspeo(null);
    setPeopleDiscovery(null);
    setDropcontact(null);
    setOutreachExecution(null);
    setMercury(null);
    setTemplatePack(null);
    setAutopilotRun(null);
    autoStartedConversationRef.current = null;
    lastRetryActionRef.current = null;
    setPendingUserMessage(null);
    setError(null);
    setDraft("");
    setMarketChoice("");
    setIndustryChoice("");

    if (!conversationId) {
      return;
    }

    let cancelled = false;
    fetch(`/api/v1/conversations/${conversationId}`)
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if (!response.ok) {
          setError(errorText(payload, "Ano could not load your research conversation."));
          return;
        }
        const record =
          payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
        const nextConversation = ("conversation" in record
          ? record.conversation
          : null) as ResearchConversationView | null;
        setConversation(nextConversation);

        if ("research" in record) {
          setResearch((record.research ?? null) as EvidenceResearchView | null);
        } else if (nextConversation) {
          void loadResearch(nextConversation.conversation.id);
        }

        if ("synthesis" in record) {
          setSynthesis((record.synthesis ?? null) as MarketSynthesis | null);
        } else if (nextConversation) {
          void loadSynthesis(nextConversation.conversation.id);
        }

        if ("provider" in record) {
          setProvider((record.provider ?? null) as ResearchProviderState | null);
        }

        if ("companySearch" in record) {
          setCompanySearch((record.companySearch ?? null) as CompanySearchView | null);
        }

        if ("prospeo" in record) {
          setProspeo((record.prospeo ?? null) as ProspeoProviderState | null);
        }

        if ("peopleDiscovery" in record) {
          setPeopleDiscovery((record.peopleDiscovery ?? null) as PeopleDiscoveryView | null);
        }

        if ("dropcontact" in record) {
          setDropcontact((record.dropcontact ?? null) as DropcontactProviderState | null);
        }

        if ("outreachExecution" in record) {
          setOutreachExecution((record.outreachExecution ?? null) as OutreachExecutionView | null);
        }

        if ("mercury" in record) {
          setMercury((record.mercury ?? null) as MercuryConnectorState | null);
        }

        if ("templatePack" in record) {
          setTemplatePack((record.templatePack ?? null) as OutreachTemplatePackView | null);
        }

        if ("autopilotRun" in record) {
          setAutopilotRun((record.autopilotRun ?? null) as AutopilotRunView | null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Ano could not reach the workspace. Refresh and try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, embeddedInShell]);

  useEffect(() => {
    if (!embeddedInShell || !setShellContext) return;
    setShellContext({
      conversation,
      research,
      synthesis,
      provider,
      companySearch,
      prospeo,
      peopleDiscovery,
      dropcontact,
      outreachExecution,
      mercury,
      templatePack,
    });
  }, [
    embeddedInShell,
    setShellContext,
    conversation,
    research,
    synthesis,
    provider,
    companySearch,
    prospeo,
    peopleDiscovery,
    dropcontact,
    outreachExecution,
    mercury,
    templatePack,
  ]);

  useEffect(() => {
    if (!embeddedInShell || !setShellContext) return;
    return () => {
      setShellContext({
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
      });
    };
  }, [embeddedInShell, setShellContext]);

  useEffect(() => {
    const activeId = conversation?.conversation.id;
    if (!activeId || research?.run.status !== "running") return;
    const poll = window.setInterval(() => {
      void loadResearch(activeId);
    }, 5_000);
    return () => window.clearInterval(poll);
  }, [conversation?.conversation.id, research?.run.status]);

  const shellSyncedTitle =
    embeddedInShell && conversationId
      ? shell?.conversations.find((item) => item.id === conversationId)?.title
      : undefined;

  useEffect(() => {
    if (!shellSyncedTitle) return;
    setConversation((prev) =>
      prev && prev.conversation.title !== shellSyncedTitle
        ? { ...prev, conversation: { ...prev.conversation, title: shellSyncedTitle } }
        : prev,
    );
  }, [shellSyncedTitle]);

  const startAutopilot = useCallback(
    async (targetConversationId: string, fromStage?: AutopilotExecutableStage) => {
      try {
        const response = await fetch(
          `/api/v1/conversations/${targetConversationId}/autopilot/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fromStage ? { fromStage } : {}),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(errorText(payload, "Ano could not start autopilot."));
          return;
        }
        if (payload && typeof payload === "object" && "autopilotRun" in payload) {
          setAutopilotRun((payload.autopilotRun ?? null) as AutopilotRunView | null);
        }
      } catch {
        setError("Ano could not reach the server to start autopilot.");
      }
    },
    [],
  );

  const pauseAutopilot = useCallback(async () => {
    if (!conversation) return;
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/autopilot/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "paused" }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(errorText(payload, "Ano could not pause autopilot cleanly."));
        return;
      }
      if (payload && typeof payload === "object" && "autopilotRun" in payload) {
        setAutopilotRun((payload.autopilotRun ?? null) as AutopilotRunView | null);
      }
    } catch {
      setError("Ano could not pause autopilot cleanly.");
    }
  }, [conversation]);

  const resumeAutopilot = useCallback(async () => {
    if (!conversation) return;
    setError(null);
    await startAutopilot(conversation.conversation.id);
  }, [conversation, startAutopilot]);

  const activeMode = embeddedInShell ? shell?.mode : workspace?.mode;
  const needsSignIn = Boolean(
    error?.toLowerCase().includes("sign in") ||
      error?.toLowerCase().includes("workspace") ||
      activeMode === "demo" ||
      activeMode === "unauthenticated",
  );

  useEffect(() => {
    const activeId = conversation?.conversation.id;
    if (
      !activeId ||
      needsSignIn ||
      autopilotRun ||
      research ||
      synthesis ||
      !conversation?.brief?.intakeComplete ||
      conversation?.plan?.approvalStatus !== "approved" ||
      autoStartedConversationRef.current === activeId
    ) {
      return;
    }
    autoStartedConversationRef.current = activeId;
    void startAutopilot(activeId);
  }, [
    conversation?.conversation.id,
    conversation?.brief?.intakeComplete,
    conversation?.plan?.approvalStatus,
    autopilotRun,
    research,
    synthesis,
    needsSignIn,
    startAutopilot,
  ]);

  useEffect(() => {
    const activeId = conversation?.conversation.id;
    if (!activeId || autopilotRun?.status !== "running") return;

    let cancelled = false;
    async function runLoop() {
      while (!cancelled) {
        try {
          const response = await fetch(`/api/v1/conversations/${activeId}/autopilot/step`, {
            method: "POST",
          });
          const payload = await response.json().catch(() => ({}));
          if (cancelled) return;
          if (!response.ok) {
            lastRetryActionRef.current = () => resumeAutopilot();
            setError(errorText(payload, "Ano paused the autonomous pipeline cleanly."));
            return;
          }
          const record =
            payload && typeof payload === "object"
              ? (payload as Record<string, unknown>)
              : {};

          if ("autopilotRun" in record) {
            setAutopilotRun((record.autopilotRun ?? null) as AutopilotRunView | null);
          }
          if ("conversation" in record && record.conversation) {
            setConversation(record.conversation as ResearchConversationView);
          }
          if ("research" in record) {
            setResearch((record.research ?? null) as EvidenceResearchView | null);
          }
          if ("synthesis" in record) {
            setSynthesis((record.synthesis ?? null) as MarketSynthesis | null);
          }
          if ("companySearch" in record) {
            setCompanySearch((record.companySearch ?? null) as CompanySearchView | null);
          }
          if ("peopleDiscovery" in record) {
            setPeopleDiscovery((record.peopleDiscovery ?? null) as PeopleDiscoveryView | null);
          }
          if ("templatePack" in record) {
            setTemplatePack((record.templatePack ?? null) as OutreachTemplatePackView | null);
          }

          const nextRun = ("autopilotRun" in record
            ? record.autopilotRun
            : null) as AutopilotRunView | null;
          if (!nextRun || nextRun.status !== "running") {
            if (embeddedInShell) void refreshShellConversations?.();
            return;
          }

          if (record.skippedBecauseInFlight === true) {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 2_500);
            });
          }
        } catch {
          if (!cancelled) {
            setError(
              "Connection interrupted while stepping autopilot. Click Resume autopilot to continue.",
            );
          }
          return;
        }
      }
    }

    void runLoop();
    return () => {
      cancelled = true;
    };
  }, [
    conversation?.conversation.id,
    autopilotRun?.status,
    embeddedInShell,
    refreshShellConversations,
  ]);

  const activeMarketId = marketChoice || synthesis?.markets[0]?.id || "";
  const selectableIndustries =
    synthesis?.industries.filter(
      (industry) => !industry.marketProfileId || industry.marketProfileId === activeMarketId,
    ) ?? [];
  const activeIndustryId = industryChoice || selectableIndustries[0]?.id || "";

  async function request(url: string, body: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok || !payload.conversation) {
      throw new Error(errorText(payload, "Ano could not save that response."));
    }
    return payload.conversation as ResearchConversationView;
  }

  async function start(input: { message: string; files: File[]; urls: string[] }) {
    setIsWorking(true);
    setError(null);
    const attachmentLabels = [
      ...input.files.map((f) => f.name),
      ...input.urls,
    ];
    const optimisticLabel =
      input.message ||
      (attachmentLabels.length > 0
        ? `Analyze my attached product source(s): ${attachmentLabels.join(", ")}`
        : "");
    setPendingUserMessage(optimisticLabel);
    setDraft("");
    setPendingFiles([]);
    setPendingUrls([]);
    try {
      let created: ResearchConversationView;
      if (input.files.length > 0) {
        const form = new FormData();
        if (input.message) form.append("message", input.message);
        for (const file of input.files) {
          form.append("files", file);
        }
        if (input.urls.length > 0) {
          form.append("urls", JSON.stringify(input.urls));
        }
        const response = await fetch("/api/v1/conversations", {
          method: "POST",
          headers: {
            "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
          },
          body: form,
        });
        const payload = await response.json();
        if (!response.ok || !payload.conversation) {
          throw new Error(errorText(payload, "Ano could not begin the conversation."));
        }
        created = payload.conversation as ResearchConversationView;
      } else {
        created = await request("/api/v1/conversations", {
          message: input.message,
          ...(input.urls.length > 0 ? { urls: input.urls } : {}),
        });
      }
      setPendingUserMessage(null);
      setConversation(created);
      lastRetryActionRef.current = null;
      if (created.brief?.intakeComplete && created.plan?.approvalStatus === "approved") {
        autoStartedConversationRef.current = created.conversation.id;
        await startAutopilot(created.conversation.id);
      }
      if (embeddedInShell) {
        void refreshShellConversations?.();
        router.push(`/research/${created.conversation.id}`);
      }
    } catch (requestError) {
      setPendingUserMessage(null);
      setDraft(input.message);
      setPendingFiles(input.files);
      setPendingUrls(input.urls);
      lastRetryActionRef.current = () => start(input);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not begin the conversation.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function uploadPendingSources(
    targetConversationId: string,
    files: File[],
    urls: string[],
  ) {
    let latestSources = conversation?.productSources ?? [];
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(
        `/api/v1/conversations/${targetConversationId}/product-sources`,
        { method: "POST", body: form },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, `Ano could not read "${file.name}".`));
      }
      if (Array.isArray(payload.productSources)) {
        latestSources = payload.productSources;
      }
    }
    for (const url of urls) {
      const response = await fetch(
        `/api/v1/conversations/${targetConversationId}/product-sources`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, `Ano could not read "${url}".`));
      }
      if (Array.isArray(payload.productSources)) {
        latestSources = payload.productSources;
      }
    }
    setConversation((prev) => (prev ? { ...prev, productSources: latestSources } : prev));
  }

  async function removeSavedSource(sourceId: string) {
    if (!conversation || isWorking) return;
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/product-sources?sourceId=${encodeURIComponent(sourceId)}`,
        { method: "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "Ano could not remove that product source."));
      }
      if (Array.isArray(payload.productSources)) {
        setConversation((prev) =>
          prev ? { ...prev, productSources: payload.productSources } : prev,
        );
      }
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Ano could not remove that product source.",
      );
    }
  }

  async function sendFollowUp(messageText: string) {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    setPendingUserMessage(messageText);
    setDraft("");
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
          },
          body: JSON.stringify({ message: messageText }),
        },
      );
      const payload = await response.json();
      if (!response.ok || !payload.conversation) {
        throw new Error(errorText(payload, "Ano could not send that message."));
      }
      setPendingUserMessage(null);
      setConversation(payload.conversation as ResearchConversationView);
      if ("companySearch" in payload) {
        setCompanySearch((payload.companySearch ?? null) as CompanySearchView | null);
      }
      if ("prospeo" in payload && payload.prospeo) {
        setProspeo(payload.prospeo as ProspeoProviderState);
      }
      if ("peopleDiscovery" in payload) {
        setPeopleDiscovery((payload.peopleDiscovery ?? null) as PeopleDiscoveryView | null);
      }
      if ("dropcontact" in payload && payload.dropcontact) {
        setDropcontact(payload.dropcontact as DropcontactProviderState);
      }
      if ("templatePack" in payload) {
        setTemplatePack((payload.templatePack ?? null) as OutreachTemplatePackView | null);
      }
      if ("autopilotRun" in payload) {
        setAutopilotRun((payload.autopilotRun ?? null) as AutopilotRunView | null);
      }
      lastRetryActionRef.current = null;
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setPendingUserMessage(null);
      setDraft(messageText);
      lastRetryActionRef.current = () => sendFollowUp(messageText);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not send that message.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function resume(body: Record<string, unknown>, optimisticText?: string) {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    if (optimisticText) {
      setPendingUserMessage(optimisticText);
      setDraft("");
    }
    try {
      const next = await request(
        `/api/v1/conversations/${conversation.conversation.id}/resume`,
        body,
      );
      setPendingUserMessage(null);
      setConversation(next);
      lastRetryActionRef.current = null;
      if (
        next.brief?.intakeComplete &&
        next.plan?.approvalStatus === "approved" &&
        !autopilotRun
      ) {
        autoStartedConversationRef.current = next.conversation.id;
        await startAutopilot(next.conversation.id);
      }
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setPendingUserMessage(null);
      if (optimisticText) setDraft(optimisticText);
      lastRetryActionRef.current = () => resume(body, optimisticText);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not save that decision.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleRetry() {
    setError(null);
    const pendingRetry = lastRetryActionRef.current;
    if (pendingRetry) {
      await pendingRetry();
      return;
    }
    if (autopilotRun?.status === "failed" || autopilotRun?.status === "paused") {
      await resumeAutopilot();
      return;
    }
    if (conversation?.run.status === "failed_safe") {
      await resume({ kind: "retry" });
    }
  }

  async function handleComposerSubmit() {
    const trimmed = draft.trim();
    const filesSnapshot = [...pendingFiles];
    const urlsSnapshot = [...pendingUrls];
    if (
      (!trimmed && filesSnapshot.length === 0 && urlsSnapshot.length === 0) ||
      isWorking ||
      needsSignIn
    ) {
      return;
    }

    if (!conversation) {
      await start({ message: trimmed, files: filesSnapshot, urls: urlsSnapshot });
      return;
    }

    if (filesSnapshot.length > 0 || urlsSnapshot.length > 0) {
      setIsWorking(true);
      setError(null);
      setPendingFiles([]);
      setPendingUrls([]);
      try {
        await uploadPendingSources(conversation.conversation.id, filesSnapshot, urlsSnapshot);
      } catch (uploadError) {
        setPendingFiles(filesSnapshot);
        setPendingUrls(urlsSnapshot);
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Ano could not attach your product sources.",
        );
        setIsWorking(false);
        return;
      } finally {
        if (!trimmed) setIsWorking(false);
      }
    }

    if (!trimmed) return;

    if (conversation.run.status === "awaiting_context" && conversation.pendingQuestion) {
      await resume(
        {
          kind: "clarification",
          answer: trimmed,
          messageId: window.crypto.randomUUID(),
        },
        trimmed,
      );
      return;
    }

    await sendFollowUp(trimmed);
  }

  function handleQuickReply(text: string) {
    if (
      conversation?.run.status === "awaiting_context" &&
      conversation.pendingQuestion &&
      !isWorking
    ) {
      void resume(
        {
          kind: "clarification",
          answer: text,
          messageId: window.crypto.randomUUID(),
        },
        text,
      );
      return;
    }
    setDraft(text);
  }

  async function researchRequest(url: string, body?: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(errorText(payload, "Ano could not safely continue public research."));
    }
    setResearch((payload.research ?? null) as EvidenceResearchView | null);
    if (payload.provider) setProvider(payload.provider as ResearchProviderState);
    setError(null);
    if (embeddedInShell) void refreshShellConversations?.();
  }

  async function prepareResearch() {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    try {
      await researchRequest(`/api/v1/conversations/${conversation.conversation.id}/research-run`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not prepare the public-research scope.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function startResearch() {
    if (!conversation || !research) return;
    setIsWorking(true);
    setError(null);
    try {
      await researchRequest(
        `/api/v1/conversations/${conversation.conversation.id}/research-run/start`,
        { runId: research.run.id },
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not run the approved public-research scope.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function analyseEvidence() {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/market-synthesis`,
        {
          method: "POST",
          headers: { "X-Ano-Idempotency-Key": window.crypto.randomUUID() },
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "Ano could not safely analyze the saved evidence."));
      }
      setSynthesis((payload.synthesis ?? null) as MarketSynthesis | null);
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not safely analyze the saved evidence.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function lockTargetRoute() {
    if (!conversation || !synthesis) return;
    const marketProfileId = activeMarketId;
    const industryProfileId = activeIndustryId;
    if (!marketProfileId || !industryProfileId) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/target-decision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
          },
          body: JSON.stringify({ marketProfileId, industryProfileId }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "Ano could not lock that target route."));
      }
      setSynthesis(payload.synthesis as MarketSynthesis);
      const searchResponse = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/company-search`,
      );
      if (searchResponse.ok) {
        const searchPayload = await searchResponse.json();
        setCompanySearch((searchPayload.companySearch ?? null) as CompanySearchView | null);
        if (searchPayload.prospeo) {
          setProspeo(searchPayload.prospeo as ProspeoProviderState);
        }
      }
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not lock that target route.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function prepareCompanySearch(options?: {
    providerKey?: "prospeo" | "openstreetmap";
    resolveWebsites?: boolean;
    locationOverrides?: string[];
    keywordOverrides?: string[];
    industryOverrides?: string[];
    excludedCategories?: string[];
  }) {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/company-search`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
          },
          body: JSON.stringify({
            action: "prepare_preview",
            providerKey: options?.providerKey,
            resolveWebsites: options?.resolveWebsites,
            locationOverrides: options?.locationOverrides,
            keywordOverrides: options?.keywordOverrides,
            industryOverrides: options?.industryOverrides,
            excludedCategories: options?.excludedCategories,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "Ano could not prepare the company search preview."));
      }
      setCompanySearch((payload.companySearch ?? null) as CompanySearchView | null);
      if (payload.prospeo) setProspeo(payload.prospeo as ProspeoProviderState);
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not prepare the company search preview.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function runFreeCompanySearch(options?: {
    resolveWebsites?: boolean;
    locationOverrides?: string[];
    keywordOverrides?: string[];
    excludedCategories?: string[];
  }) {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/company-search`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
          },
          body: JSON.stringify({
            action: "run_free_search",
            resolveWebsites: options?.resolveWebsites,
            locationOverrides: options?.locationOverrides,
            keywordOverrides: options?.keywordOverrides,
            excludedCategories: options?.excludedCategories,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "Ano could not complete OpenStreetMap discovery."));
      }
      setCompanySearch((payload.companySearch ?? null) as CompanySearchView | null);
      if (payload.prospeo) setProspeo(payload.prospeo as ProspeoProviderState);
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not complete OpenStreetMap discovery.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  function focusComposerWithPrompt(prefill?: string) {
    if (prefill) {
      setDraft(prefill);
    }
    window.setTimeout(() => {
      const composer = document.getElementById("ano-chat-composer");
      composer?.focus();
      composer?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 40);
  }

  async function approveCompanySearch(searchId: string) {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/company-search`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
          },
          body: JSON.stringify({
            action: "approve_search",
            searchId,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "Ano could not run the approved company search."));
      }
      setCompanySearch((payload.companySearch ?? null) as CompanySearchView | null);
      if (payload.prospeo) setProspeo(payload.prospeo as ProspeoProviderState);
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not run the approved company search.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function updateAccountState(
    accountId: string,
    state: "shortlisted" | "held" | "dismissed",
  ) {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/accounts/${accountId}/state`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ state }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, "Ano could not update that company candidate."));
      }
      setCompanySearch((payload.companySearch ?? null) as CompanySearchView | null);
      const peopleResponse = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/people-discovery`,
      );
      if (peopleResponse.ok) {
        const peoplePayload = await peopleResponse.json();
        setPeopleDiscovery((peoplePayload.peopleDiscovery ?? null) as PeopleDiscoveryView | null);
        if (peoplePayload.dropcontact) {
          setDropcontact(peoplePayload.dropcontact as DropcontactProviderState);
        }
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not update that company candidate.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function runPeopleDiscoveryAction(body: Record<string, unknown>, fallbackError: string) {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/people-discovery`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, fallbackError));
      }
      setPeopleDiscovery((payload.peopleDiscovery ?? null) as PeopleDiscoveryView | null);
      if (payload.dropcontact) {
        setDropcontact(payload.dropcontact as DropcontactProviderState);
      }
      if (payload.prospeo) {
        setProspeo(payload.prospeo as ProspeoProviderState);
      }
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : fallbackError);
    } finally {
      setIsWorking(false);
    }
  }

  async function runOutreachAction(body: Record<string, unknown>, fallbackError: string) {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/outreach`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, fallbackError));
      }
      setOutreachExecution((payload.outreachExecution ?? null) as OutreachExecutionView | null);
      if (payload.mercury) {
        setMercury(payload.mercury as MercuryConnectorState);
      }
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : fallbackError);
    } finally {
      setIsWorking(false);
    }
  }

  async function runTemplateAction(body: Record<string, unknown>, fallbackError: string) {
    if (!conversation) return;
    setIsWorking(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/conversations/${conversation.conversation.id}/templates`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(errorText(payload, fallbackError));
      }
      setTemplatePack((payload.templatePack ?? null) as OutreachTemplatePackView | null);
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : fallbackError);
    } finally {
      setIsWorking(false);
    }
  }

  function beginNewResearch() {
    setConversation(null);
    setResearch(null);
    setSynthesis(null);
    setCompanySearch(null);
    setProspeo(null);
    setPeopleDiscovery(null);
    setDropcontact(null);
    setOutreachExecution(null);
    setMercury(null);
    setTemplatePack(null);
    setAutopilotRun(null);
    autoStartedConversationRef.current = null;
    lastRetryActionRef.current = null;
    setPendingUserMessage(null);
    setDraft("");
    setPendingFiles([]);
    setPendingUrls([]);
    setMarketChoice("");
    setIndustryChoice("");
    setError(null);
    if (embeddedInShell) {
      router.push("/research");
    }
  }

  return (
    <section className="m3-chat-workspace" aria-label="Research conversation">
      <div className="m3-chat-scroll">
        <ConversationThread
          conversation={conversation}
          research={research}
          synthesis={synthesis}
          companySearch={companySearch}
          prospeo={prospeo}
          peopleDiscovery={peopleDiscovery}
          dropcontact={dropcontact}
          outreachExecution={outreachExecution}
          mercury={mercury}
          templatePack={templatePack}
          autopilotRun={autopilotRun}
          provider={provider}
          pendingUserMessage={pendingUserMessage}
          error={error}
          needsSignIn={needsSignIn}
          isWorking={isWorking}
          onPauseAutopilot={() => void pauseAutopilot()}
          onResumeAutopilot={() => void resumeAutopilot()}
          onRetry={() => void handleRetry()}
          onDismissError={() => setError(null)}
          selectedMarketId={activeMarketId}
          selectedIndustryId={activeIndustryId}
          onSelectStarterPrompt={(prompt) => setDraft(prompt)}
          onApprovePlan={() => void resume({ kind: "approve" })}
          onDeclinePlan={() => void resume({ kind: "decline" })}
          onEditPlan={(instruction) =>
            void resume(
              {
                kind: "edit",
                instruction,
                messageId: window.crypto.randomUUID(),
              },
              instruction,
            )
          }
          onPrepareResearch={() => void prepareResearch()}
          onStartResearch={() => void startResearch()}
          onAnalyseEvidence={() => void analyseEvidence()}
          onSelectMarket={(marketId) => {
            setMarketChoice(marketId);
            setIndustryChoice("");
          }}
          onSelectIndustry={(industryId) => setIndustryChoice(industryId)}
          onLockTargetRoute={() => void lockTargetRoute()}
          onPrepareCompanySearch={(options) => void prepareCompanySearch(options)}
          onRunFreeCompanySearch={(options) => void runFreeCompanySearch(options)}
          onApproveCompanySearch={(searchId) => void approveCompanySearch(searchId)}
          onFocusComposerWithPrompt={focusComposerWithPrompt}
          onUpdateAccountState={(accountId, state) => void updateAccountState(accountId, state)}
          onProposeBuyerRoles={(optionsInput) => {
            const payload = Array.isArray(optionsInput)
              ? { action: "propose_roles", roleOverrides: optionsInput }
              : { action: "propose_roles", ...(optionsInput ?? {}) };
            void runPeopleDiscoveryAction(
              payload,
              "Ano could not prepare buyer-role recommendations.",
            );
          }}
          onRunFreePeopleSearch={(options) =>
            void runPeopleDiscoveryAction(
              { action: "run_free_people_search", ...(options ?? {}) },
              "Ano could not scan shortlisted company websites for decision-makers.",
            )
          }
          onApprovePersonSearch={(personSearchId) =>
            void runPeopleDiscoveryAction(
              { action: "approve_person_search", personSearchId },
              "Ano could not run the approved Prospeo person search.",
            )
          }
          onPrepareContactVerification={(contactIds, providerKey) =>
            void runPeopleDiscoveryAction(
              { action: "prepare_verification", contactIds, providerKey },
              `Ano could not prepare the selective ${
                providerKey === "dropcontact" ? "Dropcontact" : "Prospeo"
              } preview.`,
            )
          }
          onApproveContactVerification={(verificationRunId) =>
            void runPeopleDiscoveryAction(
              { action: "approve_verification", verificationRunId },
              "Ano could not complete selective contact verification.",
            )
          }
          onGeneratePlaybooks={() =>
            void runPeopleDiscoveryAction(
              { action: "generate_playbooks" },
              "Ano could not compile factual account playbooks.",
            )
          }
          onGenerateTemplatePack={(options) =>
            void runTemplateAction(
              { action: "generate", ...(options ?? {}) },
              "Ano could not generate human-voice outreach email templates.",
            )
          }
          onEditTemplateStep={(input) =>
            void runTemplateAction(
              { action: "edit_step", ...input },
              "Ano could not save your outreach template edits.",
            )
          }
          onGenerateOutreachDrafts={(playbookId) =>
            void runOutreachAction(
              { action: "generate_drafts", playbookId },
              "Ano could not compile outreach drafts.",
            )
          }
          onEditOutreachDraft={(draftId, subject, body) =>
            void runOutreachAction(
              { action: "edit_draft", draftId, subject, body },
              "Ano could not save a new draft version.",
            )
          }
          onCreateExecutionProposal={(draftId, proposalType, scheduledFor, note) =>
            void runOutreachAction(
              { action: "create_proposal", draftId, proposalType, scheduledFor, note },
              "Ano could not stage that execution proposal.",
            )
          }
          onDecideExecutionProposal={(proposalId, decision, rationale) =>
            void runOutreachAction(
              { action: "decide_proposal", proposalId, decision, rationale },
              "Ano could not record your proposal decision.",
            )
          }
          onOpenContextRail={() => setContextRailOpen?.(true)}
          onStartNewResearch={beginNewResearch}
        />
      </div>

      <ConversationComposer
        conversation={conversation}
        research={research}
        autopilotRunning={autopilotRun?.status === "running"}
        value={draft}
        onChange={setDraft}
        onSubmit={() => void handleComposerSubmit()}
        onStartNewResearch={beginNewResearch}
        isWorking={isWorking}
        needsSignIn={needsSignIn}
        productSources={conversation?.productSources ?? []}
        pendingFiles={pendingFiles}
        pendingUrls={pendingUrls}
        onAddFiles={(incoming) =>
          setPendingFiles((prev) => [...prev, ...incoming].slice(0, 3))
        }
        onRemovePendingFile={(index) =>
          setPendingFiles((prev) => prev.filter((_item, idx) => idx !== index))
        }
        onAddUrl={(url) =>
          setPendingUrls((prev) => (prev.includes(url) ? prev : [...prev, url].slice(0, 3)))
        }
        onRemovePendingUrl={(url) =>
          setPendingUrls((prev) => prev.filter((item) => item !== url))
        }
        onRemoveSavedSource={(sourceId) => void removeSavedSource(sourceId)}
        onSelectQuickReply={handleQuickReply}
      />
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [marketChoice, setMarketChoice] = useState("");
  const [industryChoice, setIndustryChoice] = useState("");

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

  const activeMode = embeddedInShell ? shell?.mode : workspace?.mode;
  const needsSignIn = Boolean(
    error?.toLowerCase().includes("sign in") ||
      error?.toLowerCase().includes("workspace") ||
      activeMode === "demo" ||
      activeMode === "unauthenticated",
  );

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

  async function start(messageText: string) {
    setIsWorking(true);
    setError(null);
    setPendingUserMessage(messageText);
    setDraft("");
    try {
      const created = await request("/api/v1/conversations", { message: messageText });
      setPendingUserMessage(null);
      setConversation(created);
      if (embeddedInShell) {
        void refreshShellConversations?.();
        router.push(`/research/${created.conversation.id}`);
      }
    } catch (requestError) {
      setPendingUserMessage(null);
      setDraft(messageText);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not begin the conversation.",
      );
    } finally {
      setIsWorking(false);
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
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setPendingUserMessage(null);
      setDraft(messageText);
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
      if (embeddedInShell) void refreshShellConversations?.();
    } catch (requestError) {
      setPendingUserMessage(null);
      if (optimisticText) setDraft(optimisticText);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Ano could not save that decision.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handleComposerSubmit() {
    const trimmed = draft.trim();
    if (!trimmed || isWorking || needsSignIn) return;

    if (!conversation) {
      await start(trimmed);
      return;
    }

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
    setPendingUserMessage(null);
    setDraft("");
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
          provider={provider}
          pendingUserMessage={pendingUserMessage}
          error={error}
          needsSignIn={needsSignIn}
          isWorking={isWorking}
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
        value={draft}
        onChange={setDraft}
        onSubmit={() => void handleComposerSubmit()}
        onStartNewResearch={beginNewResearch}
        isWorking={isWorking}
        needsSignIn={needsSignIn}
      />
    </section>
  );
}

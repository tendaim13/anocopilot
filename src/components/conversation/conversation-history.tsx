"use client";

import type { GraphRunStatus, ResearchConversationSummary } from "@/lib/ano/research-conversation";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";

export interface ConversationHistoryProps {
  conversations: ResearchConversationSummary[];
  activeConversationId: string | null;
  mode: "supabase" | "demo" | "unauthenticated";
  hasMore?: boolean;
  loadingMore?: boolean;
  onSelectConversation: (conversationId: string) => void;
  onLoadMore?: () => void;
}

function conversationStatusLabel(status: GraphRunStatus) {
  if (status === "awaiting_context") return "Needs answer";
  if (status === "awaiting_plan_approval") return "Plan review";
  if (status === "requires_manual_review") return "Manual review";
  if (status === "planning") return "Planning";
  if (status === "complete_without_research") return "Plan locked";
  if (status === "failed_safe") return "Stopped safely";
  return "Draft";
}

export function ConversationHistory({
  conversations,
  activeConversationId,
  mode,
  hasMore = false,
  loadingMore = false,
  onSelectConversation,
  onLoadMore,
}: ConversationHistoryProps) {
  useMaterialWeb();

  if (conversations.length === 0) {
    return (
      <p className="ano-nav-empty">
        {mode === "supabase"
          ? "Start a conversation to save your research history."
          : "Sign in to save durable research threads."}
      </p>
    );
  }

  return (
    <div className="ano-history-block">
      <md-list className="ano-conversation-list" aria-label="Recent research">
        {conversations.map((item) => {
          const isActive = item.id === activeConversationId;
          return (
            <md-list-item
              key={item.id}
              type="button"
              className={`ano-conversation-item${isActive ? " is-active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelectConversation(item.id)}
            >
              <span slot="headline" className="ano-conv-title">
                {item.title}
              </span>
              <span slot="supporting-text" className="ano-conv-status">
                {conversationStatusLabel(item.status)}
              </span>
            </md-list-item>
          );
        })}
      </md-list>
      {hasMore && onLoadMore && (
        <MaterialButton
          variant="text"
          className="ano-load-more-btn"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "Loading…" : "Load older research"}
        </MaterialButton>
      )}
    </div>
  );
}

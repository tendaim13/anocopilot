"use client";

import type { KeyboardEvent } from "react";

import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import type { ResearchConversationView } from "@/lib/ano/research-conversation";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";

export interface ConversationComposerProps {
  conversation: ResearchConversationView | null;
  research: EvidenceResearchView | null;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStartNewResearch: () => void;
  isWorking: boolean;
  needsSignIn: boolean;
}

export function ConversationComposer({
  conversation,
  research,
  value,
  onChange,
  onSubmit,
  onStartNewResearch,
  isWorking,
  needsSignIn,
}: ConversationComposerProps) {
  useMaterialWeb();

  const status = conversation?.run.status;
  const isClarifying = status === "awaiting_context" && Boolean(conversation?.pendingQuestion);
  const isRunningResearch = research?.run.status === "running";

  const isDisabled = isWorking || needsSignIn || isRunningResearch;

  let label = "Ask Ano";
  let placeholder =
    "Describe what you sell and the sales outcome you want (e.g., AI workflows that turn quotes into jobs)…";
  let helper =
    "Press Enter to send · Shift+Enter for a new line. Ano asks one question only if it changes the research design.";
  let buttonLabel = "Ask Ano";

  if (!conversation) {
    label = "What are you trying to sell?";
    buttonLabel = isWorking ? "Thinking…" : "Ask Ano";
  } else if (isClarifying && conversation.pendingQuestion) {
    label = "Answer Ano’s clarifying question";
    placeholder = "Answer in your own words…";
    helper = "Your reply resumes the paused research graph via a typed clarification event.";
    buttonLabel = isWorking ? "Updating…" : "Reply";
  } else if (isRunningResearch) {
    label = "Research in progress";
    placeholder = "Ano is executing the approved SearXNG research scope…";
    helper = "Free-form messages pause briefly while public evidence retrieval finishes.";
    buttonLabel = "Running";
  } else {
    label = "Chat with Ano";
    placeholder =
      "Ask about what you see, compare companies, or tell Ano how to refine the search…";
    helper =
      "Enter to send · Shift+Enter for new line. OpenStreetMap local refinements run automatically ($0); paid credits still stay gated.";
    buttonLabel = isWorking ? "Thinking…" : "Send";
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!isDisabled && value.trim()) {
        onSubmit();
      }
    }
  }

  return (
    <div className="m3-composer-dock">
      <div className="m3-composer-box">
        {isClarifying && conversation?.pendingQuestion && (
          <div className="m3-composer-context">
            <span>Pending question:</span> {conversation.pendingQuestion.question}
          </div>
        )}

        <MaterialTextField
          id="ano-chat-composer"
          name="composer"
          label={label}
          type="textarea"
          rows={2}
          value={value}
          onValueChange={onChange}
          placeholder={placeholder}
          supportingText={
            needsSignIn
              ? "Sign in to start or continue a durable workspace conversation."
              : helper
          }
          disabled={isDisabled}
          onKeyDown={handleKeyDown}
        />

        <div className="m3-composer-actions">
          <div className="m3-composer-left">
            {conversation && (
              <MaterialButton variant="text" disabled={isWorking} onClick={onStartNewResearch}>
                New research
              </MaterialButton>
            )}
          </div>
          <div className="m3-composer-right">
            {isWorking && (
              <md-circular-progress
                indeterminate
                aria-label="Ano is working"
                className="m3-inline-spinner"
              />
            )}
            <MaterialButton
              variant="filled"
              disabled={isDisabled || !value.trim()}
              onClick={onSubmit}
            >
              {buttonLabel}
            </MaterialButton>
          </div>
        </div>
      </div>
    </div>
  );
}

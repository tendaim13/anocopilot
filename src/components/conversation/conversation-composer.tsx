"use client";

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import type { EvidenceResearchView } from "@/lib/ano/evidence-research";
import type {
  ProductSourceSummary,
  ResearchConversationView,
} from "@/lib/ano/research-conversation";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialInputChip } from "@/components/material/material-input-chip";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";
import { AttachFileIcon, LinkIcon } from "@/components/shell/ano-icons";

export interface ConversationComposerProps {
  conversation: ResearchConversationView | null;
  research: EvidenceResearchView | null;
  autopilotRunning?: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStartNewResearch: () => void;
  isWorking: boolean;
  needsSignIn: boolean;
  productSources?: ProductSourceSummary[];
  pendingFiles?: File[];
  pendingUrls?: string[];
  onAddFiles?: (files: File[]) => void;
  onRemovePendingFile?: (index: number) => void;
  onAddUrl?: (url: string) => void;
  onRemovePendingUrl?: (url: string) => void;
  onRemoveSavedSource?: (sourceId: string) => void;
  onSelectQuickReply?: (text: string) => void;
}

export function ConversationComposer({
  conversation,
  research,
  autopilotRunning = false,
  value,
  onChange,
  onSubmit,
  onStartNewResearch,
  isWorking,
  needsSignIn,
  productSources = [],
  pendingFiles = [],
  pendingUrls = [],
  onAddFiles,
  onRemovePendingFile,
  onAddUrl,
  onRemovePendingUrl,
  onRemoveSavedSource,
  onSelectQuickReply,
}: ConversationComposerProps) {
  useMaterialWeb();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlInputOpen, setUrlInputOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");

  const status = conversation?.run.status;
  const isClarifying = status === "awaiting_context" && Boolean(conversation?.pendingQuestion);
  const isRunningResearch = research?.run.status === "running";
  const isBusyPipeline = isRunningResearch || autopilotRunning;

  const isDisabled = isWorking || needsSignIn || isBusyPipeline;
  const hasAttachments = pendingFiles.length > 0 || pendingUrls.length > 0;
  const canSubmit = !isDisabled && Boolean(value.trim() || hasAttachments);

  let label = "Ask Ano";
  let placeholder =
    "Paste your product link, describe what you sell, or attach a PDF, Word doc (.docx), or .txt file…";
  let helper =
    "Enter to send · Shift+Enter for new line · Supports product URLs, PDF, DOCX, and TXT.";
  let buttonLabel = "Start research";

  if (!conversation) {
    label = "What product or service are you selling?";
    buttonLabel = isWorking ? "Analyzing…" : "Start";
  } else if (isClarifying && conversation.pendingQuestion) {
    label = "Answer Ano’s intake question";
    placeholder =
      "Share where your business is located and where you want to sell (or say 'recommend the best market')…";
    helper = "Your reply completes setup so Ano can research markets, find emails, and draft templates.";
    buttonLabel = isWorking ? "Updating…" : "Continue";
  } else if (autopilotRunning) {
    label = "Autopilot is running…";
    placeholder = "Ano is researching markets, finding decision-makers, and drafting templates…";
    helper = "Live stage progress updates above. You can pause autopilot anytime from the progress card.";
    buttonLabel = "Running";
  } else if (isRunningResearch) {
    label = "Research in progress";
    placeholder = "Ano is researching public market evidence…";
    helper = "Free-form messages pause briefly while market research completes.";
    buttonLabel = "Running";
  } else {
    label = "Chat with Ano";
    placeholder =
      "Ask about the research, companies, or emails — or tell Ano what to adjust next…";
    helper = "Enter to send · Shift+Enter for new line · Attach extra product docs or links anytime.";
    buttonLabel = isWorking ? "Thinking…" : "Send";
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSubmit) {
        onSubmit();
      }
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files ? Array.from(event.target.files) : [];
    if (selected.length > 0) {
      onAddFiles?.(selected);
    }
    event.target.value = "";
  }

  function handleConfirmUrl() {
    const cleaned = urlDraft.trim();
    if (!cleaned) return;
    onAddUrl?.(cleaned);
    setUrlDraft("");
    setUrlInputOpen(false);
  }

  function handleUrlKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleConfirmUrl();
    }
  }

  return (
    <div className="m3-composer-dock">
      <div className="m3-composer-box">
        {isClarifying && conversation?.pendingQuestion && (
          <div className="m3-composer-context">
            <span>Pending question:</span> {conversation.pendingQuestion.question}
            {onSelectQuickReply && (
              <div className="m3-composer-quick-replies">
                <md-chip-set aria-label="Quick intake replies">
                  <md-suggestion-chip
                    label="Recommend the best market for me"
                    onClick={() => onSelectQuickReply("Recommend the best market for me.")}
                  />
                </md-chip-set>
              </div>
            )}
          </div>
        )}

        {(productSources.length > 0 || pendingFiles.length > 0 || pendingUrls.length > 0) && (
          <md-chip-set aria-label="Attached product sources">
            {productSources.map((src) => {
              const label = `${src.sourceType === "website_url" ? "URL" : src.sourceType.toUpperCase()} · ${src.label}`;
              return onRemoveSavedSource ? (
                <MaterialInputChip
                  key={src.id}
                  label={label}
                  selected
                  onRemove={() => onRemoveSavedSource(src.id)}
                />
              ) : (
                <md-assist-chip key={src.id} label={label} />
              );
            })}
            {pendingFiles.map((file, idx) =>
              onRemovePendingFile ? (
                <MaterialInputChip
                  key={`${file.name}-${idx}`}
                  label={`FILE · ${file.name}`}
                  onRemove={() => onRemovePendingFile(idx)}
                />
              ) : (
                <md-assist-chip key={`${file.name}-${idx}`} label={`FILE · ${file.name}`} />
              ),
            )}
            {pendingUrls.map((url) => {
              const label = `LINK · ${url.replace(/^https?:\/\//i, "")}`;
              return onRemovePendingUrl ? (
                <MaterialInputChip
                  key={url}
                  label={label}
                  onRemove={() => onRemovePendingUrl(url)}
                />
              ) : (
                <md-assist-chip key={url} label={label} />
              );
            })}
          </md-chip-set>
        )}

        {urlInputOpen && (
          <div className="m3-composer-url-bar">
            <MaterialTextField
              id="ano-product-url-input"
              name="productUrl"
              label="Product website URL"
              type="url"
              value={urlDraft}
              onValueChange={setUrlDraft}
              placeholder="https://yourproduct.com"
              disabled={isDisabled}
              onKeyDown={handleUrlKeyDown}
            />
            <MaterialButton
              variant="tonal"
              disabled={isDisabled || !urlDraft.trim()}
              onClick={handleConfirmUrl}
            >
              Attach link
            </MaterialButton>
            <MaterialButton variant="text" onClick={() => setUrlInputOpen(false)}>
              Cancel
            </MaterialButton>
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

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          multiple
          hidden
          onChange={handleFileChange}
        />

        <div className="m3-composer-actions">
          <div className="m3-composer-left">
            <md-icon-button
              aria-label="Attach PDF, Word doc, or text file"
              title="Attach PDF (.pdf), Word (.docx), or text (.txt)"
              disabled={isDisabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <AttachFileIcon />
            </md-icon-button>
            <md-icon-button
              aria-label="Add product website link"
              title="Add product website link"
              disabled={isDisabled}
              onClick={() => setUrlInputOpen((open) => !open)}
            >
              <LinkIcon />
            </md-icon-button>
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
            <MaterialButton variant="filled" disabled={!canSubmit} onClick={onSubmit}>
              {buttonLabel}
            </MaterialButton>
          </div>
        </div>
      </div>
    </div>
  );
}

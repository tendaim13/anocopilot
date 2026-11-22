"use client";

import { useEffect, useMemo, useState } from "react";

import type { AccountCandidateDossier } from "@/lib/ano/company-discovery";
import {
  lintOutreachEmailStep,
  normalizeMergeTags,
  renderTemplateForContact,
  SUPPORTED_MERGE_TAGS,
  tidyEmailText,
  type OutreachTemplatePackView,
  type TemplateCtaStyle,
  type TemplateStepKey,
  type TemplateTone,
} from "@/lib/ano/outreach-templates";
import type { ContactCandidateView } from "@/lib/ano/people-playbooks";
import { downloadExportEndpoint } from "@/components/artifacts/lead-export-card";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialIconButton } from "@/components/material/material-icon-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";
import { CloseIcon } from "@/components/shell/ano-icons";

export interface OutreachTemplateDrawerProps {
  open: boolean;
  conversationId?: string;
  templatePack: OutreachTemplatePackView | null;
  contacts: ContactCandidateView[];
  accounts: AccountCandidateDossier[];
  initialStepKey?: TemplateStepKey;
  isWorking: boolean;
  onClose: () => void;
  onEditStep: (input: {
    stepKey: TemplateStepKey;
    subject: string;
    body: string;
    senderName?: string | null;
  }) => void;
  onRegenerate: (options?: {
    tone?: TemplateTone;
    ctaStyle?: TemplateCtaStyle;
    entryOffer?: string | null;
    senderName?: string | null;
    includeLinkedIn?: boolean;
  }) => void;
  onSuggestChangesInChat: (prefill?: string) => void;
}

export function OutreachTemplateDrawer({
  open,
  conversationId,
  templatePack,
  contacts,
  accounts,
  initialStepKey = "initial",
  isWorking,
  onClose,
  onEditStep,
  onRegenerate,
  onSuggestChangesInChat,
}: OutreachTemplateDrawerProps) {
  useMaterialWeb();

  const [activeStepKey, setActiveStepKey] = useState<TemplateStepKey>(initialStepKey);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [senderInput, setSenderInput] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string>("");
  const [copiedSingle, setCopiedSingle] = useState(false);

  const steps = templatePack?.steps ?? [];
  const activeStep = steps.find((s) => s.stepKey === activeStepKey) ?? steps[0] ?? null;

  useEffect(() => {
    if (open) {
      setActiveStepKey(initialStepKey);
      setSenderInput(templatePack?.senderName ?? "");
    }
  }, [open, initialStepKey, templatePack?.senderName]);

  useEffect(() => {
    if (activeStep) {
      setDraftSubject(activeStep.subject);
      setDraftBody(activeStep.body);
    }
  }, [activeStep?.stepKey, activeStep?.subject, activeStep?.body]);

  useEffect(() => {
    if (!selectedLeadId && contacts.length > 0) {
      setSelectedLeadId(contacts[0].id);
    }
  }, [contacts, selectedLeadId]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const knownNames = useMemo(() => accounts.map((a) => a.name), [accounts]);

  const liveLint = useMemo(() => {
    if (!activeStep) return null;
    return lintOutreachEmailStep(
      {
        stepKey: activeStep.stepKey,
        channel: activeStep.channel,
        subject: normalizeMergeTags(tidyEmailText(draftSubject)),
        body: normalizeMergeTags(tidyEmailText(draftBody)),
      },
      { knownNames },
    );
  }, [activeStep, draftSubject, draftBody, knownNames]);

  const selectedContact = contacts.find((c) => c.id === selectedLeadId) ?? contacts[0] ?? null;
  const matchedAccount = useMemo(() => {
    if (selectedContact) {
      return accounts.find((a) => a.id === selectedContact.accountCandidateId) ?? accounts[0] ?? null;
    }
    return accounts.find((a) => a.lifecycleState === "shortlisted") ?? accounts[0] ?? null;
  }, [selectedContact, accounts]);

  const renderedPreview = useMemo(() => {
    return renderTemplateForContact(
      {
        subject: draftSubject,
        body: draftBody,
      },
      selectedContact,
      matchedAccount,
      senderInput.trim() || null,
    );
  }, [draftSubject, draftBody, selectedContact, matchedAccount, senderInput]);

  if (!open || !templatePack || !activeStep) {
    return null;
  }

  function appendMergeTag(tag: string) {
    setDraftBody((prev) => {
      if (!prev) return tag;
      return prev.endsWith(" ") || prev.endsWith("\n") ? `${prev}${tag}` : `${prev} ${tag}`;
    });
  }

  async function copyRenderedEmail() {
    const payload = renderedPreview.subject
      ? `Subject: ${renderedPreview.subject}\n\n${renderedPreview.body}`
      : renderedPreview.body;
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedSingle(true);
      window.setTimeout(() => setCopiedSingle(false), 1_800);
    } catch {
      // Ignore clipboard failures in restricted browser contexts.
    }
  }

  return (
    <div
      className="m3-artifact-drawer-root"
      role="dialog"
      aria-modal="true"
      aria-label="Outreach email template studio"
    >
      <div className="m3-artifact-drawer-backdrop" onClick={onClose} aria-hidden="true" />

      <aside className="m3-artifact-drawer">
        <header className="m3-artifact-drawer-header">
          <div>
            <p className="m3-artifact-kicker">
              TEMPLATE STUDIO · SEQUENCE v{templatePack.version} · ANTI-AI VOICE CHECK
            </p>
            <h2>
              {activeStep.label} (Day {activeStep.dayOffset})
            </h2>
          </div>
          <div className="m3-action-row">
            {conversationId && (
              <>
                <MaterialButton
                  variant="tonal"
                  disabled={isWorking}
                  onClick={() =>
                    void downloadExportEndpoint(
                      `/api/v1/conversations/${conversationId}/export?format=templates_csv`,
                      "ano-templates.csv",
                    )
                  }
                >
                  Export CSV
                </MaterialButton>
                <MaterialButton
                  variant="outlined"
                  disabled={isWorking}
                  onClick={() =>
                    void downloadExportEndpoint(
                      `/api/v1/conversations/${conversationId}/export?format=templates_md`,
                      "ano-templates.md",
                    )
                  }
                >
                  Export .md
                </MaterialButton>
              </>
            )}
            <MaterialButton
              variant="outlined"
              onClick={() => {
                onClose();
                onSuggestChangesInChat(
                  `Update ${activeStep.label} to sound even more human and focus on `,
                );
              }}
            >
              Ask Ano to rewrite in chat
            </MaterialButton>
            <MaterialIconButton ariaLabel="Close template studio" onClick={onClose}>
              <CloseIcon />
            </MaterialIconButton>
          </div>
        </header>

        <div className="m3-artifact-drawer-body">
          <div className="m3-action-row" role="tablist" aria-label="Sequence steps">
            {steps.map((step) => (
              <MaterialButton
                key={step.stepKey}
                variant={step.stepKey === activeStep.stepKey ? "filled" : "outlined"}
                onClick={() => setActiveStepKey(step.stepKey)}
              >
                {`${step.label} (D${step.dayOffset}) · ${step.lint.passed ? "✓" : `${step.lint.issues.length}!`}`}
              </MaterialButton>
            ))}
          </div>

          <div className="m3-template-editor-grid">
            <section className="m3-artifact-card">
              <header className="m3-artifact-header">
                <div>
                  <p className="m3-artifact-kicker">RAW MERGE TEMPLATE</p>
                  <h3>Edit subject &amp; plain-text body</h3>
                </div>
                {liveLint && (
                  <span
                    className={`m3-status-badge ${
                      liveLint.passed ? "status-approved" : "status-awaiting_approval"
                    }`}
                  >
                    {liveLint.wordCount}/{liveLint.maxWords} words
                  </span>
                )}
              </header>

              {activeStep.channel === "email" && (
                <MaterialTextField
                  label="Lowercase email subject"
                  value={draftSubject}
                  onValueChange={setDraftSubject}
                  placeholder="e.g. {{company_name}} recall"
                  supportingText="2-5 lowercase words, zero recipient names, no 'quick question' or fake 're:'."
                  disabled={isWorking}
                />
              )}

              <label className="m3-template-field-label" htmlFor="m3-template-body-editor">
                Message body (plain text)
              </label>
              <textarea
                id="m3-template-body-editor"
                className="m3-template-textarea"
                rows={7}
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                disabled={isWorking}
              />

              <div className="m3-chip-group">
                <span className="m3-chip-group-label">Insert merge tag</span>
                <div className="m3-action-row">
                  {SUPPORTED_MERGE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="m3-row-action-btn"
                      onClick={() => appendMergeTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <MaterialTextField
                label="Optional sender first name sign-off"
                value={senderInput}
                onValueChange={setSenderInput}
                placeholder="Leave blank if your email blaster adds a signature"
                supportingText="Ano strips repetitive 'Best,' / 'Warm regards,' closings and uses a plain first name or blank footer."
                disabled={isWorking}
              />

              {liveLint && liveLint.issues.length > 0 ? (
                <div className="m3-warning-callout" role="status">
                  <strong>Anti-AI voice flags ({liveLint.issues.length})</strong>
                  <ul className="m3-lint-issue-list">
                    {liveLint.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="m3-muted-callout" role="status">
                  <strong>Passes all anti-AI voice checks</strong>
                  <p className="m3-helper-note">
                    Short, plain-text, zero em-dashes or hype filler, clean subject, and valid
                    merge tags.
                  </p>
                </div>
              )}

              <div className="m3-action-row">
                <MaterialButton
                  variant="filled"
                  disabled={isWorking || !draftBody.trim()}
                  onClick={() =>
                    onEditStep({
                      stepKey: activeStep.stepKey,
                      subject: draftSubject,
                      body: draftBody,
                      senderName: senderInput.trim() || null,
                    })
                  }
                >
                  {isWorking ? "Saving…" : "Save step changes"}
                </MaterialButton>
                <MaterialButton
                  variant="outlined"
                  disabled={isWorking}
                  onClick={() =>
                    onRegenerate({
                      tone: templatePack.tone,
                      ctaStyle: templatePack.ctaStyle,
                      entryOffer: templatePack.entryOffer,
                      senderName: senderInput.trim() || null,
                      includeLinkedIn: templatePack.steps.some(
                        (s) => s.stepKey === "linkedin_note",
                      ),
                    })
                  }
                >
                  Regenerate all (Free)
                </MaterialButton>
              </div>
            </section>

            <section className="m3-artifact-card">
              <header className="m3-artifact-header">
                <div>
                  <p className="m3-artifact-kicker">LIVE LEAD PREVIEW</p>
                  <h3>Test rendered output before export</h3>
                </div>
              </header>

              {contacts.length > 0 ? (
                <div className="m3-chip-group">
                  <label className="m3-chip-group-label" htmlFor="m3-lead-preview-select">
                    Preview with discovered lead ({contacts.length})
                  </label>
                  <select
                    id="m3-lead-preview-select"
                    className="m3-template-select"
                    value={selectedContact?.id ?? ""}
                    onChange={(event) => setSelectedLeadId(event.target.value)}
                  >
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.fullName} · {contact.title ?? "Decision maker"} @{" "}
                        {contact.accountName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="m3-helper-note">
                  Previewing with {matchedAccount?.name ?? "sample company"}. Discover named
                  contacts in Phase E to preview exact personalizations.
                </p>
              )}

              <div className="m3-template-preview-box">
                {renderedPreview.subject && (
                  <p className="m3-template-preview-subject">
                    <span>Subject:</span> {renderedPreview.subject}
                  </p>
                )}
                <pre className="m3-template-preview-body">{renderedPreview.body}</pre>
              </div>

              <div className="m3-action-row">
                <MaterialButton variant="tonal" onClick={() => void copyRenderedEmail()}>
                  {copiedSingle ? "Copied rendered email" : "Copy Subject + Body"}
                </MaterialButton>
              </div>
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}

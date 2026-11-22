"use client";

import { useState } from "react";

import type {
  OutreachTemplatePackView,
  TemplateCtaStyle,
  TemplateStepKey,
  TemplateTone,
} from "@/lib/ano/outreach-templates";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";

export interface OutreachTemplatePackCardProps {
  templatePack: OutreachTemplatePackView | null;
  targetIndustryName?: string;
  isWorking: boolean;
  onGenerate: (options?: {
    tone?: TemplateTone;
    ctaStyle?: TemplateCtaStyle;
    entryOffer?: string | null;
    senderName?: string | null;
    includeLinkedIn?: boolean;
  }) => void;
  onOpenDrawer: (stepKey?: TemplateStepKey) => void;
  onSuggestChangesInChat?: (prefill?: string) => void;
}

const TONE_OPTIONS: Array<[TemplateTone, string]> = [
  ["peer_direct", "Peer direct"],
  ["warm_smb", "Warm SMB"],
  ["executive_brief", "Executive brief"],
  ["curious", "Curious"],
];

const CTA_OPTIONS: Array<[TemplateCtaStyle, string]> = [
  ["easy_yes", "Easy yes ask"],
  ["free_offer", "Free entry offer"],
  ["direct_question", "Direct question"],
];

export function OutreachTemplatePackCard({
  templatePack,
  targetIndustryName,
  isWorking,
  onGenerate,
  onOpenDrawer,
  onSuggestChangesInChat,
}: OutreachTemplatePackCardProps) {
  useMaterialWeb();

  const [toneOverride, setToneOverride] = useState<TemplateTone | null>(null);
  const [ctaOverride, setCtaOverride] = useState<TemplateCtaStyle | null>(null);
  const [entryOfferOverride, setEntryOfferOverride] = useState<string | null>(null);
  const [includeLinkedIn, setIncludeLinkedIn] = useState<boolean>(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const selectedTone = toneOverride ?? templatePack?.tone ?? "peer_direct";
  const selectedCta = ctaOverride ?? templatePack?.ctaStyle ?? "easy_yes";
  const entryOfferValue = entryOfferOverride ?? templatePack?.entryOffer ?? "";

  const steps = templatePack?.steps ?? [];
  const passedCount = steps.filter((step) => step.lint.passed).length;
  const email1 = steps.find((step) => step.stepKey === "initial");

  async function handleCopyAll() {
    if (!templatePack) return;
    const text = templatePack.steps
      .map((step) => {
        const header = `=== Step ${step.stepNumber}: ${step.label} (Day ${step.dayOffset}, ${step.channel}) ===`;
        const subjectLine = step.subject ? `Subject: ${step.subject}\n\n` : "";
        return `${header}\n${subjectLine}${step.body}`;
      })
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1_800);
    } catch {
      // Ignore clipboard failures in restricted browser environments.
    }
  }

  return (
    <article
      className="m3-artifact-card"
      aria-label="Phase 9B human-voice outreach email templates"
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">PHASE 9B · BLASTER-READY OUTREACH TEMPLATES ($0)</p>
          <h2>
            {templatePack
              ? `Human-voice 3-step sequence · v${templatePack.version}`
              : `Generate human-sounding cold email templates${targetIndustryName ? ` for ${targetIndustryName}` : ""}`}
          </h2>
        </div>
        <span
          className={`m3-status-badge ${
            !templatePack
              ? "status-neutral"
              : passedCount === steps.length
                ? "status-approved"
                : "status-awaiting_approval"
          }`}
        >
          {templatePack
            ? `${passedCount}/${steps.length} clean voice`
            : "Ready to generate ($0)"}
        </span>
      </header>

      <p className="m3-artifact-lead">
        Writes short, plain-text emails with standard{" "}
        <code>{"{{first_name}}"}</code> and <code>{"{{company_name}}"}</code> merge variables.
        Enforces strict anti-AI checks: max 60/50/30 words, zero em-dashes, zero exclamation marks,
        lowercase subjects, no pitch dumps in Email 1, and facts strictly from locked research.
      </p>

      {templatePack && (
        <div className="m3-metric-strip">
          <div>
            <span>Sequence steps</span>
            <strong>{steps.length}</strong>
          </div>
          <div>
            <span>Email 1 length</span>
            <strong>
              {email1 ? `${email1.lint.wordCount}/${email1.lint.maxWords} words` : "-"}
            </strong>
          </div>
          <div>
            <span>Voice mode</span>
            <strong>
              {templatePack.generationMode === "llm"
                ? "AI + linter"
                : templatePack.generationMode === "manual"
                  ? "Manual edit"
                  : "Grounded draft"}
            </strong>
          </div>
          <div>
            <span>External spend</span>
            <strong>$0 (Free)</strong>
          </div>
        </div>
      )}

      <div className="m3-buying-committee-grid">
        <div className="m3-chip-group">
          <span className="m3-chip-group-label">Writing voice preset</span>
          <div className="m3-action-row" role="group" aria-label="Writing voice preset">
            {TONE_OPTIONS.map(([value, label]) => (
              <MaterialButton
                key={value}
                variant={selectedTone === value ? "tonal" : "outlined"}
                disabled={isWorking}
                onClick={() => setToneOverride(value)}
              >
                {label}
              </MaterialButton>
            ))}
          </div>
        </div>

        <div className="m3-chip-group">
          <span className="m3-chip-group-label">Email 1 closing ask (CTA style)</span>
          <div className="m3-action-row" role="group" aria-label="CTA style">
            {CTA_OPTIONS.map(([value, label]) => (
              <MaterialButton
                key={value}
                variant={selectedCta === value ? "tonal" : "outlined"}
                disabled={isWorking}
                onClick={() => setCtaOverride(value)}
              >
                {label}
              </MaterialButton>
            ))}
            <MaterialButton
              variant={includeLinkedIn ? "tonal" : "outlined"}
              disabled={isWorking}
              onClick={() => setIncludeLinkedIn((prev) => !prev)}
            >
              {includeLinkedIn ? "Includes LinkedIn note" : "+ Include LinkedIn note"}
            </MaterialButton>
          </div>
        </div>

        {(selectedCta === "free_offer" || Boolean(entryOfferValue.trim())) && (
          <MaterialTextField
            label="Free entry offer for Email 1 (optional)"
            value={entryOfferValue}
            onValueChange={(next) => setEntryOfferOverride(next)}
            placeholder="e.g. a 3-point recall gap breakdown for your clinic"
            supportingText="Only offer something real you can deliver on reply."
            disabled={isWorking}
          />
        )}
      </div>

      {steps.length > 0 && (
        <section className="m3-artifact-section">
          <h3>Sequence overview (click any step to edit or test against a real lead)</h3>
          <div className="m3-person-list">
            {steps.map((step) => (
              <article key={step.stepKey} className="m3-route-card">
                <div className="m3-route-head">
                  <div>
                    <h4>
                      Step {step.stepNumber} · {step.label} (Day {step.dayOffset})
                    </h4>
                    <p className="m3-helper-note">
                      {step.subject ? `Subject: ${step.subject}` : "LinkedIn connection note"}
                      {` · ${step.lint.wordCount}/${step.lint.maxWords} words`}
                    </p>
                  </div>
                  <span
                    className={`m3-status-badge ${
                      step.lint.passed ? "status-approved" : "status-awaiting_approval"
                    }`}
                  >
                    {step.lint.passed ? "Clean voice" : `${step.lint.issues.length} flag`}
                  </span>
                </div>
                <pre className="m3-template-preview-snippet">{step.body}</pre>
                <div className="m3-action-row">
                  <MaterialButton variant="text" onClick={() => onOpenDrawer(step.stepKey)}>
                    Edit &amp; preview on lead
                  </MaterialButton>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <footer className="m3-artifact-footer">
        <div className="m3-action-row">
          <MaterialButton
            variant={templatePack ? "outlined" : "filled"}
            disabled={isWorking}
            onClick={() =>
              onGenerate({
                tone: selectedTone,
                ctaStyle: selectedCta,
                entryOffer: entryOfferValue.trim() || null,
                includeLinkedIn,
              })
            }
          >
            {isWorking
              ? "Writing sequence…"
              : templatePack
                ? "Regenerate sequence (Free)"
                : "Generate human-sounding email sequence (Free)"}
          </MaterialButton>

          {templatePack && (
            <>
              <MaterialButton variant="filled" onClick={() => onOpenDrawer("initial")}>
                Open template studio &amp; lead preview
              </MaterialButton>
              <MaterialButton variant="tonal" onClick={() => void handleCopyAll()}>
                {copiedAll ? "Copied all steps" : "Copy all steps"}
              </MaterialButton>
            </>
          )}

          {onSuggestChangesInChat && (
            <MaterialButton
              variant="outlined"
              onClick={() =>
                onSuggestChangesInChat(
                  "Rewrite Email 1 to be even shorter and sound less salesy for ",
                )
              }
            >
              Refine templates in chat
            </MaterialButton>
          )}
        </div>
      </footer>
    </article>
  );
}

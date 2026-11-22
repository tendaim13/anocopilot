"use client";

import { useState } from "react";

import {
  summarizeLeadExportReadiness,
  type LeadExportScope,
} from "@/lib/ano/lead-export";
import type { OutreachTemplatePackView } from "@/lib/ano/outreach-templates";
import type { ContactCandidateView } from "@/lib/ano/people-playbooks";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";

export async function downloadExportEndpoint(
  url: string,
  fallbackFilename: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Ano could not prepare that export file.";
    throw new Error(message);
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename;

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
}

export interface LeadExportCardProps {
  conversationId: string;
  contacts: ContactCandidateView[];
  templatePack: OutreachTemplatePackView | null;
  isWorking?: boolean;
}

export function LeadExportCard({
  conversationId,
  contacts,
  templatePack,
  isWorking = false,
}: LeadExportCardProps) {
  useMaterialWeb();

  const [scope, setScope] = useState<LeadExportScope>("with_email");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const summary = summarizeLeadExportReadiness(contacts, templatePack);
  const scopedCount =
    scope === "verified_only"
      ? summary.verifiedEmailCount
      : scope === "with_email"
        ? summary.withEmailCount
        : summary.totalLeads;

  async function triggerDownload(url: string, fallbackFilename: string, kind: string) {
    setDownloading(kind);
    setExportError(null);
    try {
      await downloadExportEndpoint(url, fallbackFilename);
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Ano could not download that export file.",
      );
    } finally {
      setDownloading(null);
    }
  }

  return (
    <article
      className="m3-artifact-card"
      aria-label="Phase 9C blaster-ready leads and email templates export pack"
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">PHASE 9C · EXPORT PACK (CSV &amp; TEMPLATES)</p>
          <h2>Export blaster-ready leads list &amp; email templates</h2>
        </div>
        <span
          className={`m3-status-badge ${
            summary.withEmailCount > 0 || summary.templatesReady
              ? "status-approved"
              : "status-neutral"
          }`}
        >
          {summary.withEmailCount > 0 ? `${summary.withEmailCount} with email` : `${summary.totalLeads} named`}
        </span>
      </header>

      <p className="m3-artifact-lead">
        Download RFC-4180 formula-safe CSV files formatted for external email blasters, spreadsheets,
        or manual outreach — no Mercury connection required. Keeps verified vs public-website email
        provenance honest in every row.
      </p>

      <div className="m3-metric-strip">
        <div>
          <span>Total leads</span>
          <strong>{summary.totalLeads}</strong>
        </div>
        <div>
          <span>With email (verified + public)</span>
          <strong>{summary.withEmailCount}</strong>
        </div>
        <div>
          <span>Verified emails</span>
          <strong>{summary.verifiedEmailCount}</strong>
        </div>
        <div>
          <span>Templates ready</span>
          <strong>
            {summary.templatesReady
              ? `${summary.cleanVoiceStepsCount}/${summary.templateStepsCount} clean`
              : "Not generated"}
          </strong>
        </div>
      </div>

      {contacts.length > 0 && (
        <div className="m3-chip-group">
          <span className="m3-chip-group-label">Lead export scope</span>
          <div className="m3-action-row" role="group" aria-label="Lead export scope">
            <MaterialButton
              variant={scope === "with_email" ? "tonal" : "outlined"}
              disabled={isWorking || Boolean(downloading)}
              onClick={() => setScope("with_email")}
            >
              {`With email (${summary.withEmailCount})`}
            </MaterialButton>
            <MaterialButton
              variant={scope === "verified_only" ? "tonal" : "outlined"}
              disabled={isWorking || Boolean(downloading)}
              onClick={() => setScope("verified_only")}
            >
              {`Verified only (${summary.verifiedEmailCount})`}
            </MaterialButton>
            <MaterialButton
              variant={scope === "all" ? "tonal" : "outlined"}
              disabled={isWorking || Boolean(downloading)}
              onClick={() => setScope("all")}
            >
              {`All leads (${summary.totalLeads})`}
            </MaterialButton>
          </div>
        </div>
      )}

      {exportError && (
        <div className="m3-warning-callout" role="alert">
          <strong>Export could not complete</strong>
          <p>{exportError}</p>
        </div>
      )}

      <footer className="m3-artifact-footer">
        <div className="m3-action-row">
          <MaterialButton
            variant="filled"
            disabled={isWorking || Boolean(downloading) || scopedCount === 0}
            onClick={() =>
              void triggerDownload(
                `/api/v1/conversations/${conversationId}/export?format=leads_csv&scope=${scope}`,
                `ano-leads-${scope}.csv`,
                "leads_csv",
              )
            }
          >
            {downloading === "leads_csv"
              ? "Preparing Leads CSV…"
              : `Download Leads CSV (${scopedCount})`}
          </MaterialButton>

          {templatePack && (
            <>
              <MaterialButton
                variant="tonal"
                disabled={isWorking || Boolean(downloading)}
                onClick={() =>
                  void triggerDownload(
                    `/api/v1/conversations/${conversationId}/export?format=templates_csv`,
                    "ano-templates.csv",
                    "templates_csv",
                  )
                }
              >
                {downloading === "templates_csv" ? "Preparing CSV…" : "Download Templates CSV"}
              </MaterialButton>
              <MaterialButton
                variant="outlined"
                disabled={isWorking || Boolean(downloading)}
                onClick={() =>
                  void triggerDownload(
                    `/api/v1/conversations/${conversationId}/export?format=templates_md`,
                    "ano-templates.md",
                    "templates_md",
                  )
                }
              >
                {downloading === "templates_md" ? "Preparing Markdown…" : "Download Templates .md"}
              </MaterialButton>
            </>
          )}
        </div>
      </footer>
    </article>
  );
}

"use client";

import { useState } from "react";

import { buildLeadsCsvDownloadUrl } from "@/lib/ano/autopilot";
import type { CompanySearchView } from "@/lib/ano/company-discovery";
import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import type { OutreachTemplatePackView } from "@/lib/ano/outreach-templates";
import type { PeopleDiscoveryView } from "@/lib/ano/people-playbooks";
import { downloadExportEndpoint } from "@/components/artifacts/lead-export-card";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";

export interface ResultsJumpBarProps {
  conversationId: string;
  synthesis: MarketSynthesis | null;
  companySearch: CompanySearchView | null;
  peopleDiscovery: PeopleDiscoveryView | null;
  templatePack: OutreachTemplatePackView | null;
  isWorking?: boolean;
  onOpenEvidence: () => void;
  onOpenCompanies: () => void;
  onOpenPeople: () => void;
  onOpenTemplates: () => void;
}

export function ResultsJumpBar({
  conversationId,
  synthesis,
  companySearch,
  peopleDiscovery,
  templatePack,
  isWorking = false,
  onOpenEvidence,
  onOpenCompanies,
  onOpenPeople,
  onOpenTemplates,
}: ResultsJumpBarProps) {
  useMaterialWeb();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const companiesCount = companySearch?.accounts.length ?? 0;
  const contacts = peopleDiscovery?.contacts ?? [];
  const contactsWithEmailCount = contacts.filter((c) =>
    Boolean(c.verifiedDetails?.email || c.publicEmail),
  ).length;

  const hasAnyArtifact = Boolean(
    synthesis || companiesCount > 0 || contacts.length > 0 || templatePack,
  );
  if (!hasAnyArtifact) {
    return null;
  }

  async function handleDownloadCsv() {
    setDownloading(true);
    setDownloadError(null);
    const scope = contactsWithEmailCount > 0 ? "with_email" : "all";
    try {
      await downloadExportEndpoint(
        buildLeadsCsvDownloadUrl(conversationId, scope),
        "ano-leads.csv",
      );
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "Ano could not download the leads CSV.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <nav className="m3-results-jump-bar" aria-label="Jump to research results">
      <div className="m3-jump-bar-head">
        <span className="m3-artifact-kicker">JUMP TO RESULTS</span>
        <span className="m3-helper-note">Open any stage drawer or download your ready leads</span>
      </div>
      <div className="m3-jump-bar-actions">
        {synthesis && (
          <MaterialButton variant="outlined" onClick={onOpenEvidence}>
            Market &amp; Evidence
          </MaterialButton>
        )}
        {companiesCount > 0 && (
          <MaterialButton variant="outlined" onClick={onOpenCompanies}>
            {`Companies (${companiesCount})`}
          </MaterialButton>
        )}
        {contacts.length > 0 && (
          <MaterialButton variant="outlined" onClick={onOpenPeople}>
            {`People & Emails (${contactsWithEmailCount || contacts.length})`}
          </MaterialButton>
        )}
        {templatePack && (
          <MaterialButton variant="outlined" onClick={onOpenTemplates}>
            Email Templates
          </MaterialButton>
        )}
        {contacts.length > 0 && (
          <MaterialButton
            variant="filled"
            disabled={isWorking || downloading}
            onClick={() => void handleDownloadCsv()}
          >
            {downloading ? "Preparing CSV…" : "Download Leads CSV"}
          </MaterialButton>
        )}
      </div>
      {downloadError && (
        <p className="m3-helper-note" role="alert">
          {downloadError}
        </p>
      )}
    </nav>
  );
}

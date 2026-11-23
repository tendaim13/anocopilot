"use client";

import { useState } from "react";

import type { ProspeoProviderState } from "@/lib/ano/company-discovery";
import type {
  ContactVerificationRunView,
  DropcontactProviderState,
} from "@/lib/ano/people-playbooks";
import { ApprovalCard } from "@/components/conversation/approval-card";
import { MaterialButton } from "@/components/material/material-button";

export interface ContactVerificationCardProps {
  verificationRun: ContactVerificationRunView;
  prospeo?: ProspeoProviderState | null;
  dropcontact: DropcontactProviderState | null;
  isWorking: boolean;
  onApproveVerification: (verificationRunId: string) => void;
}

export function ContactVerificationCard({
  verificationRun,
  prospeo = null,
  dropcontact,
  isWorking,
  onApproveVerification,
}: ContactVerificationCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isProspeo = verificationRun.providerKey === "prospeo";
  const providerLabel = isProspeo ? "Prospeo" : "Dropcontact";
  const providerAvailable = isProspeo
    ? (prospeo?.available ?? false)
    : (dropcontact?.available ?? false);

  return (
    <article
      className="m3-artifact-card"
      aria-label={`Selective ${providerLabel} verification`}
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">
            STAGE B · SELECTIVE {providerLabel.toUpperCase()} VERIFICATION
          </p>
          <h2>
            {verificationRun.status === "awaiting_approval"
              ? `Verify ${verificationRun.previewPairs.length} selected contact pair${verificationRun.previewPairs.length === 1 ? "" : "s"} (${providerLabel})`
              : verificationRun.status === "running"
                ? `Running selective ${providerLabel} verification…`
                : verificationRun.status === "completed"
                  ? `${providerLabel} verified ${verificationRun.verifiedCount ?? 0} of ${verificationRun.previewPairs.length} selected contacts`
                  : `${providerLabel} verification paused for review`}
          </h2>
        </div>
        <span className={`m3-status-badge status-${verificationRun.status}`}>
          {verificationRun.status.replaceAll("_", " ")}
        </span>
      </header>

      <p className="m3-artifact-lead">
        {`${providerLabel} email verification runs selectively on the ${verificationRun.previewPairs.length} contact${verificationRun.previewPairs.length === 1 ? "" : "s"} you selected.`}
      </p>

      <div className="m3-metric-strip">
        <div>
          <span>Provider</span>
          <strong>
            {isProspeo
              ? "Prospeo bulk verification"
              : "Dropcontact (selective batch)"}
          </strong>
        </div>
        <div>
          <span>Pairs submitted</span>
          <strong>{verificationRun.previewPairs.length}</strong>
        </div>
        <div>
          <span>Batch limit</span>
          <strong>Up to 10 contacts</strong>
        </div>
      </div>

      <section className="m3-artifact-section">
        <h3>Exact name-and-company pairs disclosed</h3>
        <div className="m3-pair-list">
          {verificationRun.previewPairs.map((pair) => (
            <div key={pair.contactId} className="m3-evidence-source-item">
              <div className="m3-evidence-source-top">
                <span className="m3-claim-pill">{pair.fullName}</span>
                <span className="m3-source-tag">{pair.companyName}</span>
              </div>
              <p>
                Fields transmitted: {pair.fieldsSent.join(", ")}
                {pair.website ? ` · ${pair.website}` : ""}
              </p>
            </div>
          ))}
        </div>
      </section>

      {verificationRun.failureMessage &&
        verificationRun.status === "requires_manual_review" && (
          <div className="m3-warning-callout" role="status">
            <strong>No automatic retry attempted</strong>
            <p>{verificationRun.failureMessage}</p>
          </div>
        )}

      {verificationRun.status === "awaiting_approval" && (
        <footer className="m3-artifact-footer">
          <div className="m3-decision-copy">
            <strong>No {providerLabel} request has been sent yet.</strong>
            <p>
              {providerAvailable
                ? "Only the listed pairs above will be submitted. Unselected people are untouched."
                : `Add ${isProspeo ? "PROSPEO_KEY" : "DROPCONTACT_API_KEY"} on the server before approving verification.`}
            </p>
          </div>
          <div className="m3-action-row">
              <MaterialButton
              variant="filled"
              disabled={isWorking || !providerAvailable}
              onClick={() => setConfirmOpen(true)}
            >
              Verify selected contacts
            </MaterialButton>
          </div>
        </footer>
      )}

      <ApprovalCard
        open={confirmOpen}
        title={`Run ${providerLabel} email verification?`}
        body={`Submits ${verificationRun.previewPairs.length} selected contact${verificationRun.previewPairs.length === 1 ? "" : "s"} to ${providerLabel} for work email lookup and verification.`}
        confirmLabel="Verify contacts"
        cancelLabel="Cancel"
        isWorking={isWorking}
        onConfirm={() => {
          setConfirmOpen(false);
          onApproveVerification(verificationRun.id);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </article>
  );
}

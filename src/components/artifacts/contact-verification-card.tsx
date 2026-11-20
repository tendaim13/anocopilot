"use client";

import { useState } from "react";

import type {
  ContactVerificationRunView,
  DropcontactProviderState,
} from "@/lib/ano/people-playbooks";
import { ApprovalCard } from "@/components/conversation/approval-card";
import { MaterialButton } from "@/components/material/material-button";

export interface ContactVerificationCardProps {
  verificationRun: ContactVerificationRunView;
  dropcontact: DropcontactProviderState | null;
  isWorking: boolean;
  onApproveVerification: (verificationRunId: string) => void;
}

export function ContactVerificationCard({
  verificationRun,
  dropcontact,
  isWorking,
  onApproveVerification,
}: ContactVerificationCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dropcontactAvailable = dropcontact?.available ?? false;

  return (
    <article
      className="m3-artifact-card"
      aria-label="Selective Dropcontact verification"
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">STAGE B · SELECTIVE DROPCONTACT VERIFICATION</p>
          <h2>
            {verificationRun.status === "awaiting_approval"
              ? `Verify ${verificationRun.previewPairs.length} selected contact pair${verificationRun.previewPairs.length === 1 ? "" : "s"}`
              : verificationRun.status === "running"
                ? "Running selective Dropcontact verification…"
                : verificationRun.status === "completed"
                  ? `Verified ${verificationRun.verifiedCount ?? 0} of ${verificationRun.previewPairs.length} selected contacts`
                  : "Dropcontact verification paused for review"}
          </h2>
        </div>
        <span className={`m3-status-badge status-${verificationRun.status}`}>
          {verificationRun.status.replaceAll("_", " ")}
        </span>
      </header>

      <p className="m3-artifact-lead">{verificationRun.estimateDetail}</p>

      <div className="m3-metric-strip">
        <div>
          <span>Provider</span>
          <strong>Dropcontact (selective batch)</strong>
        </div>
        <div>
          <span>Pairs submitted</span>
          <strong>{verificationRun.previewPairs.length}</strong>
        </div>
        <div>
          <span>Estimated credits</span>
          <strong>{verificationRun.estimatedCredits}</strong>
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
            <strong>No Dropcontact request has been sent yet.</strong>
            <p>
              {dropcontactAvailable
                ? "Only the listed pairs above will be submitted. Unselected people are untouched."
                : "Add DROPCONTACT_API_KEY on the server before approving verification."}
            </p>
          </div>
          <div className="m3-action-row">
            <MaterialButton
              variant="filled"
              disabled={isWorking || !dropcontactAvailable}
              onClick={() => setConfirmOpen(true)}
            >
              Approve selective verification
            </MaterialButton>
          </div>
        </footer>
      )}

      <ApprovalCard
        open={confirmOpen}
        title="Approve selective Dropcontact verification?"
        body={`Submits ${verificationRun.previewPairs.length} selected name-and-company pair${verificationRun.previewPairs.length === 1 ? "" : "s"} (${verificationRun.estimatedCredits} estimated credit${verificationRun.estimatedCredits === 1 ? "" : "s"}) to Dropcontact.`}
        confirmLabel="Submit selected pairs"
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

"use client";

import { useMemo, useState } from "react";

import type {
  ExecutionProposalType,
  ExecutionProposalView,
  MercuryConnectorState,
  OutreachDraftView,
  OutreachExecutionView,
} from "@/lib/ano/outreach-execution";
import type { AccountPlaybookView } from "@/lib/ano/people-playbooks";
import { ApprovalCard } from "@/components/conversation/approval-card";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";

export interface OutreachDraftCardProps {
  playbooks: AccountPlaybookView[];
  outreachExecution: OutreachExecutionView | null;
  mercury: MercuryConnectorState | null;
  isWorking: boolean;
  onGenerateDrafts: (playbookId?: string) => void;
  onEditDraft: (draftId: string, subject: string, body: string) => void;
  onCreateProposal: (
    draftId: string,
    proposalType: ExecutionProposalType,
    scheduledFor?: string,
    note?: string,
  ) => void;
  onDecideProposal: (
    proposalId: string,
    decision: "approved" | "rejected" | "dismissed",
    rationale?: string,
  ) => void;
}

function channelLabel(channel: OutreachDraftView["channel"]) {
  if (channel === "email") return "Email draft";
  if (channel === "linkedin") return "LinkedIn note (review-only)";
  if (channel === "call_script") return "Call script";
  return "Follow-up draft";
}

function eligibilityBadgeText(status: OutreachDraftView["eligibility"]["status"]) {
  if (status === "eligible") return "Verified eligible";
  if (status === "blocked_unverified_email") return "Requires verified email";
  if (status === "blocked_missing_contact") return "No named contact";
  if (status === "blocked_suppressed") return "Suppressed";
  return "Review-only";
}

function eligibilityBadgeClass(status: OutreachDraftView["eligibility"]["status"]) {
  if (status === "eligible") return "status-approved";
  if (status === "blocked_suppressed") return "status-declined";
  if (status === "review_only_channel") return "status-neutral";
  return "status-awaiting_approval";
}

export function OutreachDraftCard({
  playbooks,
  outreachExecution,
  isWorking,
  onGenerateDrafts,
  onEditDraft,
  onCreateProposal,
  onDecideProposal,
}: OutreachDraftCardProps) {
  useMaterialWeb();

  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [scheduleInput, setScheduleInput] = useState("Next Tuesday 10:00 AM workspace time");
  const [confirmProposal, setConfirmProposal] = useState<ExecutionProposalView | null>(null);

  const drafts = outreachExecution?.drafts ?? [];
  const proposals = outreachExecution?.proposals ?? [];

  const latestDrafts = useMemo(() => {
    const map = new Map<string, OutreachDraftView>();
    for (const draft of drafts) {
      const key = `${draft.accountPlaybookId}:${draft.channel}`;
      const existing = map.get(key);
      if (!existing || draft.version > existing.version) {
        map.set(key, draft);
      }
    }
    return Array.from(map.values());
  }, [drafts]);

  if (playbooks.length === 0 && drafts.length === 0 && proposals.length === 0) {
    return null;
  }

  return (
    <article
      className="m3-artifact-card"
      aria-label="Outreach drafts and action approvals"
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">Outreach Drafts</p>
          <h2>
            {drafts.length === 0
              ? "Compile versioned outreach drafts from approved playbooks"
              : `${latestDrafts.length} channel draft${latestDrafts.length === 1 ? "" : "s"} · ${proposals.filter((p) => p.status === "awaiting_approval").length} awaiting approval`}
          </h2>
        </div>
        <span
          className={`m3-status-badge ${
            proposals.some((p) => p.status === "executed")
              ? "status-approved"
              : proposals.some((p) => p.status === "awaiting_approval")
                ? "status-awaiting_approval"
                : "status-neutral"
          }`}
        >
          {proposals.some((p) => p.status === "awaiting_approval")
            ? "Proposal approval required"
            : "Approval required"}
        </span>
      </header>

      <p className="m3-artifact-lead">
        Every draft runs deterministic suppression and verified-email eligibility checks before
        staging. Emails, calendar invites, and call tasks require individual explicit approvals.
      </p>

      <div className="m3-metric-strip">
        <div>
          <span>Approved playbooks</span>
          <strong>{playbooks.length}</strong>
        </div>
        <div>
          <span>Active draft versions</span>
          <strong>{drafts.length}</strong>
        </div>
        <div>
          <span>Pending proposals</span>
          <strong>{proposals.filter((p) => p.status === "awaiting_approval").length}</strong>
        </div>
        <div>
          <span>Executed actions</span>
          <strong>{proposals.filter((p) => p.status === "executed").length}</strong>
        </div>
      </div>

      {latestDrafts.length > 0 && (
        <section className="m3-artifact-section">
          <h3>Reviewable channel drafts</h3>
          <div className="m3-person-list">
            {latestDrafts.map((draft) => {
              const isEditing = editingDraftId === draft.id;
              return (
                <article key={draft.id} className="m3-route-card">
                  <div className="m3-route-head">
                    <div>
                      <h4>
                        {channelLabel(draft.channel)} · v{draft.version} ({draft.accountName})
                      </h4>
                      <p className="m3-helper-note">
                        {draft.contactName
                          ? `${draft.contactName}${draft.contactEmail ? ` · ${draft.contactEmail}` : ""}`
                          : "No linked contact"}
                        {` · ${draft.claimIds.length} claims · ${draft.signalIds.length} signals`}
                      </p>
                    </div>
                    <span
                      className={`m3-status-badge ${eligibilityBadgeClass(draft.eligibility.status)}`}
                    >
                      {eligibilityBadgeText(draft.eligibility.status)}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="m3-inline-edit">
                      <MaterialTextField
                        label="Draft subject"
                        value={editSubject}
                        onValueChange={setEditSubject}
                        maxLength={240}
                        disabled={isWorking}
                      />
                      <MaterialTextField
                        label="Draft body"
                        type="textarea"
                        rows={5}
                        value={editBody}
                        onValueChange={setEditBody}
                        maxLength={4000}
                        disabled={isWorking}
                      />
                      <div className="m3-action-row">
                        <MaterialButton
                          variant="filled"
                          disabled={isWorking || !editSubject.trim() || !editBody.trim()}
                          onClick={() => {
                            onEditDraft(draft.id, editSubject, editBody);
                            setEditingDraftId(null);
                          }}
                        >
                          Save v{draft.version + 1}
                        </MaterialButton>
                        <MaterialButton
                          variant="text"
                          disabled={isWorking}
                          onClick={() => setEditingDraftId(null)}
                        >
                          Cancel
                        </MaterialButton>
                      </div>
                    </div>
                  ) : (
                    <>
                      <strong>{draft.subject}</strong>
                      <p className="m3-draft-body">{draft.body}</p>
                      {draft.callScriptPoints.length > 0 && (
                        <ul className="m3-bullet-list">
                          {draft.callScriptPoints.map((pt) => (
                            <li key={pt}>{pt}</li>
                          ))}
                        </ul>
                      )}
                      <p className="m3-helper-note">{draft.eligibility.reasons[0]}</p>

                      <div className="m3-action-row">
                        <MaterialButton
                          variant="outlined"
                          disabled={isWorking}
                          onClick={() => {
                            setEditingDraftId(draft.id);
                            setEditSubject(draft.subject);
                            setEditBody(draft.body);
                          }}
                        >
                          Edit version
                        </MaterialButton>

                        {(draft.channel === "email" || draft.channel === "follow_up") && (
                          <MaterialButton
                            variant="filled"
                            disabled={isWorking || !draft.eligibility.canProposeEmailSend}
                            onClick={() => onCreateProposal(draft.id, "email_send")}
                          >
                            Propose email send
                          </MaterialButton>
                        )}

                        {draft.channel === "email" && (
                          <MaterialButton
                            variant="tonal"
                            disabled={isWorking || !draft.eligibility.canProposeCalendarSchedule}
                            onClick={() =>
                              onCreateProposal(draft.id, "calendar_schedule", scheduleInput)
                            }
                          >
                            Propose calendar invite
                          </MaterialButton>
                        )}

                        {draft.channel === "call_script" && (
                          <MaterialButton
                            variant="tonal"
                            disabled={isWorking || !draft.eligibility.canProposeCallTask}
                            onClick={() => onCreateProposal(draft.id, "call_task")}
                          >
                            Propose call task
                          </MaterialButton>
                        )}
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {latestDrafts.some((d) => d.channel === "email" && d.eligibility.canProposeCalendarSchedule) && (
        <div className="m3-inline-edit">
          <MaterialTextField
            label="Proposed meeting slot label for calendar invite proposals"
            value={scheduleInput}
            onValueChange={setScheduleInput}
            disabled={isWorking}
          />
        </div>
      )}

      {proposals.length > 0 && (
        <section className="m3-artifact-section">
          <h3>Outbound action proposals ({proposals.length})</h3>
          <div className="m3-person-list">
            {proposals.map((proposal) => (
              <article key={proposal.id} className="m3-evidence-source-item">
                <div className="m3-person-title-row">
                  <span className="m3-claim-pill">
                    {proposal.proposalType.startsWith("mercury_")
                      ? "CRM sync"
                      : proposal.proposalType.replaceAll("_", " ")}
                  </span>
                  <span className={`m3-status-badge status-${proposal.status}`}>
                    {proposal.status.replaceAll("_", " ")}
                  </span>
                </div>
                <strong>{proposal.summary}</strong>
                {proposal.executedAt && (
                  <small>
                    Executed {new Date(proposal.executedAt).toLocaleString()} · Receipt recorded
                  </small>
                )}
                {proposal.status === "awaiting_approval" && (
                  <div className="m3-action-row">
                    <MaterialButton
                      variant="filled"
                      disabled={isWorking}
                      onClick={() => setConfirmProposal(proposal)}
                    >
                      Approve & record
                    </MaterialButton>
                    <MaterialButton
                      variant="outlined"
                      disabled={isWorking}
                      onClick={() => onDecideProposal(proposal.id, "rejected")}
                    >
                      Reject
                    </MaterialButton>
                    <MaterialButton
                      variant="text"
                      disabled={isWorking}
                      onClick={() => onDecideProposal(proposal.id, "dismissed")}
                    >
                      Dismiss
                    </MaterialButton>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      <footer className="m3-artifact-footer">
        <div className="m3-action-row">
          <MaterialButton
            variant={drafts.length === 0 ? "filled" : "outlined"}
            disabled={isWorking || playbooks.length === 0}
            onClick={() => onGenerateDrafts()}
          >
            {isWorking
              ? "Updating outreach…"
              : drafts.length === 0
                ? "Compile outreach drafts (Email, LinkedIn, Call, Follow-up)"
                : "Refresh outreach drafts from playbooks"}
          </MaterialButton>
        </div>
      </footer>

      {confirmProposal && (
        <ApprovalCard
          open={Boolean(confirmProposal)}
          title="Approve this outbound action?"
          body={`${confirmProposal.summary}. Approval records an immutable decision and audit receipt.`}
          confirmLabel="Approve action"
          cancelLabel="Keep reviewing"
          isWorking={isWorking}
          onConfirm={() => {
            const target = confirmProposal;
            setConfirmProposal(null);
            onDecideProposal(target.id, "approved");
          }}
          onCancel={() => setConfirmProposal(null)}
        />
      )}
    </article>
  );
}

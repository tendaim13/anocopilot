"use client";

import { useState } from "react";

import type { ResearchPlan } from "@/lib/ano/research-conversation";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";

export interface ResearchPlanCardProps {
  plan: ResearchPlan;
  isWorking: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onEdit: (instruction: string) => void;
}

function approvalBadgeText(status: ResearchPlan["approvalStatus"]) {
  if (status === "approved") return "Approved";
  if (status === "declined") return "Declined";
  return "Awaiting approval";
}

export function ResearchPlanCard({
  plan,
  isWorking,
  onApprove,
  onDecline,
  onEdit,
}: ResearchPlanCardProps) {
  useMaterialWeb();
  const [editOpen, setEditOpen] = useState(false);
  const [instruction, setInstruction] = useState("");

  function submitEdit() {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    onEdit(trimmed);
    setEditOpen(false);
    setInstruction("");
  }

  return (
    <article className="m3-artifact-card m3-plan-artifact" aria-label={`Research plan version ${plan.version}`}>
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">RESEARCH PLAN · VERSION {plan.version}</p>
          <h2>{plan.summary}</h2>
        </div>
        <span className={`m3-status-badge status-${plan.approvalStatus}`}>
          {approvalBadgeText(plan.approvalStatus)}
        </span>
      </header>

      <div className="m3-artifact-grid">
        <section className="m3-artifact-section">
          <h3>Questions Ano will answer</h3>
          <ol className="m3-numbered-list">
            {plan.researchQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ol>
        </section>

        <section className="m3-artifact-section">
          <h3>Comparison criteria</h3>
          <md-chip-set aria-label="Comparison criteria">
            {plan.comparisonCriteria.map((criterion) => (
              <md-assist-chip key={criterion}>{criterion}</md-assist-chip>
            ))}
          </md-chip-set>
        </section>
      </div>

      <div className="m3-scope-strip">
        <div>
          <span>Markets</span>
          <strong>{plan.plannedScope.markets.join(", ") || "Determined from research"}</strong>
        </div>
        <div>
          <span>Industries</span>
          <strong>{plan.plannedScope.industries.join(", ") || "Evaluated from evidence"}</strong>
        </div>
        <div>
          <span>Buyer roles</span>
          <strong>{plan.plannedScope.buyerRoles.join(", ") || "Evaluated from evidence"}</strong>
        </div>
        <div>
          <span>Planned ceiling</span>
          <strong>
            Up to {plan.budget.maximumSearches} searches · {plan.budget.maximumFetches} fetches
          </strong>
        </div>
      </div>

      <section className="m3-artifact-section">
        <h3>Intended source classes</h3>
        <md-chip-set aria-label="Intended source classes">
          {plan.intendedSourceClasses.map((sourceClass) => (
            <md-assist-chip key={sourceClass}>{sourceClass}</md-assist-chip>
          ))}
        </md-chip-set>
      </section>

      {plan.uncertainties.length > 0 && (
        <section className="m3-artifact-section m3-muted-callout">
          <h3>Open uncertainties</h3>
          <ul className="m3-bullet-list">
            {plan.uncertainties.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {plan.approvalStatus === "awaiting_approval" && (
        <footer className="m3-artifact-footer">
          <div className="m3-decision-copy">
            <strong>Does this research plan look right?</strong>
            <p>
              Approving locks the plan for Phase B. No external web search or provider request
              starts until you approve a separate provider scope.
            </p>
          </div>
          <div className="m3-action-row">
            <MaterialButton variant="filled" disabled={isWorking} onClick={onApprove}>
              {isWorking ? "Saving…" : "Approve plan"}
            </MaterialButton>
            <MaterialButton
              variant="tonal"
              disabled={isWorking}
              onClick={() => setEditOpen((current) => !current)}
            >
              {editOpen ? "Cancel edit" : "Edit plan"}
            </MaterialButton>
            <MaterialButton variant="text" disabled={isWorking} onClick={onDecline}>
              Decline
            </MaterialButton>
          </div>

          {editOpen && (
            <div className="m3-inline-edit">
              <MaterialTextField
                label="How Ano should revise this plan"
                type="textarea"
                rows={3}
                value={instruction}
                onValueChange={setInstruction}
                placeholder="Focus first on Malaysia and Singapore commercial property managers…"
                disabled={isWorking}
              />
              <div className="m3-action-row">
                <MaterialButton
                  variant="filled"
                  disabled={isWorking || !instruction.trim()}
                  onClick={submitEdit}
                >
                  Update plan
                </MaterialButton>
              </div>
            </div>
          )}
        </footer>
      )}

      {plan.approvalStatus === "declined" && (
        <footer className="m3-artifact-footer m3-notice-subtle">
          <strong>Plan declined.</strong> No external research was started. Send a new message below
          to try a different direction.
        </footer>
      )}
    </article>
  );
}

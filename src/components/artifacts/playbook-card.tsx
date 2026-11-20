"use client";

import type { AccountPlaybookView } from "@/lib/ano/people-playbooks";

export interface PlaybookCardProps {
  playbook: AccountPlaybookView;
}

function provenanceLabel(
  provenance: AccountPlaybookView["buyerAngles"][number]["contactProvenance"],
) {
  if (provenance === "verified_contact") return "Verified contact";
  if (provenance === "named_unverified") return "Named (unverified)";
  return "Role hypothesis";
}

function pointBadge(
  kind: AccountPlaybookView["evidenceBackedPoints"][number]["kind"],
) {
  if (kind === "research_claim") return "Research claim";
  if (kind === "company_signal") return "Company signal";
  return "Contact record";
}

export function PlaybookCard({ playbook }: PlaybookCardProps) {
  return (
    <article
      className="m3-artifact-card"
      aria-label={`Factual playbook for ${playbook.accountName}`}
    >
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">FACTUAL ACCOUNT PLAYBOOK · PROVENANCE-LOCKED</p>
          <h2>{playbook.headline}</h2>
          <p className="m3-helper-note">
            {playbook.targetMarketName} · {playbook.targetIndustryName}
          </p>
        </div>
        <span className="m3-status-badge status-approved">{playbook.status}</span>
      </header>

      <div className="m3-reasoning-callout">
        <strong>Account thesis (Company evidence)</strong>
        <p className="m3-artifact-lead">{playbook.accountThesis}</p>
        <p className="m3-helper-note">{playbook.industryContext}</p>
      </div>

      <section className="m3-artifact-section">
        <h3>Buyer messaging angles ({playbook.buyerAngles.length})</h3>
        <div className="m3-route-grid">
          {playbook.buyerAngles.map((angle, index) => (
            <article
              key={`${angle.contactId ?? angle.roleTitle}-${index}`}
              className="m3-route-card"
            >
              <div className="m3-route-head">
                <h4>{angle.personName ? `${angle.personName} · ${angle.roleTitle}` : angle.roleTitle}</h4>
                <span className="m3-claim-pill">
                  {provenanceLabel(angle.contactProvenance)}
                </span>
              </div>
              <p>{angle.openingAngle}</p>
              <strong>Hypothesis to validate</strong>
              <p>{angle.valueHypothesis}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="m3-artifact-section">
        <h3>Grounded evidence lineage ({playbook.evidenceBackedPoints.length})</h3>
        <ul className="m3-claim-list">
          {playbook.evidenceBackedPoints.map((point) => (
            <li key={`${point.kind}-${point.refId}`}>
              <span className="m3-claim-pill">{pointBadge(point.kind)}</span>
              <span>{point.statement}</span>
              <small className="m3-comparison-basis">{point.attribution}</small>
            </li>
          ))}
        </ul>
      </section>

      <div className="m3-artifact-grid">
        <section className="m3-artifact-section">
          <h3>First-call validation questions</h3>
          <ol className="m3-numbered-list">
            {playbook.validationQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </section>

        <section className="m3-artifact-section">
          <h3>Explicit unknowns</h3>
          <ul className="m3-bullet-list">
            {playbook.unknowns.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { WorkspaceRuntime } from "@/contracts/ano";
import type { StandaloneBriefInput, StandaloneBriefResult } from "@/lib/ano/standalone";

const starterInput: StandaloneBriefInput = {
  companyName: "",
  companyIndustry: "",
  companyLocation: "",
  contactName: "",
  contactRole: "",
  accountContext: "",
  salesObjective: "",
};

const navigation = [
  ["▦", "Today"],
  ["◫", "Account brief"],
  ["✓", "Plan"],
  ["⚙", "Controls"],
];

function readinessTone(score: number) {
  if (score >= 75) return "score-high";
  if (score >= 55) return "score-mid";
  return "score-low";
}

export function StandaloneWorkbench() {
  const [input, setInput] = useState<StandaloneBriefInput>(starterInput);
  const [result, setResult] = useState<StandaloneBriefResult | null>(null);
  const [workspaceRuntime, setWorkspaceRuntime] = useState<WorkspaceRuntime | null>(null);
  const [workspaceError, setWorkspaceError] = useState<{ code?: string; error: string } | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/workspace")
      .then(async (response) => ({ response, payload: (await response.json()) as WorkspaceRuntime | { error: string; code?: string } }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        if (response.ok && "workspace" in payload) {
          setWorkspaceRuntime(payload);
          setWorkspaceError(null);
        } else if ("error" in payload) {
          setWorkspaceError(payload);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const signInRequired = workspaceError?.code === "AUTH_REQUIRED";
  const workspaceSetupRequired = workspaceError?.code === "WORKSPACE_REQUIRED";
  const liveWorkspace = workspaceRuntime?.mode === "supabase";
  const workspaceName = workspaceRuntime?.workspace.name ?? (signInRequired ? "Sign in required" : workspaceSetupRequired ? "Set up workspace" : "Ano workspace");

  function update(field: keyof StandaloneBriefInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  async function createBrief() {
    setError(null);
    if (signInRequired || workspaceSetupRequired) {
      setError(workspaceSetupRequired ? "Create your Ano workspace before saving a workspace brief." : "Sign in before Ano can prepare and save a workspace brief.");
      return;
    }
    setIsRunning(true);
    try {
      const response = await fetch("/api/v1/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Ano-Idempotency-Key": window.crypto.randomUUID() },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as StandaloneBriefResult | { error?: string };
      if (!response.ok || !("brief" in payload)) {
        throw new Error("error" in payload ? payload.error : "Ano could not prepare this workspace brief.");
      }
      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ano could not prepare this workspace brief.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>◖</span><span>◗</span></div>
          <div><strong>Ano</strong><small>Sales copilot</small></div>
        </div>
        <nav aria-label="Ano workspace">
          {navigation.map(([icon, label]) => <button key={label} className={`nav-item ${label === "Account brief" ? "active" : ""}`} type="button"><span aria-hidden="true">{icon}</span>{label}</button>)}
        </nav>
        <div className="sidebar-footer">
          <div className="safe-mode"><span className="live-dot" /> {liveWorkspace ? "Private workspace" : signInRequired ? "Sign in required" : "Workspace setup required"}</div>
          <div className="account-chip"><span className="avatar">TM</span><span>Tendai Midzi</span><span className="chevron">⌄</span></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="crumbs"><span>Workspace</span><b>/</b><strong>{workspaceName}</strong></div>
          <div className="topbar-actions">
            <span className="manual-badge">Standalone</span>
            {signInRequired && <Link href="/login" className="topbar-signin">Sign in</Link>}
            {workspaceSetupRequired && <Link href="/onboarding" className="topbar-signin">Create workspace</Link>}
            <button className="icon-button" type="button" aria-label="Notifications">◌</button>
            <button className="avatar-button" type="button" aria-label="Account">TM</button>
          </div>
        </header>

        <div className="page-wrap">
          <section className="page-heading">
            <div>
              <p className="eyebrow">WORKSPACE-ONLY SALES COPILOT</p>
              <h1>Build an account brief</h1>
              <p className="lede">Give Ano the account context you already know. It will turn that record into a reviewable brief, outreach draft, and work plan.</p>
            </div>
            <div className="mode-note"><span>✦</span><div><b>Truthful by design</b><small>Ano uses only the information entered in this workspace. No prospect data is invented or fetched.</small></div></div>
          </section>

          <section className="stat-row" aria-label="Ano boundaries">
            <div className="stat-card"><span>Grounding</span><b>Workspace input</b><small>Manual records and notes only</small></div>
            <div className="stat-card"><span>Reasoning</span><b>Bedrock</b><small>One guarded server-side brief</small></div>
            <div className="stat-card"><span>Data sources</span><b>None connected</b><small>No Mercury or enrichment provider</small></div>
            <div className="stat-card"><span>Actions</span><b>Review only</b><small>No email, call, or CRM write</small></div>
          </section>

          <section className="research-layout">
            <section className="panel research-form-panel">
              <div className="panel-heading"><div><p className="section-kicker">01 — ADD THE CONTEXT</p><h2>What does Ano know about this account?</h2></div><span className="required-note">* Required</span></div>
              <div className="form-grid">
                <label>Account name *<input value={input.companyName} onChange={(event) => update("companyName", event.target.value)} placeholder="Company name" /></label>
                <label>Industry *<input value={input.companyIndustry} onChange={(event) => update("companyIndustry", event.target.value)} placeholder="Industry" /></label>
                <label>Location *<input value={input.companyLocation} onChange={(event) => update("companyLocation", event.target.value)} placeholder="City, region, or market" /></label>
                <label>Sales objective *<input value={input.salesObjective} onChange={(event) => update("salesObjective", event.target.value)} placeholder="What outcome do you want to work toward?" /></label>
                <label>Contact name <input value={input.contactName} onChange={(event) => update("contactName", event.target.value)} placeholder="Optional" /></label>
                <label>Contact role <input value={input.contactRole} onChange={(event) => update("contactRole", event.target.value)} placeholder="Optional" /></label>
                <label className="wide-field">Account context *
                  <textarea value={input.accountContext} onChange={(event) => update("accountContext", event.target.value)} rows={7} placeholder="Paste notes from a call, write what the company does, its current workflow, challenges, timing, and anything that must shape the conversation." />
                </label>
              </div>
              {error && <div className="error-box"><span>!</span><p>{error}</p></div>}
              <div className="form-footer"><p><span>⌁</span> Your record stays in Ano. The brief will be a proposal for review, never an automatic action.</p><button className="primary-button" type="button" onClick={createBrief} disabled={isRunning}>{isRunning ? "Preparing brief…" : "Create workspace brief"}<span>→</span></button></div>
            </section>

            <section className="panel how-panel">
              <div className="panel-heading"><div><p className="section-kicker">HOW IT WORKS</p><h2>Self-contained first</h2></div></div>
              <ol className="how-list">
                <li><span>1</span><div><b>Capture</b><p>You enter the account record and the context you trust.</p></div></li>
                <li><span>2</span><div><b>Ground</b><p>Ano cites only those workspace records.</p></div></li>
                <li><span>3</span><div><b>Plan</b><p>Bedrock creates a brief and draft for your review.</p></div></li>
                <li><span>4</span><div><b>Decide</b><p>You choose what happens next. Nothing is sent automatically.</p></div></li>
              </ol>
            </section>
          </section>

          {result ? <BriefResult result={result} /> : <section className="empty-state panel"><div className="empty-orbit">✦</div><h2>Your first workspace brief will appear here</h2><p>Enter an account and the context you already have. Ano will not fill the gap with simulated research.</p></section>}
        </div>
      </section>
    </main>
  );
}

function BriefResult({ result }: { result: StandaloneBriefResult }) {
  return <>
    <section className="results-heading"><div><p className="section-kicker">02 — REVIEW THE BRIEF</p><h2>{result.account.name}</h2><p>{result.run.message}</p></div><div className="run-complete"><span>✓</span> Workspace brief saved</div></section>
    <section className="standalone-results">
      <article className="brief-panel standalone-brief">
        <div className="brief-top"><div><p className="section-kicker">ANO BRIEF</p><h2>{result.account.name}</h2><p>{result.account.industry} · {result.account.location}</p></div><span className="confidence-badge">Workspace grounded</span></div>
        <section className="brief-block"><h3>Summary</h3><p>{result.brief.summary}</p></section>
        <section className="brief-block"><h3>Why this approach</h3><p>{result.brief.rationale}</p></section>
        <section className="brief-block"><h3>Known from your workspace</h3><ul className="plain-list">{result.brief.knownFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul></section>
        <section className="brief-block"><h3>Questions to resolve</h3><ul className="plain-list">{result.brief.questions.length ? result.brief.questions.map((question) => <li key={question}>{question}</li>) : <li>No open question was proposed.</li>}</ul></section>
        {result.brief.assumptions.length > 0 && <section className="brief-block"><h3>Assumptions to check</h3><ul className="plain-list">{result.brief.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></section>}
      </article>
      <div className="standalone-side">
        <article className="panel readiness-card"><p className="section-kicker">INFORMATION READINESS</p><div className="readiness-score"><b className={readinessTone(result.readiness.score)}>{result.readiness.score}</b><span>/100</span></div><p>{result.readiness.label} · this measures context completeness, not the likelihood of purchase.</p>{result.readiness.components.map((component) => <div className="score-row" key={component.label}><div><span>{component.label}</span><b>{component.score}/{component.maximum}</b></div><div className="progress"><span className={component.tone} style={{ width: `${(component.score / component.maximum) * 100}%` }} /></div></div>)}</article>
        <article className="panel evidence-panel"><p className="section-kicker">SOURCE RECORDS</p><h2>Workspace evidence</h2>{result.evidence.map((item) => <div className="evidence-item" key={item.id}><span>◌</span><div><b>{item.label} <em>{item.id}</em></b><p>{item.observation}</p><small>Entered in Ano · not externally verified</small></div></div>)}</article>
      </div>
    </section>
    <section className="brief-output-grid">
      <article className="panel draft-panel"><p className="section-kicker">HUMAN-REVIEW DRAFT</p><h2>{result.brief.outreach.subject}</h2><p className="draft-body">{result.brief.outreach.body}</p><small>This draft is not sent anywhere.</small></article>
      <article className="panel plan-section"><div className="panel-heading"><div><p className="section-kicker">03 — PLAN THE WORK</p><h2>Ano plan</h2></div><span className="plan-label">Review before action</span></div><div className="plan-list">{result.plan.map((item) => <article className="plan-item" key={item.id}><span className={`priority-dot ${item.priority.toLowerCase().replaceAll(" ", "-")}`} /><div><div className="plan-title"><h3>{item.title}</h3><span>{item.action}</span></div><p>{item.reason} <em>[{item.evidenceIds.join(", ")}]</em></p></div><b>{item.priority}</b></article>)}</div></article>
    </section>
  </>;
}

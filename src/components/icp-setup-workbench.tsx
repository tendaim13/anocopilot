"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { WorkspaceRuntime } from "@/contracts/ano";
import type { IcpProfileInput, IcpProfileResult } from "@/lib/ano/icp";

const starterInput: IcpProfileInput = {
  productName: "",
  productDescription: "",
  valueProposition: "",
  targetMarket: "",
  targetLocations: "",
  idealCustomerProfile: "",
  buyerRoles: "",
  salesObjective: "",
  exclusions: "",
  contextNotes: "",
};

const navigation = [["▦", "Today"], ["◎", "Market profile"], ["⌕", "Research plan"], ["✓", "Plan"], ["⚙", "Controls"]];

function readinessTone(score: number) {
  if (score >= 75) return "score-high";
  if (score >= 55) return "score-mid";
  return "score-low";
}

export function IcpSetupWorkbench() {
  const [input, setInput] = useState<IcpProfileInput>(starterInput);
  const [result, setResult] = useState<IcpProfileResult | null>(null);
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
        } else if ("error" in payload) setWorkspaceError(payload);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const signInRequired = workspaceError?.code === "AUTH_REQUIRED";
  const workspaceSetupRequired = workspaceError?.code === "WORKSPACE_REQUIRED";
  const liveWorkspace = workspaceRuntime?.mode === "supabase";
  const workspaceName = workspaceRuntime?.workspace.name ?? (signInRequired ? "Sign in required" : workspaceSetupRequired ? "Set up workspace" : "Ano workspace");

  function update(field: keyof IcpProfileInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  async function createIcp() {
    setError(null);
    if (signInRequired || workspaceSetupRequired) {
      setError(workspaceSetupRequired ? "Create your Ano workspace before saving a market profile." : "Sign in before Ano can prepare and save your market profile.");
      return;
    }
    setIsRunning(true);
    try {
      const response = await fetch("/api/v1/icp", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Ano-Idempotency-Key": window.crypto.randomUUID() },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as IcpProfileResult | { error?: string };
      if (!response.ok || !("brief" in payload)) throw new Error("error" in payload ? payload.error : "Ano could not prepare this market profile.");
      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ano could not prepare this market profile.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark"><span>◖</span><span>◗</span></div><div><strong>Ano</strong><small>Sales copilot</small></div></div>
        <nav aria-label="Ano workspace">{navigation.map(([icon, label]) => <button key={label} className={`nav-item ${label === "Market profile" ? "active" : ""}`} type="button"><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>
        <div className="sidebar-footer"><div className="safe-mode"><span className="live-dot" /> {liveWorkspace ? "Private workspace" : signInRequired ? "Sign in required" : "Workspace setup required"}</div><div className="account-chip"><span className="avatar">TM</span><span>Tendai Midzi</span><span className="chevron">⌄</span></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="crumbs"><span>Workspace</span><b>/</b><strong>{workspaceName}</strong></div><div className="topbar-actions"><span className="manual-badge">Standalone</span>{signInRequired && <Link href="/login" className="topbar-signin">Sign in</Link>}{workspaceSetupRequired && <Link href="/onboarding" className="topbar-signin">Create workspace</Link>}<button className="icon-button" type="button" aria-label="Notifications">◌</button><button className="avatar-button" type="button" aria-label="Account">TM</button></div></header>

        <div className="page-wrap">
          <section className="page-heading"><div><p className="eyebrow">YOUR GO-TO-MARKET CONTEXT</p><h1>Set up Ano</h1><p className="lede">Start with what you sell and who you serve. Ano will shape an ICP and research plan before it ever works on a target account.</p></div><div className="mode-note"><span>✦</span><div><b>No account required</b><small>Account briefs come later, after you choose or add a real target.</small></div></div></section>

          <section className="stat-row" aria-label="Ano boundaries"><div className="stat-card"><span>Grounding</span><b>Your market context</b><small>Offer, customers, buyers, and goals</small></div><div className="stat-card"><span>Reasoning</span><b>Bedrock</b><small>One guarded server-side ICP</small></div><div className="stat-card"><span>Data sources</span><b>None connected</b><small>No Mercury or enrichment provider</small></div><div className="stat-card"><span>Actions</span><b>Planning only</b><small>No email, call, or CRM write</small></div></section>

          <section className="research-layout">
            <section className="panel research-form-panel">
              <div className="panel-heading"><div><p className="section-kicker">01 — DEFINE YOUR MARKET</p><h2>What should Ano understand first?</h2></div><span className="required-note">* Required</span></div>
              <div className="form-grid">
                <label>Product or service *<input value={input.productName} onChange={(event) => update("productName", event.target.value)} placeholder="e.g. Quote-to-job workflow software" /></label>
                <label>Sales objective *<input value={input.salesObjective} onChange={(event) => update("salesObjective", event.target.value)} placeholder="e.g. Define our first outbound market" /></label>
                <label className="wide-field">What do you sell? *<textarea value={input.productDescription} onChange={(event) => update("productDescription", event.target.value)} rows={4} placeholder="Describe the product or service, its core capability, and how customers use it." /></label>
                <label className="wide-field">What outcome do you create? *<textarea value={input.valueProposition} onChange={(event) => update("valueProposition", event.target.value)} rows={3} placeholder="Describe the customer problem you solve and the result you help create." /></label>
                <label>Target market *<input value={input.targetMarket} onChange={(event) => update("targetMarket", event.target.value)} placeholder="Industries or customer segments" /></label>
                <label>Target locations *<input value={input.targetLocations} onChange={(event) => update("targetLocations", event.target.value)} placeholder="Countries, regions, or cities" /></label>
                <label className="wide-field">Ideal customer profile *<textarea value={input.idealCustomerProfile} onChange={(event) => update("idealCustomerProfile", event.target.value)} rows={3} placeholder="Company type, size, operating model, current process, or signals that make a customer a good fit. Write ‘Not sure’ if you need Ano to help define it." /></label>
                <label>Buyer roles *<input value={input.buyerRoles} onChange={(event) => update("buyerRoles", event.target.value)} placeholder="e.g. Operations Director, Founder" /></label>
                <label>Who should Ano avoid? <input value={input.exclusions} onChange={(event) => update("exclusions", event.target.value)} placeholder="Optional industries, regions, company types" /></label>
                <label className="wide-field">Additional context <textarea value={input.contextNotes} onChange={(event) => update("contextNotes", event.target.value)} rows={4} placeholder="Optional: existing customers, current channels, language, pricing, positioning, or constraints Ano should respect." /></label>
              </div>
              {error && <div className="error-box"><span>!</span><p>{error}</p></div>}
              <div className="form-footer"><p><span>⌁</span> This creates your market profile—not a prospect record. Ano will not invent companies, people, or data.</p><button className="primary-button" type="button" onClick={createIcp} disabled={isRunning}>{isRunning ? "Preparing ICP…" : "Create ICP & plan"}<span>→</span></button></div>
            </section>
            <section className="panel how-panel"><div className="panel-heading"><div><p className="section-kicker">HOW IT WORKS</p><h2>Start with your business</h2></div></div><ol className="how-list"><li><span>1</span><div><b>Define</b><p>Describe your offer, target market, and buyer.</p></div></li><li><span>2</span><div><b>Ground</b><p>Ano cites only the information you enter.</p></div></li><li><span>3</span><div><b>Map</b><p>Bedrock produces an ICP and research plan.</p></div></li><li><span>4</span><div><b>Research later</b><p>Target accounts come after the market is clear.</p></div></li></ol></section>
          </section>

          {result ? <IcpResult result={result} /> : <section className="empty-state panel"><div className="empty-orbit">✦</div><h2>Your ICP and research plan will appear here</h2><p>Define the business and market first. Ano will not fabricate accounts or data while connectors remain off.</p></section>}
        </div>
      </section>
    </main>
  );
}

function IcpResult({ result }: { result: IcpProfileResult }) {
  return <>
    <section className="results-heading"><div><p className="section-kicker">02 — REVIEW YOUR ICP</p><h2>{result.profile.productName}</h2><p>{result.run.message}</p></div><div className="run-complete"><span>✓</span> Market profile saved</div></section>
    <section className="standalone-results"><article className="brief-panel standalone-brief"><div className="brief-top"><div><p className="section-kicker">ANO ICP</p><h2>{result.profile.targetMarket}</h2><p>{result.profile.targetLocations}</p></div><span className="confidence-badge">Workspace grounded</span></div><section className="brief-block"><h3>Positioning</h3><p>{result.brief.positioning}</p></section><section className="brief-block"><h3>Ideal customer profile</h3><p>{result.brief.idealCustomerSummary}</p></section><section className="brief-block"><h3>Known from your workspace</h3><ul className="plain-list">{result.brief.knownFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul></section><section className="brief-block"><h3>Questions to resolve</h3><ul className="plain-list">{result.brief.questions.length ? result.brief.questions.map((question) => <li key={question}>{question}</li>) : <li>No open question was proposed.</li>}</ul></section>{result.brief.assumptions.length > 0 && <section className="brief-block"><h3>Assumptions to check</h3><ul className="plain-list">{result.brief.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></section>}</article><div className="standalone-side"><article className="panel readiness-card"><p className="section-kicker">ICP READINESS</p><div className="readiness-score"><b className={readinessTone(result.readiness.score)}>{result.readiness.score}</b><span>/100</span></div><p>{result.readiness.label} · this measures context completeness, not market demand or likelihood to buy.</p>{result.readiness.components.map((component) => <div className="score-row" key={component.label}><div><span>{component.label}</span><b>{component.score}/{component.maximum}</b></div><div className="progress"><span className={component.tone} style={{ width: `${(component.score / component.maximum) * 100}%` }} /></div></div>)}</article><article className="panel evidence-panel"><p className="section-kicker">SOURCE RECORDS</p><h2>Your market context</h2>{result.evidence.map((item) => <div className="evidence-item" key={item.id}><span>◌</span><div><b>{item.label} <em>{item.id}</em></b><p>{item.observation}</p><small>Entered in Ano · not externally verified</small></div></div>)}</article></div></section>
    <section className="brief-output-grid"><article className="panel draft-panel"><p className="section-kicker">NEXT STAGE</p><h2>Account briefs come after targeting</h2><p className="draft-body">This profile will guide future account research and prioritisation. Ano has not found, created, or contacted any prospect.</p><small>Connectors remain off.</small></article><article className="panel plan-section"><div className="panel-heading"><div><p className="section-kicker">03 — PLAN THE RESEARCH</p><h2>Ano plan</h2></div><span className="plan-label">Review before action</span></div><div className="plan-list">{result.plan.map((item) => <article className="plan-item" key={item.id}><span className={`priority-dot ${item.priority.toLowerCase().replaceAll(" ", "-")}`} /><div><div className="plan-title"><h3>{item.title}</h3><span>{item.action}</span></div><p>{item.reason} <em>[{item.evidenceIds.join(", ")}]</em></p></div><b>{item.priority}</b></article>)}</div></article></section>
  </>;
}

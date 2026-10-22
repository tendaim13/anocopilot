"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { WorkspaceRuntime } from "@/contracts/ano";
import type { MarketBriefResult, MarketDecisionInput, ProductBriefInput } from "@/lib/ano/market-discovery";

const starterInput: ProductBriefInput = {
  offer: "",
  objective: "",
  marketHunch: "",
  locationPreference: "",
  buyerHunch: "",
  customerExamples: "",
  exclusions: "",
  additionalContext: "",
};

const navigation = [["▦", "Today"], ["◎", "Market discovery"], ["⌕", "Company research"], ["✓", "Decisions"], ["⚙", "Controls"]];

export function MarketDiscoveryWorkbench() {
  const [input, setInput] = useState<ProductBriefInput>(starterInput);
  const [result, setResult] = useState<MarketBriefResult | null>(null);
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

  function update(field: keyof ProductBriefInput, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  async function prepareMarketHypotheses() {
    setError(null);
    if (signInRequired || workspaceSetupRequired) {
      setError(workspaceSetupRequired ? "Create your Ano workspace before saving a product brief." : "Sign in before Ano can prepare and save your product brief.");
      return;
    }
    setIsRunning(true);
    try {
      const response = await fetch("/api/v1/market-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Ano-Idempotency-Key": window.crypto.randomUUID() },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as MarketBriefResult | { error?: string };
      if (!response.ok || !("hypothesis" in payload)) throw new Error("error" in payload ? payload.error : "Ano could not prepare market hypotheses.");
      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ano could not prepare market hypotheses.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark"><span>◖</span><span>◗</span></div><div><strong>Ano</strong><small>Sales copilot</small></div></div>
        <nav aria-label="Ano workspace">{navigation.map(([icon, label]) => <button key={label} className={`nav-item ${label === "Market discovery" ? "active" : ""}`} type="button"><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>
        <div className="sidebar-footer"><div className="safe-mode"><span className="live-dot" /> {liveWorkspace ? "Private workspace" : signInRequired ? "Sign in required" : "Workspace setup required"}</div><div className="account-chip"><span className="avatar">TM</span><span>Tendai Midzi</span><span className="chevron">⌄</span></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="crumbs"><span>Workspace</span><b>/</b><strong>{workspaceName}</strong></div><div className="topbar-actions"><span className="manual-badge">Standalone</span>{signInRequired && <Link href="/login" className="topbar-signin">Sign in</Link>}{workspaceSetupRequired && <Link href="/onboarding" className="topbar-signin">Create workspace</Link>}<button className="icon-button" type="button" aria-label="Notifications">◌</button><button className="avatar-button" type="button" aria-label="Account">TM</button></div></header>

        <div className="page-wrap">
          <section className="page-heading"><div><p className="eyebrow">01 — MARKET DISCOVERY</p><h1>Find where to sell</h1><p className="lede">Tell Ano what you sell and what you want to achieve. It will turn the fragments into hypotheses, show what it needs to validate, and ask you to choose a location path.</p></div><div className="mode-note"><span>✦</span><div><b>Reasoning, not research</b><small>Ano has no provider or company data at this stage. Every conclusion is labelled as a hypothesis.</small></div></div></section>

          <section className="stat-row" aria-label="Ano boundaries"><div className="stat-card"><span>Starting point</span><b>Offer + objective</b><small>The only required inputs</small></div><div className="stat-card"><span>Reasoning</span><b>Bedrock</b><small>Unverified market hypotheses</small></div><div className="stat-card"><span>Data sources</span><b>Not connected</b><small>No Prospeo or Dropcontact call</small></div><div className="stat-card"><span>Actions</span><b>None</b><small>No CRM, email, or outreach action</small></div></section>

          <section className="research-layout market-start-layout">
            <section className="panel research-form-panel">
              <div className="panel-heading"><div><p className="section-kicker">YOUR PRODUCT BRIEF</p><h2>What do you sell, and what are you trying to achieve?</h2></div><span className="required-note">* Required</span></div>
              <div className="form-grid">
                <label className="wide-field">What do you sell? *<textarea value={input.offer} onChange={(event) => update("offer", event.target.value)} rows={4} placeholder="A concise description is enough. For example: AI workflows that turn quotes into scheduled jobs." /></label>
                <label className="wide-field">What are you trying to achieve? *<textarea value={input.objective} onChange={(event) => update("objective", event.target.value)} rows={3} placeholder="For example: find a first outbound market or test a new sales motion." /></label>
                <label>Any market or industry hunch?<input value={input.marketHunch} onChange={(event) => update("marketHunch", event.target.value)} placeholder="Optional — or write Not sure" /></label>
                <label>Preferred location?<input value={input.locationPreference} onChange={(event) => update("locationPreference", event.target.value)} placeholder="Optional country, region, or city" /></label>
                <label>Who might care about this?<input value={input.buyerHunch} onChange={(event) => update("buyerHunch", event.target.value)} placeholder="Optional buyer, team, or role hunch" /></label>
                <label>Who should Ano avoid?<input value={input.exclusions} onChange={(event) => update("exclusions", event.target.value)} placeholder="Optional sectors, regions, or constraints" /></label>
                <label className="wide-field">Useful context (optional)<textarea value={input.customerExamples} onChange={(event) => update("customerExamples", event.target.value)} rows={3} placeholder="Existing customer examples, why they bought, operating context, or simply leave this blank." /></label>
                <label className="wide-field">Anything else Ano should respect?<textarea value={input.additionalContext} onChange={(event) => update("additionalContext", event.target.value)} rows={3} placeholder="Optional pricing, language, positioning, commercial constraints, or a note that you are not sure yet." /></label>
              </div>
              {error && <div className="error-box"><span>!</span><p>{error}</p></div>}
              <div className="form-footer"><p><span>⌁</span> No research homework required. Ano will not treat your hints as verified market facts or create companies, contacts, or outreach.</p><button className="primary-button" type="button" onClick={prepareMarketHypotheses} disabled={isRunning}>{isRunning ? "Mapping hypotheses…" : "Map my market hypotheses"}<span>→</span></button></div>
            </section>
            <section className="panel how-panel"><div className="panel-heading"><div><p className="section-kicker">THE WORKFLOW</p><h2>Ano fills in the gaps</h2></div></div><ol className="how-list"><li><span>1</span><div><b>Start simply</b><p>Enter only your offer and objective. Everything else is optional.</p></div></li><li><span>2</span><div><b>Frame hypotheses</b><p>Ano identifies segments, pains, and buyers worth testing—not facts.</p></div></li><li><span>3</span><div><b>Choose the scope</b><p>Set a location or ask to compare markets before discovery.</p></div></li><li><span>4</span><div><b>Research later</b><p>Only a future approved provider step can surface companies or contacts.</p></div></li></ol></section>
          </section>

          {result ? <MarketHypothesisResult initialResult={result} /> : <section className="empty-state panel"><div className="empty-orbit">✦</div><h2>Your market hypothesis map will appear here</h2><p>Ano will distinguish your input from unverified hypotheses, open questions, and the next decision. No company or contact data is used yet.</p></section>}
        </div>
      </section>
    </main>
  );
}

function MarketHypothesisResult({ initialResult }: { initialResult: MarketBriefResult }) {
  const [result, setResult] = useState(initialResult);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [isSavingDecision, setIsSavingDecision] = useState(false);

  async function chooseLocation(choice: MarketDecisionInput["choice"]) {
    setIsSavingDecision(true);
    setDecisionMessage(null);
    try {
      const response = await fetch(`/api/v1/market-briefs/${result.productBrief.id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice }) });
      const payload = (await response.json()) as { choice?: string; message?: string; error?: string };
      if (!response.ok || !payload.message) throw new Error(payload.error ?? "Ano could not save that location decision.");
      setResult((current) => ({ ...current, run: { ...current.run, status: "market_scope_locked" }, locationDecision: { ...current.locationDecision, status: "selected", selection: choice } }));
      setDecisionMessage(payload.message);
    } catch (error) {
      setDecisionMessage(error instanceof Error ? error.message : "Ano could not save that location decision.");
    } finally {
      setIsSavingDecision(false);
    }
  }

  return <>
    <section className="results-heading"><div><p className="section-kicker">02 — REVIEW THE HYPOTHESES</p><h2>{result.productBrief.offer}</h2><p>{result.run.message}</p></div><div className="run-complete"><span>✓</span> Product brief saved</div></section>
    <section className="market-results">
      <article className="brief-panel standalone-brief"><div className="brief-top"><div><p className="section-kicker">ANO MARKET MAP</p><h2>What may be worth testing</h2><p>Hypotheses are grounded only in your product brief—not external market research.</p></div><span className="confidence-badge">Hypothesis only</span></div><section className="brief-block"><h3>Preliminary market map</h3><p>{result.hypothesis.marketMap}</p></section><section className="brief-block"><h3>Testable hypotheses</h3><div className="hypothesis-list">{result.hypothesis.hypotheses.map((item) => <article className="hypothesis-item" key={item.id}><div><b>{item.title}</b><p>{item.statement}</p></div><em>{item.evidenceIds.join(" · ")}</em></article>)}</div></section>{result.hypothesis.assumptions.length > 0 && <section className="brief-block"><h3>Assumptions to validate</h3><ul className="plain-list">{result.hypothesis.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></section>}{result.hypothesis.questions.length > 0 && <section className="brief-block"><h3>Questions that would change the research</h3><ul className="plain-list">{result.hypothesis.questions.map((item) => <li key={item}>{item}</li>)}</ul></section>}</article>
      <div className="standalone-side"><article className="panel decision-panel"><p className="section-kicker">DECISION REQUIRED</p><h2>Choose the location path</h2><p>{result.locationDecision.prompt}</p><div className="decision-options">{result.locationDecision.options.map((option) => <button key={option.key} className={`decision-option ${result.locationDecision.selection === option.key ? "selected-decision" : ""}`} type="button" disabled={isSavingDecision || result.locationDecision.status === "selected"} onClick={() => chooseLocation(option.key)}><b>{option.label}</b><span>{option.description}</span>{result.locationDecision.selection === option.key && <em>Selected</em>}</button>)}</div>{decisionMessage && <div className="decision-message">{decisionMessage}</div>}</article><article className="panel evidence-panel"><p className="section-kicker">YOUR INPUTS</p><h2>Directly from you</h2>{result.evidence.map((item) => <div className="evidence-item" key={item.id}><span>◌</span><div><b>{item.label} <em>{item.id}</em></b><p>{item.observation}</p><small>Entered in Ano · not externally verified</small></div></div>)}</article></div>
    </section>
    <section className="next-stage-banner panel"><div><p className="section-kicker">BOUNDARY</p><h2>Company research is intentionally not available yet</h2><p>After you choose a scope, the next phase can ask for explicit approval before a credit-bearing company search. Ano has not connected Prospeo, Dropcontact, a CRM, or any outreach channel.</p></div><span>0 provider calls</span></section>
  </>;
}

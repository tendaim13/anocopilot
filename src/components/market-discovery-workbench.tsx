"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { WorkspaceRuntime } from "@/contracts/ano";
import type { MarketBriefResult, MarketDecisionInput, MarketHypothesis, ProductBriefInput } from "@/lib/ano/market-discovery";

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

  useEffect(() => {
    if (workspaceRuntime?.mode !== "supabase") return;
    let cancelled = false;
    fetch("/api/v1/market-briefs/current")
      .then(async (response) => ({ response, payload: (await response.json()) as { result?: MarketBriefResult; error?: string } }))
      .then(({ response, payload }) => {
        if (!cancelled && response.ok && payload.result) setResult(payload.result);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [workspaceRuntime?.mode]);

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
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [manualLocation, setManualLocation] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [draftHypotheses, setDraftHypotheses] = useState<MarketHypothesis[]>(initialResult.hypothesis.hypotheses);

  useEffect(() => {
    setResult(initialResult);
    setDraftHypotheses(initialResult.hypothesis.hypotheses);
    setIsEditing(false);
  }, [initialResult]);

  async function chooseLocation(choice: MarketDecisionInput["choice"]) {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/market-briefs/${result.productBrief.id}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice }) });
      const payload = (await response.json()) as { result?: MarketBriefResult; message?: string; error?: string };
      if (!response.ok || !payload.message) throw new Error(payload.error ?? "Ano could not save that location decision.");
      if (payload.result) setResult(payload.result);
      setMessage(payload.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ano could not save that location decision.");
    } finally {
      setIsSaving(false);
    }
  }

  async function lockManualLocation() {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/market-briefs/${result.productBrief.id}/scope`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: manualLocation }) });
      const payload = (await response.json()) as { result?: MarketBriefResult; error?: string };
      if (!response.ok || !payload.result) throw new Error(payload.error ?? "Ano could not lock that market scope.");
      setResult(payload.result);
      setMessage("Location scope saved. Company discovery remains unavailable until a later approved provider phase.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ano could not lock that market scope.");
    } finally {
      setIsSaving(false);
    }
  }

  function updateDraft(index: number, field: "title" | "statement", value: string) {
    setDraftHypotheses((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  async function saveHypotheses() {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/market-briefs/${result.productBrief.id}/hypotheses`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hypotheses: draftHypotheses.map(({ id, title, statement, evidenceIds }) => ({ id, title, statement, evidenceIds })) }) });
      const payload = (await response.json()) as MarketBriefResult | { error?: string };
      if (!response.ok || !("hypothesis" in payload)) throw new Error("error" in payload ? payload.error : "Ano could not save the hypothesis edit.");
      setResult(payload);
      setDraftHypotheses(payload.hypothesis.hypotheses);
      setIsEditing(false);
      setMessage("Hypotheses saved as your edits. They remain unverified until future research provides evidence.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ano could not save the hypothesis edit.");
    } finally {
      setIsSaving(false);
    }
  }

  return <>
    <section className="results-heading"><div><p className="section-kicker">02 — REVIEW THE HYPOTHESES</p><h2>{result.productBrief.offer}</h2><p>{result.run.message}</p></div><div className="run-complete"><span>✓</span> Product brief saved</div></section>
    <section className="market-results">
      <article className="brief-panel standalone-brief"><div className="brief-top"><div><p className="section-kicker">ANO MARKET MAP</p><h2>What may be worth testing</h2><p>Hypotheses are grounded only in your product brief—not external market research.</p></div><span className="confidence-badge">Hypothesis only</span></div><section className="brief-block"><h3>Preliminary market map</h3><p>{result.hypothesis.marketMap}</p></section><section className="brief-block"><div className="section-row"><h3>Testable hypotheses</h3>{result.locationDecision.status !== "selected" && <button type="button" className="secondary-button compact" disabled={isSaving} onClick={() => setIsEditing((current) => !current)}>{isEditing ? "Cancel" : "Edit hypotheses"}</button>}</div><div className="hypothesis-list">{(isEditing ? draftHypotheses : result.hypothesis.hypotheses).map((item, index) => <article className="hypothesis-item" key={item.id}><div>{isEditing ? <><input aria-label={`Hypothesis ${index + 1} title`} value={item.title} onChange={(event) => updateDraft(index, "title", event.target.value)} /><textarea aria-label={`Hypothesis ${index + 1} statement`} value={item.statement} rows={3} onChange={(event) => updateDraft(index, "statement", event.target.value)} /></> : <><b>{item.title}</b><p>{item.statement}</p>{item.origin === "workspace_member" && <small>Edited by you · still a hypothesis</small>}</>}</div><em>{item.evidenceIds.join(" · ")}</em></article>)}</div>{isEditing && <div className="inline-actions"><button className="primary-button compact-primary" type="button" disabled={isSaving} onClick={saveHypotheses}>{isSaving ? "Saving…" : "Save hypothesis edits"}</button><span>Edits do not turn a hypothesis into research evidence.</span></div>}</section>{result.hypothesis.assumptions.length > 0 && <section className="brief-block"><h3>Assumptions to validate</h3><ul className="plain-list">{result.hypothesis.assumptions.map((item) => <li key={item}>{item}</li>)}</ul></section>}{result.hypothesis.questions.length > 0 && <section className="brief-block"><h3>Questions that would change the research</h3><ul className="plain-list">{result.hypothesis.questions.map((item) => <li key={item}>{item}</li>)}</ul></section>}</article>
      <div className="standalone-side"><article className="panel decision-panel"><p className="section-kicker">{result.locationDecision.status === "selected" ? "SCOPE CHECKPOINT" : "DECISION REQUIRED"}</p><h2>{result.locationDecision.status === "selected" ? "Market scope" : "Choose the location path"}</h2><p>{result.locationDecision.status === "selected" ? result.scope.summary : result.locationDecision.prompt}</p>{result.locationDecision.status !== "selected" && <div className="decision-options">{result.locationDecision.options.map((option) => <button key={option.key} className="decision-option" type="button" disabled={isSaving} onClick={() => chooseLocation(option.key)}><b>{option.label}</b><span>{option.description}</span></button>)}</div>}{result.scope.state === "awaiting_location_input" && <div className="scope-input"><label>Location to prioritise<input value={manualLocation} onChange={(event) => setManualLocation(event.target.value)} placeholder="Country, region, or city" /></label><button className="primary-button compact-primary" type="button" disabled={isSaving} onClick={lockManualLocation}>{isSaving ? "Locking…" : "Lock location scope"}</button></div>}{message && <div className="decision-message">{message}</div>}</article><article className="panel provider-state"><p className="section-kicker">COMPANY DISCOVERY</p><h2>Provider unavailable</h2><p>{result.provider.message}</p><div><span>Scope</span><b>{result.scope.locations.length ? result.scope.locations.join(", ") : result.scope.kind === "compare" ? "Comparison requested" : "Open"}</b></div><div><span>Market-scan evidence</span><b>{result.scan.evidenceIds.length} records</b></div><div><span>Provider calls</span><b>0</b></div></article><article className="panel evidence-panel"><p className="section-kicker">EVIDENCE LEDGER</p><h2>Directly from you</h2>{result.evidence.map((item) => <div className="evidence-item" key={item.id}><span>◌</span><div><b>{item.label} <em>{item.id}</em></b><p>{item.observation}</p><small>Entered in Ano · not externally verified</small></div></div>)}</article></div>
    </section>
    <section className="audit-panel panel"><div><p className="section-kicker">RUN TIMELINE</p><h2>What Ano has done</h2></div><ol>{result.timeline.map((entry) => <li key={entry.id}><span className={entry.category} /> <div><b>{entry.label}</b><p>{entry.detail}</p></div><time>{new Date(entry.at).toLocaleString()}</time></li>)}</ol></section>
    <section className="next-stage-banner panel"><div><p className="section-kicker">BOUNDARY</p><h2>Company research is intentionally blocked until a provider is connected</h2><p>The market scope and audit trail are ready for a future approval flow. Ano has not connected Prospeo, Dropcontact, a CRM, or any outreach channel, and it has not fabricated a company or a location claim.</p></div><span>0 provider calls</span></section>
  </>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { AgentRunPanel } from "@/components/agent-run-panel";
import type { WorkspaceRuntime } from "@/contracts/ano";
import type { Candidate, PlanItem, ResearchInput, ResearchResult } from "@/lib/ano/types";

const starterInput: ResearchInput = {
  objective: "Find Australian service firms likely to benefit from a clearer quote-to-job and follow-up workflow.",
  industry: "Fire protection and facilities services",
  geography: "Australia",
  targetRole: "Operations Director or Service Manager",
  exclusions: "Solo operators, residential-only work",
  maxResults: 3,
};

type CandidateState = "shortlisted" | "dismissed" | "review";

type LocalDemoState = {
  version: 2;
  input: ResearchInput;
  result: ResearchResult | null;
  candidateStates: Record<string, CandidateState>;
};

const phaseTwoStateKey = "ano-phase-two-demo-workspace";

const navigation = [
  ["▦", "Today"],
  ["⌕", "Research"],
  ["◫", "Briefs"],
  ["✓", "Plan"],
  ["⚙", "Controls"],
];

function scoreTone(score: number) {
  if (score >= 80) return "score-high";
  if (score >= 65) return "score-mid";
  return "score-low";
}

export function AnoWorkbench() {
  const [input, setInput] = useState<ResearchInput>(starterInput);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [candidateStates, setCandidateStates] = useState<Record<string, CandidateState>>({});
  const [clarification, setClarification] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceRuntime, setWorkspaceRuntime] = useState<WorkspaceRuntime | null>(null);
  const [workspaceError, setWorkspaceError] = useState<{ code?: string; error: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(phaseTwoStateKey);
    try {
      const saved = stored ? (JSON.parse(stored) as LocalDemoState) : null;
      if (saved?.version === 2) {
        setInput(saved.input);
        setResult(saved.result);
        setCandidateStates(saved.candidateStates);
        setActiveCandidateId(saved.result?.candidates[0]?.id ?? null);
      } else {
        const legacyStates = window.localStorage.getItem("ano-phase-one-candidate-states");
        if (legacyStates) setCandidateStates(JSON.parse(legacyStates) as Record<string, CandidateState>);
      }
    } catch {
      window.localStorage.removeItem(phaseTwoStateKey);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const saved: LocalDemoState = { version: 2, input, result, candidateStates };
    window.localStorage.setItem(phaseTwoStateKey, JSON.stringify(saved));
  }, [candidateStates, hydrated, input, result]);

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

  const activeCandidate = useMemo<Candidate | null>(() => {
    if (!result) return null;
    return result.candidates.find((candidate) => candidate.id === activeCandidateId) ?? result.candidates[0] ?? null;
  }, [activeCandidateId, result]);

  const plan = useMemo<PlanItem[]>(() => {
    if (!result) return [];
    return result.plan.filter((item) => candidateStates[item.candidateId] !== "dismissed");
  }, [candidateStates, result]);

  const shortlistedCount = Object.values(candidateStates).filter((state) => state === "shortlisted").length;
  const liveWorkspace = workspaceRuntime?.mode === "supabase";
  const signInRequired = workspaceError?.code === "AUTH_REQUIRED";
  const workspaceSetupRequired = workspaceError?.code === "WORKSPACE_REQUIRED";
  const workspaceName = workspaceRuntime?.workspace.name ?? (signInRequired ? "Sign in required" : workspaceSetupRequired ? "Set up workspace" : "Nerva Studio — demo");
  const persistenceLabel = liveWorkspace ? "Workspace persistence" : signInRequired ? "Secure workspace access" : workspaceSetupRequired ? "Workspace setup required" : "Browser demo persistence";
  const bedrockPlanned = result?.run.mode === "bedrock_mock_tools";

  function update(field: keyof ResearchInput, value: string | number) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  async function runResearch() {
    setError(null);
    setClarification(null);

    if (signInRequired || workspaceSetupRequired) {
      setError("Sign in before Ano can create a workspace-scoped research run.");
      if (workspaceSetupRequired) setError("Create your Ano workspace before starting a workspace-scoped research run.");
      return;
    }

    const missing = [
      ["industry", "industry"],
      ["geography", "geography"],
      ["targetRole", "a target role"],
    ].find(([key]) => !String(input[key as keyof ResearchInput]).trim());

    if (missing) {
      setClarification(`Ano needs ${missing[1]} before it can plan a safe research run.`);
      return;
    }

    setIsRunning(true);
    try {
      const response = await fetch("/api/v1/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ano-Idempotency-Key": window.crypto.randomUUID(),
        },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as ResearchResult | { error?: string };
      if (!response.ok || !("candidates" in payload)) {
        throw new Error("error" in payload ? payload.error : "Ano could not complete this research run.");
      }
      setResult(payload);
      setActiveCandidateId(payload.candidates[0]?.id ?? null);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Ano could not complete this research run.");
    } finally {
      setIsRunning(false);
    }
  }

  async function setCandidateState(candidateId: string, state: CandidateState) {
    const previousState = candidateStates[candidateId];
    setCandidateStates((current) => ({ ...current, [candidateId]: state }));

    if (!liveWorkspace || !result?.run.id) return;

    try {
      const response = await fetch(`/api/v1/candidates/${encodeURIComponent(candidateId)}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: result.run.id, state }),
      });
      if (!response.ok) throw new Error("Ano could not save that workspace state.");
    } catch {
      setCandidateStates((current) => ({ ...current, [candidateId]: previousState ?? "review" }));
      setError("Ano could not save that workspace state. Your change was restored locally.");
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>◖</span><span>◗</span></div>
          <div>
            <strong>Ano</strong>
            <small>Sales copilot</small>
          </div>
        </div>

        <nav aria-label="Ano workspace">
          {navigation.map(([icon, label]) => (
            <button key={label} className={`nav-item ${label === "Research" ? "active" : ""}`} type="button">
              <span aria-hidden="true">{icon}</span>{label}
            </button>
          ))}
        </nav>

          <div className="sidebar-footer">
          <div className="safe-mode"><span className="live-dot" /> {liveWorkspace ? "Workspace persistence" : signInRequired ? "Sign in required" : workspaceSetupRequired ? "Workspace setup required" : "Local demo workspace"}</div>
          <div className="account-chip"><span className="avatar">TM</span><span>Tendai Midzi</span><span className="chevron">⌄</span></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="crumbs"><span>Workspace</span><b>/</b><strong>{workspaceName}</strong></div>
          <div className="topbar-actions">
            <span className="mock-badge">{liveWorkspace ? "Simulated data" : workspaceSetupRequired ? "Setup required" : "Local demo"}</span>
            {signInRequired && <Link href="/login" className="topbar-signin">Sign in</Link>}
            {workspaceSetupRequired && <Link href="/onboarding" className="topbar-signin">Create workspace</Link>}
            <button className="icon-button" type="button" aria-label="Notifications">◌</button>
            <button className="avatar-button" type="button" aria-label="Account">TM</button>
          </div>
        </header>

        <div className="page-wrap">
          <section className="page-heading">
            <div>
              <p className="eyebrow">SALES RESEARCH &amp; PLANNING</p>
              <h1>Research workbench</h1>
              <p className="lede">Turn a focused ICP into an evidence-backed shortlist and a practical next-step plan.</p>
            </div>
            <div className="mode-note"><span>✦</span><div><b>{persistenceLabel}</b><small>{liveWorkspace ? "Server session and records are scoped to this workspace." : signInRequired ? "Use your work email to securely access Ano." : workspaceSetupRequired ? "Your signed-in account can create its first secure workspace." : "Saved in this browser; use Supabase for team tenancy."}</small></div></div>
          </section>

          <section className="stat-row" aria-label="Research summary">
            <div className="stat-card"><span>Research mode</span><b>{bedrockPlanned ? "Bedrock + mock" : "Mock only"}</b><small>{bedrockPlanned ? "Model reasoning · zero provider credits" : "Zero credits used"}</small></div>
            <div className="stat-card"><span>Shortlisted</span><b>{shortlistedCount}</b><small>{liveWorkspace ? "Workspace-scoped records" : "Saved in this browser"}</small></div>
            <div className="stat-card"><span>Tool boundary</span><b>Read-only</b><small>Five permitted mock tools</small></div>
            <div className="stat-card"><span>External writes</span><b>Disabled</b><small>Proposals come later</small></div>
          </section>

          <section className="research-layout">
            <section className="panel research-form-panel">
              <div className="panel-heading"><div><p className="section-kicker">01 — DEFINE THE WORK</p><h2>Who should Ano look for?</h2></div><span className="required-note">* Required</span></div>
              <div className="form-grid">
                <label className="wide-field">Objective *
                  <textarea value={input.objective} onChange={(event) => update("objective", event.target.value)} rows={3} />
                </label>
                <label>Industry *
                  <input value={input.industry} onChange={(event) => update("industry", event.target.value)} />
                </label>
                <label>Geography *
                  <input value={input.geography} onChange={(event) => update("geography", event.target.value)} />
                </label>
                <label>Target role *
                  <input value={input.targetRole} onChange={(event) => update("targetRole", event.target.value)} />
                </label>
                <label>Exclusions
                  <input value={input.exclusions} onChange={(event) => update("exclusions", event.target.value)} />
                </label>
              </div>
              {clarification && <div className="clarification"><span>✦</span><p>{clarification}</p></div>}
              {error && <div className="error-box"><span>!</span><p>{error}</p></div>}
              <div className="form-footer"><p><span>⌁</span> Ano will use simulated, read-only discovery and evidence tools.</p><button className="primary-button" type="button" onClick={runResearch} disabled={isRunning}>{isRunning ? "Running research…" : "Run simulated research"}<span>→</span></button></div>
            </section>

            <section className="panel how-panel">
              <div className="panel-heading"><div><p className="section-kicker">HOW IT WORKS</p><h2>Bounded by design</h2></div></div>
              <ol className="how-list">
                <li><span>1</span><div><b>Clarify</b><p>Ano asks for the inputs it needs before starting.</p></div></li>
                <li><span>2</span><div><b>Research</b><p>Only approved mock tools can run in this workspace.</p></div></li>
                <li><span>3</span><div><b>Explain</b><p>Scores and recommendations keep their evidence trail.</p></div></li>
                <li><span>4</span><div><b>Review</b><p>You shortlist, dismiss, or mark results for later.</p></div></li>
              </ol>
            </section>
          </section>

          {result ? (
            <>
              <section className="results-heading">
                <div><p className="section-kicker">02 — REVIEW THE RESULTS</p><h2>Ranked opportunities</h2><p>{result.run.message}</p></div>
                <div className="run-complete"><span>✓</span> {liveWorkspace ? `${bedrockPlanned ? "Bedrock" : "Workspace"} run saved` : "Demo run saved locally"}</div>
              </section>

              <AgentRunPanel input={input} result={result} />

              <section className="results-layout">
                <div className="candidate-list">
                  {result.candidates.map((candidate, index) => {
                    const state = candidateStates[candidate.id];
                    const isActive = activeCandidate?.id === candidate.id;
                    return <article key={candidate.id} className={`candidate-card ${isActive ? "selected" : ""} ${state === "dismissed" ? "dismissed" : ""}`} onClick={() => setActiveCandidateId(candidate.id)}>
                      <div className="rank-circle">{index + 1}</div>
                      <div className="candidate-main"><div className="candidate-title"><div><h3>{candidate.name}</h3><p>{candidate.industry} · {candidate.location}</p></div><span className={`fit-badge ${candidate.fitLabel === "High fit" ? "high" : "promising"}`}>{candidate.fitLabel}</span></div><p className="candidate-description">{candidate.description}</p><div className="signal-row">{candidate.signals.map((signal) => <span key={signal}>{signal}</span>)}</div></div>
                      <div className="candidate-score"><b className={scoreTone(candidate.score)}>{candidate.score}</b><span>/100</span><small>{candidate.confidence} confidence</small></div>
                    </article>;
                  })}
                </div>

                {activeCandidate && <CandidateBrief candidate={activeCandidate} state={candidateStates[activeCandidate.id]} onStateChange={setCandidateState} />}
              </section>

              <section className="plan-section panel">
                <div className="panel-heading"><div><p className="section-kicker">03 — TURN RESEARCH INTO ACTION</p><h2>Ano plan</h2><p className="subtle">A proposed worklist. Nothing has been written to Mercury.</p></div><span className="plan-label">Today &amp; this week</span></div>
                <div className="plan-list">
                  {plan.map((item) => <article className="plan-item" key={item.id}><span className={`priority-dot ${item.priority.toLowerCase().replaceAll(" ", "-")}`} /><div><div className="plan-title"><h3>{item.title}</h3><span>{item.action}</span></div><p>{item.reason}</p></div><b>{item.priority}</b><button type="button" aria-label={`Review ${item.title}`}>→</button></article>)}
                </div>
              </section>
            </>
          ) : (
            <section className="empty-state panel"><div className="empty-orbit">✦</div><h2>Your first brief will appear here</h2><p>Start with an ICP above. Ano will show a transparent simulated tool trail, scorecard, and action plan.</p></section>
          )}
        </div>
      </section>
    </main>
  );
}

function CandidateBrief({ candidate, state, onStateChange }: { candidate: Candidate; state?: CandidateState; onStateChange: (candidateId: string, state: CandidateState) => void }) {
  return <aside className="brief-panel">
    <div className="brief-top"><div><p className="section-kicker">ANO BRIEF</p><h2>{candidate.name}</h2><p>{candidate.location} · {candidate.employees}</p></div><span className="confidence-badge">{candidate.confidence} confidence</span></div>
    <div className="brief-score"><div><span>Opportunity score</span><b className={scoreTone(candidate.score)}>{candidate.score}<small>/100</small></b></div><p>Calculated from deterministic factors. Ano can explain this score; it cannot silently change it.</p></div>
    <section className="brief-block"><h3>Why Ano ranked this account</h3><p>{candidate.recommendationReason}</p></section>
    <section className="score-breakdown"><h3>Scorecard</h3>{candidate.scoreComponents.map((component) => <div className="score-row" key={component.label}><div><span>{component.label}</span><b>{component.score}/{component.maximum}</b></div><div className="progress"><span className={component.tone} style={{ width: `${(component.score / component.maximum) * 100}%` }} /></div><p>{component.explanation}</p></div>)}</section>
    <section className="brief-block contact-block"><h3>Candidate contact</h3><div className="contact-row"><span className="contact-avatar">{candidate.contact.name.split(" ").map((part) => part[0]).join("")}</span><div><b>{candidate.contact.name}</b><p>{candidate.contact.role}</p></div><span className="availability">{candidate.contact.availability}</span></div></section>
    <section className="brief-block"><h3>Evidence used</h3><div className="evidence-list">{candidate.evidence.map((item) => <div className="evidence-item" key={item.id}><span>◌</span><div><b>{item.source} <em>{item.id}</em></b><p>{item.observation}</p><small>Simulated evidence · {item.capturedAt}</small></div></div>)}</div></section>
    <div className="review-actions"><p>Review this candidate</p><div><button type="button" className={`secondary-button ${state === "dismissed" ? "selected-action" : ""}`} onClick={() => onStateChange(candidate.id, "dismissed")}>Dismiss</button><button type="button" className={`secondary-button ${state === "review" ? "selected-action" : ""}`} onClick={() => onStateChange(candidate.id, "review")}>Review later</button><button type="button" className={`primary-button compact ${state === "shortlisted" ? "selected-primary" : ""}`} onClick={() => onStateChange(candidate.id, "shortlisted")}>{state === "shortlisted" ? "Shortlisted ✓" : "Shortlist"}</button></div></div>
  </aside>;
}

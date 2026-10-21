import type { ResearchInput, ResearchResult } from "@/lib/ano/types";

function label(tool: string) {
  return tool.replaceAll("_", " ");
}

export function AgentRunPanel({ input, result }: { input: ResearchInput; result: ResearchResult }) {
  const execution = result.run.execution;

  return (
    <section className="agent-run-panel panel" aria-label="Ano run trace">
      <div className="agent-run-header">
        <div>
          <p className="section-kicker">RUN TRACE</p>
          <h2>What Ano did, step by step</h2>
          <p>Intent: {input.objective}</p>
        </div>
        <div className="mock-loop-badge"><span>✓</span> {execution?.planner?.kind === "bedrock" ? "Bedrock planner · bounded loop" : "Bounded mock loop"}</div>
      </div>

      {execution ? (
        <div className="run-metrics" aria-label="Run limits and usage">
          <div><span>Tools</span><b>{execution.usage.toolCalls} <small>/ {execution.limits.maxToolCalls} max</small></b></div>
          <div><span>Turns</span><b>{execution.usage.turns} <small>/ {execution.limits.maxTurns} max</small></b></div>
          <div><span>Evidence</span><b>{execution.usage.evidenceItems} <small>/ {execution.limits.maxEvidenceItems} max</small></b></div>
          <div><span>Clarifications</span><b>{execution.usage.clarifications} <small>/ {execution.limits.maxClarifications} max</small></b></div>
        </div>
      ) : (
        <p className="run-legacy-note">This saved local result predates the bounded-run trace. Run it again to record full execution details.</p>
      )}

      {result.run.agentAnswer && (
        <section className="agent-answer" aria-label="Ano final answer">
          <div className="agent-answer-heading"><span>✦</span><div><b>{result.run.agentAnswer.source === "bedrock" ? "Bedrock answer · citations validated" : "Ano fallback answer"}</b><small>{result.run.agentAnswer.source === "bedrock" ? "The application checked every cited evidence ID." : "The planner output was not usable, so Ano returned a deterministic summary."}</small></div></div>
          <p>{result.run.agentAnswer.summary}</p>
          <div className="answer-evidence"><span>Evidence</span>{result.run.agentAnswer.evidenceIds.map((id) => <em key={id}>{id}</em>)}</div>
          {result.run.agentAnswer.inferences.length > 0 && <div className="answer-inferences"><b>Inferences</b>{result.run.agentAnswer.inferences.map((inference) => <p key={inference}>{inference}</p>)}</div>}
        </section>
      )}

      <div className="run-trace-content">
        <ol className="run-trace-list">
          {result.toolTrail.map((event) => (
            <li key={event.id}>
              <span className="run-turn">{event.turn ?? "—"}</span>
              <div><b>{label(event.tool)}</b><p>{event.summary}</p></div>
              <span className="run-status">Completed</span>
            </li>
          ))}
        </ol>
        <aside className="run-boundary">
          <span className="boundary-icon">⌁</span>
          <div>
            <b>External connectivity is disabled</b>
            <p>Mercury, providers, email, calls, browser/HTTP, SQL, and every external write have no execution path in Phase 4A.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

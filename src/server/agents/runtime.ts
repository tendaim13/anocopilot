import type { AgentCheckpoint, AgentRunLimits, MockToolResult, ResearchAgentRequest, ResearchAgentResult } from "@/contracts/agent";
import { mockResearchToolNames, type MockResearchToolName, type ResearchRunExecution, type ToolEvent } from "@/lib/ano/types";
import { runMockResearch, type MockResearchFixture } from "@/lib/ano/mock-research";
import { createCheckpoint } from "@/server/agents/resume";
import { salesResearchRole, validateResearchBrief } from "@/server/agents/roles/sales-research";
import { scoreMatchesCandidate } from "@/server/agents/scoring";
import { evaluateToolIntent, DEFAULT_RESEARCH_LIMITS } from "@/server/policy/tool-guard";

type RuntimeErrorCode = "INVALID_LIMITS" | "TOOL_LIMIT" | "TURN_LIMIT" | "EVIDENCE_LIMIT" | "TIME_LIMIT" | "POLICY_BLOCKED" | "FIXTURE_INTEGRITY";

type RuntimeState = {
  turn: number;
  toolCalls: number;
  evidenceItems: number;
};

type MockToolPlanStep = {
  tool: MockResearchToolName;
  execute: (fixture: MockResearchFixture) => MockToolResult;
};

export class AgentRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code: RuntimeErrorCode,
    public readonly checkpoint: AgentCheckpoint,
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

function failedCheckpoint(state: RuntimeState) {
  return createCheckpoint("failed", state.turn, state.toolCalls);
}

function fail(message: string, code: RuntimeErrorCode, state: RuntimeState): never {
  throw new AgentRuntimeError(message, code, failedCheckpoint(state));
}

function resolveLimits(overrides?: Partial<AgentRunLimits>) {
  const limits = { ...DEFAULT_RESEARCH_LIMITS, ...overrides };
  const invalid = Object.entries(limits).find(([, value]) => !Number.isFinite(value) || value < 0);
  if (invalid) {
    throw new AgentRuntimeError(
      `Ano received an invalid ${invalid[0]} run limit.`,
      "INVALID_LIMITS",
      createCheckpoint("failed", 0, 0),
    );
  }
  return limits;
}

function assertBeforeTool(state: RuntimeState, limits: AgentRunLimits, startedAt: number) {
  if (state.toolCalls + 1 > limits.maxToolCalls) {
    fail("Ano stopped before exceeding its configured tool-call limit.", "TOOL_LIMIT", state);
  }
  if (state.turn + 1 > limits.maxTurns) {
    fail("Ano stopped before exceeding its configured turn limit.", "TURN_LIMIT", state);
  }
  if (Date.now() - startedAt > limits.maxElapsedMs) {
    fail("Ano stopped because this run exceeded its configured time limit.", "TIME_LIMIT", state);
  }
}

function assertFixtureIntegrity(fixture: MockResearchFixture, state: RuntimeState) {
  const evidence = fixture.candidates.flatMap((candidate) => candidate.evidence);
  const hasUnattributedEvidence = evidence.some((item) => !item.id || !item.source || !item.simulated);
  if (hasUnattributedEvidence) {
    fail("Ano stopped because mock evidence was missing an attributable simulated source.", "FIXTURE_INTEGRITY", state);
  }

  if (fixture.candidates.some((candidate) => !scoreMatchesCandidate(candidate))) {
    fail("Ano stopped because a deterministic score did not match its scorecard.", "FIXTURE_INTEGRITY", state);
  }

  if (fixture.plan.some((item) => !fixture.candidates.some((candidate) => candidate.id === item.candidateId))) {
    fail("Ano stopped because a proposed plan item did not map to a researched account.", "FIXTURE_INTEGRITY", state);
  }
}

function createMockToolPlan(): MockToolPlanStep[] {
  return [
    {
      tool: "search_companies",
      execute: (fixture) => ({
        tool: "search_companies",
        summary: `Matched ${fixture.candidates.length} simulated companies against the requested ICP.`,
        evidenceItems: 0,
      }),
    },
    {
      tool: "search_people",
      execute: (fixture) => ({
        tool: "search_people",
        summary: `Located role-aligned candidate contacts for ${fixture.candidates.length} shortlisted accounts.`,
        evidenceItems: 0,
      }),
    },
    {
      tool: "get_account_evidence",
      execute: (fixture) => ({
        tool: "get_account_evidence",
        summary: "Collected attributable simulated company, workflow, hiring, and contact observations.",
        evidenceItems: fixture.candidates.flatMap((candidate) => candidate.evidence).length,
      }),
    },
    {
      tool: "compute_score",
      execute: (fixture) => ({
        tool: "compute_score",
        summary: `Verified deterministic scorecards for ${fixture.candidates.length} accounts.`,
        evidenceItems: 0,
      }),
    },
    {
      tool: "build_today_plan",
      execute: (fixture) => ({
        tool: "build_today_plan",
        summary: `Ordered ${fixture.plan.length} Ano-owned research and outreach-preparation items by readiness.`,
        evidenceItems: 0,
      }),
    },
  ];
}

function completedExecution(limits: AgentRunLimits, state: RuntimeState, startedAt: number, completedAt: string): ResearchRunExecution {
  return {
    engine: "bounded_mock_tool_loop",
    role: "sales-research-planning",
    completedAt,
    limits,
    usage: {
      toolCalls: state.toolCalls,
      turns: state.turn,
      evidenceItems: state.evidenceItems,
      clarifications: 0,
      elapsedMs: Date.now() - startedAt,
    },
    policy: {
      permittedTools: [...mockResearchToolNames],
      externalConnections: "disabled",
      externalActions: "disabled",
      evidence: "simulated",
    },
  };
}

/**
 * Phase 4A's application-controlled tool loop. It never invokes a model, a
 * provider, Mercury, a browser, or an external action. Phase 4B may place a
 * Bedrock planner in front of this executor, but cannot bypass its per-tool
 * policy checks, integrity checks, or limits.
 */
export function runBoundedMockSalesResearch(request: ResearchAgentRequest): ResearchAgentResult {
  const startedAt = Date.now();
  const limits = resolveLimits(request.limits);
  const state: RuntimeState = { turn: 0, toolCalls: 0, evidenceItems: 0 };

  validateResearchBrief(request.input);
  const fixture = runMockResearch(request.input);
  assertFixtureIntegrity(fixture, state);

  const decisions: ResearchAgentResult["decisions"] = [];
  const toolTrail: ToolEvent[] = [];

  for (const step of createMockToolPlan()) {
    assertBeforeTool(state, limits, startedAt);

    const decision = evaluateToolIntent({ tool: step.tool, initiatedBy: "agent", payload: {} });
    decisions.push({ tool: step.tool, decision });
    if (decision.disposition !== "allow") {
      fail(`${salesResearchRole.name} was blocked by the workspace tool policy.`, "POLICY_BLOCKED", state);
    }

    const output = step.execute(fixture);
    if (output.tool !== step.tool) {
      fail("Ano stopped because a tool returned a malformed result.", "FIXTURE_INTEGRITY", state);
    }

    state.turn += 1;
    state.toolCalls += 1;
    state.evidenceItems += output.evidenceItems;
    if (state.evidenceItems > limits.maxEvidenceItems) {
      fail("Ano stopped before exceeding its configured evidence-item limit.", "EVIDENCE_LIMIT", state);
    }

    toolTrail.push({
      id: `tool-${String(state.toolCalls).padStart(2, "0")}`,
      tool: output.tool,
      status: "completed",
      summary: output.summary,
      turn: state.turn,
      simulated: true,
    });
  }

  if (Date.now() - startedAt > limits.maxElapsedMs) {
    fail("Ano stopped because this run exceeded its configured time limit.", "TIME_LIMIT", state);
  }

  const checkpoint = createCheckpoint("completed", state.turn, state.toolCalls);
  const execution = completedExecution(limits, state, startedAt, checkpoint.createdAt);
  return {
    result: {
      ...fixture,
      toolTrail,
      run: {
        ...fixture.run,
        message: `Ano completed a bounded simulated research run for ${request.input.industry} in ${request.input.geography}.`,
        execution,
      },
    },
    checkpoint,
    decisions,
  };
}

/** Backwards-compatible name for the existing domain service. */
export function runSimulatedSalesResearch(request: ResearchAgentRequest): ResearchAgentResult {
  return runBoundedMockSalesResearch(request);
}

import type { AgentFinalAnswer, MockResearchToolName, ResearchInput, ResearchResult } from "@/lib/ano/types";

export type AgentToolName =
  | "search_companies"
  | "search_people"
  | "get_account_evidence"
  | "compute_score"
  | "build_today_plan"
  | "save_shortlist"
  | "dismiss_candidate"
  | "mark_for_review"
  | "get_mercury_lead"
  | "get_mercury_activity"
  | "get_campaign_context"
  | "provider_search"
  | "provider_enrich_contact"
  | "propose_mercury_task"
  | "propose_mercury_draft"
  | "propose_mercury_update";

export type ToolTier = "mock_read" | "deterministic" | "ano_state" | "mercury_read" | "provider_credit" | "mercury_proposal";
export type GuardDisposition = "allow" | "ask" | "deny" | "shadow";

export type ToolIntent = {
  tool: AgentToolName | string;
  initiatedBy: "user" | "agent";
  payload: Record<string, unknown>;
};

export type GuardDecision = {
  disposition: GuardDisposition;
  reason: string;
  auditLabel: string;
};

export type AgentRunLimits = {
  maxToolCalls: number;
  maxTurns: number;
  maxEvidenceItems: number;
  maxClarifications: number;
  maxElapsedMs: number;
};

export type AgentCheckpoint = {
  phase: "clarifying" | "researching" | "awaiting_approval" | "completed" | "failed";
  turn: number;
  toolCalls: number;
  createdAt: string;
};

export type ResearchAgentRequest = {
  input: ResearchInput;
  idempotencyKey: string;
  limits?: Partial<AgentRunLimits>;
};

export type ResearchAgentResult = {
  result: ResearchResult;
  checkpoint: AgentCheckpoint;
  decisions: Array<{ tool: AgentToolName; decision: GuardDecision }>;
};

export type MockToolResult = {
  tool: MockResearchToolName;
  summary: string;
  evidenceItems: number;
  data: Record<string, unknown>;
};

export type AgentPlannerResult = {
  mode: "mock" | "bedrock";
  modelTurns: number;
  guardrail: "not_used" | "enabled";
  finalAnswer: "deterministic" | "validated" | "fallback";
  agentAnswer?: AgentFinalAnswer;
};

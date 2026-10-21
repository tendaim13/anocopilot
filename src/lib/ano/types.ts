import { z } from "zod";

export const researchInputSchema = z.object({
  objective: z.string().trim().min(12).max(600),
  industry: z.string().trim().min(2).max(120),
  geography: z.string().trim().min(2).max(120),
  targetRole: z.string().trim().min(2).max(120),
  exclusions: z.string().trim().max(240).optional().default(""),
  maxResults: z.number().int().min(1).max(6).default(3),
});

export type ResearchInput = z.infer<typeof researchInputSchema>;

export type EvidenceItem = {
  id: string;
  source: string;
  kind: "company" | "hiring" | "workflow" | "engagement" | "contact";
  observation: string;
  capturedAt: string;
  simulated: true;
};

export type ScoreComponent = {
  label: string;
  score: number;
  maximum: number;
  explanation: string;
  tone: "emerald" | "amber" | "slate";
};

export type Contact = {
  name: string;
  role: string;
  availability: "Candidate contact" | "Needs enrichment";
};

export type Candidate = {
  id: string;
  name: string;
  industry: string;
  location: string;
  employees: string;
  description: string;
  fitLabel: "High fit" | "Promising" | "Watchlist";
  score: number;
  confidence: "High" | "Medium";
  contact: Contact;
  signals: string[];
  scoreComponents: ScoreComponent[];
  evidence: EvidenceItem[];
  recommendedAction: string;
  recommendationReason: string;
};

export const mockResearchToolNames = [
  "search_companies",
  "search_people",
  "get_account_evidence",
  "compute_score",
  "build_today_plan",
] as const;

export type MockResearchToolName = (typeof mockResearchToolNames)[number];

export type ToolEvent = {
  id: string;
  tool: MockResearchToolName;
  status: "completed";
  summary: string;
  turn: number;
  simulated: true;
};

export type ResearchRunExecution = {
  engine: "bounded_mock_tool_loop";
  role: "sales-research-planning";
  completedAt: string;
  limits: {
    maxToolCalls: number;
    maxTurns: number;
    maxEvidenceItems: number;
    maxClarifications: number;
    maxElapsedMs: number;
  };
  usage: {
    toolCalls: number;
    turns: number;
    evidenceItems: number;
    clarifications: number;
    elapsedMs: number;
  };
  policy: {
    permittedTools: MockResearchToolName[];
    externalConnections: "disabled";
    externalActions: "disabled";
    evidence: "simulated";
  };
  planner?: {
    kind: "application" | "bedrock";
    modelTurns: number;
    guardrail: "not_used" | "enabled";
    finalAnswer: "deterministic" | "validated" | "fallback";
  };
};

export type AgentFinalAnswer = {
  summary: string;
  evidenceIds: string[];
  inferences: string[];
  source: "bedrock" | "application_fallback";
};

export type PlanItem = {
  id: string;
  title: string;
  action: "Research" | "Prepare call" | "Draft follow-up";
  priority: "Now" | "Today" | "This week";
  reason: string;
  candidateId: string;
};

export type ResearchResult = {
  run: {
    id: string;
    status: "completed";
    mode: "mock" | "bedrock_mock_tools";
    clarification: string | null;
    message: string;
    execution?: ResearchRunExecution;
    agentAnswer?: AgentFinalAnswer;
  };
  candidates: Candidate[];
  toolTrail: ToolEvent[];
  plan: PlanItem[];
};

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

export type ToolEvent = {
  id: string;
  tool: "search_companies" | "search_people" | "get_account_evidence" | "compute_score" | "build_today_plan";
  status: "completed";
  summary: string;
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
    mode: "mock";
    clarification: string | null;
    message: string;
  };
  candidates: Candidate[];
  toolTrail: ToolEvent[];
  plan: PlanItem[];
};

import { z } from "zod";

export const standaloneBriefInputSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  companyIndustry: z.string().trim().min(2).max(120),
  companyLocation: z.string().trim().min(2).max(120),
  contactName: z.string().trim().max(120).optional().default(""),
  contactRole: z.string().trim().max(120).optional().default(""),
  accountContext: z.string().trim().min(24).max(4_000),
  salesObjective: z.string().trim().min(12).max(600),
});

export type StandaloneBriefInput = z.infer<typeof standaloneBriefInputSchema>;

export type ManualEvidence = {
  id: string;
  label: string;
  observation: string;
};

export type BriefReadiness = {
  score: number;
  label: "Ready" | "Needs context" | "Needs a contact";
  components: Array<{
    label: string;
    score: number;
    maximum: number;
    explanation: string;
    tone: "emerald" | "amber" | "slate";
  }>;
};

export type StandaloneBriefPlanItem = {
  id: string;
  title: string;
  action: "Review context" | "Draft outreach" | "Prepare call" | "Confirm next step";
  priority: "Now" | "Today" | "This week";
  reason: string;
  evidenceIds: string[];
};

export type StandaloneBriefResult = {
  run: {
    id: string;
    status: "completed";
    mode: "bedrock";
    message: string;
    modelTurns: 1;
  };
  account: {
    id: string;
    name: string;
    industry: string;
    location: string;
    contact: { name: string; role: string } | null;
  };
  evidence: ManualEvidence[];
  readiness: BriefReadiness;
  brief: {
    summary: string;
    rationale: string;
    knownFacts: string[];
    questions: string[];
    outreach: { subject: string; body: string };
    assumptions: string[];
    evidenceIds: string[];
  };
  plan: StandaloneBriefPlanItem[];
};

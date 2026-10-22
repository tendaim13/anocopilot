import { z } from "zod";

export const icpProfileInputSchema = z.object({
  // Ano should clarify terse or uncertain answers; it should not grade them.
  // Upper bounds remain server-side safety limits for a bounded model request.
  productName: z.string().trim().max(160),
  productDescription: z.string().trim().max(2_000),
  valueProposition: z.string().trim().max(800),
  targetMarket: z.string().trim().max(600),
  targetLocations: z.string().trim().max(400),
  // A workspace may not know its ideal customer yet. Ano should turn that
  // uncertainty into a clarification question instead of refusing to start.
  idealCustomerProfile: z.string().trim().max(1_200),
  buyerRoles: z.string().trim().max(400),
  salesObjective: z.string().trim().max(600),
  exclusions: z.string().trim().max(800).optional().default(""),
  contextNotes: z.string().trim().max(2_000).optional().default(""),
}).strict();

export type IcpProfileInput = z.infer<typeof icpProfileInputSchema>;

export type ManualIcpEvidence = {
  id: string;
  label: string;
  observation: string;
};

export type IcpReadiness = {
  score: number;
  label: "Ready to plan research" | "Needs market detail" | "Needs buyer context";
  components: Array<{
    label: string;
    score: number;
    maximum: number;
    explanation: string;
    tone: "emerald" | "amber" | "slate";
  }>;
};

export type IcpPlanItem = {
  id: string;
  title: string;
  action: "Refine profile" | "Validate market" | "Define segment" | "Prepare research";
  priority: "Now" | "Today" | "This week";
  reason: string;
  evidenceIds: string[];
};

export type IcpProfileResult = {
  run: {
    id: string;
    status: "completed";
    mode: "bedrock";
    message: string;
    modelTurns: 1;
  };
  profile: {
    id: string;
    productName: string;
    targetMarket: string;
    targetLocations: string;
    idealCustomerProfile: string;
    buyerRoles: string;
    salesObjective: string;
  };
  evidence: ManualIcpEvidence[];
  readiness: IcpReadiness;
  brief: {
    positioning: string;
    idealCustomerSummary: string;
    knownFacts: string[];
    questions: string[];
    assumptions: string[];
    evidenceIds: string[];
  };
  plan: IcpPlanItem[];
};

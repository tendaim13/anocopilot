import { z } from "zod";

const optionalText = z.string().trim().max(2_000).optional().default("");

/**
 * Phase A begins with a product brief, not an ICP. Only the offer and the
 * user's outcome are required; every market detail is a hypothesis input.
 */
export const productBriefInputSchema = z.object({
  offer: z.string().trim().refine((value) => value.length > 0, "Describe what you sell."),
  objective: z.string().trim().refine((value) => value.length > 0, "Describe what you want to achieve."),
  marketHunch: optionalText,
  locationPreference: optionalText,
  buyerHunch: optionalText,
  customerExamples: optionalText,
  exclusions: optionalText,
  additionalContext: optionalText,
});

export type ProductBriefInput = z.infer<typeof productBriefInputSchema>;

export type BriefEvidence = {
  id: string;
  label: string;
  observation: string;
  source: "workspace_input";
};

export type MarketHypothesis = {
  id: string;
  title: string;
  statement: string;
  evidenceIds: string[];
};

export type LocationDecision = {
  id: string;
  type: "confirm_preference" | "choose_research_path";
  prompt: string;
  options: Array<{
    key: "lock_location" | "compare_markets" | "set_preference" | "continue_without_location";
    label: string;
    description: string;
  }>;
  status: "awaiting_choice" | "selected";
  selection?: string;
};

export type MarketBriefResult = {
  run: {
    id: string;
    status: "awaiting_scope_decision" | "market_scope_locked";
    mode: "bedrock";
    message: string;
    modelTurns: number;
  };
  productBrief: {
    id: string;
    offer: string;
    objective: string;
  };
  evidence: BriefEvidence[];
  hypothesis: {
    marketMap: string;
    hypotheses: MarketHypothesis[];
    assumptions: string[];
    questions: string[];
  };
  locationDecision: LocationDecision;
};

export const marketDecisionInputSchema = z.object({
  choice: z.enum(["lock_location", "compare_markets", "set_preference", "continue_without_location"]),
});

export type MarketDecisionInput = z.infer<typeof marketDecisionInputSchema>;

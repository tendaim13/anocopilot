import "server-only";

import { z } from "zod";

import { researchQuerySchema, type ResearchQuery } from "@/lib/ano/evidence-research";
import { isOpenMarketRecommendationIntent } from "@/lib/ano/autopilot";
import type { ResearchBrief, ResearchPlan } from "@/lib/ano/research-conversation";
import {
  createPlannerChatModel,
  OllamaConnectionError,
  OllamaModelNotFoundError,
} from "@/server/agents/ollama-chat-model";
import { GeminiApiError, sanitizeLlmErrorForUser } from "@/server/agents/gemini-chat-model";
import {
  extractJsonCandidate,
  invokeBedrockPrompt,
  mapSourceClass,
  type SourceClassLiteral,
} from "@/server/agents/research-planning-model";
import { normalizeLocationQuery } from "@/server/domain/prospeo-company-discovery";
import {
  DEEP_RESEARCH_DIMENSIONS,
  type DeepResearchDimension,
  type ResearchCoverage,
} from "@/server/research/deep-research-assessment";
import type { LlmPlannerConfig } from "@/server/agents/bedrock-contracts";

const text = z.string().trim().min(1).max(500);
// Ano, not Bedrock, owns durable identifiers and wave sequencing. Keeping them
// out of the model contract prevents a harmless formatting mistake from
// rejecting an otherwise usable research query.
const modelResearchQuerySchema = researchQuerySchema.omit({ id: true, waveNumber: true });
export const iterativeResearchWavePlanSchema = z.object({
  objective: text,
  candidateMarkets: z.array(z.string().trim().min(1).max(140)).min(2).max(5),
  // A follow-up planner is allowed to conclude that the saved evidence does
  // not justify another novel query. Ano then ends public collection rather
  // than treating that honest zero-query result as a model failure.
  queries: z.array(modelResearchQuerySchema).max(12),
});
export type IterativeResearchWavePlan = {
  objective: string;
  candidateMarkets: string[];
  queries: ResearchQuery[];
};

export class IterativeResearchPlannerError extends Error {
  constructor(message: string, readonly reason?: string) {
    super(message);
    this.name = "IterativeResearchPlannerError";
  }
}

function planInput(brief: ResearchBrief, plan: ResearchPlan) {
  return {
    approvedBrief: {
      offer: brief.offer,
      goal: brief.goal,
      businessLocation: brief.businessLocation ?? null,
      targetMarkets: brief.targetMarkets ?? [],
      marketHints: brief.marketHints,
      locationHints: brief.locationHints,
      buyerHints: brief.buyerHints,
      constraints: brief.constraints,
    },
    approvedPlan: {
      researchQuestions: plan.researchQuestions,
      comparisonCriteria: plan.comparisonCriteria,
      intendedSourceClasses: plan.intendedSourceClasses,
      plannedScope: plan.plannedScope,
    },
  };
}

const DEFAULT_PEER_MARKETS = [
  "United States",
  "Canada",
  "United Kingdom",
  "Australia",
  "Singapore",
];

function isNonGeographicPlaceholder(value: string): boolean {
  const clean = value.trim();
  if (!clean) return true;
  if (isOpenMarketRecommendationIntent(clean)) return true;
  return /^(?:adjacent|candidate|primary|target|other|general|global|worldwide|remote|anywhere|national market|test market|tbd|unknown|unspecified|none|n\/a|na|to be decided)/i.test(
    clean,
  );
}

function cleanGeographicCandidate(raw: string): string | null {
  if (isNonGeographicPlaceholder(raw)) return null;
  const cleaned = normalizeLocationQuery(raw).trim().slice(0, 140);
  if (!cleaned || isNonGeographicPlaceholder(cleaned)) return null;
  return cleaned;
}

export function deriveCandidateMarketsFromBriefAndPlan(
  brief: ResearchBrief,
  plan: ResearchPlan,
  proposed: string[] = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const pushUnique = (raw: string | null | undefined) => {
    if (!raw) return;
    const cleaned = cleanGeographicCandidate(raw);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  };

  for (const market of [
    ...(brief.targetMarkets ?? []),
    ...plan.plannedScope.markets,
    ...brief.locationHints,
    ...proposed,
  ]) {
    pushUnique(market);
    if (out.length >= 5) break;
  }

  if (out.length < 2 && brief.businessLocation) {
    pushUnique(brief.businessLocation);
  }

  for (const peer of DEFAULT_PEER_MARKETS) {
    if (out.length >= 3) break;
    pushUnique(peer);
  }

  return out.slice(0, 5);
}

function priorQueryContext(priorQueries: string[]) {
  return priorQueries.length
    ? { alreadySearched: priorQueries.slice(0, 50) }
    : { alreadySearched: [] };
}

function promptForInitialWave(brief: ResearchBrief, plan: ResearchPlan, maximumQueries: number, priorQueries: string[]) {
  return [
    "You are Ano's iterative public-research planner. You plan searches but cannot browse, fetch, use a provider, name companies, name people, or make a market recommendation.",
    "Design the first evidence wave for a comparative market study. The purpose is to form a small, testable set of 2 to 5 candidate markets and collect evidence for the same decision dimensions, not to answer with generic industry articles.",
    "Use these comparison dimensions exactly: problem_urgency, market_density, buyer_conditions, market_access, solution_fit, counter_evidence.",
    `Return 6 to ${Math.min(12, maximumQueries)} short, non-duplicative queries. Every query must identify a candidateMarket and one comparisonDimension. Spread queries across at least two candidates and seek the listed source classes. Candidate markets are hypotheses to be tested, never recommendations. If no novel query is justified, return an empty queries array.`,
    "Avoid generic queries such as 'AI workflow adoption'. Anchor each query to the offer, outcome, candidate, and evidence gap. Include at least one counter_evidence query. Do not repeat or lightly rephrase any query in alreadySearched.",
    "Return JSON only: {objective:string,candidateMarkets:string[],queries:[{query:string,reason:string,sourceClass:'Government and official statistics'|'Industry bodies and primary research'|'Public company reports and filings'|'Independent reporting',candidateMarket:string|null,comparisonDimension:'problem_urgency'|'market_density'|'buyer_conditions'|'market_access'|'solution_fit'|'counter_evidence',priority:number}]}. Do not return IDs or wave numbers; Ano assigns them.",
    JSON.stringify({ ...planInput(brief, plan), ...priorQueryContext(priorQueries) }),
  ].join("\n\n");
}

function promptForFollowUpWave(brief: ResearchBrief, plan: ResearchPlan, coverage: ResearchCoverage, waveNumber: number, maximumQueries: number, priorQueries: string[]) {
  return [
    "You are Ano's iterative public-research planner. You plan the next bounded research wave but cannot browse, fetch, use a provider, name companies, name people, or make a market recommendation.",
    "Use the saved coverage ledger below to close the highest-impact comparison gaps. Do not repeat broad queries or search a candidate simply because it is familiar. Do not repeat or lightly rephrase any query in alreadySearched.",
    `This is wave ${waveNumber}. Return up to ${Math.min(12, maximumQueries)} targeted, non-duplicative queries. Preserve the candidateMarkets exactly; every query must name one candidateMarket and one comparisonDimension. Prioritize missing direct evidence, source-class diversity, dated evidence, and counter-evidence for an apparent leader. If none can be formed without repeating alreadySearched, return an empty queries array.`,
    "Return JSON only: {objective:string,candidateMarkets:string[],queries:[{query:string,reason:string,sourceClass:'Government and official statistics'|'Industry bodies and primary research'|'Public company reports and filings'|'Independent reporting',candidateMarket:string|null,comparisonDimension:'problem_urgency'|'market_density'|'buyer_conditions'|'market_access'|'solution_fit'|'counter_evidence',priority:number}]}. Do not return IDs or wave numbers; Ano assigns them.",
    JSON.stringify({ ...planInput(brief, plan), coverage, ...priorQueryContext(priorQueries) }),
  ].join("\n\n");
}

function normalisedQueryKey(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

const ALLOWED_DIMENSIONS = [
  "problem_urgency",
  "market_density",
  "buyer_conditions",
  "market_access",
  "solution_fit",
  "counter_evidence",
] as const;

type ComparisonDimensionLiteral = (typeof ALLOWED_DIMENSIONS)[number];

function mapComparisonDimension(raw: unknown): ComparisonDimensionLiteral {
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const exact = ALLOWED_DIMENSIONS.find((item) => item === normalized);
    if (exact) return exact;
    if (/counter|risk|barrier|downside|challenge|drawback|objection|negative|con\b/.test(normalized)) {
      return "counter_evidence";
    }
    if (/terrain|density|size|volume|count|number|practice|clinic|concentration|scale/.test(normalized)) {
      return "market_density";
    }
    if (/buyer|budget|willing|spend|decision|procure|authority|condition|financ/.test(normalized)) {
      return "buyer_conditions";
    }
    if (/access|regulat|legal|compli|channel|reach|distribut|entry/.test(normalized)) {
      return "market_access";
    }
    if (/fit|integrat|workflow|adopt|compat|solut/.test(normalized)) {
      return "solution_fit";
    }
    if (/urgen|pain|problem|need|missed|no_show|churn|cost|inefficien/.test(normalized)) {
      return "problem_urgency";
    }
  }
  return "problem_urgency";
}

function normalizePriority(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(100, Math.max(1, Math.round(raw)));
  }
  if (typeof raw === "string") {
    const lowered = raw.trim().toLowerCase();
    if (lowered === "high") return 90;
    if (lowered === "medium") return 60;
    if (lowered === "low") return 30;
    const numeric = Number(lowered);
    if (Number.isFinite(numeric)) {
      return Math.min(100, Math.max(1, Math.round(numeric)));
    }
  }
  return 50;
}

function resolveCandidateMarket(rawMarket: unknown, candidateMarkets: string[]): string | null {
  if (typeof rawMarket !== "string") return null;
  const trimmed = rawMarket.trim().slice(0, 140);
  if (!trimmed) return null;
  const matched = candidateMarkets.find((item) => item.toLowerCase() === trimmed.toLowerCase());
  return matched ?? trimmed;
}

function queryTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
}

function isNearDuplicateQuery(
  candidate: { query: string; candidateMarket?: string | null; comparisonDimension?: string | null },
  priorQueries: string[],
  knownKeys: Set<string>,
): boolean {
  const normalized = normalisedQueryKey(candidate.query);
  if (!normalized || knownKeys.has(normalized)) return true;

  const candidateToks = queryTokens(candidate.query);
  if (candidateToks.size === 0) return true;

  const marketKey = candidate.candidateMarket?.trim().toLowerCase() ?? "";
  for (const prior of priorQueries) {
    const priorToks = queryTokens(prior);
    if (priorToks.size === 0) continue;
    const shared = Array.from(candidateToks).filter((t) => priorToks.has(t)).length;
    const sim = shared / Math.max(1, Math.min(candidateToks.size, priorToks.size));
    const sharesMarket = !marketKey || prior.toLowerCase().includes(marketKey);
    if (sharesMarket && sim >= 0.85) {
      return true;
    }
  }
  return false;
}

function preNormalizeWaveShape(value: unknown, expectedCandidates?: string[]) {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  const objectiveRaw =
    typeof raw.objective === "string" && raw.objective.trim()
      ? raw.objective
      : typeof raw.goal === "string" && raw.goal.trim()
        ? raw.goal
        : "Compare candidate markets across decision dimensions";
  const objective = objectiveRaw.trim().slice(0, 500);

  const rawMarketsSource = Array.isArray(raw.candidateMarkets) ? raw.candidateMarkets : [];
  const extractedMarkets = rawMarketsSource
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
        return item.name.trim();
      }
      return "";
    })
    .filter((item) => item.length > 0 && !isNonGeographicPlaceholder(item))
    .map((item) => item.slice(0, 140));

  const seenMarkets = new Set<string>();
  const candidateMarkets: string[] = [];
  for (const market of [...(expectedCandidates ?? []), ...extractedMarkets]) {
    const key = market.toLowerCase();
    if (!seenMarkets.has(key)) {
      seenMarkets.add(key);
      candidateMarkets.push(market);
    }
  }

  const rawQueries = Array.isArray(raw.queries) ? raw.queries : [];
  if (candidateMarkets.length < 2) {
    for (const entry of rawQueries) {
      if (entry && typeof entry === "object" && "candidateMarket" in entry && typeof entry.candidateMarket === "string") {
        const cleaned = entry.candidateMarket.trim().slice(0, 140);
        if (cleaned && !isNonGeographicPlaceholder(cleaned) && !seenMarkets.has(cleaned.toLowerCase())) {
          seenMarkets.add(cleaned.toLowerCase());
          candidateMarkets.push(cleaned);
        }
      }
    }
  }
  for (const peer of DEFAULT_PEER_MARKETS) {
    if (candidateMarkets.length >= 2) break;
    if (!seenMarkets.has(peer.toLowerCase())) {
      seenMarkets.add(peer.toLowerCase());
      candidateMarkets.push(peer);
    }
  }
  const boundedMarkets = candidateMarkets.slice(0, 5);

  const normalizedQueries = rawQueries
    .slice(0, 12)
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const q = entry as Record<string, unknown>;
      const queryText = typeof q.query === "string" ? q.query.trim().slice(0, 380) : "";
      if (queryText.length < 3) return [];
      const reasonText =
        typeof q.reason === "string" && q.reason.trim()
          ? q.reason.trim().slice(0, 320)
          : "Evaluates decision-relevant public evidence.";
      const sourceClass =
        (typeof q.sourceClass === "string" ? mapSourceClass(q.sourceClass) : null) ??
        "Industry bodies and primary research";
      const candidateMarket = resolveCandidateMarket(q.candidateMarket, boundedMarkets);
      return [
        {
          query: queryText,
          reason: reasonText,
          sourceClass,
          candidateMarket,
          comparisonDimension: mapComparisonDimension(q.comparisonDimension),
          priority: normalizePriority(q.priority),
        },
      ];
    });

  return {
    objective,
    candidateMarkets: boundedMarkets,
    queries: normalizedQueries,
  };
}

export function normalizeIterativeResearchWave(
  value: unknown,
  waveNumber: number,
  maximumQueries: number,
  expectedCandidates?: string[],
  priorQueries: string[] = [],
  coverage?: ResearchCoverage | null,
) {
  const parsed = iterativeResearchWavePlanSchema.parse(preNormalizeWaveShape(value, expectedCandidates));
  const candidateMarkets = expectedCandidates?.length ? expectedCandidates : parsed.candidateMarkets;
  const allowedCandidates = new Set(candidateMarkets);
  const knownQueries = new Set(priorQueries.map(normalisedQueryKey));
  const trackedPriorQueries = [...priorQueries];

  const saturatedCells = new Set<string>();
  const uncoveredCells = new Set<string>();
  if (waveNumber > 1 && coverage?.cells?.length) {
    for (const cell of coverage.cells) {
      const cellKey = `${cell.candidateMarket.toLowerCase()}::${cell.dimension}`;
      if (cell.qualifyingSources === 0) uncoveredCells.add(cellKey);
      else if (cell.qualifyingSources >= 2) saturatedCells.add(cellKey);
    }
  }

  let candidateQueries = parsed.queries.filter(
    (query) =>
      !expectedCandidates?.length ||
      (typeof query.candidateMarket === "string" && allowedCandidates.has(query.candidateMarket)),
  );

  // For follow-up waves with uncovered cells remaining, drop redundant saturated-cell queries.
  if (waveNumber > 1 && uncoveredCells.size > 0) {
    const gapClosingOnly = candidateQueries.filter((query) => {
      const market = query.candidateMarket?.trim().toLowerCase() ?? "";
      const dim = query.comparisonDimension ?? "problem_urgency";
      if (dim === "counter_evidence") return true;
      return !saturatedCells.has(`${market}::${dim}`);
    });
    candidateQueries = gapClosingOnly;
  }

  const queries: ResearchQuery[] = candidateQueries
    .filter((query) => {
      const nearDup = isNearDuplicateQuery(query, trackedPriorQueries, knownQueries);
      if (nearDup) return false;
      knownQueries.add(normalisedQueryKey(query.query));
      trackedPriorQueries.push(query.query);
      return true;
    })
    .slice(0, Math.min(12, maximumQueries))
    .map((query) =>
      researchQuerySchema.parse({
        ...query,
        id: crypto.randomUUID(),
        candidateMarket: query.candidateMarket ?? candidateMarkets[0] ?? null,
        comparisonDimension: query.comparisonDimension ?? "problem_urgency",
        priority: query.priority ?? 50,
        waveNumber,
      }),
    );

  return { objective: parsed.objective, candidateMarkets, queries };
}

function sourceClassForDimension(dimension: DeepResearchDimension): SourceClassLiteral {
  switch (dimension) {
    case "market_density":
    case "market_access":
      return "Government and official statistics";
    case "problem_urgency":
    case "solution_fit":
      return "Industry bodies and primary research";
    case "buyer_conditions":
      return "Public company reports and filings";
    case "counter_evidence":
      return "Independent reporting";
  }
}

function queryPhraseForDimension(
  offerTopic: string,
  industryTopic: string,
  market: string,
  dimension: DeepResearchDimension,
  waveNumber: number,
): string {
  const variant = waveNumber > 2 ? " official statistics benchmark" : "";
  switch (dimension) {
    case "problem_urgency":
      return `${market} ${industryTopic} ${offerTopic} demand survey statistics${variant}`.slice(0, 380);
    case "market_density":
      return `${market} ${industryTopic} business count census directory statistics${variant}`.slice(0, 380);
    case "buyer_conditions":
      return `${market} ${industryTopic} buyer spending budget procurement trends${variant}`.slice(0, 380);
    case "market_access":
      return `${market} ${industryTopic} regulatory compliance market entry overview${variant}`.slice(0, 380);
    case "solution_fit":
      return `${market} ${industryTopic} ${offerTopic} adoption workflow study${variant}`.slice(0, 380);
    case "counter_evidence":
      return `${market} ${industryTopic} ${offerTopic} adoption barriers risks limitations`.slice(0, 380);
  }
}

function compactBriefTopic(text: string): string {
  const words = text
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 5);
  return words.join(" ") || "B2B software";
}

export function buildDeterministicInitialWave(
  brief: ResearchBrief,
  plan: ResearchPlan,
  maximumQueries: number,
  priorQueries: string[] = [],
): IterativeResearchWavePlan {
  const candidateMarkets = deriveCandidateMarketsFromBriefAndPlan(brief, plan);
  const offerTopic = compactBriefTopic(brief.offer);
  const industryTopic = compactBriefTopic(
    plan.plannedScope.industries[0] ?? brief.marketHints[0] ?? "",
  );
  const known = new Set(priorQueries.map(normalisedQueryKey));
  const rawQueries: ResearchQuery[] = [];

  for (const dimension of DEEP_RESEARCH_DIMENSIONS) {
    for (const market of candidateMarkets) {
      if (rawQueries.length >= Math.min(10, maximumQueries)) break;
      const queryText = queryPhraseForDimension(offerTopic, industryTopic, market, dimension, 1);
      const key = normalisedQueryKey(queryText);
      if (known.has(key)) continue;
      known.add(key);
      rawQueries.push(
        researchQuerySchema.parse({
          id: crypto.randomUUID(),
          query: queryText,
          reason: `Tests ${dimension.replaceAll("_", " ")} in ${market} across authoritative sources.`,
          sourceClass: sourceClassForDimension(dimension),
          candidateMarket: market,
          comparisonDimension: dimension,
          priority: dimension === "counter_evidence" ? 75 : 90,
          waveNumber: 1,
        }),
      );
    }
  }

  return {
    objective: `Compare ${candidateMarkets.join(", ")} across urgency, density, buyer conditions, access, fit, and counter-evidence`,
    candidateMarkets,
    queries: rawQueries.slice(0, Math.min(10, maximumQueries)),
  };
}

export function buildDeterministicGapClosingWave(
  brief: ResearchBrief,
  plan: ResearchPlan,
  coverage: ResearchCoverage,
  waveNumber: number,
  maximumQueries: number,
  priorQueries: string[] = [],
): IterativeResearchWavePlan {
  const candidateMarkets = deriveCandidateMarketsFromBriefAndPlan(
    brief,
    plan,
    coverage.candidateMarkets,
  );
  const offerTopic = compactBriefTopic(brief.offer);
  const industryTopic = compactBriefTopic(
    plan.plannedScope.industries[0] ?? brief.marketHints[0] ?? "",
  );
  const known = new Set(priorQueries.map(normalisedQueryKey));

  const missingCells =
    coverage.missingCells && coverage.missingCells.length > 0
      ? coverage.missingCells
      : coverage.cells
        .filter((cell) => cell.qualifyingSources < 1)
        .map((cell) => ({ candidateMarket: cell.candidateMarket, dimension: cell.dimension }));

  const queries: ResearchQuery[] = [];
  for (const cell of missingCells) {
    if (queries.length >= Math.min(8, maximumQueries)) break;
    const queryText = queryPhraseForDimension(
      offerTopic,
      industryTopic,
      cell.candidateMarket,
      cell.dimension,
      waveNumber,
    );
    const key = normalisedQueryKey(queryText);
    if (known.has(key)) continue;
    known.add(key);
    queries.push(
      researchQuerySchema.parse({
        id: crypto.randomUUID(),
        query: queryText,
        reason: `Closes uncovered evidence gap for ${cell.candidateMarket} (${cell.dimension.replaceAll("_", " ")}).`,
        sourceClass: sourceClassForDimension(cell.dimension),
        candidateMarket: cell.candidateMarket,
        comparisonDimension: cell.dimension,
        priority: 95,
        waveNumber,
      }),
    );
  }

  if (queries.length < Math.min(6, maximumQueries) && coverage.sourceClassCount < 2) {
    for (const market of candidateMarkets) {
      if (queries.length >= Math.min(6, maximumQueries)) break;
      const counterQuery = queryPhraseForDimension(
        offerTopic,
        industryTopic,
        market,
        "counter_evidence",
        waveNumber,
      );
      if (!known.has(normalisedQueryKey(counterQuery))) {
        known.add(normalisedQueryKey(counterQuery));
        queries.push(
          researchQuerySchema.parse({
            id: crypto.randomUUID(),
            query: counterQuery,
            reason: `Tests counter-evidence and adds source-class diversity for ${market}.`,
            sourceClass: "Independent reporting",
            candidateMarket: market,
            comparisonDimension: "counter_evidence",
            priority: 80,
            waveNumber,
          }),
        );
      }
    }
  }

  return {
    objective: `Close remaining comparative evidence gaps in wave ${waveNumber}`,
    candidateMarkets,
    queries,
  };
}

/** LLM proposes only the next bounded question set. Ano owns all provider access and stopping conditions. */
export function createIterativeResearchPlanner(config: LlmPlannerConfig) {
  const model = createPlannerChatModel(config, { maxTokens: 2_000 });

  async function invoke(
    prompt: string,
    waveNumber: number,
    maximumQueries: number,
    expectedCandidates?: string[],
    priorQueries: string[] = [],
    coverage?: ResearchCoverage | null,
  ) {
    const systemPrompt = "Return only the requested JSON object. Do not include Markdown, recommendations, or explanatory text.";
    let reason = "LLM did not return a valid iterative query plan.";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const output = await invokeBedrockPrompt(
          model,
          systemPrompt,
          attempt ? `${prompt}\n\nReturn the exact JSON object now.` : prompt,
        );
        if (!output) throw new Error("LLM returned no textual JSON.");
        return normalizeIterativeResearchWave(
          JSON.parse(extractJsonCandidate(output)),
          waveNumber,
          maximumQueries,
          expectedCandidates,
          priorQueries,
          coverage,
        );
      } catch (error) {
        if (
          error instanceof OllamaConnectionError ||
          error instanceof OllamaModelNotFoundError ||
          error instanceof GeminiApiError
        ) {
          const detail =
            error instanceof GeminiApiError && error.technicalDetail
              ? `${error.name}: ${error.technicalDetail}`.slice(0, 600)
              : `${error.name}: ${error.message}`.slice(0, 600);
          throw new IterativeResearchPlannerError(sanitizeLlmErrorForUser(error), detail);
        }
        reason = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 600) : reason;
      }
    }
    throw new IterativeResearchPlannerError("Ano could not plan the next bounded research wave. No additional provider request was attempted.", reason);
  }

  return {
    planInitialWave: async (
      brief: ResearchBrief,
      plan: ResearchPlan,
      maximumQueries: number,
      priorQueries: string[] = [],
    ) => {
      const derivedMarkets = deriveCandidateMarketsFromBriefAndPlan(brief, plan);
      try {
        const planned = await invoke(
          promptForInitialWave(brief, plan, maximumQueries, priorQueries),
          1,
          maximumQueries,
          undefined,
          priorQueries,
        );
        if (planned.queries.length > 0) {
          return {
            ...planned,
            candidateMarkets: deriveCandidateMarketsFromBriefAndPlan(
              brief,
              plan,
              planned.candidateMarkets,
            ),
          };
        }
      } catch (error) {
        if (
          error instanceof IterativeResearchPlannerError &&
          /Gemini|Ollama/i.test(error.reason ?? "")
        ) {
          throw error;
        }
      }
      return buildDeterministicInitialWave(brief, plan, maximumQueries, priorQueries);
    },
    planFollowUpWave: async (
      brief: ResearchBrief,
      plan: ResearchPlan,
      coverage: ResearchCoverage,
      waveNumber: number,
      maximumQueries: number,
      priorQueries: string[] = [],
    ) => {
      const expectedMarkets = deriveCandidateMarketsFromBriefAndPlan(
        brief,
        plan,
        coverage.candidateMarkets,
      );
      try {
        const planned = await invoke(
          promptForFollowUpWave(brief, plan, coverage, waveNumber, maximumQueries, priorQueries),
          waveNumber,
          maximumQueries,
          expectedMarkets,
          priorQueries,
          coverage,
        );
        if (planned.queries.length > 0 || coverage.comparisonReady) {
          return planned;
        }
      } catch (error) {
        if (
          error instanceof IterativeResearchPlannerError &&
          /Gemini|Ollama/i.test(error.reason ?? "")
        ) {
          throw error;
        }
      }
      if (!coverage.comparisonReady && maximumQueries > 0) {
        return buildDeterministicGapClosingWave(
          brief,
          plan,
          coverage,
          waveNumber,
          maximumQueries,
          priorQueries,
        );
      }
      return {
        objective: "Evidence coverage gate satisfied; no additional follow-up queries needed.",
        candidateMarkets: expectedMarkets,
        queries: [],
      };
    },
  };
}

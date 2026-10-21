import type { Candidate, ScoreComponent } from "@/lib/ano/types";

export const SCORE_VERSION = "phase-1-mock-v1";

export function calculateDeterministicScore(components: ScoreComponent[]) {
  return components.reduce((total, component) => total + component.score, 0);
}

export function scoreMatchesCandidate(candidate: Candidate) {
  return calculateDeterministicScore(candidate.scoreComponents) === candidate.score;
}

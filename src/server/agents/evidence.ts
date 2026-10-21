import type { Candidate, EvidenceItem } from "@/lib/ano/types";

export function evidenceKeysFor(candidate: Candidate) {
  return candidate.evidence.map((item) => item.id);
}

export function hasOnlyCandidateEvidence(candidate: Candidate, claimedEvidence: EvidenceItem[]) {
  const permitted = new Set(evidenceKeysFor(candidate));
  return claimedEvidence.every((item) => permitted.has(item.id));
}

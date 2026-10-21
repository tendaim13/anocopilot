import type { AgentCheckpoint } from "@/contracts/agent";

export function createCheckpoint(phase: AgentCheckpoint["phase"], turn: number, toolCalls: number): AgentCheckpoint {
  return { phase, turn, toolCalls, createdAt: new Date().toISOString() };
}

export function canResumeCheckpoint(checkpoint: AgentCheckpoint) {
  return checkpoint.phase === "clarifying" || checkpoint.phase === "awaiting_approval";
}

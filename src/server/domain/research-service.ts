import type { WorkspaceSession } from "@/contracts/ano";
import { runSimulatedSalesResearch } from "@/server/agents/runtime";
import { persistResearchRun } from "@/server/persistence/research-run-store";
import type { ResearchInput, ResearchResult } from "@/lib/ano/types";

export async function runResearchForWorkspace(session: WorkspaceSession, input: ResearchInput, idempotencyKey: string): Promise<ResearchResult> {
  const agentRun = runSimulatedSalesResearch({ input, idempotencyKey });
  return persistResearchRun(session, input, agentRun.result, idempotencyKey);
}

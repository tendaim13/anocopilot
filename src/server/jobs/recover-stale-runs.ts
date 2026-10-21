import type { WorkspaceSession } from "@/contracts/ano";
import { recoverStaleResearchRuns } from "@/server/persistence/research-run-store";

/**
 * A future protected scheduler can invoke this per workspace. Recovery marks a
 * stale run failed and never retries a paid provider or external connector.
 */
export function recoverWorkspaceResearchRuns(session: WorkspaceSession) {
  return recoverStaleResearchRuns(session);
}

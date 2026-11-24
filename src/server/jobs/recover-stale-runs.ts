import type { WorkspaceSession } from "@/contracts/ano";
import { drainAutopilotRunWithDeps } from "@/server/jobs/autopilot-worker";
import {
  createDefaultAutopilotDeps,
  type AutopilotOrchestratorDeps,
} from "@/server/domain/autopilot-orchestrator-service";
import { recoverStaleAutopilotRuns } from "@/server/persistence/autopilot-store";
import { recoverStaleResearchRuns } from "@/server/persistence/research-run-store";

/**
 * Legacy run lease sweep. Marks stale research_runs failed and never retries a
 * paid provider or external connector automatically.
 */
export function recoverWorkspaceResearchRuns(session: WorkspaceSession) {
  return recoverStaleResearchRuns(session);
}

/**
 * Recovers expired stage/wave leases in a workspace without re-charging
 * completed stages and enforces the maximum interruption pause cap.
 */
export function recoverWorkspaceAutopilotRuns(
  session: WorkspaceSession,
  options?: { conversationId?: string; now?: number; maxRecoveries?: number },
) {
  return recoverStaleAutopilotRuns(session, options);
}

/**
 * Recovers expired leases in a workspace and resumes any unpaused running
 * Autopilot jobs on the server worker.
 */
export async function recoverAndDrainWorkspaceAutopilotRuns(
  session: WorkspaceSession,
  options?: {
    conversationId?: string;
    deps?: AutopilotOrchestratorDeps;
    workerId?: string;
    now?: () => number;
  },
) {
  const recovery = await recoverStaleAutopilotRuns(session, {
    conversationId: options?.conversationId,
    now: options?.now?.(),
  });
  const deps = options?.deps ?? createDefaultAutopilotDeps();
  const results = [];
  for (const conversationId of recovery.recoveredConversationIds) {
    results.push(
      await drainAutopilotRunWithDeps(session, conversationId, deps, {
        workerId: options?.workerId,
        now: options?.now,
      }),
    );
  }
  return { recovery, results };
}

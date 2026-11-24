import "server-only";

import { after } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  AUTOPILOT_STAGES,
  type AutopilotExecutableStage,
  type AutopilotRunView,
  type AutopilotStatus,
} from "@/lib/ano/autopilot";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import {
  createDefaultAutopilotDeps,
  executeAutopilotStepWithDeps,
  type AutopilotOrchestratorDeps,
} from "@/server/domain/autopilot-orchestrator-service";
import {
  readAutopilotRun,
  recoverStaleAutopilotRuns,
} from "@/server/persistence/autopilot-store";

export type AutopilotWorkerDrainResult = {
  conversationId: string;
  executedStages: AutopilotExecutableStage[];
  finalStatus: AutopilotStatus | "not_found";
  autopilotRun: AutopilotRunView | null;
  reason:
    | "completed"
    | "already_leased"
    | "paused"
    | "failed"
    | "not_found"
    | "max_iterations";
};

const activeDrainPromises = new Map<string, Promise<AutopilotWorkerDrainResult>>();

function createWorkerClientWithServiceRole(): SupabaseClient | null {
  const publicConfig = getSupabasePublicConfig();
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!publicConfig?.url || !serviceKey) {
    return null;
  }
  return createClient(publicConfig.url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Clones a request-scoped cookie session into an independent Supabase client
 * holding the signed-in user's access token (or server secret key when configured)
 * so Next.js `after()` and background workers never touch `cookies()` post-response.
 */
export async function createDetachedWorkerSession(
  session: WorkspaceSession,
): Promise<WorkspaceSession> {
  if (session.kind === "demo") {
    return session;
  }

  const publicConfig = getSupabasePublicConfig();
  if (!publicConfig) {
    return session;
  }

  const serviceKey =
    process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (serviceKey) {
    const serviceClient = createClient(publicConfig.url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return {
      ...session,
      client: serviceClient,
    };
  }

  const getSessionFn = session.client?.auth?.getSession;
  if (typeof getSessionFn !== "function") {
    return session;
  }

  try {
    const authResult = await getSessionFn.call(session.client.auth);
    const accessToken = authResult?.data?.session?.access_token;
    if (!accessToken) {
      return session;
    }

    const detachedClient = createClient(publicConfig.url, publicConfig.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    return {
      ...session,
      client: detachedClient,
    };
  } catch {
    return session;
  }
}

export async function drainAutopilotRunWithDeps(
  session: WorkspaceSession,
  conversationId: string,
  deps: AutopilotOrchestratorDeps,
  options?: {
    workerId?: string;
    leaseDurationMs?: number;
    heartbeatIntervalMs?: number;
    maxStages?: number;
    now?: () => number;
  },
): Promise<AutopilotWorkerDrainResult> {
  const inflightKey = `${session.workspace.id}:${conversationId}`;
  const existingDrain = activeDrainPromises.get(inflightKey);
  if (existingDrain) {
    return existingDrain;
  }

  const runPromise = (async (): Promise<AutopilotWorkerDrainResult> => {
    const executedStages: AutopilotExecutableStage[] = [];
    const maxIterations = Math.max(1, options?.maxStages ?? AUTOPILOT_STAGES.length + 1);
    let latestRun: AutopilotRunView | null = null;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const stepResult = await executeAutopilotStepWithDeps(
        session,
        conversationId,
        deps,
        options,
      );
      latestRun = stepResult.autopilotRun;

      if (stepResult.executedStage) {
        executedStages.push(stepResult.executedStage);
      }

      if (stepResult.skippedBecauseInFlight) {
        return {
          conversationId,
          executedStages,
          finalStatus: latestRun?.status ?? "running",
          autopilotRun: latestRun,
          reason: "already_leased",
        };
      }

      if (!latestRun) {
        return {
          conversationId,
          executedStages,
          finalStatus: "not_found",
          autopilotRun: null,
          reason: "not_found",
        };
      }

      if (latestRun.status === "paused" || latestRun.status === "cancelled") {
        return {
          conversationId,
          executedStages,
          finalStatus: latestRun.status,
          autopilotRun: latestRun,
          reason: "paused",
        };
      }

      if (latestRun.status === "failed") {
        return {
          conversationId,
          executedStages,
          finalStatus: "failed",
          autopilotRun: latestRun,
          reason: "failed",
        };
      }

      if (
        latestRun.status === "completed" ||
        latestRun.status === "completed_with_warnings" ||
        latestRun.currentStage === "done"
      ) {
        return {
          conversationId,
          executedStages,
          finalStatus: latestRun.status,
          autopilotRun: latestRun,
          reason: "completed",
        };
      }
    }

    return {
      conversationId,
      executedStages,
      finalStatus: latestRun?.status ?? "running",
      autopilotRun: latestRun,
      reason: "max_iterations",
    };
  })();

  activeDrainPromises.set(inflightKey, runPromise);
  try {
    return await runPromise;
  } finally {
    if (activeDrainPromises.get(inflightKey) === runPromise) {
      activeDrainPromises.delete(inflightKey);
    }
  }
}

export async function drainAutopilotRun(
  session: WorkspaceSession,
  conversationId: string,
  options?: {
    workerId?: string;
    leaseDurationMs?: number;
    heartbeatIntervalMs?: number;
    maxStages?: number;
    now?: () => number;
  },
): Promise<AutopilotWorkerDrainResult> {
  return drainAutopilotRunWithDeps(
    session,
    conversationId,
    createDefaultAutopilotDeps(),
    options,
  );
}

export async function scheduleAutopilotBackgroundExecution(
  session: WorkspaceSession,
  conversationId: string,
  options?: {
    workerId?: string;
    scheduler?: (task: () => Promise<void>) => void;
  },
): Promise<{ scheduled: boolean }> {
  if (session.kind === "demo") {
    return { scheduled: false };
  }

  const inflightKey = `${session.workspace.id}:${conversationId}`;
  if (activeDrainPromises.has(inflightKey)) {
    return { scheduled: true };
  }

  const detachedSession = await createDetachedWorkerSession(session);
  const runTask = async () => {
    try {
      await drainAutopilotRun(detachedSession, conversationId, {
        workerId: options?.workerId,
      });
    } catch (error) {
      console.error(
        "[ano:autopilot-worker] background drain stopped",
        error instanceof Error ? error.message.slice(0, 240) : "unknown",
      );
    }
  };

  if (options?.scheduler) {
    options.scheduler(runTask);
    return { scheduled: true };
  }

  try {
    after(runTask);
  } catch {
    // Fallback when invoked outside a Next.js request lifecycle (e.g. CLI scripts or tests).
    queueMicrotask(() => {
      void runTask();
    });
  }

  return { scheduled: true };
}

export async function ensureAutopilotWorkerProgress(
  session: WorkspaceSession,
  conversationId: string,
  options?: {
    workerId?: string;
    scheduler?: (task: () => Promise<void>) => void;
  },
): Promise<AutopilotRunView | null> {
  if (session.kind === "demo") {
    return null;
  }

  const current = await readAutopilotRun(session, conversationId).catch(() => null);
  if (!current || current.status !== "running" || current.stageInFlight) {
    return current;
  }

  await recoverStaleAutopilotRuns(session, { conversationId }).catch(() => undefined);
  const refreshed = await readAutopilotRun(session, conversationId).catch(() => current);
  if (refreshed?.status === "running" && !refreshed.stageInFlight) {
    await scheduleAutopilotBackgroundExecution(session, conversationId, options);
  }
  return refreshed;
}

export async function runGlobalAutopilotWorkerSweep(options?: {
  workerId?: string;
  limit?: number;
}): Promise<{
  configured: boolean;
  inspected: number;
  recovered: number;
  drained: number;
  paused: number;
}> {
  const serviceClient = createWorkerClientWithServiceRole();
  if (!serviceClient) {
    return { configured: false, inspected: 0, recovered: 0, drained: 0, paused: 0 };
  }

  const limit = Math.max(1, Math.min(options?.limit ?? 20, 50));
  const workerId = options?.workerId?.trim() || `cli-worker:${crypto.randomUUID().slice(0, 8)}`;

  const { data: runRows, error } = await serviceClient
    .from("autopilot_runs")
    .select("workspace_id, conversation_id, authorized_by, created_by")
    .eq("status", "running")
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error || !runRows || runRows.length === 0) {
    return { configured: true, inspected: 0, recovered: 0, drained: 0, paused: 0 };
  }

  const workspaceIds = Array.from(
    new Set(runRows.map((row) => String((row as Record<string, unknown>).workspace_id))),
  );
  const { data: workspaces } = await serviceClient
    .from("workspaces")
    .select("id, name, slug")
    .in("id", workspaceIds);

  const workspaceById = new Map<string, { id: string; name: string; slug: string }>();
  for (const ws of workspaces ?? []) {
    const rec = ws as Record<string, unknown>;
    workspaceById.set(String(rec.id), {
      id: String(rec.id),
      name: String(rec.name ?? "Workspace"),
      slug: String(rec.slug ?? "workspace"),
    });
  }

  let recovered = 0;
  let drained = 0;
  let paused = 0;

  for (const rawRow of runRows as Array<Record<string, unknown>>) {
    const workspaceId = String(rawRow.workspace_id);
    const conversationId = String(rawRow.conversation_id);
    const workspaceMeta = workspaceById.get(workspaceId);
    if (!workspaceMeta) continue;

    const actorId = String(rawRow.authorized_by ?? rawRow.created_by ?? workspaceId);
    const workerSession: WorkspaceSession = {
      kind: "supabase",
      actorId,
      actorEmail: "worker@ano.internal",
      workspace: {
        id: workspaceMeta.id,
        name: workspaceMeta.name,
        slug: workspaceMeta.slug,
        role: "owner",
      },
      workspaces: [
        {
          id: workspaceMeta.id,
          name: workspaceMeta.name,
          slug: workspaceMeta.slug,
          role: "owner",
        },
      ],
      client: serviceClient,
    };

    const recovery = await recoverStaleAutopilotRuns(workerSession, {
      conversationId,
    }).catch((): { recoveredConversationIds: string[]; pausedConversationIds: string[] } => ({
      recoveredConversationIds: [],
      pausedConversationIds: [],
    }));
    recovered += recovery.recoveredConversationIds.length;
    paused += recovery.pausedConversationIds.length;

    if (!recovery.pausedConversationIds.includes(conversationId)) {
      const drainResult = await drainAutopilotRun(workerSession, conversationId, {
        workerId,
      }).catch(() => null);
      if (drainResult && drainResult.executedStages.length > 0) {
        drained += 1;
      }
    }
  }

  return {
    configured: true,
    inspected: runRows.length,
    recovered,
    drained,
    paused,
  };
}

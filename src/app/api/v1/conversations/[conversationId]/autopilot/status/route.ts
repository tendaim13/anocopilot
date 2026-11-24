import { NextResponse } from "next/server";

import { formatAutopilotOutcomeMessage } from "@/lib/ano/autopilot";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  AutopilotOrchestratorError,
  getAutopilotStatusSnapshotForConversation,
} from "@/server/domain/autopilot-orchestrator-service";
import { ResearchConversationServiceError } from "@/server/domain/research-conversation-service";
import { ensureAutopilotWorkerProgress } from "@/server/jobs/autopilot-worker";
import { AutopilotPersistenceError } from "@/server/persistence/autopilot-store";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (
    error instanceof AutopilotOrchestratorError ||
    error instanceof AutopilotPersistenceError ||
    error instanceof ResearchConversationServiceError ||
    error instanceof ResearchConversationPersistenceError
  ) {
    const code =
      "code" in error && typeof error.code === "string" ? error.code : "AUTOPILOT_STATUS_UNAVAILABLE";
    const status = code === "AUTH_REQUIRED" ? 401 : 422;
    return NextResponse.json(
      { error: formatAutopilotOutcomeMessage(error.message, { kind: "error" }), code },
      { status },
    );
  }
  console.error(
    "Ano autopilot status route failed",
    error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 600) }
      : { type: typeof error },
  );
  return NextResponse.json(
    { error: "Ano could not read the current pipeline progress cleanly." },
    { status: 500 },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    await ensureAutopilotWorkerProgress(session, conversationId).catch(() => null);
    const snapshot = await getAutopilotStatusSnapshotForConversation(session, conversationId);
    return NextResponse.json(snapshot);
  } catch (error) {
    return errorResponse(error);
  }
}

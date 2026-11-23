import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  AutopilotOrchestratorError,
  stepAutopilotForConversation,
} from "@/server/domain/autopilot-orchestrator-service";
import { ResearchConversationServiceError } from "@/server/domain/research-conversation-service";
import { AutopilotPersistenceError } from "@/server/persistence/autopilot-store";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      "code" in error && typeof error.code === "string" ? error.code : "AUTOPILOT_STEP_FAILED";
    const status = code === "AUTH_REQUIRED" ? 401 : 422;
    return NextResponse.json({ error: error.message, code }, { status });
  }
  console.error(
    "Ano autopilot step route failed",
    error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 600) }
      : { type: typeof error },
  );
  return NextResponse.json(
    { error: "Ano paused the autonomous pipeline safely after an unexpected stage error." },
    { status: 500 },
  );
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const result = await stepAutopilotForConversation(session, conversationId);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

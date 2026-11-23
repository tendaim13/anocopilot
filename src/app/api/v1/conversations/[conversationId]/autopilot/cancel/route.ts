import { NextResponse } from "next/server";

import { autopilotCancelRequestSchema } from "@/lib/ano/autopilot";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  AutopilotOrchestratorError,
  cancelAutopilotForConversation,
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
      "code" in error && typeof error.code === "string" ? error.code : "AUTOPILOT_CANCEL_FAILED";
    const status = code === "AUTH_REQUIRED" ? 401 : 422;
    return NextResponse.json({ error: error.message, code }, { status });
  }
  console.error(
    "Ano autopilot cancel route failed",
    error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 600) }
      : { type: typeof error },
  );
  return NextResponse.json(
    { error: "Ano could not update the autopilot run status cleanly." },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const rawBody = await request.json().catch(() => ({}));
  const parsed = autopilotCancelRequestSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a valid pause or cancel payload." },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const autopilotRun = await cancelAutopilotForConversation(
      session,
      conversationId,
      parsed.data.mode ?? "paused",
    );
    return NextResponse.json({ autopilotRun });
  } catch (error) {
    return errorResponse(error);
  }
}

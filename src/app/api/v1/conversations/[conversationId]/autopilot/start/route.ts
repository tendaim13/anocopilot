import { NextResponse } from "next/server";

import { autopilotStartRequestSchema } from "@/lib/ano/autopilot";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  AutopilotOrchestratorError,
  startAutopilotForConversation,
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
      "code" in error && typeof error.code === "string" ? error.code : "AUTOPILOT_UNAVAILABLE";
    const status = code === "AUTH_REQUIRED" ? 401 : 422;
    return NextResponse.json({ error: error.message, code }, { status });
  }
  console.error(
    "Ano autopilot start route failed",
    error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 600) }
      : { type: typeof error },
  );
  return NextResponse.json(
    { error: "Ano could not start the autonomous pipeline cleanly." },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const rawBody = await request.json().catch(() => null);
  const parsed = autopilotStartRequestSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Explicit approval is required before starting Autopilot.",
        code: "EXPLICIT_APPROVAL_REQUIRED",
      },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const autopilotRun = await startAutopilotForConversation(session, conversationId, {
      fromStage: parsed.data.fromStage,
      explicitApproval: parsed.data.explicitApproval,
      authorityScope: parsed.data.authorityScope,
    });
    return NextResponse.json({ autopilotRun });
  } catch (error) {
    return errorResponse(error);
  }
}

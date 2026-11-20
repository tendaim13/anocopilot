import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  getWorkspaceWorkQueue,
  ResearchConversationServiceError,
} from "@/server/domain/research-conversation-service";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const workQueue = await getWorkspaceWorkQueue(await requireWorkspaceSession());
    return NextResponse.json({ workQueue });
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (
      error instanceof ResearchConversationServiceError ||
      error instanceof ResearchConversationPersistenceError
    ) {
      return NextResponse.json(
        { error: error.message, code: "WORK_QUEUE_UNAVAILABLE" },
        { status: 422 },
      );
    }
    return NextResponse.json({ error: "Ano could not read the workspace work queue." }, { status: 500 });
  }
}

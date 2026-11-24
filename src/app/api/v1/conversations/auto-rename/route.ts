import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { autoRenameWorkspaceConversations } from "@/server/domain/research-conversation-service";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await requireWorkspaceSession();
    const result = await autoRenameWorkspaceConversations(session);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof ResearchConversationPersistenceError) {
      return NextResponse.json(
        { error: error.message, code: "RESEARCH_CONVERSATION_UNAVAILABLE" },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: "Ano could not automatically rename workspace conversations right now." },
      { status: 500 },
    );
  }
}

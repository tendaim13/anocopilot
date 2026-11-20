import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  getCurrentResearchConversation,
  listResearchConversations,
  ResearchConversationServiceError,
  startResearchConversation,
} from "@/server/domain/research-conversation-service";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function idempotencyKey(request: Request) {
  const supplied = request.headers.get("x-ano-idempotency-key");
  return supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied) ? supplied : crypto.randomUUID();
}

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof ResearchConversationServiceError || error instanceof ResearchConversationPersistenceError) return NextResponse.json({ error: error.message, code: "RESEARCH_CONVERSATION_UNAVAILABLE" }, { status: 422 });
  const diagnostic = error instanceof Error
    ? { name: error.name, message: error.message.slice(0, 600) }
    : { type: typeof error };
  console.error("Ano research conversation route failed unexpectedly", diagnostic);
  return NextResponse.json({ error: "Ano could not safely continue this conversation. No external action was attempted." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const session = await requireWorkspaceSession();
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const rawLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 25;

    const [listResult, conversation] = await Promise.all([
      listResearchConversations(session, { cursor, limit }),
      session.kind === "supabase" && !cursor ? getCurrentResearchConversation(session) : Promise.resolve(null),
    ]);
    return NextResponse.json({
      conversation,
      conversations: listResult.conversations,
      nextCursor: listResult.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Tell Ano what you want to sell and what you want to achieve first." }, { status: 400 });
  try {
    return NextResponse.json({ conversation: await startResearchConversation(await requireWorkspaceSession(), message, idempotencyKey(request)) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

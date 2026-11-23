import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { ResearchConversationServiceError, resumeResearchConversation } from "@/server/domain/research-conversation-service";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";
import { runWithInternalUsageContext } from "@/server/telemetry/internal-api-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function idempotencyKey(request: Request) {
  const supplied = request.headers.get("x-ano-idempotency-key");
  return supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied) ? supplied : crypto.randomUUID();
}

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const body: unknown = await request.json().catch(() => null);
  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    return NextResponse.json({
      conversation: await runWithInternalUsageContext({ session, conversationId }, () =>
        resumeResearchConversation(session, conversationId, body, idempotencyKey(request)),
      ),
    });
  } catch (error) {
    if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof ResearchConversationServiceError || error instanceof ResearchConversationPersistenceError) return NextResponse.json({ error: error.message, code: "RESEARCH_CONVERSATION_UNAVAILABLE" }, { status: 422 });
    return NextResponse.json({ error: "Ano could not safely resume this conversation. No external action was attempted." }, { status: 500 });
  }
}

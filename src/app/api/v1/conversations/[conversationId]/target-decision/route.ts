import { NextResponse } from "next/server";

import { lockTargetDecisionInputSchema } from "@/lib/ano/market-synthesis";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { lockMarketRouteForConversation, MarketSynthesisServiceError } from "@/server/domain/market-synthesis-service";
import { MarketSynthesisPersistenceError } from "@/server/persistence/market-synthesis-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof MarketSynthesisServiceError || error instanceof MarketSynthesisPersistenceError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  return NextResponse.json({ error: "Ano could not lock that target route. No company search, contact lookup, or outreach action was attempted." }, { status: 500 });
}

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const parsed = lockTargetDecisionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose one cited market and one cited industry before locking the route." }, { status: 400 });
  try {
    const { conversationId } = await context.params;
    return NextResponse.json({ synthesis: await lockMarketRouteForConversation(await requireWorkspaceSession(), conversationId, parsed.data) });
  } catch (error) {
    return errorResponse(error);
  }
}

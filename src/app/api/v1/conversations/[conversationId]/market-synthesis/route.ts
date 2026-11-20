import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  analyseMarketSynthesisForConversation,
  getMarketSynthesisForConversation,
  MarketSynthesisServiceError,
} from "@/server/domain/market-synthesis-service";
import { MarketSynthesisPersistenceError } from "@/server/persistence/market-synthesis-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof MarketSynthesisServiceError || error instanceof MarketSynthesisPersistenceError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  console.error("Ano market synthesis failed", error instanceof Error ? { name: error.name, message: error.message.slice(0, 600) } : { type: typeof error });
  return NextResponse.json({ error: "Ano could not safely analyze the saved evidence. No new search, company lookup, or sales action was attempted." }, { status: 500 });
}

export async function GET(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    return NextResponse.json({ synthesis: await getMarketSynthesisForConversation(await requireWorkspaceSession(), conversationId) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** This deliberate UI action analyzes existing saved excerpts only. */
export async function POST(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    return NextResponse.json({ synthesis: await analyseMarketSynthesisForConversation(await requireWorkspaceSession(), conversationId) });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from "next/server";

import { productBriefInputSchema } from "@/lib/ano/market-discovery";
import { AgentRuntimeError } from "@/server/agents/runtime";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { createMarketBriefForWorkspace } from "@/server/domain/market-discovery-service";
import { MarketDiscoveryPersistenceError } from "@/server/persistence/market-discovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function idempotencyKey(request: Request) {
  const supplied = request.headers.get("x-ano-idempotency-key");
  return supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied) ? supplied : crypto.randomUUID();
}

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = productBriefInputSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Tell Ano what you sell and what you want to achieve first.", issues: parsed.error.flatten() }, { status: 400 });
  try {
    const session = await requireWorkspaceSession();
    return NextResponse.json(await createMarketBriefForWorkspace(session, parsed.data, idempotencyKey(request)));
  } catch (error) {
    if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof MarketDiscoveryPersistenceError) return NextResponse.json({ error: error.message, code: "PERSISTENCE_FAILED" }, { status: 500 });
    if (error instanceof AgentRuntimeError) return NextResponse.json({ error: error.message, code: error.code, checkpoint: error.checkpoint }, { status: 422 });
    return NextResponse.json({ error: "Ano could not prepare market hypotheses. No provider, connector, or sales action was attempted." }, { status: 500 });
  }
}

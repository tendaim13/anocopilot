import { NextResponse } from "next/server";

import { marketScopeInputSchema } from "@/lib/ano/market-discovery";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { saveManualMarketScopeForWorkspace } from "@/server/domain/market-discovery-service";
import { MarketDiscoveryPersistenceError } from "@/server/persistence/market-discovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ briefId: string }> }) {
  const { briefId } = await context.params;
  const payload: unknown = await request.json().catch(() => null);
  const parsed = marketScopeInputSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Add a location before locking the market scope." }, { status: 400 });
  try {
    const session = await requireWorkspaceSession();
    return NextResponse.json(await saveManualMarketScopeForWorkspace(session, briefId, parsed.data));
  } catch (error) {
    if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof MarketDiscoveryPersistenceError) return NextResponse.json({ error: error.message, code: "PERSISTENCE_FAILED" }, { status: 409 });
    return NextResponse.json({ error: "Ano could not lock that market scope. No provider or connector action was attempted." }, { status: 500 });
  }
}

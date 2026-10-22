import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { getMarketBriefForWorkspace } from "@/server/domain/market-discovery-service";
import { MarketDiscoveryPersistenceError } from "@/server/persistence/market-discovery-store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ briefId: string }> }) {
  const { briefId } = await context.params;
  try {
    const session = await requireWorkspaceSession();
    return NextResponse.json(await getMarketBriefForWorkspace(session, briefId));
  } catch (error) {
    if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof MarketDiscoveryPersistenceError) return NextResponse.json({ error: error.message, code: "PERSISTENCE_FAILED" }, { status: 404 });
    return NextResponse.json({ error: "Ano could not restore that product brief." }, { status: 500 });
  }
}

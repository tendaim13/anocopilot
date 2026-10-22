import { NextResponse } from "next/server";

import { marketHypothesisPatchSchema } from "@/lib/ano/market-discovery";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { editMarketHypothesesForWorkspace } from "@/server/domain/market-discovery-service";
import { MarketDiscoveryPersistenceError } from "@/server/persistence/market-discovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ briefId: string }> }) {
  const { briefId } = await context.params;
  const payload: unknown = await request.json().catch(() => null);
  const parsed = marketHypothesisPatchSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Ano needs one or more grounded hypotheses to save this edit." }, { status: 400 });
  try {
    const session = await requireWorkspaceSession();
    return NextResponse.json(await editMarketHypothesesForWorkspace(session, briefId, parsed.data));
  } catch (error) {
    if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof MarketDiscoveryPersistenceError) return NextResponse.json({ error: error.message, code: "PERSISTENCE_FAILED" }, { status: 409 });
    return NextResponse.json({ error: "Ano could not save that hypothesis edit. No provider or connector action was attempted." }, { status: 500 });
  }
}

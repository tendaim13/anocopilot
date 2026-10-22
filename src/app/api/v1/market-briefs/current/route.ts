import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { getLatestMarketBriefForWorkspace } from "@/server/domain/market-discovery-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireWorkspaceSession();
    return NextResponse.json({ result: await getLatestMarketBriefForWorkspace(session) });
  } catch (error) {
    if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ error: "Ano could not restore the latest market brief." }, { status: 500 });
  }
}

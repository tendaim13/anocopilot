import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { prepareProspeoCompanySearchForWorkspace } from "@/server/domain/market-discovery-service";
import { ProspeoDiscoveryError } from "@/server/persistence/prospeo-company-discovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ briefId: string }> }) {
  const { briefId } = await context.params;
  try {
    const session = await requireWorkspaceSession();
    return NextResponse.json(await prepareProspeoCompanySearchForWorkspace(session, briefId));
  } catch (error) {
    if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof ProspeoDiscoveryError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    return NextResponse.json({ error: "Ano could not prepare a company-search preview. No company search was attempted." }, { status: 500 });
  }
}

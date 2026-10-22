import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { approveProspeoCompanySearchForWorkspace } from "@/server/domain/market-discovery-service";
import { ProspeoDiscoveryError } from "@/server/persistence/prospeo-company-discovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The user action that may create a Prospeo credit-bearing request. */
export async function POST(_request: Request, context: { params: Promise<{ searchId: string }> }) {
  const { searchId } = await context.params;
  try {
    const session = await requireWorkspaceSession();
    return NextResponse.json(await approveProspeoCompanySearchForWorkspace(session, searchId));
  } catch (error) {
    if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof ProspeoDiscoveryError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    return NextResponse.json({ error: "Ano could not start that approved company search. It did not automatically retry." }, { status: 500 });
  }
}

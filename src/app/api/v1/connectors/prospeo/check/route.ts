import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { checkProspeoConnectionForWorkspace } from "@/server/domain/market-discovery-service";
import { ProspeoDiscoveryError } from "@/server/persistence/prospeo-company-discovery-store";
import { runWithInternalUsageContext } from "@/server/telemetry/internal-api-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await requireWorkspaceSession();
    return NextResponse.json(
      await runWithInternalUsageContext({ session }, () => checkProspeoConnectionForWorkspace(session)),
    );
  } catch (error) {
    if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof ProspeoDiscoveryError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    return NextResponse.json({ error: "Ano could not check Prospeo. No company search was attempted." }, { status: 500 });
  }
}

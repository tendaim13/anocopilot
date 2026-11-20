import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  listWorkspaceDiscoveredAccounts,
  TargetAccountDiscoveryServiceError,
} from "@/server/domain/target-account-discovery-service";
import { TargetAccountDiscoveryPersistenceError } from "@/server/persistence/target-account-discovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireWorkspaceSession();
    const accounts = await listWorkspaceDiscoveredAccounts(session);
    return NextResponse.json({ accounts });
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (
      error instanceof TargetAccountDiscoveryServiceError ||
      error instanceof TargetAccountDiscoveryPersistenceError
    ) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    }
    return NextResponse.json(
      { error: "Ano could not load workspace company candidates." },
      { status: 500 },
    );
  }
}

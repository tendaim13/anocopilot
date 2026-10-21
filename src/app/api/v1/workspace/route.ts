import { NextResponse } from "next/server";

import { requireWorkspaceSession, toWorkspaceRuntime, WorkspaceSessionError } from "@/server/auth/workspace-session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireWorkspaceSession();
    return NextResponse.json(toWorkspaceRuntime(session));
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }

    return NextResponse.json({ error: "Ano could not verify the active workspace." }, { status: 500 });
  }
}

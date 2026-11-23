import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  createWorkspaceInvite,
  listWorkspaceInvites,
  WorkspaceInviteServiceError,
} from "@/server/domain/workspace-invite-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireWorkspaceSession();
    const invites = await listWorkspaceInvites(session);
    return NextResponse.json({ invites });
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof WorkspaceInviteServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Ano could not load workspace invite links." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  try {
    const session = await requireWorkspaceSession();
    const origin = new URL(request.url).origin;
    const created = await createWorkspaceInvite(session, body, origin);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof WorkspaceInviteServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Ano could not create a workspace invite link." }, { status: 500 });
  }
}

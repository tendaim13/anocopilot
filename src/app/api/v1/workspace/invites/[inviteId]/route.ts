import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  revokeWorkspaceInvite,
  WorkspaceInviteServiceError,
} from "@/server/domain/workspace-invite-service";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ inviteId: string }> },
) {
  const { inviteId } = await context.params;
  if (!z.string().uuid().safeParse(inviteId).success) {
    return NextResponse.json({ error: "Invalid invite ID." }, { status: 400 });
  }

  try {
    const session = await requireWorkspaceSession();
    const invite = await revokeWorkspaceInvite(session, inviteId);
    return NextResponse.json({ invite });
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof WorkspaceInviteServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Ano could not revoke that invite link." }, { status: 500 });
  }
}

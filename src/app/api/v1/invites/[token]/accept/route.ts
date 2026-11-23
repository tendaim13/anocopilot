import { NextResponse } from "next/server";

import { ACTIVE_WORKSPACE_COOKIE, extractInviteToken } from "@/lib/ano/workspace-auth";
import {
  acceptWorkspaceInviteByToken,
  WorkspaceInviteServiceError,
} from "@/server/domain/workspace-invite-service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const normalized = extractInviteToken(decodeURIComponent(token));
  if (!normalized) {
    return NextResponse.json(
      { error: "This invite link is invalid.", code: "INVITE_NOT_FOUND" },
      { status: 404 },
    );
  }

  try {
    const result = await acceptWorkspaceInviteByToken(normalized);
    const response = NextResponse.json(result);
    response.cookies.set(ACTIVE_WORKSPACE_COOKIE, result.workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    if (error instanceof WorkspaceInviteServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Ano could not accept that invite link." }, { status: 500 });
  }
}

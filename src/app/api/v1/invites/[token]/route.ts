import { NextResponse } from "next/server";

import { extractInviteToken } from "@/lib/ano/workspace-auth";
import {
  previewWorkspaceInviteByToken,
  WorkspaceInviteServiceError,
} from "@/server/domain/workspace-invite-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const normalized = extractInviteToken(decodeURIComponent(token));
  if (!normalized) {
    return NextResponse.json({ valid: false, status: "not_found" });
  }

  try {
    const preview = await previewWorkspaceInviteByToken(normalized);
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof WorkspaceInviteServiceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Ano could not verify that invite link." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/ano/workspace-auth";
import {
  switchWorkspaceForCurrentUser,
  WorkspaceSessionError,
} from "@/server/auth/workspace-session";

export const dynamic = "force-dynamic";

const switchWorkspaceBodySchema = z.object({
  workspaceId: z.string().uuid(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = switchWorkspaceBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a valid workspace ID to switch to." },
      { status: 400 },
    );
  }

  try {
    const runtime = await switchWorkspaceForCurrentUser(parsed.data.workspaceId);
    const response = NextResponse.json(runtime);
    response.cookies.set(ACTIVE_WORKSPACE_COOKIE, runtime.workspace.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Ano could not switch workspaces." }, { status: 500 });
  }
}

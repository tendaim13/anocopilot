import { NextResponse } from "next/server";

import { candidateStateSchema, saveCandidateState } from "@/server/domain/candidate-state-service";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await context.params;
  const payload: unknown = await request.json().catch(() => null);
  const parsed = candidateStateSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Ano needs a valid run and candidate state." }, { status: 400 });
  }

  try {
    const session = await requireWorkspaceSession();
    const state = await saveCandidateState(session, candidateId, parsed.data);
    return NextResponse.json(state);
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "Ano could not save that candidate state." }, { status: 500 });
  }
}

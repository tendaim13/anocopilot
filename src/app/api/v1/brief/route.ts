import { NextResponse } from "next/server";

import { standaloneBriefInputSchema } from "@/lib/ano/standalone";
import { AgentRuntimeError } from "@/server/agents/runtime";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { createStandaloneBriefForWorkspace } from "@/server/domain/standalone-brief-service";
import { StandaloneBriefPersistenceError } from "@/server/persistence/standalone-brief-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function idempotencyKey(request: Request) {
  const supplied = request.headers.get("x-ano-idempotency-key");
  return supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = standaloneBriefInputSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Add the account, sales objective, and enough context for Ano to prepare a brief.", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const session = await requireWorkspaceSession();
    const result = await createStandaloneBriefForWorkspace(session, parsed.data, idempotencyKey(request));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof StandaloneBriefPersistenceError) {
      return NextResponse.json({ error: error.message, code: "PERSISTENCE_FAILED" }, { status: 500 });
    }
    if (error instanceof AgentRuntimeError) {
      return NextResponse.json({ error: error.message, code: error.code, checkpoint: error.checkpoint }, { status: 422 });
    }
    return NextResponse.json({ error: "Ano could not create a workspace brief. No connector or external sales action was attempted." }, { status: 500 });
  }
}

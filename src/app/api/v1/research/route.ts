import { NextResponse } from "next/server";

import { researchInputSchema } from "@/lib/ano/types";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { runResearchForWorkspace } from "@/server/domain/research-service";
import { AgentRuntimeError } from "@/server/agents/runtime";
import { ResearchRunPersistenceError } from "@/server/persistence/research-run-store";

export const dynamic = "force-dynamic";

function idempotencyKey(request: Request) {
  const supplied = request.headers.get("x-ano-idempotency-key");
  return supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = researchInputSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Please provide an objective, industry, geography, and target role before research can begin.",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    // The runtime is deliberately simulated. Its policy guard is still applied
    // before any tool, and no provider, Mercury, or model request can run here.
    const result = await runResearchForWorkspace(session, parsed.data, idempotencyKey(request));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof ResearchRunPersistenceError) {
      const status = error.code === "RUN_IN_PROGRESS" ? 409 : 500;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    if (error instanceof AgentRuntimeError) {
      return NextResponse.json({ error: error.message, code: error.code, checkpoint: error.checkpoint }, { status: 422 });
    }

    return NextResponse.json(
      { error: "Ano could not start a safe research run. No external action was attempted." },
      { status: 500 },
    );
  }
}

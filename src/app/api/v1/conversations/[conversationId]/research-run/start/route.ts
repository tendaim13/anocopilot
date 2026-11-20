import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import { EvidenceResearchServiceError, startApprovedEvidenceResearch } from "@/server/domain/evidence-research-service";
import { EvidenceResearchPersistenceError } from "@/server/persistence/evidence-research-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof EvidenceResearchServiceError || error instanceof EvidenceResearchPersistenceError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  console.error("Ano approved public research failed", error instanceof Error ? { name: error.name, message: error.message.slice(0, 600) } : { type: typeof error });
  return NextResponse.json({ error: "Ano could not safely run this public-research scope. It will not retry a provider request automatically." }, { status: 500 });
}

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const body: unknown = await request.json().catch(() => null);
  const runId = body && typeof body === "object" && "runId" in body && typeof body.runId === "string" ? body.runId : "";
  if (!runId) return NextResponse.json({ error: "Ano needs the approved research scope before it can start." }, { status: 400 });
  try {
    const { conversationId } = await context.params;
    return NextResponse.json({ research: await startApprovedEvidenceResearch(await requireWorkspaceSession(), conversationId, runId) });
  } catch (error) {
    return errorResponse(error);
  }
}

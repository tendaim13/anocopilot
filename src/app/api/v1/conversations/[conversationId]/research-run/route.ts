import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  EvidenceResearchServiceError,
  getEvidenceResearchForConversation,
  prepareEvidenceResearchForConversation,
} from "@/server/domain/evidence-research-service";
import { EvidenceResearchPersistenceError } from "@/server/persistence/evidence-research-store";
import { searxngConfiguration } from "@/server/research/searxng-provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof EvidenceResearchServiceError || error instanceof EvidenceResearchPersistenceError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  console.error("Ano public research preparation failed", error instanceof Error ? { name: error.name, message: error.message.slice(0, 600) } : { type: typeof error });
  return NextResponse.json({ error: "Ano could not safely prepare this public-research scope. No provider request was made." }, { status: 500 });
}

export async function GET(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    return NextResponse.json({ research: await getEvidenceResearchForConversation(await requireWorkspaceSession(), conversationId), provider: searxngConfiguration() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await context.params;
    return NextResponse.json({ research: await prepareEvidenceResearchForConversation(await requireWorkspaceSession(), conversationId), provider: searxngConfiguration() }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

import { NextResponse } from "next/server";

import {
  conversationExportFormatSchema,
  leadExportScopeSchema,
} from "@/lib/ano/lead-export";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  exportConversationArtifact,
  LeadExportServiceError,
} from "@/server/domain/lead-export-service";
import { PeoplePlaybookPersistenceError } from "@/server/persistence/people-playbook-store";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (
    error instanceof LeadExportServiceError ||
    error instanceof PeoplePlaybookPersistenceError ||
    error instanceof ResearchConversationPersistenceError
  ) {
    const code = "code" in error && typeof error.code === "string" ? error.code : "EXPORT_UNAVAILABLE";
    const status = code === "AUTH_REQUIRED" ? 401 : 422;
    return NextResponse.json({ error: error.message, code }, { status });
  }
  console.error(
    "Ano conversation export route failed",
    error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 600) }
      : { type: typeof error },
  );
  return NextResponse.json(
    { error: "Ano could not prepare that export file." },
    { status: 500 },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const { searchParams } = new URL(request.url);
  const rawFormat = searchParams.get("format") ?? "leads_csv";
  const rawScope = searchParams.get("scope") ?? "with_email";

  const parsedFormat = conversationExportFormatSchema.safeParse(rawFormat);
  const parsedScope = leadExportScopeSchema.safeParse(rawScope);
  if (!parsedFormat.success || !parsedScope.success) {
    return NextResponse.json(
      { error: "Provide a valid export format (leads_csv, templates_csv, templates_md) and scope." },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const result = await exportConversationArtifact(
      session,
      conversationId,
      parsedFormat.data,
      parsedScope.data,
    );

    return new NextResponse(result.content, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

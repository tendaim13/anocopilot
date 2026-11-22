import { NextResponse } from "next/server";

import { leadExportScopeSchema } from "@/lib/ano/lead-export";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  exportWorkspacePeopleCsv,
  LeadExportServiceError,
} from "@/server/domain/lead-export-service";
import { PeoplePlaybookPersistenceError } from "@/server/persistence/people-playbook-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsedScope = leadExportScopeSchema.safeParse(searchParams.get("scope") ?? "with_email");
  if (!parsedScope.success) {
    return NextResponse.json(
      { error: "Provide a valid lead export scope (with_email, verified_only, all)." },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    const result = await exportWorkspacePeopleCsv(session, parsedScope.data);
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
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof LeadExportServiceError || error instanceof PeoplePlaybookPersistenceError) {
      const status = error.code === "AUTH_REQUIRED" ? 401 : 422;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json(
      { error: "Ano could not prepare the workspace leads export." },
      { status: 500 },
    );
  }
}

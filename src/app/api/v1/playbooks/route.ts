import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  listWorkspaceAccountPlaybooks,
  PeoplePlaybookServiceError,
} from "@/server/domain/people-playbook-service";
import { PeoplePlaybookPersistenceError } from "@/server/persistence/people-playbook-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireWorkspaceSession();
    const playbooks = await listWorkspaceAccountPlaybooks(session);
    return NextResponse.json({ playbooks });
  } catch (error) {
    if (error instanceof WorkspaceSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (
      error instanceof PeoplePlaybookServiceError ||
      error instanceof PeoplePlaybookPersistenceError
    ) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
    }
    return NextResponse.json(
      { error: "Ano could not load workspace account playbooks." },
      { status: 500 },
    );
  }
}

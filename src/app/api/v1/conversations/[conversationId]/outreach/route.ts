import { NextResponse } from "next/server";

import { outreachExecutionActionInputSchema } from "@/lib/ano/outreach-execution";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  createProposalFromDraftForConversation,
  decideExecutionProposalForConversation,
  editOutreachDraftForConversation,
  generateOutreachDraftsForConversation,
  getOutreachExecutionForConversation,
  OutreachExecutionServiceError,
} from "@/server/domain/outreach-execution-service";
import { PeoplePlaybookServiceError } from "@/server/domain/people-playbook-service";
import { TargetAccountDiscoveryServiceError } from "@/server/domain/target-account-discovery-service";
import { OutreachExecutionPersistenceError } from "@/server/persistence/outreach-execution-store";
import { PeoplePlaybookPersistenceError } from "@/server/persistence/people-playbook-store";
import { TargetAccountDiscoveryPersistenceError } from "@/server/persistence/target-account-discovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (
    error instanceof OutreachExecutionServiceError ||
    error instanceof OutreachExecutionPersistenceError ||
    error instanceof PeoplePlaybookServiceError ||
    error instanceof PeoplePlaybookPersistenceError ||
    error instanceof TargetAccountDiscoveryServiceError ||
    error instanceof TargetAccountDiscoveryPersistenceError
  ) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  }
  console.error(
    "Ano outreach execution route failed",
    error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 600) }
      : { type: typeof error },
  );
  return NextResponse.json(
    { error: "Ano could not safely complete that outreach proposal action." },
    { status: 500 },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    return NextResponse.json(await getOutreachExecutionForConversation(session, conversationId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const parsed = outreachExecutionActionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a valid outreach draft, proposal, or approval action." },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const action = parsed.data;

    if (action.action === "generate_drafts") {
      return NextResponse.json(
        await generateOutreachDraftsForConversation(session, conversationId, action.playbookId),
      );
    }
    if (action.action === "edit_draft") {
      return NextResponse.json(
        await editOutreachDraftForConversation(
          session,
          conversationId,
          action.draftId,
          action.subject,
          action.body,
        ),
      );
    }
    if (action.action === "create_proposal") {
      return NextResponse.json(
        await createProposalFromDraftForConversation(
          session,
          conversationId,
          action.draftId,
          action.proposalType,
          action.scheduledFor,
          action.note,
        ),
      );
    }

    return NextResponse.json(
      await decideExecutionProposalForConversation(
        session,
        conversationId,
        action.proposalId,
        action.decision,
        action.rationale,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

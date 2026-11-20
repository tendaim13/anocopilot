import { NextResponse } from "next/server";

import { peopleDiscoveryActionInputSchema } from "@/lib/ano/people-playbooks";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  approveContactVerificationForConversation,
  approvePersonSearchForConversation,
  generateAccountPlaybooksForConversation,
  getPeopleDiscoveryForConversation,
  PeoplePlaybookServiceError,
  prepareContactVerificationForConversation,
  proposeBuyerRolesForConversation,
} from "@/server/domain/people-playbook-service";
import { TargetAccountDiscoveryServiceError } from "@/server/domain/target-account-discovery-service";
import { PeoplePlaybookPersistenceError } from "@/server/persistence/people-playbook-store";
import { TargetAccountDiscoveryPersistenceError } from "@/server/persistence/target-account-discovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (
    error instanceof PeoplePlaybookServiceError ||
    error instanceof PeoplePlaybookPersistenceError ||
    error instanceof TargetAccountDiscoveryServiceError ||
    error instanceof TargetAccountDiscoveryPersistenceError
  ) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  }
  console.error(
    "Ano people discovery route failed",
    error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 600) }
      : { type: typeof error },
  );
  return NextResponse.json(
    { error: "Ano could not safely complete that people discovery or playbook step." },
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
    return NextResponse.json(await getPeopleDiscoveryForConversation(session, conversationId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const parsed = peopleDiscoveryActionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a valid people discovery, Dropcontact verification, or playbook action." },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const action = parsed.data;

    if (action.action === "propose_roles") {
      return NextResponse.json(
        await proposeBuyerRolesForConversation(session, conversationId, action.roleOverrides),
      );
    }
    if (action.action === "approve_person_search") {
      return NextResponse.json(
        await approvePersonSearchForConversation(session, conversationId, action.personSearchId),
      );
    }
    if (action.action === "prepare_verification") {
      return NextResponse.json(
        await prepareContactVerificationForConversation(
          session,
          conversationId,
          action.contactIds,
        ),
      );
    }
    if (action.action === "approve_verification") {
      return NextResponse.json(
        await approveContactVerificationForConversation(
          session,
          conversationId,
          action.verificationRunId,
        ),
      );
    }

    return NextResponse.json(
      await generateAccountPlaybooksForConversation(session, conversationId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

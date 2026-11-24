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
  runWebsiteTeamDiscoveryForConversation,
} from "@/server/domain/people-playbook-service";
import { TargetAccountDiscoveryServiceError } from "@/server/domain/target-account-discovery-service";
import { PeoplePlaybookPersistenceError } from "@/server/persistence/people-playbook-store";
import { TargetAccountDiscoveryPersistenceError } from "@/server/persistence/target-account-discovery-store";
import { runWithInternalUsageContext } from "@/server/telemetry/internal-api-usage";

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
      { error: "Provide a valid people discovery, email verification, or playbook action." },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const action = parsed.data;

    return NextResponse.json(
      await runWithInternalUsageContext({ session, conversationId }, async () => {
        if (action.action === "propose_roles") {
          return await proposeBuyerRolesForConversation(session, conversationId, {
            providerKey: action.providerKey,
            roleOverrides: action.roleOverrides,
            departments: action.departments,
            seniorities: action.seniorities,
            excludeTitles: action.excludeTitles,
            archetype: action.archetype,
          });
        }
        if (action.action === "run_free_people_search") {
          return await runWebsiteTeamDiscoveryForConversation(session, conversationId, {
            roleOverrides: action.roleOverrides,
            departments: action.departments,
            seniorities: action.seniorities,
            excludeTitles: action.excludeTitles,
            archetype: action.archetype,
          });
        }
        if (action.action === "approve_person_search") {
          return await approvePersonSearchForConversation(
            session,
            conversationId,
            action.personSearchId,
          );
        }
        if (action.action === "prepare_verification") {
          return await prepareContactVerificationForConversation(
            session,
            conversationId,
            action.contactIds,
            action.providerKey,
          );
        }
        if (action.action === "approve_verification") {
          return await approveContactVerificationForConversation(
            session,
            conversationId,
            action.verificationRunId,
          );
        }

        return await generateAccountPlaybooksForConversation(session, conversationId);
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

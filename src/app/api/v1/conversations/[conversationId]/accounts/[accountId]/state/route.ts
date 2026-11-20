import { NextResponse } from "next/server";

import { accountStateInputSchema } from "@/lib/ano/company-discovery";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  TargetAccountDiscoveryServiceError,
  updateAccountStateForConversation,
} from "@/server/domain/target-account-discovery-service";
import { TargetAccountDiscoveryPersistenceError } from "@/server/persistence/target-account-discovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (
    error instanceof TargetAccountDiscoveryServiceError ||
    error instanceof TargetAccountDiscoveryPersistenceError
  ) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  }
  return NextResponse.json(
    { error: "Ano could not update that company candidate." },
    { status: 500 },
  );
}

async function handleUpdate(
  request: Request,
  context: { params: Promise<{ conversationId: string; accountId: string }> },
) {
  const parsed = accountStateInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose shortlisted, held, or dismissed." },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    const { conversationId, accountId } = await context.params;
    const companySearch = await updateAccountStateForConversation(
      session,
      conversationId,
      accountId,
      parsed.data.state,
    );
    return NextResponse.json({ companySearch });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string; accountId: string }> },
) {
  return handleUpdate(request, context);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ conversationId: string; accountId: string }> },
) {
  return handleUpdate(request, context);
}

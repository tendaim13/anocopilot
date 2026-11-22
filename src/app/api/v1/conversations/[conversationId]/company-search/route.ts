import { NextResponse } from "next/server";

import { companySearchActionInputSchema } from "@/lib/ano/company-discovery";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  approveCompanySearchForConversation,
  getCompanySearchForConversation,
  prepareCompanySearchPreviewForConversation,
  runOpenStreetMapSearchForConversation,
  TargetAccountDiscoveryServiceError,
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
  console.error(
    "Ano company discovery route failed",
    error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 600) }
      : { type: typeof error },
  );
  return NextResponse.json(
    { error: "Ano could not safely complete the company discovery action." },
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
    return NextResponse.json(await getCompanySearchForConversation(session, conversationId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const parsed = companySearchActionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Specify whether to prepare a free Prospeo preview or approve a saved preview." },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    if (parsed.data.action === "prepare_preview") {
      return NextResponse.json(
        await prepareCompanySearchPreviewForConversation(session, conversationId, {
          providerKey: parsed.data.providerKey,
          resolveWebsites: parsed.data.resolveWebsites,
          locationOverrides: parsed.data.locationOverrides,
          keywordOverrides: parsed.data.keywordOverrides,
          industryOverrides: parsed.data.industryOverrides,
          excludedCategories: parsed.data.excludedCategories,
        }),
      );
    }

    if (parsed.data.action === "run_free_search") {
      return NextResponse.json(
        await runOpenStreetMapSearchForConversation(session, conversationId, {
          resolveWebsites: parsed.data.resolveWebsites,
          locationOverrides: parsed.data.locationOverrides,
          keywordOverrides: parsed.data.keywordOverrides,
          excludedCategories: parsed.data.excludedCategories,
        }),
      );
    }

    return NextResponse.json(
      await approveCompanySearchForConversation(
        session,
        conversationId,
        parsed.data.searchId,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

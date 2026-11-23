import { NextResponse } from "next/server";

import { outreachTemplateActionInputSchema } from "@/lib/ano/outreach-templates";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  editOutreachTemplateStepForConversation,
  generateOutreachTemplatePackForConversation,
  getOutreachTemplatePackForConversation,
  OutreachTemplateServiceError,
  updateOutreachTemplateSettingsForConversation,
} from "@/server/domain/outreach-template-service";
import { MarketSynthesisPersistenceError } from "@/server/persistence/market-synthesis-store";
import { OutreachTemplatePersistenceError } from "@/server/persistence/outreach-template-store";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";
import { runWithInternalUsageContext } from "@/server/telemetry/internal-api-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (
    error instanceof OutreachTemplateServiceError ||
    error instanceof OutreachTemplatePersistenceError ||
    error instanceof MarketSynthesisPersistenceError ||
    error instanceof ResearchConversationPersistenceError
  ) {
    const code =
      "code" in error && typeof error.code === "string"
        ? error.code
        : "OUTREACH_TEMPLATE_UNAVAILABLE";
    return NextResponse.json({ error: error.message, code }, { status: 422 });
  }
  console.error(
    "Ano outreach templates route failed",
    error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 600) }
      : { type: typeof error },
  );
  return NextResponse.json(
    { error: "Ano could not safely generate or save outreach email templates." },
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
    return NextResponse.json(await getOutreachTemplatePackForConversation(session, conversationId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const parsed = outreachTemplateActionInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide a valid outreach template generate, edit, or settings payload." },
      { status: 400 },
    );
  }

  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const action = parsed.data;

    return NextResponse.json(
      await runWithInternalUsageContext({ session, conversationId }, async () => {
        if (action.action === "generate") {
          return await generateOutreachTemplatePackForConversation(session, conversationId, action);
        }
        if (action.action === "edit_step") {
          return await editOutreachTemplateStepForConversation(session, conversationId, action);
        }
        return await updateOutreachTemplateSettingsForConversation(session, conversationId, action);
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

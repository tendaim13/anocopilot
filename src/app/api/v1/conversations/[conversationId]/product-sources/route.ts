import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  addProductSourceToConversation,
  getProductSourcesForConversation,
  removeProductSourceFromConversation,
  ResearchConversationServiceError,
} from "@/server/domain/research-conversation-service";
import { ProductIngestionError } from "@/server/ingestion/product-source-ingestor";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";
import { runWithInternalUsageContext } from "@/server/telemetry/internal-api-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ProductIngestionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  }
  if (
    error instanceof ResearchConversationServiceError ||
    error instanceof ResearchConversationPersistenceError
  ) {
    return NextResponse.json(
      { error: error.message, code: "PRODUCT_SOURCE_UNAVAILABLE" },
      { status: 422 },
    );
  }
  console.error(
    "Ano product sources route failed",
    error instanceof Error
      ? { name: error.name, message: error.message.slice(0, 600) }
      : { type: typeof error },
  );
  return NextResponse.json(
    { error: "Ano could not process that product source right now." },
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
    return NextResponse.json(await getProductSourcesForConversation(session, conversationId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const fileEntry = form.get("file");
      if (fileEntry && typeof fileEntry === "object" && "arrayBuffer" in fileEntry) {
        const file = fileEntry as File;
        const bytes = new Uint8Array(await file.arrayBuffer());
        return NextResponse.json(
          await runWithInternalUsageContext({ session, conversationId }, () =>
            addProductSourceToConversation(session, conversationId, {
              kind: "file",
              fileName: file.name || "product-document",
              mimeType: file.type || null,
              bytes,
            }),
          ),
          { status: 201 },
        );
      }

      const formUrl = typeof form.get("url") === "string" ? String(form.get("url")).trim() : "";
      if (formUrl) {
        return NextResponse.json(
          await runWithInternalUsageContext({ session, conversationId }, () =>
            addProductSourceToConversation(session, conversationId, { kind: "url", url: formUrl }),
          ),
          { status: 201 },
        );
      }

      return NextResponse.json(
        { error: "Attach a .pdf, .docx, .txt file or provide a product website URL." },
        { status: 400 },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const url =
      body && typeof body === "object" && "url" in body && typeof body.url === "string"
        ? body.url.trim()
        : "";
    if (!url) {
      return NextResponse.json({ error: "Provide a valid product website URL." }, { status: 400 });
    }

    return NextResponse.json(
      await runWithInternalUsageContext({ session, conversationId }, () =>
        addProductSourceToConversation(session, conversationId, { kind: "url", url }),
      ),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const url = new URL(request.url);
    const sourceId = url.searchParams.get("sourceId")?.trim() ?? "";
    if (!sourceId) {
      return NextResponse.json({ error: "Specify sourceId to remove." }, { status: 400 });
    }
    return NextResponse.json(
      await removeProductSourceFromConversation(session, conversationId, sourceId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

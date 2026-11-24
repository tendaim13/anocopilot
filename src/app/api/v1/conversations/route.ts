import { NextResponse } from "next/server";

import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  getCurrentResearchConversation,
  listResearchConversations,
  ResearchConversationServiceError,
  startResearchConversation,
} from "@/server/domain/research-conversation-service";
import { ProductIngestionError } from "@/server/ingestion/product-source-ingestor";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";
import { runWithInternalUsageContext } from "@/server/telemetry/internal-api-usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function idempotencyKey(request: Request) {
  const supplied = request.headers.get("x-ano-idempotency-key");
  return supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(supplied) ? supplied : crypto.randomUUID();
}

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof ProductIngestionError) return NextResponse.json({ error: error.message, code: error.code }, { status: 422 });
  if (error instanceof ResearchConversationServiceError || error instanceof ResearchConversationPersistenceError) return NextResponse.json({ error: error.message, code: "RESEARCH_CONVERSATION_UNAVAILABLE" }, { status: 422 });
  const diagnostic = error instanceof Error
    ? { name: error.name, message: error.message.slice(0, 600) }
    : { type: typeof error };
  console.error("Ano research conversation route failed unexpectedly", diagnostic);
  return NextResponse.json({ error: "Ano could not safely continue this conversation. No external action was attempted." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const session = await requireWorkspaceSession();
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");
    const rawLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 25;

    const [listResult, conversation] = await Promise.all([
      listResearchConversations(session, { cursor, limit }),
      session.kind === "supabase" && !cursor ? getCurrentResearchConversation(session) : Promise.resolve(null),
    ]);
    if (conversation) {
      const matched = listResult.conversations.find(
        (item) => item.id === conversation.conversation.id,
      );
      if (matched) {
        conversation.conversation.title = matched.title;
      }
    }
    return NextResponse.json({
      conversation,
      conversations: listResult.conversations,
      nextCursor: listResult.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    let message = "";
    const files: Array<{ fileName: string; mimeType?: string | null; bytes: Uint8Array }> = [];
    const urls: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const msgEntry = form.get("message");
      if (typeof msgEntry === "string") {
        message = msgEntry.trim();
      }
      for (const entry of form.getAll("files")) {
        if (entry && typeof entry === "object" && "arrayBuffer" in entry) {
          const file = entry as File;
          files.push({
            fileName: file.name || "product-document",
            mimeType: file.type || null,
            bytes: new Uint8Array(await file.arrayBuffer()),
          });
        }
      }
      const singleFile = form.get("file");
      if (singleFile && typeof singleFile === "object" && "arrayBuffer" in singleFile && files.length === 0) {
        const file = singleFile as File;
        files.push({
          fileName: file.name || "product-document",
          mimeType: file.type || null,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      }
      const urlsEntry = form.get("urls");
      if (typeof urlsEntry === "string" && urlsEntry.trim()) {
        try {
          const parsed = JSON.parse(urlsEntry);
          if (Array.isArray(parsed)) {
            urls.push(...parsed.filter((u): u is string => typeof u === "string" && u.trim().length > 0));
          }
        } catch {
          urls.push(urlsEntry.trim());
        }
      }
      for (const extraUrl of form.getAll("url")) {
        if (typeof extraUrl === "string" && extraUrl.trim()) {
          urls.push(extraUrl.trim());
        }
      }
    } else {
      const body: unknown = await request.json().catch(() => null);
      if (body && typeof body === "object") {
        if ("message" in body && typeof body.message === "string") {
          message = body.message.trim();
        }
        if ("urls" in body && Array.isArray(body.urls)) {
          urls.push(
            ...body.urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0),
          );
        }
      }
    }

    if (!message && files.length === 0 && urls.length === 0) {
      return NextResponse.json(
        { error: "Tell Ano what you sell or attach a product link, PDF, Word doc, or text file first." },
        { status: 400 },
      );
    }

    const session = await requireWorkspaceSession();
    return NextResponse.json(
      {
        conversation: await runWithInternalUsageContext({ session }, () =>
          startResearchConversation(session, { message, files, urls }, idempotencyKey(request)),
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

import "server-only";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  productSourceSummarySchema,
  type ProductSourceSummary,
} from "@/lib/ano/research-conversation";
import type { IngestedProductSource } from "@/server/ingestion/product-source-ingestor";

type LiveSession = Extract<WorkspaceSession, { kind: "supabase" }>;

export type StoredProductSource = ProductSourceSummary & {
  extractedText: string;
};

function requireLiveSession(session: WorkspaceSession): asserts session is LiveSession {
  if (session.kind === "demo") {
    throw new Error("Sign in before saving product sources.");
  }
}

function rowToStoredProductSource(row: Record<string, unknown>): StoredProductSource {
  const extractedText = typeof row.extracted_text === "string" ? row.extracted_text : "";
  const summary = productSourceSummarySchema.parse({
    id: String(row.id),
    sourceType: String(row.source_type),
    label: String(row.label ?? "Product document"),
    sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
    mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
    byteSize: typeof row.byte_size === "number" ? row.byte_size : 0,
    charCount: extractedText.length,
    summaryText: typeof row.summary_text === "string" ? row.summary_text : null,
    extractionStatus: row.extraction_status === "failed" ? "failed" : "ready",
    errorMessage: typeof row.error_message === "string" ? row.error_message : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  });
  return { ...summary, extractedText };
}

export async function saveConversationProductSource(
  session: WorkspaceSession,
  conversationId: string,
  ingested: IngestedProductSource,
): Promise<ProductSourceSummary> {
  requireLiveSession(session);
  const { data, error } = await session.client
    .from("conversation_product_sources")
    .upsert(
      {
        workspace_id: session.workspace.id,
        conversation_id: conversationId,
        source_type: ingested.sourceType,
        label: ingested.label,
        source_url: ingested.sourceUrl,
        mime_type: ingested.mimeType,
        byte_size: ingested.byteSize,
        content_sha256: ingested.contentSha256,
        extracted_text: ingested.extractedText,
        summary_text: ingested.summaryText,
        extraction_status: "ready",
        error_message: null,
        created_by: session.actorId,
      },
      { onConflict: "conversation_id,content_sha256" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new Error("Ano could not save that product source to your workspace.");
  }

  const stored = rowToStoredProductSource(data as Record<string, unknown>);
  const { extractedText: _omit, ...summary } = stored;
  return summary;
}

export async function readConversationProductSources(
  session: WorkspaceSession,
  conversationId: string,
): Promise<{
  summaries: ProductSourceSummary[];
  fullSources: StoredProductSource[];
}> {
  if (session.kind === "demo") {
    return { summaries: [], fullSources: [] };
  }

  const { data, error } = await session.client
    .from("conversation_product_sources")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error || !data) {
    return { summaries: [], fullSources: [] };
  }

  const fullSources = data.map((row) =>
    rowToStoredProductSource(row as Record<string, unknown>),
  );
  const summaries = fullSources.map(({ extractedText: _omit, ...summary }) => summary);
  return { summaries, fullSources };
}

export async function deleteConversationProductSource(
  session: WorkspaceSession,
  conversationId: string,
  sourceId: string,
): Promise<void> {
  requireLiveSession(session);
  await session.client
    .from("conversation_product_sources")
    .delete()
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .eq("id", sourceId);
}

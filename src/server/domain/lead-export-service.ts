import "server-only";

import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import {
  buildLeadsCsv,
  buildTemplatesCsv,
  buildTemplatesMarkdown,
  sanitizeExportFilenameSlug,
  type ConversationExportFormat,
  type LeadExportScope,
} from "@/lib/ano/lead-export";
import { readMarketSynthesis } from "@/server/persistence/market-synthesis-store";
import { readOutreachTemplatePackForConversation } from "@/server/persistence/outreach-template-store";
import {
  listWorkspaceContactsForExport,
  readPeopleDiscoveryForConversation,
} from "@/server/persistence/people-playbook-store";
import { readResearchConversation } from "@/server/persistence/research-conversation-store";
import { readCompanySearchForConversation } from "@/server/persistence/target-account-discovery-store";

export class LeadExportServiceError extends Error {
  constructor(message: string, readonly code: string = "EXPORT_UNAVAILABLE") {
    super(message);
    this.name = "LeadExportServiceError";
  }
}

function requireLiveSession(
  session: WorkspaceSession,
): asserts session is SupabaseWorkspaceSession {
  if (session.kind === "demo") {
    throw new LeadExportServiceError(
      "Sign in before exporting workspace leads or outreach templates.",
      "AUTH_REQUIRED",
    );
  }
}

export type ExportDownloadPayload = {
  content: string;
  contentType: string;
  filename: string;
  rowCount: number;
};

export async function exportConversationArtifact(
  session: WorkspaceSession,
  conversationId: string,
  format: ConversationExportFormat,
  scope: LeadExportScope = "with_email",
): Promise<ExportDownloadPayload> {
  requireLiveSession(session);

  const [conversation, companySearch, peopleDiscovery, templatePack, synthesis] =
    await Promise.all([
      readResearchConversation(session, conversationId),
      readCompanySearchForConversation(session, conversationId).catch(() => null),
      readPeopleDiscoveryForConversation(session, conversationId).catch(() => null),
      readOutreachTemplatePackForConversation(session, conversationId).catch(() => null),
      readMarketSynthesis(session, conversationId).catch(() => null),
    ]);

  const slug = sanitizeExportFilenameSlug(conversation.conversation.title, "ano");

  if (format === "leads_csv") {
    const contacts = peopleDiscovery?.contacts ?? [];
    const accountsById = new Map(
      (companySearch?.accounts ?? []).map((account) => [account.id, account]),
    );
    const built = buildLeadsCsv(contacts, accountsById, scope);

    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: "leads.exported_csv",
      outcome: "completed",
      details_json: {
        conversation_id: conversationId,
        scope,
        row_count: built.rowCount,
        verified_count: built.verifiedCount,
        public_email_count: built.publicEmailCount,
      },
    });

    return {
      content: built.csv,
      contentType: "text/csv; charset=utf-8",
      filename: `ano-leads-${slug}-${scope}.csv`,
      rowCount: built.rowCount,
    };
  }

  if (!templatePack) {
    throw new LeadExportServiceError(
      "Generate an outreach email template sequence first before exporting templates.",
      "TEMPLATE_PACK_NOT_FOUND",
    );
  }

  if (format === "templates_csv") {
    const built = buildTemplatesCsv(templatePack);

    await session.client.from("audit_logs").insert({
      workspace_id: session.workspace.id,
      actor_id: session.actorId,
      event_type: "templates.exported",
      outcome: "completed",
      details_json: {
        conversation_id: conversationId,
        format,
        template_pack_id: templatePack.id,
        version: templatePack.version,
        step_count: built.rowCount,
      },
    });

    return {
      content: built.csv,
      contentType: "text/csv; charset=utf-8",
      filename: `ano-templates-${slug}-v${templatePack.version}.csv`,
      rowCount: built.rowCount,
    };
  }

  const lockedMarket =
    synthesis?.markets.find((m) => m.id === synthesis.decision?.marketProfileId)?.name ??
    undefined;
  const lockedIndustry =
    synthesis?.industries.find((i) => i.id === synthesis.decision?.industryProfileId)?.name ??
    undefined;

  const markdown = buildTemplatesMarkdown(templatePack, {
    title: conversation.conversation.title,
    marketName: lockedMarket,
    industryName: lockedIndustry,
  });

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "templates.exported",
    outcome: "completed",
    details_json: {
      conversation_id: conversationId,
      format,
      template_pack_id: templatePack.id,
      version: templatePack.version,
      step_count: templatePack.steps.length,
    },
  });

  return {
    content: markdown,
    contentType: "text/markdown; charset=utf-8",
    filename: `ano-templates-${slug}-v${templatePack.version}.md`,
    rowCount: templatePack.steps.length,
  };
}

export async function exportWorkspacePeopleCsv(
  session: WorkspaceSession,
  scope: LeadExportScope = "with_email",
): Promise<ExportDownloadPayload> {
  requireLiveSession(session);

  const { contacts, accountsById } = await listWorkspaceContactsForExport(session);
  const built = buildLeadsCsv(contacts, accountsById, scope);

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "leads.exported_csv",
    outcome: "completed",
    details_json: {
      workspace_wide: true,
      scope,
      row_count: built.rowCount,
      verified_count: built.verifiedCount,
      public_email_count: built.publicEmailCount,
    },
  });

  return {
    content: built.csv,
    contentType: "text/csv; charset=utf-8",
    filename: `ano-workspace-leads-${scope}.csv`,
    rowCount: built.rowCount,
  };
}

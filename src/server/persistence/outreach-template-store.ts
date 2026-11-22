import "server-only";

import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import {
  outreachTemplatePackViewSchema,
  outreachTemplateStepSchema,
  type OutreachTemplatePackView,
  type OutreachTemplateStep,
  type TemplateCtaStyle,
  type TemplateTone,
} from "@/lib/ano/outreach-templates";

export class OutreachTemplatePersistenceError extends Error {
  constructor(message: string, readonly code: string = "OUTREACH_TEMPLATE_UNAVAILABLE") {
    super(message);
    this.name = "OutreachTemplatePersistenceError";
  }
}

type Row = Record<string, unknown>;

function requireLiveSession(
  session: WorkspaceSession,
): asserts session is SupabaseWorkspaceSession {
  if (session.kind === "demo") {
    throw new OutreachTemplatePersistenceError(
      "Sign in before Ano can generate or edit outreach email templates.",
      "AUTH_REQUIRED",
    );
  }
}

function iso(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new OutreachTemplatePersistenceError("Ano found an invalid template pack timestamp.");
  }
  return date.toISOString();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function mapTemplatePackRow(row: Row): OutreachTemplatePackView {
  const rawSteps = Array.isArray(row.steps_json) ? row.steps_json : [];
  const steps: OutreachTemplateStep[] = rawSteps
    .map((item) => outreachTemplateStepSchema.safeParse(item))
    .filter(
      (parsed): parsed is { success: true; data: OutreachTemplateStep } => parsed.success,
    )
    .map((parsed) => parsed.data);

  return outreachTemplatePackViewSchema.parse({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    targetDecisionId: String(row.target_decision_id),
    version: Number(row.version ?? 1),
    tone: String(row.tone ?? "peer_direct"),
    ctaStyle: String(row.cta_style ?? "easy_yes"),
    entryOffer: typeof row.entry_offer === "string" && row.entry_offer.trim() ? row.entry_offer : null,
    senderName: typeof row.sender_name === "string" && row.sender_name.trim() ? row.sender_name : null,
    targetRoles: asStringArray(row.target_roles_json),
    steps,
    claimIds: asStringArray(row.claim_ids_json),
    generationMode: String(row.generation_mode ?? "llm"),
    lastInstruction:
      typeof row.last_instruction === "string" && row.last_instruction.trim()
        ? row.last_instruction
        : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

export async function readOutreachTemplatePackForConversation(
  session: WorkspaceSession,
  conversationId: string,
): Promise<OutreachTemplatePackView | null> {
  if (session.kind === "demo") {
    return null;
  }

  const { data, error } = await session.client
    .from("outreach_template_packs")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new OutreachTemplatePersistenceError("Ano could not load the outreach template pack.");
  }

  const row = (data ?? [])[0] as Row | undefined;
  return row ? mapTemplatePackRow(row) : null;
}

export async function upsertOutreachTemplatePack(
  session: WorkspaceSession,
  input: {
    id: string;
    conversationId: string;
    targetDecisionId: string;
    version: number;
    tone: TemplateTone;
    ctaStyle: TemplateCtaStyle;
    entryOffer: string | null;
    senderName: string | null;
    targetRoles: string[];
    steps: OutreachTemplateStep[];
    claimIds: string[];
    generationMode: "llm" | "fallback" | "manual";
    lastInstruction: string | null;
  },
): Promise<OutreachTemplatePackView> {
  requireLiveSession(session);

  const { data, error } = await session.client
    .from("outreach_template_packs")
    .upsert(
      {
        id: input.id,
        workspace_id: session.workspace.id,
        conversation_id: input.conversationId,
        target_decision_id: input.targetDecisionId,
        version: input.version,
        tone: input.tone,
        cta_style: input.ctaStyle,
        entry_offer: input.entryOffer,
        sender_name: input.senderName,
        target_roles_json: input.targetRoles,
        steps_json: input.steps,
        claim_ids_json: input.claimIds,
        generation_mode: input.generationMode,
        last_instruction: input.lastInstruction,
        created_by: session.actorId,
      },
      { onConflict: "workspace_id,target_decision_id" },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new OutreachTemplatePersistenceError(
      "Ano could not save this outreach template sequence safely.",
    );
  }

  const view = mapTemplatePackRow(data as Row);

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "outreach.template_pack_saved",
    outcome: "completed",
    details_json: {
      conversation_id: input.conversationId,
      target_decision_id: input.targetDecisionId,
      template_pack_id: view.id,
      version: view.version,
      generation_mode: view.generationMode,
      step_count: view.steps.length,
      lint_passed_count: view.steps.filter((s) => s.lint.passed).length,
    },
  });

  return view;
}

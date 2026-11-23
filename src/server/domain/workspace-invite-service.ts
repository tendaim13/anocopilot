import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import { extractInviteToken } from "@/lib/ano/workspace-auth";
import {
  acceptWorkspaceInviteResultSchema,
  buildInviteShareUrl,
  canManageWorkspaceInvites,
  classifyInviteStatus,
  createWorkspaceInviteInputSchema,
  workspaceInvitePreviewSchema,
  workspaceInviteSummarySchema,
  type AcceptWorkspaceInviteResult,
  type WorkspaceInvitePreview,
  type WorkspaceInviteSummary,
} from "@/lib/ano/workspace-invites";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export class WorkspaceInviteServiceError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 410 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceInviteServiceError";
  }
}

export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken.trim()).digest("hex");
}

export function generateRawInviteToken(): string {
  return `inv_${randomBytes(24).toString("base64url")}`;
}

function requireAdminSession(
  session: WorkspaceSession,
): asserts session is SupabaseWorkspaceSession {
  if (session.kind === "demo") {
    throw new WorkspaceInviteServiceError(
      403,
      "ADMIN_REQUIRED",
      "Sign in to a live workspace as an owner or admin to manage invite links.",
    );
  }
  if (!canManageWorkspaceInvites(session.workspace.role)) {
    throw new WorkspaceInviteServiceError(
      403,
      "ADMIN_REQUIRED",
      "Only workspace owners and admins can manage invite links.",
    );
  }
}

function iso(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new WorkspaceInviteServiceError(
      503,
      "INVALID_INVITE_RECORD",
      "Ano found an invalid invite timestamp.",
    );
  }
  return date.toISOString();
}

function optionalIso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapInviteRow(row: Record<string, unknown>): WorkspaceInviteSummary {
  const expiresAt = iso(row.expires_at);
  const revokedAt = optionalIso(row.revoked_at);
  const usesCount = Number(row.uses_count ?? 0);
  const maxUses = Number(row.max_uses ?? 1);
  return workspaceInviteSummarySchema.parse({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    tokenPreview: String(row.token_preview ?? "inv_••••"),
    label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : null,
    role: String(row.role),
    maxUses,
    usesCount,
    status: classifyInviteStatus({ revokedAt, expiresAt, usesCount, maxUses }),
    expiresAt,
    revokedAt,
    createdAt: iso(row.created_at),
  });
}

export async function listWorkspaceInvites(
  session: WorkspaceSession,
): Promise<WorkspaceInviteSummary[]> {
  requireAdminSession(session);
  const { data, error } = await session.client
    .from("workspace_invites")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new WorkspaceInviteServiceError(
      503,
      "INVITE_LIST_FAILED",
      "Ano could not load workspace invite links.",
    );
  }

  return (data ?? []).map((row) => mapInviteRow(row as Record<string, unknown>));
}

export async function createWorkspaceInvite(
  session: WorkspaceSession,
  rawInput: unknown,
  origin: string,
): Promise<{ invite: WorkspaceInviteSummary; inviteUrl: string }> {
  requireAdminSession(session);
  const parsed = createWorkspaceInviteInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new WorkspaceInviteServiceError(
      400,
      "INVALID_INVITE_INPUT",
      parsed.error.issues[0]?.message ?? "Provide a valid role, max uses, and expiry.",
    );
  }

  const rawToken = generateRawInviteToken();
  const tokenHash = hashInviteToken(rawToken);
  const tokenPreview = `${rawToken.slice(0, 8)}…${rawToken.slice(-4)}`;
  const expiresAt = new Date(
    Date.now() + parsed.data.expiresInHours * 60 * 60 * 1_000,
  ).toISOString();

  const { data, error } = await session.client
    .from("workspace_invites")
    .insert({
      workspace_id: session.workspace.id,
      token_hash: tokenHash,
      token_preview: tokenPreview,
      label: parsed.data.label,
      role: parsed.data.role,
      max_uses: parsed.data.maxUses,
      expires_at: expiresAt,
      created_by: session.actorId,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new WorkspaceInviteServiceError(
      503,
      "INVITE_CREATE_FAILED",
      "Ano could not create a workspace invite link right now.",
    );
  }

  const invite = mapInviteRow(data as Record<string, unknown>);

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "workspace.invite_created",
    outcome: "succeeded",
    details_json: {
      invite_id: invite.id,
      role: invite.role,
      max_uses: invite.maxUses,
      expires_at: invite.expiresAt,
      label: invite.label,
    },
  });

  return {
    invite,
    inviteUrl: buildInviteShareUrl(origin, rawToken),
  };
}

export async function revokeWorkspaceInvite(
  session: WorkspaceSession,
  inviteId: string,
): Promise<WorkspaceInviteSummary> {
  requireAdminSession(session);
  const now = new Date().toISOString();
  const { data, error } = await session.client
    .from("workspace_invites")
    .update({ revoked_at: now })
    .eq("workspace_id", session.workspace.id)
    .eq("id", inviteId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new WorkspaceInviteServiceError(
      503,
      "INVITE_REVOKE_FAILED",
      "Ano could not revoke that invite link.",
    );
  }
  if (!data) {
    throw new WorkspaceInviteServiceError(
      404,
      "INVITE_NOT_FOUND",
      "Invite link was not found in this workspace.",
    );
  }

  const invite = mapInviteRow(data as Record<string, unknown>);

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "workspace.invite_revoked",
    outcome: "succeeded",
    details_json: { invite_id: invite.id },
  });

  return invite;
}

export async function previewWorkspaceInviteByToken(
  rawToken: string,
): Promise<WorkspaceInvitePreview> {
  const token = extractInviteToken(rawToken);
  if (!token) {
    return workspaceInvitePreviewSchema.parse({ valid: false, status: "not_found" });
  }

  const config = getSupabasePublicConfig();
  if (!config) {
    throw new WorkspaceInviteServiceError(
      503,
      "SUPABASE_NOT_CONFIGURED",
      "Ano is not connected to its Supabase project yet.",
    );
  }

  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc("preview_workspace_invite", {
    p_token_hash: hashInviteToken(token),
  });

  if (error || !data) {
    return workspaceInvitePreviewSchema.parse({ valid: false, status: "not_found" });
  }

  const parsed = workspaceInvitePreviewSchema.safeParse(data);
  if (!parsed.success) {
    return workspaceInvitePreviewSchema.parse({ valid: false, status: "not_found" });
  }
  return parsed.data;
}

export async function acceptWorkspaceInviteByToken(
  rawToken: string,
): Promise<AcceptWorkspaceInviteResult> {
  const token = extractInviteToken(rawToken);
  if (!token) {
    throw new WorkspaceInviteServiceError(
      404,
      "INVITE_NOT_FOUND",
      "This invite link is invalid.",
    );
  }

  const config = getSupabasePublicConfig();
  if (!config) {
    throw new WorkspaceInviteServiceError(
      503,
      "SUPABASE_NOT_CONFIGURED",
      "Ano is not connected to its Supabase project yet.",
    );
  }

  const cookieStore = await cookies();
  const client = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Read-only context fallback.
        }
      },
    },
  });

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user?.email) {
    throw new WorkspaceInviteServiceError(
      401,
      "AUTH_REQUIRED",
      "Sign in or create an account first before accepting this invite link.",
    );
  }

  const { data, error } = await client.rpc("accept_workspace_invite", {
    p_token_hash: hashInviteToken(token),
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("INVITE_REVOKED")) {
      throw new WorkspaceInviteServiceError(
        410,
        "INVITE_REVOKED",
        "This workspace invite link has been revoked by an admin.",
      );
    }
    if (msg.includes("INVITE_EXPIRED")) {
      throw new WorkspaceInviteServiceError(
        410,
        "INVITE_EXPIRED",
        "This workspace invite link has expired. Ask a workspace admin for a new link.",
      );
    }
    if (msg.includes("INVITE_EXHAUSTED")) {
      throw new WorkspaceInviteServiceError(
        410,
        "INVITE_EXHAUSTED",
        "This invite link has reached its maximum number of uses.",
      );
    }
    if (msg.includes("INVITE_NOT_FOUND")) {
      throw new WorkspaceInviteServiceError(
        404,
        "INVITE_NOT_FOUND",
        "This invite link could not be found.",
      );
    }
    if (msg.includes("AUTH_REQUIRED")) {
      throw new WorkspaceInviteServiceError(
        401,
        "AUTH_REQUIRED",
        "Sign in first before accepting this invite link.",
      );
    }
    throw new WorkspaceInviteServiceError(
      503,
      "INVITE_ACCEPT_FAILED",
      "Ano could not accept that workspace invite right now.",
    );
  }

  return acceptWorkspaceInviteResultSchema.parse(data);
}

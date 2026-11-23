import { z } from "zod";

import type { WorkspaceRole } from "@/contracts/ano";

export const inviteRoleSchema = z.enum(["admin", "member", "viewer"]);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

export const inviteStatusSchema = z.enum(["active", "revoked", "expired", "exhausted"]);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

export const createWorkspaceInviteInputSchema = z.object({
  role: inviteRoleSchema.default("member"),
  maxUses: z.coerce.number().int().min(1).max(100).default(1),
  expiresInHours: z.coerce.number().int().min(1).max(720).default(168),
  label: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
});
export type CreateWorkspaceInviteInput = z.infer<typeof createWorkspaceInviteInputSchema>;

export const workspaceInviteSummarySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  tokenPreview: z.string(),
  label: z.string().nullable(),
  role: inviteRoleSchema,
  maxUses: z.number().int().min(1).max(100),
  usesCount: z.number().int().min(0),
  status: inviteStatusSchema,
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type WorkspaceInviteSummary = z.infer<typeof workspaceInviteSummarySchema>;

export const workspaceInvitePreviewSchema = z.object({
  valid: z.boolean(),
  status: z.enum(["active", "revoked", "expired", "exhausted", "not_found"]),
  workspaceName: z.string().optional(),
  workspaceSlug: z.string().optional(),
  role: inviteRoleSchema.optional(),
  expiresAt: z.string().datetime().optional(),
  remainingUses: z.number().int().min(0).optional(),
});
export type WorkspaceInvitePreview = z.infer<typeof workspaceInvitePreviewSchema>;

export const acceptWorkspaceInviteResultSchema = z.object({
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  workspaceSlug: z.string(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  alreadyMember: z.boolean(),
  personalWorkspaceId: z.string().uuid(),
});
export type AcceptWorkspaceInviteResult = z.infer<typeof acceptWorkspaceInviteResultSchema>;

export function classifyInviteStatus(
  invite: {
    revokedAt: string | null;
    expiresAt: string;
    usesCount: number;
    maxUses: number;
  },
  nowMs = Date.now(),
): InviteStatus {
  if (invite.revokedAt) {
    return "revoked";
  }
  const expiresMs = new Date(invite.expiresAt).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    return "expired";
  }
  if (invite.usesCount >= invite.maxUses) {
    return "exhausted";
  }
  return "active";
}

export function canManageWorkspaceInvites(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function buildInviteShareUrl(origin: string, rawToken: string): string {
  const cleanOrigin = origin.replace(/\/+$/, "");
  return `${cleanOrigin}/invite/${encodeURIComponent(rawToken)}`;
}

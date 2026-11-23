import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildInviteShareUrl,
  canManageWorkspaceInvites,
  classifyInviteStatus,
  createWorkspaceInviteInputSchema,
} from "@/lib/ano/workspace-invites";
import {
  generateRawInviteToken,
  hashInviteToken,
} from "@/server/domain/workspace-invite-service";

const ROOT = process.cwd();

test("createWorkspaceInviteInputSchema validates roles, bounds, and defaults safely", () => {
  const defaulted = createWorkspaceInviteInputSchema.parse({});
  assert.equal(defaulted.role, "member");
  assert.equal(defaulted.maxUses, 1);
  assert.equal(defaulted.expiresInHours, 168);
  assert.equal(defaulted.label, null);

  const custom = createWorkspaceInviteInputSchema.parse({
    role: "admin",
    maxUses: "10",
    expiresInHours: "72",
    label: "  Sales APAC  ",
  });
  assert.equal(custom.role, "admin");
  assert.equal(custom.maxUses, 10);
  assert.equal(custom.expiresInHours, 72);
  assert.equal(custom.label, "Sales APAC");

  assert.equal(
    createWorkspaceInviteInputSchema.safeParse({ role: "owner" }).success,
    false,
  );
  assert.equal(
    createWorkspaceInviteInputSchema.safeParse({ maxUses: 101 }).success,
    false,
  );
  assert.equal(
    createWorkspaceInviteInputSchema.safeParse({ expiresInHours: 1000 }).success,
    false,
  );
});

test("classifyInviteStatus and canManageWorkspaceInvites enforce lifecycle and admin RBAC", () => {
  const now = Date.parse("2026-11-24T02:00:00.000Z");

  assert.equal(
    classifyInviteStatus(
      {
        revokedAt: null,
        expiresAt: "2026-11-25T02:00:00.000Z",
        usesCount: 0,
        maxUses: 5,
      },
      now,
    ),
    "active",
  );
  assert.equal(
    classifyInviteStatus(
      {
        revokedAt: "2026-11-24T01:30:00.000Z",
        expiresAt: "2026-11-25T02:00:00.000Z",
        usesCount: 0,
        maxUses: 5,
      },
      now,
    ),
    "revoked",
  );
  assert.equal(
    classifyInviteStatus(
      {
        revokedAt: null,
        expiresAt: "2026-11-24T01:00:00.000Z",
        usesCount: 0,
        maxUses: 5,
      },
      now,
    ),
    "expired",
  );
  assert.equal(
    classifyInviteStatus(
      {
        revokedAt: null,
        expiresAt: "2026-11-25T02:00:00.000Z",
        usesCount: 5,
        maxUses: 5,
      },
      now,
    ),
    "exhausted",
  );

  assert.equal(canManageWorkspaceInvites("owner"), true);
  assert.equal(canManageWorkspaceInvites("admin"), true);
  assert.equal(canManageWorkspaceInvites("member"), false);
  assert.equal(canManageWorkspaceInvites("viewer"), false);
  assert.equal(canManageWorkspaceInvites(null), false);
});

test("hashInviteToken, generateRawInviteToken, and buildInviteShareUrl isolate plaintext tokens from storage", () => {
  const token = generateRawInviteToken();
  assert.match(token, /^inv_[A-Za-z0-9_-]{20,}$/);

  const hashA = hashInviteToken(token);
  const hashB = hashInviteToken(`  ${token}  `);
  assert.equal(hashA, hashB);
  assert.match(hashA, /^[0-9a-f]{64}$/);
  assert.notEqual(hashA, token);

  assert.equal(
    buildInviteShareUrl("https://ano-copilot.vercel.app/", token),
    `https://ano-copilot.vercel.app/invite/${token}`,
  );
});

test("migration 000027 enforces admin-only RLS, hashed tokens, row locks, and automatic personal workspaces", async () => {
  const sql = await readFile(
    path.join(
      ROOT,
      "supabase/migrations/20261124_000027_workspace_invite_links.sql",
    ),
    "utf8",
  );

  assert.match(sql, /token_hash text not null unique/i);
  assert.match(sql, /role text not null default 'member' check \(role in \('admin', 'member', 'viewer'\)\)/i);
  assert.match(sql, /is_ano_workspace_admin\(workspace_id\)/i);
  assert.match(sql, /for update of i/i);
  assert.match(sql, /ensure_personal_ano_workspace\(null\)/i);
  assert.match(sql, /revoke all on function public\.accept_workspace_invite\(text\) from public/i);
  assert.match(sql, /revoke all on function public\.ensure_personal_ano_workspace\(text\) from public/i);
});

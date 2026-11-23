import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  deriveDefaultWorkspaceName,
  extractInviteToken,
  safeRedirectPath,
  selectActiveWorkspace,
  toWorkspaceSlug,
  validateSignUpInput,
} from "@/lib/ano/workspace-auth";

const ROOT = process.cwd();

test("toWorkspaceSlug and deriveDefaultWorkspaceName format readable defaults cleanly", () => {
  assert.equal(toWorkspaceSlug("  Nerva Studio — APAC! "), "nerva-studio-apac");
  assert.equal(toWorkspaceSlug("---Alpha Team---"), "alpha-team");

  assert.equal(
    deriveDefaultWorkspaceName("Tendai Midzi", "tendai@company.com"),
    "Tendai's Workspace",
  );
  assert.equal(
    deriveDefaultWorkspaceName(null, "alex.chen@acme.io"),
    "Alex's Workspace",
  );
  assert.equal(deriveDefaultWorkspaceName("", ""), "My Workspace");
});

test("validateSignUpInput enforces full name, valid email, password length, and confirmation match", () => {
  const valid = validateSignUpInput({
    fullName: "  Alex   Rivera ",
    email: " Alex@Company.com ",
    password: "strong-password-1",
    confirmPassword: "strong-password-1",
  });
  assert.deepEqual(valid, {
    ok: true,
    fullName: "Alex Rivera",
    email: "alex@company.com",
    password: "strong-password-1",
  });

  const shortName = validateSignUpInput({
    fullName: "A",
    email: "alex@company.com",
    password: "strong-password-1",
    confirmPassword: "strong-password-1",
  });
  assert.equal(shortName.ok, false);

  const badEmail = validateSignUpInput({
    fullName: "Alex Rivera",
    email: "not-an-email",
    password: "strong-password-1",
    confirmPassword: "strong-password-1",
  });
  assert.equal(badEmail.ok, false);

  const shortPassword = validateSignUpInput({
    fullName: "Alex Rivera",
    email: "alex@company.com",
    password: "short",
    confirmPassword: "short",
  });
  assert.equal(shortPassword.ok, false);

  const mismatch = validateSignUpInput({
    fullName: "Alex Rivera",
    email: "alex@company.com",
    password: "strong-password-1",
    confirmPassword: "different-password-2",
  });
  assert.equal(mismatch.ok, false);
});

test("extractInviteToken parses full invite URLs, relative paths, and raw tokens while rejecting malformed values", () => {
  const token = "inv_AbC123456789xyz";
  assert.equal(
    extractInviteToken(`https://ano.example.com/invite/${token}?utm=slack#top`),
    token,
  );
  assert.equal(extractInviteToken(`/invite/${token}`), token);
  assert.equal(extractInviteToken(`  ${token}  `), token);

  assert.equal(extractInviteToken("short"), null);
  assert.equal(extractInviteToken("https://ano.example.com/settings"), null);
  assert.equal(extractInviteToken(""), null);
});

test("selectActiveWorkspace picks requested membership cleanly or falls back safely", () => {
  const personal = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Alex's Workspace",
    slug: "alex-workspace",
    role: "owner" as const,
  };
  const team = {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Acme Growth Team",
    slug: "acme-growth",
    role: "member" as const,
  };

  assert.equal(selectActiveWorkspace([personal, team], team.id)?.id, team.id);
  assert.equal(selectActiveWorkspace([personal, team], "unknown-id")?.id, personal.id);
  assert.equal(selectActiveWorkspace([], team.id), null);
});

test("safeRedirectPath prevents protocol-relative and external open redirects", () => {
  assert.equal(safeRedirectPath("/invite/abc_1234567890"), "/invite/abc_1234567890");
  assert.equal(safeRedirectPath("/onboarding?new=1"), "/onboarding?new=1");
  assert.equal(safeRedirectPath("//evil.com"), "/research");
  assert.equal(safeRedirectPath("https://evil.com/phish"), "/research");
  assert.equal(safeRedirectPath(null), "/research");
});

test("settings page preserves user-facing billing copy removal", async () => {
  const settingsSource = await readFile(
    path.join(ROOT, "src/app/(app)/settings/page.tsx"),
    "utf8",
  );
  assert.equal(
    /\b1[- ]credit\b|max 1 credit|credit disclosure|\$0\b/i.test(settingsSource),
    false,
  );
});

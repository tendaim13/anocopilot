import type { WorkspaceIdentity } from "@/contracts/ano";

export const ACTIVE_WORKSPACE_COOKIE = "ano_active_workspace_id";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;

export function toWorkspaceSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function capitalizeWord(word: string): string {
  if (!word) return "";
  return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
}

export function deriveDefaultWorkspaceName(
  fullName?: string | null,
  email?: string | null,
): string {
  const cleanName = fullName?.trim().replace(/\s+/g, " ") ?? "";
  if (cleanName) {
    const firstToken = cleanName
      .split(" ")[0]
      ?.replace(/[^a-zA-Z0-9-]/g, "");
    if (firstToken && firstToken.length >= 2) {
      return `${capitalizeWord(firstToken)}'s Workspace`;
    }
  }

  const localPart = email?.trim().split("@")[0] ?? "";
  const firstEmailToken = localPart
    .split(/[._+-]+/)
    .find((part) => part.replace(/[^a-zA-Z0-9]/g, "").length >= 2)
    ?.replace(/[^a-zA-Z0-9]/g, "");

  if (firstEmailToken) {
    return `${capitalizeWord(firstEmailToken)}'s Workspace`;
  }

  return "My Workspace";
}

export function extractInviteToken(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  if (INVITE_TOKEN_PATTERN.test(trimmed)) {
    return trimmed;
  }

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  } else {
    pathname = trimmed.split("?")[0]?.split("#")[0] ?? "";
  }

  const match = pathname.match(/\/invite\/([A-Za-z0-9_-]{12,128})\/?$/);
  if (match?.[1] && INVITE_TOKEN_PATTERN.test(match[1])) {
    return match[1];
  }

  return null;
}

export function validateSignUpInput(input: {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}):
  | { ok: true; fullName: string; email: string; password: string }
  | { ok: false; error: string } {
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, error: "Enter your full name (at least 2 characters)." };
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid work email address." };
  }

  if (input.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters long." };
  }
  if (input.password.length > 128) {
    return { ok: false, error: "Password must be 128 characters or fewer." };
  }
  if (input.password !== input.confirmPassword) {
    return { ok: false, error: "Passwords do not match." };
  }

  return { ok: true, fullName, email, password: input.password };
}

export function selectActiveWorkspace(
  workspaces: WorkspaceIdentity[],
  requestedWorkspaceId?: string | null,
): WorkspaceIdentity | null {
  if (workspaces.length === 0) return null;
  if (requestedWorkspaceId) {
    const matched = workspaces.find((item) => item.id === requestedWorkspaceId);
    if (matched) return matched;
  }
  return workspaces[0] ?? null;
}

export function safeRedirectPath(
  requested?: string | null,
  fallback = "/research",
): string {
  const clean = requested?.trim() ?? "";
  if (!clean.startsWith("/") || clean.startsWith("//") || clean.startsWith("/\\")) {
    return fallback;
  }
  return clean;
}

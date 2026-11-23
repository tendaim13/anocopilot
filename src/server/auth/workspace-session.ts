import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { WorkspaceIdentity, WorkspaceRole, WorkspaceRuntime, WorkspaceSession } from "@/contracts/ano";
import { ACTIVE_WORKSPACE_COOKIE, selectActiveWorkspace } from "@/lib/ano/workspace-auth";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

const demoWorkspace: WorkspaceIdentity = {
  id: "demo-nerva-studio",
  name: "Nerva Studio — demo",
  slug: "nerva-studio-demo",
  role: "owner",
};

const supportedRoles = new Set<WorkspaceRole>(["owner", "admin", "member", "viewer"]);

export class WorkspaceSessionError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    public readonly code: "AUTH_REQUIRED" | "WORKSPACE_REQUIRED" | "DOMAIN_NOT_ALLOWED" | "SUPABASE_NOT_CONFIGURED",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceSessionError";
  }
}

export function isSupabaseConfigured() {
  return Boolean(getSupabasePublicConfig());
}

function canUseLocalDemo() {
  return process.env.NODE_ENV !== "production" && process.env.ANO_ALLOW_DEMO_MODE !== "false";
}

function safeRole(value: unknown): WorkspaceRole {
  return typeof value === "string" && supportedRoles.has(value as WorkspaceRole) ? (value as WorkspaceRole) : "viewer";
}

function emailDomain(email: string) {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export async function requireWorkspaceSession(): Promise<WorkspaceSession> {
  const config = getSupabasePublicConfig();

  if (!config) {
    if (canUseLocalDemo()) {
      return {
        kind: "demo",
        actorId: "demo-user",
        actorEmail: "demo@local.ano",
        workspace: demoWorkspace,
        workspaces: [demoWorkspace],
      };
    }

    throw new WorkspaceSessionError(
      503,
      "SUPABASE_NOT_CONFIGURED",
      "Ano is not connected to its own Supabase workspace yet.",
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
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Cookies can only be written in a Route Handler or Server Action.
          // This guard keeps server-rendered callers read-only.
        }
      },
    },
  });

  const { data: userData, error: userError } = await client.auth.getUser();
  const user = userData.user;
  if (userError || !user?.email) {
    throw new WorkspaceSessionError(401, "AUTH_REQUIRED", "Sign in to access an Ano workspace.");
  }

  const { data: memberships, error: membershipError } = await client
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (membershipError || !memberships || memberships.length === 0) {
    throw new WorkspaceSessionError(
      403,
      "WORKSPACE_REQUIRED",
      "Your account does not have access to an Ano workspace.",
    );
  }

  const membershipRows = memberships as Array<{ workspace_id: string; role: unknown }>;
  const workspaceIds = Array.from(new Set(membershipRows.map((row) => String(row.workspace_id))));

  const [workspacesResult, domainsResult] = await Promise.all([
    client.from("workspaces").select("id, name, slug").in("id", workspaceIds),
    client.from("workspace_domains").select("workspace_id, domain").in("workspace_id", workspaceIds),
  ]);

  if (workspacesResult.error) {
    throw new WorkspaceSessionError(403, "WORKSPACE_REQUIRED", "Ano could not resolve your workspace.");
  }
  if (domainsResult.error) {
    throw new WorkspaceSessionError(403, "DOMAIN_NOT_ALLOWED", "Ano could not verify the workspace domain policy.");
  }

  const workspacesById = new Map<string, { id: string; name: string; slug: string }>();
  for (const row of workspacesResult.data ?? []) {
    workspacesById.set(String(row.id), {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
    });
  }

  const domainsByWorkspaceId = new Map<string, string[]>();
  for (const row of domainsResult.data ?? []) {
    const wsId = String(row.workspace_id);
    const list = domainsByWorkspaceId.get(wsId) ?? [];
    list.push(String(row.domain).toLowerCase());
    domainsByWorkspaceId.set(wsId, list);
  }

  const userDomain = emailDomain(user.email);
  let domainRejected = false;
  const allowedWorkspaces: WorkspaceIdentity[] = [];
  const seenWorkspaceIds = new Set<string>();

  for (const membership of membershipRows) {
    const wsId = String(membership.workspace_id);
    if (seenWorkspaceIds.has(wsId)) continue;
    const workspaceRow = workspacesById.get(wsId);
    if (!workspaceRow) continue;

    const allowedDomains = domainsByWorkspaceId.get(wsId) ?? [];
    if (allowedDomains.length > 0 && !allowedDomains.includes(userDomain)) {
      domainRejected = true;
      continue;
    }

    seenWorkspaceIds.add(wsId);
    allowedWorkspaces.push({
      id: workspaceRow.id,
      name: workspaceRow.name,
      slug: workspaceRow.slug,
      role: safeRole(membership.role),
    });
  }

  const preferredWorkspaceId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
  const activeWorkspace = selectActiveWorkspace(allowedWorkspaces, preferredWorkspaceId);

  if (!activeWorkspace) {
    if (domainRejected) {
      throw new WorkspaceSessionError(
        403,
        "DOMAIN_NOT_ALLOWED",
        "Your email domain is not allowed for this Ano workspace.",
      );
    }
    throw new WorkspaceSessionError(403, "WORKSPACE_REQUIRED", "Ano could not resolve your workspace.");
  }

  return {
    kind: "supabase",
    actorId: user.id,
    actorEmail: user.email,
    workspace: activeWorkspace,
    workspaces: allowedWorkspaces,
    client,
  };
}

export function toWorkspaceRuntime(session: WorkspaceSession): WorkspaceRuntime {
  return {
    mode: session.kind,
    workspace: session.workspace,
    workspaces: session.workspaces && session.workspaces.length > 0
      ? session.workspaces
      : [session.workspace],
    actor: { id: session.actorId, email: session.actorEmail },
    persistence: session.kind === "supabase" ? "supabase" : "browser-demo",
  };
}

export async function switchWorkspaceForCurrentUser(
  targetWorkspaceId: string,
): Promise<WorkspaceRuntime> {
  const session = await requireWorkspaceSession();
  const available = session.workspaces && session.workspaces.length > 0
    ? session.workspaces
    : [session.workspace];
  const matched = available.find((item) => item.id === targetWorkspaceId);
  if (!matched) {
    throw new WorkspaceSessionError(
      403,
      "WORKSPACE_REQUIRED",
      "You do not have access to that workspace.",
    );
  }
  return {
    ...toWorkspaceRuntime(session),
    workspace: matched,
  };
}

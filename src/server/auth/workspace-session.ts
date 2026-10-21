import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { WorkspaceIdentity, WorkspaceRole, WorkspaceRuntime, WorkspaceSession } from "@/contracts/ano";
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
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError || !memberships?.[0]) {
    throw new WorkspaceSessionError(403, "WORKSPACE_REQUIRED", "Your account does not have access to an Ano workspace.");
  }

  const membership = memberships[0] as { workspace_id: string; role: unknown };
  const { data: workspace, error: workspaceError } = await client
    .from("workspaces")
    .select("id, name, slug")
    .eq("id", membership.workspace_id)
    .maybeSingle();

  if (workspaceError || !workspace) {
    throw new WorkspaceSessionError(403, "WORKSPACE_REQUIRED", "Ano could not resolve your workspace.");
  }

  const { data: domains, error: domainError } = await client
    .from("workspace_domains")
    .select("domain")
    .eq("workspace_id", membership.workspace_id);

  if (domainError) {
    throw new WorkspaceSessionError(403, "DOMAIN_NOT_ALLOWED", "Ano could not verify the workspace domain policy.");
  }

  const allowedDomains = (domains ?? []).map((domain) => String(domain.domain).toLowerCase());
  if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain(user.email))) {
    throw new WorkspaceSessionError(403, "DOMAIN_NOT_ALLOWED", "Your email domain is not allowed for this Ano workspace.");
  }

  return {
    kind: "supabase",
    actorId: user.id,
    actorEmail: user.email,
    workspace: {
      id: String(workspace.id),
      name: String(workspace.name),
      slug: String(workspace.slug),
      role: safeRole(membership.role),
    },
    client,
  };
}

export function toWorkspaceRuntime(session: WorkspaceSession): WorkspaceRuntime {
  return {
    mode: session.kind,
    workspace: session.workspace,
    actor: { id: session.actorId, email: session.actorEmail },
    persistence: session.kind === "supabase" ? "supabase" : "browser-demo",
  };
}

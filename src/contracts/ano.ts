import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export type WorkspaceIdentity = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
};

export type DemoWorkspaceSession = {
  kind: "demo";
  actorId: "demo-user";
  actorEmail: "demo@local.ano";
  workspace: WorkspaceIdentity;
  workspaces?: WorkspaceIdentity[];
};

export type SupabaseWorkspaceSession = {
  kind: "supabase";
  actorId: string;
  actorEmail: string;
  workspace: WorkspaceIdentity;
  workspaces?: WorkspaceIdentity[];
  client: SupabaseClient;
};

export type WorkspaceSession = DemoWorkspaceSession | SupabaseWorkspaceSession;

export type WorkspaceRuntime = {
  mode: WorkspaceSession["kind"];
  workspace: WorkspaceIdentity;
  workspaces: WorkspaceIdentity[];
  actor: {
    id: string;
    email: string;
  };
  persistence: "browser-demo" | "supabase";
};

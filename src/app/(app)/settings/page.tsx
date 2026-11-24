"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";
import { MoonIcon, SunIcon } from "@/components/shell/ano-icons";
import { useAppShell } from "@/components/shell/app-shell";
import {
  canManageWorkspaceInvites,
  type InviteRole,
  type WorkspaceInviteSummary,
} from "@/lib/ano/workspace-invites";

function inviteStatusBadgeClass(status: WorkspaceInviteSummary["status"]): string {
  switch (status) {
    case "active":
      return "status-approved";
    case "expired":
    case "exhausted":
      return "status-awaiting_approval";
    case "revoked":
    default:
      return "status-failed_safe";
  }
}

export default function SettingsPage() {
  useMaterialWeb();
  const router = useRouter();
  const shell = useAppShell();
  const workspace = shell?.workspace;
  const workspaces = shell?.workspaces ?? (workspace ? [workspace] : []);
  const actorEmail = shell?.actorEmail ?? null;
  const mode = shell?.mode ?? "demo";
  const theme = shell?.theme ?? "light";

  const isAdmin = mode === "supabase" && canManageWorkspaceInvites(workspace?.role);

  const [invites, setInvites] = useState<WorkspaceInviteSummary[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("member");
  const [inviteExpiresHours, setInviteExpiresHours] = useState<number>(168);
  const [inviteMaxUses, setInviteMaxUses] = useState<number>(5);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
  const [freshInviteUrl, setFreshInviteUrl] = useState<string | null>(null);
  const [copiedFreshUrl, setCopiedFreshUrl] = useState(false);

  const loadInvites = useCallback(async () => {
    if (!isAdmin) {
      setInvites([]);
      return;
    }
    setLoadingInvites(true);
    setInviteError(null);
    try {
      const response = await fetch("/api/v1/workspace/invites");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const msg =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Ano could not load invite links.";
        setInviteError(msg);
        return;
      }
      if (payload && typeof payload === "object" && "invites" in payload && Array.isArray(payload.invites)) {
        setInvites(payload.invites as WorkspaceInviteSummary[]);
      }
    } catch {
      setInviteError("Ano could not reach the workspace invite endpoint.");
    } finally {
      setLoadingInvites(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    setFreshInviteUrl(null);
    setCopiedFreshUrl(false);
    void loadInvites();
  }, [loadInvites, workspace?.id]);

  async function handleCreateInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin || creatingInvite) return;
    setCreatingInvite(true);
    setInviteError(null);
    setFreshInviteUrl(null);
    setCopiedFreshUrl(false);

    try {
      const response = await fetch("/api/v1/workspace/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: inviteLabel.trim() || undefined,
          role: inviteRole,
          expiresInHours: inviteExpiresHours,
          maxUses: inviteMaxUses,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const msg =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Ano could not generate an invite link.";
        setInviteError(msg);
        return;
      }

      if (payload && typeof payload === "object" && "invite" in payload && "inviteUrl" in payload) {
        setInvites((prev) => [payload.invite as WorkspaceInviteSummary, ...prev]);
        setFreshInviteUrl(String(payload.inviteUrl));
        setInviteLabel("");
      }
    } catch {
      setInviteError("Connection failed while creating the invite link.");
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!isAdmin || revokingInviteId) return;
    setRevokingInviteId(inviteId);
    setInviteError(null);
    try {
      const response = await fetch(`/api/v1/workspace/invites/${encodeURIComponent(inviteId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const msg =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Ano could not revoke that invite link.";
        setInviteError(msg);
        return;
      }
      if (payload && typeof payload === "object" && "invite" in payload) {
        const updated = payload.invite as WorkspaceInviteSummary;
        setInvites((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }
    } catch {
      setInviteError("Connection failed while revoking the invite link.");
    } finally {
      setRevokingInviteId(null);
    }
  }

  async function handleCopyInviteUrl() {
    if (!freshInviteUrl) return;
    try {
      await navigator.clipboard.writeText(freshInviteUrl);
      setCopiedFreshUrl(true);
    } catch {
      setCopiedFreshUrl(false);
    }
  }

  return (
    <section className="ano-section-page">
      <header className="ano-section-header">
        <div>
          <p className="ano-rail-kicker">SYSTEM</p>
          <h1>Workspace & account</h1>
          <p>
            Manage your active workspace, team invite links, appearance theme, and outreach guardrails for this Ano session.
          </p>
        </div>
      </header>

      <div className="ano-card-grid">
        <article className="ano-surface-card">
          <h2>Appearance & theme</h2>
          <p>
            <strong>Active theme:</strong>{" "}
            {theme === "dark" ? "Dark (Black & Neutral Grey + Orange)" : "Light (Orange & White)"}
          </p>
          <p>
            Default workspace surface uses crisp white cards with vibrant orange actions. Switch to
            black and neutral grey anytime; saved per browser.
          </p>
          <div className="ano-appearance-actions">
            <MaterialButton
              variant={theme === "light" ? "filled" : "outlined"}
              onClick={() => shell?.setTheme("light")}
            >
              <SunIcon slot="icon" />
              Light (Orange & White)
            </MaterialButton>
            <MaterialButton
              variant={theme === "dark" ? "filled" : "outlined"}
              onClick={() => shell?.setTheme("dark")}
            >
              <MoonIcon slot="icon" />
              Dark (Black & Grey)
            </MaterialButton>
          </div>
        </article>

        <article className="ano-surface-card">
          <h2>Active workspace & memberships</h2>
          {actorEmail && (
            <p>
              <strong>Signed in as:</strong> {actorEmail}
            </p>
          )}
          <p>
            <strong>Active workspace:</strong> {workspace?.name ?? "Not signed in"}
          </p>
          <p>
            <strong>Slug:</strong> {workspace?.slug ?? "—"}
          </p>
          <p>
            <strong>Role:</strong> {workspace?.role ?? "—"}
          </p>
          <p>
            <strong>Workspace mode:</strong> {mode === "supabase" ? "Cloud workspace (saved)" : "Demo / signed out"}
          </p>

          {mode === "supabase" ? (
            <>
              {workspaces.length > 0 && (
                <ul className="ano-settings-ws-list">
                  {workspaces.map((item) => {
                    const isCurrent = item.id === workspace?.id;
                    return (
                      <li key={item.id} className="ano-settings-ws-row">
                        <div>
                          <strong>{item.name}</strong>
                          <small>
                            /{item.slug} · {item.role}
                          </small>
                        </div>
                        {isCurrent ? (
                          <span className="m3-status-badge status-approved">Active</span>
                        ) : (
                          <MaterialButton
                            variant="outlined"
                            onClick={() => void shell?.switchWorkspace(item.id)}
                          >
                            Switch
                          </MaterialButton>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="ano-appearance-actions">
                <MaterialButton variant="outlined" onClick={() => router.push("/onboarding?new=1")}>
                  Create workspace
                </MaterialButton>
                <MaterialButton variant="text" onClick={() => void shell?.signOut()}>
                  Sign out
                </MaterialButton>
              </div>
            </>
          ) : (
            <p>
              <Link href="/login">Sign in</Link> or <Link href="/signup">create an account</Link> to connect a durable workspace.
            </p>
          )}
        </article>

        <article className="ano-surface-card">
          <h2>Team invite links (Admin-only)</h2>
          <p>
            Joining an existing workspace requires an invite link generated by a workspace owner or
            admin. Invited teammates automatically retain their own personal workspace as well.
          </p>

          {mode !== "supabase" ? (
            <p>
              <Link href="/login">Sign in</Link> to manage invite links for your workspace.
            </p>
          ) : !isAdmin ? (
            <p>
              Only workspace <strong>owners</strong> and <strong>admins</strong> can create or revoke
              invite links for <strong>{workspace?.name}</strong>.
            </p>
          ) : (
            <>
              <form onSubmit={handleCreateInvite} className="ano-invite-form">
                <MaterialTextField
                  id="ano-invite-label"
                  name="inviteLabel"
                  label="Link note (optional)"
                  value={inviteLabel}
                  onValueChange={setInviteLabel}
                  maxLength={120}
                  placeholder="e.g. Sales team APAC"
                  disabled={creatingInvite}
                />
                <div className="ano-invite-controls">
                  <md-outlined-select
                    label="Role"
                    value={inviteRole}
                    disabled={creatingInvite || undefined}
                    onChange={(e) => {
                      const next = (e.currentTarget as unknown as { value?: string }).value;
                      if (next === "member" || next === "viewer" || next === "admin") {
                        setInviteRole(next);
                      }
                    }}
                  >
                    <md-select-option value="member" selected={inviteRole === "member" || undefined}>
                      <div slot="headline">Member</div>
                    </md-select-option>
                    <md-select-option value="viewer" selected={inviteRole === "viewer" || undefined}>
                      <div slot="headline">Viewer</div>
                    </md-select-option>
                    <md-select-option value="admin" selected={inviteRole === "admin" || undefined}>
                      <div slot="headline">Admin</div>
                    </md-select-option>
                  </md-outlined-select>

                  <md-outlined-select
                    label="Expires"
                    value={String(inviteExpiresHours)}
                    disabled={creatingInvite || undefined}
                    onChange={(e) => {
                      const next = Number((e.currentTarget as unknown as { value?: string }).value);
                      if (Number.isFinite(next) && next > 0) setInviteExpiresHours(next);
                    }}
                  >
                    <md-select-option value="24" selected={inviteExpiresHours === 24 || undefined}>
                      <div slot="headline">24 hours</div>
                    </md-select-option>
                    <md-select-option value="168" selected={inviteExpiresHours === 168 || undefined}>
                      <div slot="headline">7 days</div>
                    </md-select-option>
                    <md-select-option value="720" selected={inviteExpiresHours === 720 || undefined}>
                      <div slot="headline">30 days</div>
                    </md-select-option>
                  </md-outlined-select>

                  <md-outlined-select
                    label="Max uses"
                    value={String(inviteMaxUses)}
                    disabled={creatingInvite || undefined}
                    onChange={(e) => {
                      const next = Number((e.currentTarget as unknown as { value?: string }).value);
                      if (Number.isFinite(next) && next > 0) setInviteMaxUses(next);
                    }}
                  >
                    <md-select-option value="1" selected={inviteMaxUses === 1 || undefined}>
                      <div slot="headline">1 use</div>
                    </md-select-option>
                    <md-select-option value="5" selected={inviteMaxUses === 5 || undefined}>
                      <div slot="headline">5 uses</div>
                    </md-select-option>
                    <md-select-option value="25" selected={inviteMaxUses === 25 || undefined}>
                      <div slot="headline">25 uses</div>
                    </md-select-option>
                    <md-select-option value="100" selected={inviteMaxUses === 100 || undefined}>
                      <div slot="headline">100 uses</div>
                    </md-select-option>
                  </md-outlined-select>
                </div>
                <MaterialButton type="submit" variant="filled" disabled={creatingInvite}>
                  {creatingInvite ? "Generating link…" : "Generate invite link"}
                </MaterialButton>
              </form>

              {freshInviteUrl && (
                <div className="ano-fresh-invite-box" role="status">
                  <strong>Share this invite link (shown once):</strong>
                  <code>{freshInviteUrl}</code>
                  <div className="ano-appearance-actions">
                    <MaterialButton variant="outlined" onClick={() => void handleCopyInviteUrl()}>
                      {copiedFreshUrl ? "Copied link" : "Copy link"}
                    </MaterialButton>
                  </div>
                </div>
              )}

              {inviteError && (
                <p className="ano-dialog-error" role="alert">
                  {inviteError}
                </p>
              )}

              {loadingInvites ? (
                <p>Loading invite links…</p>
              ) : invites.length === 0 ? (
                <p>No invite links created for this workspace yet.</p>
              ) : (
                <ul className="ano-settings-ws-list">
                  {invites.map((item) => (
                    <li key={item.id} className="ano-settings-ws-row">
                      <div>
                        <strong>
                          {item.label ?? `Invite (${item.tokenPreview})`} · {item.role}
                        </strong>
                        <small>
                          {item.tokenPreview} · {item.usesCount}/{item.maxUses} used · expires{" "}
                          {new Date(item.expiresAt).toLocaleDateString()}
                        </small>
                      </div>
                      <div className="ano-invite-row-actions">
                        <span className={`m3-status-badge ${inviteStatusBadgeClass(item.status)}`}>
                          {item.status}
                        </span>
                        {item.status === "active" && (
                          <MaterialButton
                            variant="text"
                            disabled={revokingInviteId === item.id}
                            onClick={() => void handleRevokeInvite(item.id)}
                          >
                            {revokingInviteId === item.id ? "Revoking…" : "Revoke"}
                          </MaterialButton>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
}

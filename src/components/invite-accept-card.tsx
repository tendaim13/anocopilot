"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { getBrowserSupabaseClient } from "@/client/services/supabase-browser";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";
import type { WorkspaceInvitePreview } from "@/lib/ano/workspace-invites";

export interface InviteAcceptCardProps {
  token: string;
}

function statusDescription(status: WorkspaceInvitePreview["status"]): string {
  switch (status) {
    case "revoked":
      return "This invite link was revoked by a workspace admin. Ask the admin for a fresh invite link.";
    case "expired":
      return "This invite link has expired. Ask a workspace admin to generate a new invite link.";
    case "exhausted":
      return "This invite link has reached its maximum number of uses.";
    case "not_found":
      return "We could not find a workspace invite matching this link.";
    default:
      return "";
  }
}

export function InviteAcceptCard({ token }: InviteAcceptCardProps) {
  useMaterialWeb();
  const router = useRouter();

  const [preview, setPreview] = useState<WorkspaceInvitePreview | null>(null);
  const [actorEmail, setActorEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/v1/invites/${encodeURIComponent(token)}`)
      .then(async (response) => ({
        ok: response.ok,
        payload: await response.json().catch(() => null),
      }))
      .then(({ ok, payload }) => {
        if (cancelled) return;
        if (ok && payload && typeof payload === "object" && "status" in payload) {
          setPreview(payload as WorkspaceInvitePreview);
        } else {
          setPreview({ valid: false, status: "not_found" });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMessage("Ano could not verify this invite link right now.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });

    const client = getBrowserSupabaseClient();
    if (!client) {
      setAuthChecked(true);
      return;
    }

    client.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        setActorEmail(data.user?.email ?? null);
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAccept() {
    setErrorMessage(null);
    setAccepting(true);
    try {
      const response = await fetch(`/api/v1/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const msg =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Ano could not join that workspace.";
        setErrorMessage(msg);
        return;
      }

      router.replace("/research");
      router.refresh();
    } catch {
      setErrorMessage("Connection failed while accepting the invite. Please try again.");
    } finally {
      setAccepting(false);
    }
  }

  const encodedToken = encodeURIComponent(token);

  return (
    <main className="auth-page">
      <section className="auth-card onboarding-card">
        <div className="brand-lockup auth-brand">
          <div className="brand-mark">
            <span>◖</span>
            <span>◗</span>
          </div>
          <div>
            <strong>Ano</strong>
            <small>Sales copilot</small>
          </div>
        </div>
        <p className="eyebrow">TEAM WORKSPACE INVITE</p>

        {loadingPreview ? (
          <>
            <h1>Checking invite link…</h1>
            <p className="lede">Validating workspace details securely.</p>
          </>
        ) : !preview || !preview.valid ? (
          <>
            <h1>Invite unavailable</h1>
            <p className="lede">
              {statusDescription(preview?.status ?? "not_found")}
            </p>
            <p className="auth-footnote">
              <Link href="/login">Sign in</Link> · <Link href="/signup">Create account</Link>
            </p>
          </>
        ) : (
          <>
            <h1>Join {preview.workspaceName}</h1>
            <p className="lede">
              You have been invited as <strong>{preview.role}</strong>. Accepting gives you
              access to <strong>{preview.workspaceName}</strong> and also sets up your own
              personal workspace so you can toggle between them anytime.
            </p>

            <div className="workspace-domain-note" style={{ marginTop: 18 }}>
              Workspace URL: <b>ano / {preview.workspaceSlug}</b> · Role: <b>{preview.role}</b>
              {typeof preview.remainingUses === "number" && (
                <> · Remaining spots: <b>{preview.remainingUses}</b></>
              )}
            </div>

            {authChecked && actorEmail ? (
              <div className="auth-form">
                <p className="auth-secondary-label">
                  Joining as <strong>{actorEmail}</strong>
                </p>
                <MaterialButton
                  type="button"
                  variant="filled"
                  className="auth-submit"
                  disabled={accepting}
                  onClick={() => void handleAccept()}
                >
                  {accepting ? "Joining workspace…" : `Accept invite & open ${preview.workspaceName}`}
                </MaterialButton>
              </div>
            ) : authChecked ? (
              <div className="auth-form">
                <MaterialButton
                  type="button"
                  variant="filled"
                  className="auth-submit"
                  onClick={() => router.push(`/signup?invite=${encodedToken}`)}
                >
                  Create account to join
                </MaterialButton>
                <MaterialButton
                  type="button"
                  variant="outlined"
                  className="auth-submit"
                  onClick={() => router.push(`/login?invite=${encodedToken}`)}
                >
                  Sign in with existing account
                </MaterialButton>
              </div>
            ) : null}

            {errorMessage && (
              <p className="auth-message is-error" role="status">
                {errorMessage}
              </p>
            )}

            <p className="auth-footnote">
              <Link href="/">Return to Ano</Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}

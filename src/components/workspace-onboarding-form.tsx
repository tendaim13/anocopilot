"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { getBrowserSupabaseClient } from "@/client/services/supabase-browser";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";
import {
  deriveDefaultWorkspaceName,
  extractInviteToken,
  toWorkspaceSlug,
} from "@/lib/ano/workspace-auth";

export function WorkspaceOnboardingForm() {
  useMaterialWeb();
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState("");
  const [slugWasEdited, setSlugWasEdited] = useState(false);
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [actorEmail, setActorEmail] = useState<string | null>(null);
  const [isAdditionalWorkspace, setIsAdditionalWorkspace] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailDomain = useMemo(() => actorEmail?.split("@")[1]?.toLowerCase() ?? null, [actorEmail]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const creatingAnother = params.get("new") === "1";
    setIsAdditionalWorkspace(creatingAnother);

    const client = getBrowserSupabaseClient();
    if (!client) {
      setIsError(true);
      setMessage("Ano is missing its public Supabase configuration.");
      return;
    }

    let cancelled = false;
    client.auth.getUser().then(async ({ data, error }) => {
      if (cancelled) return;
      if (error || !data.user?.email) {
        router.replace("/login?next=/onboarding");
        return;
      }

      const fullName =
        typeof data.user.user_metadata?.full_name === "string"
          ? data.user.user_metadata.full_name
          : null;
      setActorEmail(data.user.email);

      if (!creatingAnother) {
        try {
          const workspaceRes = await fetch("/api/v1/workspace");
          if (!cancelled && workspaceRes.ok) {
            router.replace("/research");
            return;
          }
        } catch {
          // Stay on onboarding if the check fails transiently.
        }
      }

      const suggestedName = creatingAnother
        ? ""
        : deriveDefaultWorkspaceName(fullName, data.user.email);
      if (suggestedName) {
        setWorkspaceName(suggestedName);
        setWorkspaceSlug(toWorkspaceSlug(suggestedName));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  function updateWorkspaceName(value: string) {
    setWorkspaceName(value);
    if (!slugWasEdited) setWorkspaceSlug(toWorkspaceSlug(value));
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setIsError(false);

    const client = getBrowserSupabaseClient();
    if (!client) {
      setIsError(true);
      setMessage("Ano is missing its public Supabase configuration.");
      return;
    }

    const name = workspaceName.trim();
    const slug = toWorkspaceSlug(workspaceSlug);
    if (name.length < 2 || slug.length < 2) {
      setIsError(true);
      setMessage("Enter a workspace name and URL with at least two characters.");
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await client.rpc("create_ano_workspace", {
      workspace_name: name,
      workspace_slug: slug,
    });

    if (error) {
      setIsSubmitting(false);
      setIsError(true);
      setMessage(
        error.code === "23505"
          ? "That workspace URL is already taken. Choose another name or URL."
          : "Ano could not create that workspace. Please try again.",
      );
      return;
    }

    if (typeof data === "string" && data) {
      await fetch("/api/v1/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: data }),
      }).catch(() => undefined);
    }

    setIsSubmitting(false);
    router.replace("/research");
    router.refresh();
  }

  function handleJoinInvite() {
    setMessage(null);
    setIsError(false);
    const token = extractInviteToken(inviteInput);
    if (!token) {
      setIsError(true);
      setMessage("Paste a valid Ano admin invite link or invite code.");
      return;
    }
    router.push(`/invite/${encodeURIComponent(token)}`);
  }

  async function handleSignOut() {
    const client = getBrowserSupabaseClient();
    if (client) {
      await client.auth.signOut().catch(() => undefined);
    }
    router.replace("/login");
    router.refresh();
  }

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
        <p className="eyebrow">
          {isAdditionalWorkspace ? "NEW WORKSPACE" : "CREATE YOUR PERSONAL WORKSPACE"}
        </p>
        <h1>{isAdditionalWorkspace ? "Create another workspace" : "Set up your workspace"}</h1>
        <p className="lede">
          {isAdditionalWorkspace
            ? "Create a separate tenant workspace. You can toggle between workspaces anytime from the top-right switcher."
            : "Every Ano account starts with its own isolated workspace. You become its owner and can still join team workspaces via admin invite links."}
        </p>
        <form onSubmit={createWorkspace} className="auth-form">
          <MaterialTextField
            id="ano-workspace-name"
            name="workspaceName"
            label="Workspace name"
            value={workspaceName}
            onValueChange={updateWorkspaceName}
            required
            minLength={2}
            maxLength={120}
            placeholder="Alex's Workspace"
            disabled={isSubmitting}
          />
          <MaterialTextField
            id="ano-workspace-slug"
            name="workspaceSlug"
            label="Workspace URL"
            value={workspaceSlug}
            onValueChange={(value) => {
              setSlugWasEdited(true);
              setWorkspaceSlug(toWorkspaceSlug(value));
            }}
            required
            minLength={2}
            maxLength={80}
            placeholder="alex-workspace"
            supportingText={`ano / ${workspaceSlug || "your-workspace"}`}
            disabled={isSubmitting}
          />
          <p className="workspace-domain-note">
            {emailDomain ? (
              <>
                Signed in as <b>{actorEmail}</b>. <b>{emailDomain}</b> will be registered as an
                approved domain for this workspace.
              </>
            ) : (
              "Confirming your work email…"
            )}
          </p>
          <MaterialButton
            type="submit"
            variant="filled"
            className="auth-submit"
            disabled={isSubmitting || !actorEmail}
          >
            {isSubmitting ? "Creating workspace…" : "Create workspace"}
          </MaterialButton>
        </form>

        <section className="auth-secondary-section" aria-label="Join with an invite link">
          <p className="auth-secondary-label">Have an admin invite link?</p>
          <div className="auth-invite-row">
            <MaterialTextField
              id="ano-onboarding-invite"
              name="inviteLink"
              label="Invite link or code"
              value={inviteInput}
              onValueChange={setInviteInput}
              placeholder="Paste /invite/... link"
              disabled={isSubmitting}
            />
            <MaterialButton
              type="button"
              variant="outlined"
              disabled={!inviteInput.trim() || isSubmitting}
              onClick={handleJoinInvite}
            >
              Open invite
            </MaterialButton>
          </div>
        </section>

        {message && (
          <p className={`auth-message${isError ? " is-error" : ""}`} role="status">
            {message}
          </p>
        )}
        <p className="auth-footnote">
          {isAdditionalWorkspace ? (
            <>
              <Link href="/research">Back to Ano</Link> ·{" "}
            </>
          ) : null}
          <button
            type="button"
            className="auth-inline-link"
            onClick={() => void handleSignOut()}
          >
            Sign out
          </button>
        </p>
      </section>
    </main>
  );
}

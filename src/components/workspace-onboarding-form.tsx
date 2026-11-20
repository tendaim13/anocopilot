"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { getBrowserSupabaseClient } from "@/client/services/supabase-browser";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";

function toWorkspaceSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function WorkspaceOnboardingForm() {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState("");
  const [slugWasEdited, setSlugWasEdited] = useState(false);
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [actorEmail, setActorEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailDomain = useMemo(() => actorEmail?.split("@")[1]?.toLowerCase() ?? null, [actorEmail]);

  useEffect(() => {
    const client = getBrowserSupabaseClient();
    if (!client) {
      setIsError(true);
      setMessage("Ano is missing its public Supabase configuration.");
      return;
    }

    client.auth.getUser().then(({ data, error }) => {
      if (error || !data.user?.email) {
        router.replace("/login?next=/onboarding");
        return;
      }
      setActorEmail(data.user.email);
    });
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
      setMessage("Enter a workspace name with at least two characters.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await client.rpc("create_ano_workspace", {
      workspace_name: name,
      workspace_slug: slug,
    });
    setIsSubmitting(false);

    if (error) {
      setIsError(true);
      setMessage(
        error.code === "23505"
          ? "That workspace URL is already taken. Choose another name or URL."
          : "Ano could not create that workspace. Please try again.",
      );
      return;
    }

    router.replace("/");
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
        <p className="eyebrow">CREATE YOUR WORKSPACE</p>
        <h1>Set up Ano</h1>
        <p className="lede">
          This creates your team’s isolated workspace. You become its owner and can invite
          colleagues later.
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
            placeholder="Nerva Studio"
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
            placeholder="nerva-studio"
            supportingText={`ano / ${workspaceSlug || "your-workspace"}`}
            disabled={isSubmitting}
          />
          <p className="workspace-domain-note">
            {emailDomain ? (
              <>
                <b>{emailDomain}</b> will be the first approved email domain for this workspace.
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
        {message && (
          <p className={`auth-message${isError ? " is-error" : ""}`} role="status">
            {message}
          </p>
        )}
        <p className="auth-footnote">
          Already belong to a workspace? Ask its owner to add you.{" "}
          <Link href="/">Return to Ano</Link>
        </p>
      </section>
    </main>
  );
}

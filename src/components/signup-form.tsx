"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { getBrowserSupabaseClient } from "@/client/services/supabase-browser";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";
import {
  extractInviteToken,
  safeRedirectPath,
  validateSignUpInput,
} from "@/lib/ano/workspace-auth";

function formatSignUpError(error: { message?: string; code?: string; status?: number }): string {
  const code = error.code?.toLowerCase() ?? "";
  const message = error.message ?? "";
  const lower = message.toLowerCase();

  if (code === "over_email_send_rate_limit" || error.status === 429 || lower.includes("rate limit")) {
    return "Too many confirmation emails were requested recently. Wait a minute before trying again.";
  }
  if (code === "user_already_exists" || lower.includes("already registered")) {
    return "An account with this work email already exists. Sign in instead.";
  }
  if (code === "signup_disabled" || lower.includes("signups not allowed")) {
    return "Email sign-ups are currently disabled.";
  }
  if (code === "weak_password" || lower.includes("password")) {
    return message || "Choose a stronger password (at least 8 characters).";
  }

  return message || "Ano could not create your account right now. Please try again.";
}

export function SignUpForm() {
  useMaterialWeb();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [requestedNext, setRequestedNext] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const parsedInvite = extractInviteToken(params.get("invite") ?? "");
    const nextParam = params.get("next");
    setInviteToken(parsedInvite);
    setRequestedNext(nextParam ? safeRedirectPath(nextParam, "/onboarding") : null);
  }, []);

  const postAuthDestination = inviteToken
    ? `/invite/${encodeURIComponent(inviteToken)}`
    : requestedNext ?? "/onboarding";

  const loginHref = (() => {
    const search = new URLSearchParams();
    if (inviteToken) search.set("invite", inviteToken);
    if (requestedNext) search.set("next", requestedNext);
    const qs = search.toString();
    return qs ? `/login?${qs}` : "/login";
  })();

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setIsError(false);

    const validated = validateSignUpInput({
      fullName,
      email,
      password,
      confirmPassword,
    });

    if (!validated.ok) {
      setIsError(true);
      setMessage(validated.error);
      return;
    }

    const client = getBrowserSupabaseClient();
    if (!client) {
      setIsError(true);
      setMessage("Authentication service is temporarily unavailable.");
      return;
    }

    setIsSubmitting(true);
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", postAuthDestination);

    const { data, error } = await client.auth.signUp({
      email: validated.email,
      password: validated.password,
      options: {
        data: { full_name: validated.fullName },
        emailRedirectTo: callbackUrl.toString(),
      },
    });
    setIsSubmitting(false);

    if (error) {
      setIsError(true);
      setMessage(formatSignUpError(error));
      return;
    }

    if (data.user?.identities && data.user.identities.length === 0) {
      setIsError(true);
      setMessage("An account with this work email already exists. Sign in instead.");
      return;
    }

    if (data.session) {
      router.push(postAuthDestination);
      router.refresh();
      return;
    }

    setConfirmationEmail(validated.email);
    setIsError(false);
    setMessage(
      `Account created! Check ${validated.email} for your confirmation link to finish setting up your workspace.`,
    );
  }

  async function handleResendConfirmation() {
    if (!confirmationEmail || isSubmitting) return;
    const client = getBrowserSupabaseClient();
    if (!client) return;

    setIsSubmitting(true);
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", postAuthDestination);

    const { error } = await client.auth.resend({
      type: "signup",
      email: confirmationEmail,
      options: { emailRedirectTo: callbackUrl.toString() },
    });
    setIsSubmitting(false);

    if (error) {
      setIsError(true);
      setMessage(formatSignUpError(error));
      return;
    }

    setIsError(false);
    setMessage(`Sent another confirmation email to ${confirmationEmail}.`);
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
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
        <p className="eyebrow">CREATE ACCOUNT</p>
        <h1>Get started with Ano</h1>
        <p className="lede">
          Create your account to launch your personal sales-research workspace in minutes.
        </p>

        {inviteToken && (
          <p className="workspace-domain-note" style={{ marginTop: 16 }}>
            You’re signing up with an admin invite link. After confirming your account, you’ll
            join the invited team workspace and also get your own personal workspace.
          </p>
        )}

        <form onSubmit={handleSignUp} className="auth-form">
          <MaterialTextField
            id="ano-signup-name"
            name="fullName"
            label="Full name"
            type="text"
            autoComplete="name"
            value={fullName}
            onValueChange={setFullName}
            required
            placeholder="Alex Rivera"
            disabled={isSubmitting || Boolean(confirmationEmail)}
          />
          <MaterialTextField
            id="ano-signup-email"
            name="email"
            label="Work email"
            type="email"
            autoComplete="email"
            value={email}
            onValueChange={setEmail}
            required
            placeholder="alex@company.com"
            disabled={isSubmitting || Boolean(confirmationEmail)}
          />
          <MaterialTextField
            id="ano-signup-password"
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onValueChange={setPassword}
            required
            minLength={8}
            supportingText="At least 8 characters"
            disabled={isSubmitting || Boolean(confirmationEmail)}
          />
          <MaterialTextField
            id="ano-signup-confirm-password"
            name="confirmPassword"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onValueChange={setConfirmPassword}
            required
            minLength={8}
            disabled={isSubmitting || Boolean(confirmationEmail)}
          />

          {!confirmationEmail ? (
            <MaterialButton
              type="submit"
              variant="filled"
              className="auth-submit"
              disabled={
                isSubmitting ||
                !fullName.trim() ||
                !email.trim() ||
                password.length < 8 ||
                !confirmPassword
              }
            >
              {isSubmitting ? "Creating account…" : "Create account"}
            </MaterialButton>
          ) : (
            <MaterialButton
              type="button"
              variant="outlined"
              className="auth-submit"
              disabled={isSubmitting}
              onClick={() => void handleResendConfirmation()}
            >
              {isSubmitting ? "Resending…" : "Resend confirmation email"}
            </MaterialButton>
          )}
        </form>

        {message && (
          <p className={`auth-message${isError ? " is-error" : ""}`} role="status">
            {message}
          </p>
        )}

        <p className="auth-footnote">
          Already have an account? <Link href={loginHref}>Sign in</Link> ·{" "}
          <Link href="/">Return to Ano</Link>
        </p>
      </section>
    </main>
  );
}

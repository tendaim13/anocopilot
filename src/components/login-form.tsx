"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { getBrowserSupabaseClient } from "@/client/services/supabase-browser";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";
import { extractInviteToken, safeRedirectPath } from "@/lib/ano/workspace-auth";

type AuthMode = "password" | "otp";

function formatAuthError(
  error: { message?: string; code?: string; status?: number },
  mode: AuthMode,
) {
  const code = error.code?.toLowerCase() ?? "";
  const message = error.message ?? "";
  const lowerMessage = message.toLowerCase();

  if (code === "over_email_send_rate_limit" || error.status === 429 || lowerMessage.includes("rate limit")) {
    return "Supabase Auth's email rate limit was reached (default SMTP allows 2 emails per hour). Wait a minute, configure custom SMTP in Supabase Auth, or sign in with your password.";
  }
  if (code === "otp_disabled" || lowerMessage.includes("signups not allowed for otp")) {
    return "New-user magic-link signups are disabled in Supabase Auth for this address. Create an account or sign in with your password.";
  }
  if (code === "invalid_credentials" || lowerMessage.includes("invalid login credentials")) {
    return "Invalid email or password. Double-check your credentials or create an account.";
  }
  if (code === "email_not_confirmed" || lowerMessage.includes("email not confirmed")) {
    return "Please confirm your email address using the link sent to your inbox before signing in.";
  }

  const detail = [code, message].filter(Boolean).join(": ");
  if (mode === "otp") {
    return detail
      ? `Ano could not send a sign-in link (${detail}). Check Supabase Auth Redirect URLs and SMTP settings.`
      : "Ano could not send a sign-in link. Check the Auth configuration and try again.";
  }
  return detail
    ? `Ano could not sign you in (${detail}).`
    : "Ano could not sign you in. Check your credentials and try again.";
}

export function LoginForm() {
  useMaterialWeb();
  const router = useRouter();
  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [requestedNext, setRequestedNext] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const parsedInvite = extractInviteToken(params.get("invite") ?? "");
    const nextParam = params.get("next");
    setInviteToken(parsedInvite);
    setRequestedNext(nextParam ? safeRedirectPath(nextParam, "/research") : null);

    const callbackError = params.get("error");
    if (callbackError === "configuration") {
      setIsError(true);
      setMessage("Ano is missing its public Supabase configuration.");
    } else if (callbackError === "callback") {
      setIsError(true);
      setMessage("That sign-in or confirmation link was invalid or expired. Try signing in with your password or requesting a new link.");
    }
  }, []);

  const destination = inviteToken
    ? `/invite/${encodeURIComponent(inviteToken)}`
    : requestedNext ?? "/research";

  const signUpHref = (() => {
    const search = new URLSearchParams();
    if (inviteToken) search.set("invite", inviteToken);
    if (requestedNext) search.set("next", requestedNext);
    const qs = search.toString();
    return qs ? `/signup?${qs}` : "/signup";
  })();

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setIsError(false);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setIsError(true);
      setMessage("Enter your work email first.");
      return;
    }
    if (authMode === "password" && !password) {
      setIsError(true);
      setMessage("Enter your password to sign in.");
      return;
    }

    const client = getBrowserSupabaseClient();
    if (!client) {
      setIsError(true);
      setMessage("Ano is missing its public Supabase configuration.");
      return;
    }

    setIsSubmitting(true);

    if (authMode === "password") {
      const { error } = await client.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      setIsSubmitting(false);
      if (error) {
        setIsError(true);
        setMessage(formatAuthError(error, "password"));
        return;
      }
      router.push(destination);
      router.refresh();
      return;
    }

    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", destination);

    const { error } = await client.auth.signInWithOtp({
      email: trimmedEmail,
      options: { emailRedirectTo: callbackUrl.toString() },
    });
    setIsSubmitting(false);
    setIsError(Boolean(error));
    setMessage(
      error
        ? formatAuthError(error, "otp")
        : "Check your inbox for your Ano sign-in link.",
    );
  }

  async function handlePasswordReset() {
    setMessage(null);
    setIsError(false);
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setIsError(true);
      setMessage("Enter your work email above first, then click Forgot password.");
      return;
    }

    const client = getBrowserSupabaseClient();
    if (!client) {
      setIsError(true);
      setMessage("Ano is missing its public Supabase configuration.");
      return;
    }

    setIsSubmitting(true);
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", "/settings");

    const { error } = await client.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: callbackUrl.toString(),
    });
    setIsSubmitting(false);

    if (error) {
      setIsError(true);
      setMessage(formatAuthError(error, "otp"));
      return;
    }

    setIsError(false);
    setMessage(`Password reset instructions sent to ${trimmedEmail}.`);
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
        <p className="eyebrow">SECURE WORKSPACE ACCESS</p>
        <h1>Sign in to Ano</h1>
        <p className="lede">
          Access your sales-research workspaces and team pipelines.
        </p>

        {inviteToken && (
          <p className="workspace-domain-note" style={{ marginTop: 16 }}>
            Sign in to accept your team workspace invite link. New to Ano?{" "}
            <Link href={signUpHref}>Create an account</Link>.
          </p>
        )}

        <div className="auth-mode-tabs">
          <md-tabs
            aria-label="Sign-in method"
            onChange={(event) => {
              const target = event.currentTarget as unknown as { activeTabIndex?: number };
              const nextMode: AuthMode = target.activeTabIndex === 1 ? "otp" : "password";
              setAuthMode(nextMode);
              setMessage(null);
              setIsError(false);
            }}
          >
            <md-primary-tab
              active={authMode === "password"}
              onClick={() => {
                setAuthMode("password");
                setMessage(null);
                setIsError(false);
              }}
            >
              Password
            </md-primary-tab>
            <md-primary-tab
              active={authMode === "otp"}
              onClick={() => {
                setAuthMode("otp");
                setMessage(null);
                setIsError(false);
              }}
            >
              Email link
            </md-primary-tab>
          </md-tabs>
        </div>

        <form onSubmit={handleSignIn} className="auth-form">
          <MaterialTextField
            id="ano-login-email"
            name="email"
            label="Work email"
            type="email"
            autoComplete="email"
            value={email}
            onValueChange={setEmail}
            required
            placeholder="you@company.com"
            disabled={isSubmitting}
          />
          {authMode === "password" && (
            <>
              <MaterialTextField
                id="ano-login-password"
                name="password"
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onValueChange={setPassword}
                required
                disabled={isSubmitting}
              />
              <div className="auth-inline-actions">
                <button
                  type="button"
                  className="auth-inline-link"
                  disabled={isSubmitting}
                  onClick={() => void handlePasswordReset()}
                >
                  Forgot password?
                </button>
              </div>
            </>
          )}
          <MaterialButton
            type="submit"
            variant="filled"
            className="auth-submit"
            disabled={isSubmitting || !email.trim() || (authMode === "password" && !password)}
          >
            {isSubmitting
              ? authMode === "password"
                ? "Signing in…"
                : "Sending link…"
              : authMode === "password"
                ? "Sign in"
                : "Email me a sign-in link"}
          </MaterialButton>
        </form>
        {message && (
          <p className={`auth-message${isError ? " is-error" : ""}`} role="status">
            {message}
          </p>
        )}
        <p className="auth-footnote">
          New to Ano? <Link href={signUpHref}>Create an account</Link> ·{" "}
          <Link href="/">Return to Ano</Link>
        </p>
      </section>
    </main>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { getBrowserSupabaseClient } from "@/client/services/supabase-browser";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialTextField } from "@/components/material/material-text-field";
import { useMaterialWeb } from "@/components/material/register";

type AuthMode = "otp" | "password";

function formatAuthError(
  error: { message?: string; code?: string; status?: number },
  mode: AuthMode,
) {
  const code = error.code?.toLowerCase() ?? "";
  const message = error.message ?? "";
  const lowerMessage = message.toLowerCase();

  if (code === "over_email_send_rate_limit" || error.status === 429 || lowerMessage.includes("rate limit")) {
    return "Supabase Auth's email rate limit was reached (default SMTP allows 2 magic-link emails per hour and 1 request per 60 seconds). Wait a minute, configure custom SMTP in Supabase Auth, or use the Password tab.";
  }
  if (code === "otp_disabled" || lowerMessage.includes("signups not allowed for otp")) {
    return "New-user magic-link signups are disabled in Supabase Auth for this address. Add the user in Supabase Auth or sign in with a password.";
  }
  if (code === "invalid_credentials" || lowerMessage.includes("invalid login credentials")) {
    return "Invalid email or password. Verify the user credentials in Supabase Auth and try again.";
  }
  if (code === "email_not_confirmed" || lowerMessage.includes("email not confirmed")) {
    return "This email address has not been confirmed in Supabase Auth yet.";
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
  const [authMode, setAuthMode] = useState<AuthMode>("otp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackError = params.get("error");
    if (callbackError === "configuration") {
      setIsError(true);
      setMessage("Ano is missing its public Supabase configuration.");
    } else if (callbackError === "callback") {
      setIsError(true);
      setMessage("That sign-in link was invalid or expired. Request a new link or sign in with your password.");
    }
  }, []);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setIsError(false);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setIsError(true);
      setMessage("Enter your approved work email first.");
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
    const currentUrl = new URL(window.location.href);
    const requestedNext = currentUrl.searchParams.get("next");
    const destination = requestedNext?.startsWith("/") ? requestedNext : "/research";

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
          Use your approved work email. Ano will use your authenticated workspace membership to
          scope every record and research run.
        </p>

        <div className="auth-mode-tabs">
          <md-tabs
            aria-label="Sign-in method"
            onChange={(event) => {
              const target = event.currentTarget as unknown as { activeTabIndex?: number };
              const nextMode: AuthMode = target.activeTabIndex === 1 ? "password" : "otp";
              setAuthMode(nextMode);
              setMessage(null);
              setIsError(false);
            }}
          >
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
                ? "Sign in with password"
                : "Email me a sign-in link"}
          </MaterialButton>
        </form>
        {message && (
          <p className={`auth-message${isError ? " is-error" : ""}`} role="status">
            {message}
          </p>
        )}
        <p className="auth-footnote">
          New to Ano? After signing in, you can create your first secure workspace.{" "}
          <Link href="/">Return to Ano</Link>
        </p>
      </section>
    </main>
  );
}

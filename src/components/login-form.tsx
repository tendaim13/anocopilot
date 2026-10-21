"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { getBrowserSupabaseClient } from "@/client/services/supabase-browser";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function requestSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const client = getBrowserSupabaseClient();

    if (!client) {
      setMessage("Ano is missing its public Supabase configuration.");
      return;
    }

    setIsSubmitting(true);
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setIsSubmitting(false);
    setMessage(error ? "Ano could not send a sign-in link. Check the Auth configuration and try again." : "Check your inbox for your Ano sign-in link.");
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-lockup auth-brand"><div className="brand-mark"><span>◖</span><span>◗</span></div><div><strong>Ano</strong><small>Sales copilot</small></div></div>
        <p className="eyebrow">SECURE WORKSPACE ACCESS</p>
        <h1>Sign in to Ano</h1>
        <p className="lede">Use your approved work email. Ano will use your authenticated workspace membership to scope every record and research run.</p>
        <form onSubmit={requestSignIn} className="auth-form">
          <label>Work email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@company.com" /></label>
          <button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? "Sending link…" : "Email me a sign-in link"}<span>→</span></button>
        </form>
        {message && <p className="auth-message" role="status">{message}</p>}
        <p className="auth-footnote">No workspace yet? An owner must create it first. <Link href="/">Return to Ano</Link></p>
      </section>
    </main>
  );
}

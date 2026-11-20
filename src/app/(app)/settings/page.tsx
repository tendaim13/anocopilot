"use client";

import Link from "next/link";

import { MaterialButton } from "@/components/material/material-button";
import { MoonIcon, SunIcon } from "@/components/shell/ano-icons";
import { useAppShell } from "@/components/shell/app-shell";

export default function SettingsPage() {
  const shell = useAppShell();
  const workspace = shell?.workspace;
  const mode = shell?.mode ?? "demo";
  const theme = shell?.theme ?? "light";

  return (
    <section className="ano-section-page">
      <header className="ano-section-header">
        <div>
          <p className="ano-rail-kicker">SYSTEM</p>
          <h1>Workspace & connections</h1>
          <p>
            Workspace identity, appearance theme, provider guardrails, and approval policies for this Ano instance.
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
          <h2>Active workspace</h2>
          <p>
            <strong>Name:</strong> {workspace?.name ?? "Not signed in"}
          </p>
          <p>
            <strong>Slug:</strong> {workspace?.slug ?? "—"}
          </p>
          <p>
            <strong>Role:</strong> {workspace?.role ?? "—"}
          </p>
          <p>
            <strong>Persistence mode:</strong> {mode === "supabase" ? "Supabase (durable RLS)" : "Demo / unauthenticated"}
          </p>
          {mode !== "supabase" && (
            <p>
              <Link href="/login">Sign in to connect a durable workspace</Link>
            </p>
          )}
        </article>

        <article className="ano-surface-card">
          <h2>Provider & safety boundaries</h2>
          <p>
            <strong>Amazon Bedrock:</strong> Reasoning and citation-bound synthesis only; no direct tool or DB credentials.
          </p>
          <p>
            <strong>Private SearXNG:</strong> Approval-gated public discovery up to 50 searches / 100 fetches per mission.
          </p>
          <p>
            <strong>Prospeo (Phases D & E):</strong> Free previews for location/role scoping; 1-page (max 25 results / max 1 credit) caps for company and named-person searches with zero automatic retries.
          </p>
          <p>
            <strong>Dropcontact (Phase E):</strong> Selective verification only for user-checked people with explicit credit disclosure; never bulk-enriches discovered candidates.
          </p>
          <p>
            <strong>Outreach & Mercury (Phase F):</strong> Every email send, calendar invite, call task, and Mercury CRM proposal enforces contact eligibility checks and requires explicit per-action human approval.
          </p>
        </article>
      </div>
    </section>
  );
}

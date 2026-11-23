"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { MaterialButton } from "@/components/material/material-button";
import { MoonIcon, SunIcon } from "@/components/shell/ano-icons";
import { useAppShell } from "@/components/shell/app-shell";

export default function SettingsPage() {
  const router = useRouter();
  const shell = useAppShell();
  const workspace = shell?.workspace;
  const workspaces = shell?.workspaces ?? (workspace ? [workspace] : []);
  const actorEmail = shell?.actorEmail ?? null;
  const mode = shell?.mode ?? "demo";
  const theme = shell?.theme ?? "light";

  return (
    <section className="ano-section-page">
      <header className="ano-section-header">
        <div>
          <p className="ano-rail-kicker">SYSTEM</p>
          <h1>Workspace & account</h1>
          <p>
            Manage your active workspace, appearance theme, and outreach guardrails for this Ano session.
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
            <strong>Persistence mode:</strong> {mode === "supabase" ? "Supabase (durable RLS)" : "Demo / unauthenticated"}
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
          <h2>Provider & safety boundaries</h2>
          <p>
            <strong>Reasoning LLM (Google AI Studio Gemini, Ollama, or Amazon Bedrock):</strong> Reasoning, planning, and citation-bound synthesis only; no direct tool or DB credentials. Configured on server via <code>ANO_AGENT_MODE</code>.
          </p>
          <p>
            <strong>Private SearXNG:</strong> Bounded public market discovery with SSRF/content-type/size validation and safe fallback to uploaded product materials.
          </p>
          <p>
            <strong>Company & decision-maker discovery:</strong> Combines OpenStreetMap local business lookup, company website scans, and Prospeo/Dropcontact B2B verification under server-enforced limits.
          </p>
          <p>
            <strong>Outreach & Mercury (Phase F):</strong> Every external email send, calendar invite, call task, and Mercury CRM proposal enforces contact eligibility checks and requires explicit per-action human approval.
          </p>
        </article>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { getBrowserSupabaseClient } from "@/client/services/supabase-browser";
import { MaterialButton } from "@/components/material/material-button";
import { MaterialIconButton } from "@/components/material/material-icon-button";
import { useMaterialWeb } from "@/components/material/register";
import { MoonIcon, SunIcon } from "@/components/shell/ano-icons";

type ThemeMode = "light" | "dark";
type PreviewTab = 0 | 1 | 2 | 3;

const THEME_STORAGE_KEY = "ano-theme";

const PREVIEW_COMPANIES = [
  {
    name: "Klang Valley Cold Storage",
    city: "Shah Alam",
    note: "Operates two chilled warehouses; roof footprint matches solar EPC sizing.",
  },
  {
    name: "Puchong Packaging Sdn Bhd",
    city: "Puchong",
    note: "Continuous 24-hour extrusion line with daytime peak tariff exposure.",
  },
  {
    name: "Subang Food Processing",
    city: "Subang Jaya",
    note: "Industrial kitchen and blast-chill plant on public directory records.",
  },
] as const;

const PREVIEW_CONTACTS = [
  {
    name: "Lim Wei Ming",
    role: "Operations Director · Klang Valley Cold Storage",
    provenance: "Verified work email",
    pillClass: "ano-home-pill-safe",
  },
  {
    name: "Nurul Aina",
    role: "Facilities Manager · Puchong Packaging Sdn Bhd",
    provenance: "Verified work email",
    pillClass: "ano-home-pill-safe",
  },
  {
    name: "Rajesh Nair",
    role: "Plant Manager · Subang Food Processing",
    provenance: "Public website email",
    pillClass: "ano-home-pill-neutral",
  },
] as const;

const WORKFLOW_STEPS = [
  {
    number: "01",
    title: "Define the brief",
    description:
      "Share a website link, product document, or plain description along with your target location.",
  },
  {
    number: "02",
    title: "Map the market",
    description:
      "Review cited market notes and select the buyer segment your team wants to prioritise.",
  },
  {
    number: "03",
    title: "Build companies & contacts",
    description:
      "Inspect shortlisted companies, buying-committee contacts, and clear email verification labels.",
  },
  {
    number: "04",
    title: "Draft & export",
    description:
      "Edit plain-text follow-up sequences and download spreadsheet-ready contact lists in CSV format.",
  },
] as const;

const TEAM_PILLARS = [
  {
    title: "Clear source labels",
    description:
      "Verified work emails are kept separate from public website inbox addresses so sales reps know how each contact was found.",
  },
  {
    title: "Export-ready lists",
    description:
      "Download researched companies, contacts, and three-step email sequences as CSV or Markdown files.",
  },
  {
    title: "Shared team workspaces",
    description:
      "Invite colleagues by role and switch between personal and shared team workspaces from the top bar.",
  },
  {
    title: "Human review first",
    description:
      "Outreach drafts stay in your review queue until a team member explicitly approves sending.",
  },
] as const;

export function LandingHome() {
  useMaterialWeb();
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [activeTab, setActiveTab] = useState<PreviewTab>(0);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem(THEME_STORAGE_KEY) : null;
    const initial: ThemeMode = stored === "dark" ? "dark" : "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;

    let cancelled = false;
    async function checkSession() {
      try {
        const client = getBrowserSupabaseClient();
        if (!client) return;
        const { data } = await client.auth.getSession();
        if (!cancelled && data.session) {
          setIsSignedIn(true);
        }
      } catch {
        // Keep default public CTAs when auth client is unavailable.
      }
    }
    void checkSession();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleToggleTheme() {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = next;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    }
  }

  return (
    <div className="ano-home">
      <header className="ano-home-header">
        <div className="ano-home-container ano-home-header-inner">
          <Link href="/" className="ano-home-brand" aria-label="Ano home">
            <span className="ano-home-brand-mark" aria-hidden="true">
              ◖◗
            </span>
            <strong>Ano</strong>
          </Link>

          <nav className="ano-home-nav" aria-label="Homepage sections">
            <a href="#workflow">Workflow</a>
            <a href="#outputs">What you get</a>
            <a href="#workspaces">Workspaces</a>
          </nav>

          <div className="ano-home-actions">
            <MaterialIconButton
              ariaLabel={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={handleToggleTheme}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </MaterialIconButton>
            {isSignedIn ? (
              <MaterialButton variant="filled" href="/research">
                Open workspace
              </MaterialButton>
            ) : (
              <>
                <MaterialButton variant="text" href="/login">
                  Sign in
                </MaterialButton>
                <MaterialButton variant="filled" href="/signup">
                  Create account
                </MaterialButton>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="ano-home-container ano-home-hero" aria-labelledby="ano-hero-title">
          <div>
            <p className="ano-home-kicker">Sales research workspace</p>
            <h1 id="ano-hero-title" className="ano-home-title">
              Turn a product brief into researched accounts and ready outreach.
            </h1>
            <p className="ano-home-lede">
              Start with a website link, product deck, or short description of what you sell. Ano
              researches the market, builds a vetted company and contact list, verifies work
              emails, and prepares plain-spoken drafts for your team to review.
            </p>

            <div className="ano-home-cta-row">
              {isSignedIn ? (
                <>
                  <MaterialButton variant="filled" href="/research">
                    Open workspace
                  </MaterialButton>
                  <MaterialButton variant="outlined" href="/companies">
                    View saved companies
                  </MaterialButton>
                </>
              ) : (
                <>
                  <MaterialButton variant="filled" href="/signup">
                    Create a workspace
                  </MaterialButton>
                  <MaterialButton variant="outlined" href="/login">
                    Sign in
                  </MaterialButton>
                </>
              )}
            </div>

            <ul className="ano-home-facts">
              <li>
                <span className="ano-home-fact-dot" aria-hidden="true" />
                <span>Works from product URLs, PDFs, DOCX files, or plain notes</span>
              </li>
              <li>
                <span className="ano-home-fact-dot" aria-hidden="true" />
                <span>Labels verified work emails separately from public website addresses</span>
              </li>
              <li>
                <span className="ano-home-fact-dot" aria-hidden="true" />
                <span>Outbound sends always wait for explicit team approval</span>
              </li>
            </ul>
          </div>

          <aside className="ano-home-preview" aria-label="Sample workspace preview">
            <div className="ano-home-preview-head">
              <p className="ano-home-preview-title">Commercial solar EPC · Selangor</p>
              <span className="ano-home-pill ano-home-pill-neutral">Sample workspace</span>
            </div>

            <div className="ano-home-preview-tabs">
              <md-tabs
                aria-label="Sample workspace views"
                activeTabIndex={activeTab}
                onChange={(event) => {
                  const target = event.currentTarget as unknown as { activeTabIndex?: number };
                  const idx = target.activeTabIndex;
                  if (idx === 0 || idx === 1 || idx === 2 || idx === 3) {
                    setActiveTab(idx);
                  }
                }}
              >
                <md-primary-tab active={activeTab === 0} onClick={() => setActiveTab(0)}>
                  Brief
                </md-primary-tab>
                <md-primary-tab active={activeTab === 1} onClick={() => setActiveTab(1)}>
                  Companies
                </md-primary-tab>
                <md-primary-tab active={activeTab === 2} onClick={() => setActiveTab(2)}>
                  Contacts
                </md-primary-tab>
                <md-primary-tab active={activeTab === 3} onClick={() => setActiveTab(3)}>
                  Outreach
                </md-primary-tab>
              </md-tabs>
            </div>

            <div className="ano-home-preview-body">
              {activeTab === 0 && (
                <div className="ano-home-brief-grid">
                  <div className="ano-home-brief-item">
                    <span className="ano-home-brief-label">Offer summary</span>
                    <p className="ano-home-brief-value">
                      Turnkey rooftop solar systems for cold-storage and daytime manufacturing sites.
                    </p>
                  </div>
                  <div className="ano-home-brief-item">
                    <span className="ano-home-brief-label">Target region</span>
                    <p className="ano-home-brief-value">Selangor, Malaysia</p>
                  </div>
                  <div className="ano-home-brief-item">
                    <span className="ano-home-brief-label">Attached reference</span>
                    <p className="ano-home-brief-value">product-overview.pdf</p>
                  </div>
                  <div className="ano-home-brief-item">
                    <span className="ano-home-brief-label">Locked buyer direction</span>
                    <p className="ano-home-brief-value">
                      Mid-size food and cold-storage operators with high daytime compressor load
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 1 && (
                <div className="ano-home-preview-list">
                  {PREVIEW_COMPANIES.map((company) => (
                    <div key={company.name} className="ano-home-preview-row">
                      <div>
                        <strong>
                          {company.name} · {company.city}
                        </strong>
                        <span>{company.note}</span>
                      </div>
                      <span className="ano-home-pill ano-home-pill-accent">Shortlisted</span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 2 && (
                <div className="ano-home-preview-list">
                  {PREVIEW_CONTACTS.map((contact) => (
                    <div key={contact.name} className="ano-home-preview-row">
                      <div>
                        <strong>{contact.name}</strong>
                        <span>{contact.role}</span>
                      </div>
                      <span className={`ano-home-pill ${contact.pillClass}`}>
                        {contact.provenance}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 3 && (
                <div className="ano-home-email-card">
                  <div className="ano-home-email-subject">
                    <strong>Subject: rooftop power costs in shah alam</strong>
                    <span className="ano-home-pill ano-home-pill-neutral">Awaiting approval</span>
                  </div>
                  <p className="ano-home-email-body">
                    {`Hi Wei Ming,\n\nI saw Klang Valley Cold Storage runs two temperature-controlled bays in Shah Alam. We help industrial facilities with heavy daytime cooling lower electricity bills with zero upfront capex.\n\nWorth sharing a quick two-page tariff estimate for your roof?`}
                  </p>
                  <p className="ano-home-email-foot">
                    Export CSV or review each draft inside your workspace before sending.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </section>

        <div className="ano-home-container">
          <md-divider />
        </div>

        <section
          id="workflow"
          className="ano-home-container ano-home-section"
          aria-labelledby="ano-workflow-title"
        >
          <div className="ano-home-section-head">
            <p className="ano-home-kicker">Workflow</p>
            <h2 id="ano-workflow-title">Four steps from brief to outreach</h2>
            <p>
              Each research thread moves through four clear stages so your team can inspect sources
              and adjust filters along the way.
            </p>
          </div>

          <div className="ano-home-steps">
            {WORKFLOW_STEPS.map((step) => (
              <article key={step.number} className="ano-home-step-card">
                <span className="ano-home-step-num">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <div className="ano-home-container">
          <md-divider />
        </div>

        <section
          id="outputs"
          className="ano-home-container ano-home-section"
          aria-labelledby="ano-outputs-title"
        >
          <div className="ano-home-section-head">
            <p className="ano-home-kicker">What you get</p>
            <h2 id="ano-outputs-title">Built for working sales teams</h2>
            <p>
              Keep product context, account lists, contact verification, and team collaboration in
              one structured workspace.
            </p>
          </div>

          <div className="ano-home-pillars">
            {TEAM_PILLARS.map((pillar) => (
              <article key={pillar.title} className="ano-home-pillar-card">
                <h3>{pillar.title}</h3>
                <p>{pillar.description}</p>
              </article>
            ))}
          </div>
        </section>

        <div className="ano-home-container">
          <md-divider />
        </div>

        <section id="workspaces" className="ano-home-container ano-home-section">
          <div className="ano-home-closing">
            <div className="ano-home-closing-copy">
              <h2>Start a workspace for your team</h2>
              <p>Create your own research workspace or sign in to continue an existing thread.</p>
            </div>
            <div className="ano-home-closing-actions">
              {isSignedIn ? (
                <MaterialButton variant="filled" href="/research">
                  Open workspace
                </MaterialButton>
              ) : (
                <>
                  <MaterialButton variant="filled" href="/signup">
                    Create a workspace
                  </MaterialButton>
                  <MaterialButton variant="outlined" href="/login">
                    Sign in
                  </MaterialButton>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <div className="ano-home-container">
        <md-divider />
        <footer className="ano-home-footer">
          <span>Ano · Sales research workspace</span>
          <div className="ano-home-footer-links">
            <Link href="/login">Sign in</Link>
            <Link href="/signup">Create account</Link>
            <Link href="/research">Workspace</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

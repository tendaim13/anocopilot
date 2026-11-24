# Ano Copilot: Chat-First Material Web Action Plan

**Status:** Phases 0–9 (Domain Phases A–F + Multi-Source Emails, Human-Voice Templates & CSV Export) implemented & verified; **Phase 10 (10A–10E: Autonomous Autopilot, Multi-Format Product Ingestion, Internalized Credit Policy & Operator-Only API Usage Ledger)** mapped for execution  
**Scope:** Replace Ano's tabbed research workbench with a durable, ChatGPT-style research-to-revenue workspace, and evolve the post-Phase 9 workflow from manual step-by-step gate approvals into an autonomous product-to-leads pipeline.  
**UI standard:** Material Web (`@material/web@2.4.1`) implementing Material Design 3.  
**Date:** 2026-11-23

## 1. Decision summary

Ano will become a chat-first sales-research application. The conversation is the primary surface; research plans, approvals, provider progress, evidence, and recommendations are rendered as rich, traceable artifacts *inside* that conversation.

The visual structure will combine:

- **ChatGPT's interaction model:** persistent conversation history, a focused message thread, a sticky composer, and a clear active conversation.
- **Sellbird's information architecture:** a calm persistent sidebar, visible work waiting on the user, compact status counts, and a contextual decision workspace.
- **Ano's trust model (Phases 0–9 baseline -> Phase 10 evolution):** Through Phase 9, every discovery, enrichment, and synthesis step required explicit per-step UI approvals with user-facing credit disclosures. In **Phase 10**, research, company discovery, 3-way email acquisition, and outreach template generation run as an **autonomous, server-budgeted autopilot** immediately after product ingestion (URL/PDF/DOCX/TXT) + 2 intake answers (business location + target market), keeping credit/charge mechanics completely internal while preserving explicit human approval strictly for **outbound external email sends and Mercury CRM writes**.

The only component library will be **Material Web** (`@material/web`). Do not add MUI, Tailwind UI, shadcn, Radix, a React Material wrapper, or another component library. Native React, Next.js, TypeScript, CSS, and the existing application dependencies remain in scope.

## 2. Current-state correction

The repository does **not** currently have Tailwind in `package.json`, a Tailwind configuration file, or Tailwind utility classes. It uses a large custom stylesheet at `src/app/globals.css`, including legacy workbench styles and the current `phase-a`, `phase-b`, and `phase-c` styles.

Therefore this is **not a Tailwind removal project**. It is a migration from custom component styling to Material Web components and Material 3 design tokens. Layout CSS remains necessary; Material Web supplies controls, interaction states, accessibility primitives, and visual tokens, not an entire chat-application layout.

## 3. Product goal and non-goals

### Goal

**Historical rebuild baseline (Phases 0–9):**

```text
Seller message
  → Ano asks one decision-changing question, if necessary
  → Ano posts a reviewable research-plan card
  → Seller approves, edits, or declines in the thread
  → Ano posts a bounded provider-approval card
  → Ano posts safe progress and evidence artifacts
  → Ano posts a cited recommendation
  → Seller selects the target route
  → Later phases add companies, people, and playbooks as linked artifacts
```

**Phase 10 Autonomous Goal (replacing mechanical multi-click staging):**

```text
Seller provides product link or file (URL, PDF, DOCX, TXT)
  → Ano confirms business location & target selling market (max 1 combined prompt)
  → Ano automatically executes Market Research → Target Lock → Company Discovery → 3-Way Email Waterfall → Human-Voice Email Templates
  → Seller jumps directly to any artifact drawer, downloads CSVs, or uses freeform chat to ask questions & trigger targeted re-runs
```

### Non-goals for this architecture

- Do not add autonomous outbound email sending, live campaign blasting, calling, or CRM writes without explicit human approval.
- Do not expose internal API usage, token counts, credit counters, or provider billing telemetry in user-facing UI, API responses, or LLM chat context (usage logs stay isolated for operator review only).
- Do not relax server-side budget ceilings, SSRF checks, idempotency, RLS, audit trails, or evidence-citation controls.
- Do not reimplement the research engine or copy external proprietary code, assets, or a second UI framework.

## 4. Design principles

1. **Conversation first.** A seller should not need to decide which tab contains the next step.
2. **Artifacts, not hidden state.** Plans, sources, evidence confidence, cohorts, and templates appear cleanly inside jumpable workspace artifacts, while operational API telemetry stays strictly internal.
3. **Evidence before persuasion.** Every research-derived claim retains a path to its saved source and claim type.
4. **Autopilot for read/enrichment; explicit approval only for external action.** After Phases 0–9 validated per-step gates manually, Phase 10 automates read-only research, company/contact discovery, email enrichment, and template drafting under silent server-side budgets (`ano_internal`), while reserving explicit user confirmation strictly for outbound email sends and CRM writes.
5. **A calm operational shell.** The left navigation groups work and knowledge without competing with the conversation.
6. **One design language.** Material 3 tokens control color, type, shape, elevation, focus, and dark mode. App CSS only composes the layout and handles product-specific visual meaning.
7. **Responsive by structure.** Desktop has a sidebar and optional context rail; mobile has a compact toolbar and a context drawer.

## 5. Target information architecture

```text
┌──────────────────────┬──────────────────────────────────────────────┬─────────────────────┐
│ Sidebar              │ Active conversation                          │ Context rail        │
│                      │                                              │                     │
│ Ano                  │ [Title] [Research status] [More]             │ Research plan       │
│ + New research       │                                              │ Provider budget     │
│                      │ You: Help me find an outbound market         │ Evidence summary    │
│ Recent research      │ Ano: One question that changes the plan      │ Sources             │
│ • Malaysia SMB AI    │ You: Start with Malaysia                     │ Activity            │
│ • Dental workflow    │ Ano: Research plan [Approve] [Edit]          │                     │
│                      │ Ano: SearXNG scope [Review and run]          │ Collapsible         │
│ Work                 │ Ano: Research completed [View evidence]      │                     │
│ • Needs review (3)   │ Ano: Recommended route with cited claims     │                     │
│ • Active research(1) │                                              │                     │
│                      │ ──────────────────────────────────────────── │                     │
│ Library              │ Ask Ano about this research…          [Send] │                     │
│ • Sources            │                                              │                     │
│ • Saved briefs       │                                              │                     │
│                      │                                              │                     │
│ Settings             │                                              │                     │
└──────────────────────┴──────────────────────────────────────────────┴─────────────────────┘
```

### Sidebar groups

| Group | Initial items | Behaviour |
| --- | --- | --- |
| **Research** | New research, recent conversations | Creates, opens, renames, archives, and searches research conversations. |
| **Work** | Needs review, active research | Shows approval-required plans, provider scopes, stalled runs, and later Mercury proposals. Counts mean an action is waiting. |
| **Library** | Sources, saved briefs | Read-only access to reusable research records; no duplicate provider calls. |
| **System** | Connections, settings | Workspace-specific provider, budget, policy, and account controls. |

Companies (Phase 6 / Domain Phase D), People (Phase 7 / Domain Phase E), and Playbook (Phase 7 / Domain Phase E) remain unavailable until their corresponding product phases exist. They must not be rendered as apparently working navigation items.

## 6. Material Web standard

### 6.1 Dependency and registration rules

1. Add and lock one approved exact version of `@material/web` in `package.json` and `package-lock.json`.
2. Import individual Material Web components instead of importing `@material/web/all.js`; this keeps the client bundle deliberate.
3. Register custom elements from a small client-only module, for example `src/components/material/register.ts`.
4. Render Material custom elements only from Client Components that require interaction. Server Components may render the surrounding semantic layout and data boundaries.
5. Add local TypeScript JSX declarations for the Material element tags and the events/properties Ano uses. Do not suppress TypeScript errors globally.
6. Use React 19's native custom-element support. Do not add a React wrapper package.
7. Pin the selected version and maintain an internal adapter layer because Material Web's upstream repository currently describes itself as maintenance-mode pending new maintainers.

### 6.2 Component map

| Ano need | Material Web component(s) | Ano-specific rule |
| --- | --- | --- |
| Primary and secondary actions | `md-filled-button`, `md-tonal-button`, `md-outlined-button`, `md-text-button` | Use filled only for one primary action in a decision context. |
| Compact actions | `md-icon-button`, `md-filled-icon-button`, `md-outlined-icon-button`, `md-icon` | Every icon-only button has an accessible label. |
| New conversation | `md-fab` or filled button | Label it **New research**, not a vague plus-only action. |
| Composer and plan edits | `md-outlined-text-field` with `type="textarea"` | Preserve keyboard send rules and native form semantics. |
| Conversation history / queues | `md-list`, `md-list-item` | The selected conversation is visible, keyboard reachable, and reflected in the URL. |
| Filters and contextual suggestions | `md-chip-set`, `md-filter-chip`, `md-suggestion-chip`, `md-assist-chip` | Chips assist input; they do not substitute for approval. |
| Approval confirmation | `md-dialog` and Material buttons | Approval card is first; confirmation dialog is only used for high-impact or destructive choices. |
| Overflow actions | `md-menu`, `md-menu-item` | Archive/delete/rename are contextual and never hidden behind an icon without a label. |
| Progress | `md-linear-progress`, `md-circular-progress` | Pair visual progress with text describing the actual safe graph state. |
| Controlled choices | `md-select`, `md-select-option` | Market/industry selection remains an explicit target-decision event. |
| Secondary views | `md-tabs` only in the context rail if needed | Do not restore the current top-level workflow tabs. |
| Status and source labels | Material chips plus Ano token classes | Use text and icon/shape in addition to color. |

### 6.3 Material 3 theme rules

Create `src/styles/material-theme.css` with scoped Material system tokens:

- `--md-sys-color-*` for light and dark schemes;
- `--md-sys-typescale-*` and `--md-ref-typeface-*` for typography;
- `--md-sys-shape-*` for consistent corners;
- component tokens only where a product requirement needs a deliberate exception.

Use a restrained Ano palette: a deep ink/blue for the shell, a distinct primary action color, success/warning/error colors for safety states, and neutral surfaces. Do not copy Sellbird's palette or trademark styling. Validate contrast in both themes.

## 7. Front-end architecture

### 7.1 File structure

```text
src/
  app/
    (app)/
      layout.tsx                    # Authenticated Material app shell
      research/
        page.tsx                    # New-research landing state
        [conversationId]/page.tsx   # Active conversation route
      work/page.tsx                 # Approval and active-run queue (Phase 5)
      library/page.tsx              # Sources and saved briefs
      settings/page.tsx             # Workspace controls & connector status
      companies/page.tsx            # Shortlisted accounts & dossiers (Phase 6 / D)
      people/page.tsx               # Discovered & verified contacts (Phase 7 / E)
      playbook/page.tsx             # Account & buyer playbooks (Phase 7 / E)
    api/v1/
      work-queue/route.ts                 # Unified workspace review & active-run queue
      conversations/[conversationId]/
        product-sources/route.ts          # Phase 10B: multi-format URL/PDF/DOCX/TXT ingestion
        autopilot/
          start/route.ts                  # Phase 10C: initialize autonomous run
          step/route.ts                   # Phase 10C: execute next checkpointed pipeline stage
          cancel/route.ts                 # Phase 10C: pause/cancel autonomous run
        export/route.ts                   # Audited CSV & template export (Phase 9C)
    globals.css                           # Document reset and global defaults only
  components/
    material/
      register.ts                   # Client-side Material Web registrations
      types.d.ts                    # JSX custom-element declarations
      material-button.tsx           # Narrow app adapters, not a UI library
      material-icon-button.tsx
      material-text-field.tsx
    shell/
      app-shell.tsx
      app-sidebar.tsx
      mobile-toolbar.tsx
      context-rail.tsx
      ano-icons.tsx
    conversation/
      conversation-thread.tsx
      conversation-message.tsx
      conversation-composer.tsx
      conversation-history.tsx
      artifact-message.tsx
      approval-card.tsx
      research-progress-message.tsx
    artifacts/
      research-plan-card.tsx
      provider-scope-card.tsx
      research-progress-message.tsx
      evidence-card.tsx
      recommendation-card.tsx
      target-decision-card.tsx
      company-search-preview-card.tsx   # Phase 6 / Domain Phase D
      account-cohort-card.tsx           # Phase 6 / Domain Phase D
      company-cohort-artifact-drawer.tsx # Phase 6 / Domain Phase D
      account-dossier-card.tsx          # Phase 6 / Domain Phase D
      people-discovery-card.tsx         # Phase 7 / Domain Phase E
      people-cohort-artifact-drawer.tsx # Phase 7 / Domain Phase E
      contact-verification-card.tsx     # Phase 7 / Domain Phase E
      playbook-card.tsx                 # Phase 7 / Domain Phase E
      outreach-draft-card.tsx           # Phase 8 / Domain Phase F
      outreach-template-pack-card.tsx   # Phase 9B
      outreach-template-drawer.tsx      # Phase 9B
      lead-export-card.tsx              # Phase 9C
      autopilot-progress-card.tsx       # Phase 10D
      results-jump-bar.tsx              # Phase 10D
    work/
      review-queue.tsx                  # Phase 5
  server/
    ingestion/
      product-source-ingestor.ts        # Phase 10B: SSRF-safe URL + PDF/DOCX/TXT extractor
    domain/
      autopilot-orchestrator-service.ts # Phase 10C: checkpointed 6-stage state machine
    telemetry/
      internal-api-usage.ts             # Phase 10A: write-only RPC telemetry + budget check
scripts/
  report-api-usage.mjs                  # Phase 10A: operator-only CLI (never exposed via HTTP)
  styles/
    material-theme.css
    shell.css
    conversation.css
    artifacts.css
```

The precise route-group name may change, but the active conversation must be addressable at a stable URL such as `/research/<conversation-id>`.

### 7.2 State boundaries

| Concern | Ownership |
| --- | --- |
| Conversation selection, composer text, open context rail | Client UI state |
| Conversations, messages, plans, research runs, evidence, approvals | Ano API and Supabase records |
| Graph checkpoints and resumptions | LangGraph plus existing Ano persistence |
| Permission, budget, provider execution, audit | Existing server domain/policy/persistence layers |
| Material component registration and theme | Client bootstrap and CSS tokens |

Never mirror the database into a long-lived client store merely to render the chat. Fetch the selected conversation by ID, hydrate its artifacts from durable records, and refresh only the active run/event data while it is executing.

## 8. Conversation and API changes

### 8.1 Conversation history

The current `GET /api/v1/conversations` returns only the newest resumable conversation. Replace that implicit-singleton behaviour with:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/conversations?cursor=&limit=` | Paginated workspace-scoped conversation summaries for the sidebar. |
| `POST /api/v1/conversations` | Create a new conversation and return its ID plus initial state. |
| `GET /api/v1/conversations/:id` | Read one selected conversation and its renderable artifacts. |
| `PATCH /api/v1/conversations/:id` | Rename or archive a conversation through validated, auditable actions. |
| `POST /api/v1/conversations/:id/messages` | Submit a normal message only where the current graph policy permits it. |
| `POST /api/v1/conversations/:id/resume` | Submit a typed graph interruption response only. |

Add an archival state/timestamp and title-change audit record if they do not already exist. Do not delete a conversation that carries provider receipts or evidence from the normal UI; archival is the default action.

### 8.2 Rich message contract

Retain `ano_messages` as the chronological record, but evolve `content_json` to a versioned render contract:

```ts
type MessagePart =
  | { type: "text"; markdown: string }
  | { type: "artifact"; artifactType: "research_plan" | "provider_scope" | "research_progress" | "evidence_report" | "target_decision"; artifactId: string }
  | { type: "status"; state: "thinking" | "awaiting_approval" | "running" | "completed" | "stopped_safely" };
```

The message stores references, not duplicate source excerpts, credentials, raw HTML, or entire graph state. The server resolves every artifact against the selected workspace before returning it to the browser.

### 8.3 Continuous-chat behaviour

The current graph permits unrestricted follow-up messages only when it is `draft` or `complete_without_research`; it uses typed resume events while awaiting clarification or plan approval. Preserve that safety design, but make it feel natural:

- The single composer remains visible at all times.
- When Ano is waiting for a clarification, the composer labels the pending question and maps the reply to the existing typed clarification resume action.
- When Ano is awaiting plan approval, show **Approve**, **Edit**, and **Decline** inside the plan artifact. A plain text message may request a plan revision but cannot be interpreted as approval.
- When a research run is active, allow safe chat questions about the visible saved state; do not modify, restart, or expand provider scope through free-form text.
- When research is complete, a follow-up can create a new bounded planning step or a revision, never an implicit provider call.

## 9. Artifact rendering rules

| Artifact | In-thread presentation | Context-rail presentation | Required controls |
| --- | --- | --- | --- |
| Research plan | Summary, questions, scope, uncertainty, decision buttons | Latest version and approval state | Approve, edit, decline (`md-dialog` confirm) |
| Provider scope | Provider, capped searches/fetches, cost/risk note | Current budget and receipt | Explicit run approval only |
| Research progress | Current safe phase, completed counts, readable event text | Timeline and diagnostics | Continue only when saved state permits it |
| Evidence ledger & report | Source observations, recommendation, confidence, direct findings, inference labels | Sources and coverage detail | Filter sources / open context rail / start bounded follow-up |
| Target decision | Selected market and industry (`md-outlined-select`), consequences | Decision history | Lock only through explicit action |
| Company search & cohort (Phase 6 / D) | Dual-source discovery (1-click free OpenStreetMap Nominatim bounded POI / optional Overpass local discovery at \$0, or Prospeo profile-only `search_everywhere: false` & industry-taxonomy mapping at max 1 credit), compact preview table in chat + click-in interactive cohort drawer (`CompanyCohortArtifactDrawer`) with search/filter/dossier drill-down and direct chat feedback | Active search receipt and filter provenance | OpenStreetMap runs in 1 click (\$0); Prospeo requires explicit credit approval |
| Account dossier & signals (Phase 6 / D) | Accessible inside the click-in cohort artifact drawer & `/companies` directory (fit breakdown, confirmed signals, evidence links, retrieval timestamps, unknowns) rather than flooding chat with 25 cards | Full account source ledger | Shortlist, hold, dismiss, or ask Ano about the company |
| People & verification (Phase 7 / E) | Product-aware Buying Committee selector (`local_smb` / `mid_market` / `enterprise`, Prospeo-aligned Seniority & Department `<md-filter-chip>` selectors, Title Include & Exclude rules editable via UI chips or two-way chat); Dual-source People Discovery (1-click free Website Team/About crawl `website_team` at \$0 credits with cited source URLs, or Prospeo `/search-person` at max 1 credit using `company.websites`/`company.names` + `person_seniority` + `person_department` + `person_job_title` include/exclude); compact preview table in chat + slide-over `<PeopleCohortArtifactDrawer />` (`Name`, `Job Title`, `Department / Seniority`, `Company`, `Source`, `Verification Status`) with search, source/status filters, detail drill-down, selective Dropcontact checkboxes (plus planned Phase 9A `public_website` \$0 capture & Prospeo `/bulk-enrich-person`), and **"Suggest changes in chat"** | Contact provenance, buying committee criteria, and verification receipt | Website team scan runs in 1 click (\$0); Prospeo person search, Prospeo enrichment, and Dropcontact verification keep separate explicit approvals |
| Account playbook & outreach (Phases 7–8 / E–F) | Evidence-backed angles, validation questions, channel drafts, Mercury proposal preview | Draft versions and eligibility checks | Review-only drafts; explicit per-action approval to send/sync |
| Outreach email template pack *(Phase 9B)* | Compact 3-step sequence card (`Initial`, `Follow-Up 1`, `Follow-Up 2` + optional `LinkedIn Note`) + click-in `<OutreachTemplateDrawer />` enforcing anti-AI cold-email checks (60/50/30 word caps, zero em-dashes/`!`/markdown/AI clichés, lowercase subjects, no URLs in Email 1) with merge variables (`{{first_name}}`, `{{full_name}}`, `{{job_title}}`, `{{company_name}}`, `{{city}}`, `{{country}}`, `{{website}}`), live lead-preview switcher, inline edits, chat-driven refinements, and 1-click **Copy** | Active sequence version, tone, CTA style, and cited Phase C claim lineage | Free LLM generation with single bounded rewrite pass & chat edits (\$0 external spend); never triggers external sends |
| Leads & templates export pack *(Phase 9C)* | Readiness summary metrics (`Total Leads`, `With Email`, `Verified Emails`, `Templates Ready`) + filterable 1-click RFC-4180 formula-safe CSV download (`Leads CSV`) and template download (`.csv` / `.md`) inside `<LeadExportCard />`, `<PeopleCohortArtifactDrawer />`, `<OutreachTemplateDrawer />`, and `/people` without requiring Mercury or an email blaster | Export audit log & provenance filter summary (`email_status`, `email_source`) | Workspace-scoped authenticated `GET`; neutralizes formula injection; logs append-only `audit_logs` events |

Every artifact must show the difference between: **what the user told Ano**, **source observation**, **comparable evidence**, **Ano inference**, and **unknown / validate next**.

### 9.1 Phase E Buying Committee & Dual-Source People Discovery Design

1. **3-Axis Product-Aware Persona Model (`BuyingCommitteeCriteria`):**
   - **Company Archetype (`local_smb` | `mid_market` | `enterprise`):** Automatically inferred from shortlisted Phase D companies (e.g., OpenStreetMap physical clinics or small headcount default to `local_smb`) so Ano avoids requesting SaaS-style C-suite titles that do not exist at single-site clinics.
   - **Seniority Band (`person_seniority`):** Mapped cleanly to Prospeo's controlled enum (`Founder/Owner`, `C-Suite`, `Partner`, `Vice President`, `Head`, `Director`, `Manager`, `Senior`).
   - **Function / Department (`person_department`):** Mapped from the offer brief & locked industry (e.g., `Medical & Health`, `Operations`, `C-Suite`, `Engineering & Technical`, `Information Technology`, `Finance`, `Sales`, `Marketing`, `Human Resources`).
   - **Title Include & Exclude Rules (`person_job_title`):** Positive decision-maker title keywords paired with exclusion filters (e.g. excluding `Intern`, `Student`, `Assistant`, `Receptionist`, `Hygienist`) so non-buyer staff are filtered out.
2. **Cross-Industry Website Team Extractor (`website_team`, \$0 credits):**
   - SSRF-safe bounded crawl inspecting shortlisted company homepages and internal `/about`, `/company`, `/team`, `/leadership`, `/executives`, `/partners`, `/attorneys`, `/advisors`, `/consultants`, `/doctors`, `/staff`, `/contact` links (capped at 10 companies, 3 pages per company, 20 pages total across a run, `text/html` only, 8s timeout).
   - Parses Schema.org JSON-LD (`Person`, `Founder`, `Employee`, `Attorney`, `Physician`, `Dentist`), semantic team cards, narrative `/about` & `/company` prose sentences (`"founded by..."`, `"<Name>, <Title>"`), and a strictly text-verified LLM extraction fallback (capped at 5 sites/run when deterministic passes find 0 people, rejecting any name not literally present on the fetched pages) to extract up to 4 decision-makers per company (25 total) with their exact source URL; never scrapes or fabricates emails/phones (email verification remains gated via Dropcontact).
3. **Fixed Prospeo `/search-person` Payload & Title Suggestions (1 credit on explicit approval):**
   - Uses Prospeo's documented `company.websites` / `company.names` filter keys alongside `person_seniority.include`, `person_department.include`, and `person_job_title.include` / `person_job_title.exclude`. Free `/search-suggestions` (`job_title_search`) is available via `suggestProspeoJobTitles()`.
4. **Two-Way Chat `peopleUpdate` Integration:**
   - Grounded chat (`conversation-chat-model.ts`) surfaces the active `BuyingCommitteeCriteria` and People Cohort rows in Ano's live context snapshot.
   - Users can ask questions about discovered people (`peopleUpdate: null`) or refine titles, departments, seniorities, exclusions, or provider via chat: `website_team` refinements execute immediately at \$0 credits, while `prospeo` refinements stage a preview with an inline **"Approve 1-credit Prospeo person search"** button.

## 10. Consolidated implementation roadmap

### Completed roadmap — Phases 0 to 8 (Implemented & Verified)

| Phase | Delivered scope | Verification state |
| --- | --- | --- |
| **Phase 0–1** | Pinned `@material/web@2.4.1`, client-only custom element registration (`src/components/material/register.ts`), React 19 JSX declarations (`types.d.ts`), narrow Material adapters, light/dark M3 tokens (`src/styles/material-theme.css`), and Material Web `/login` (with Password + Magic Link tabs and Auth error diagnostics) and `/onboarding`. | `typecheck`, Turbopack `build`, and auth routes verified. |
| **Phase 2** | Authenticated Material `AppShell` (`app-sidebar.tsx`, `mobile-toolbar.tsx`, `context-rail.tsx`), live routes (`/research`, `/research/[conversationId]`, `/work`, `/library`, `/settings`), and workspace conversation listing. | `typecheck`, Turbopack `build`, and `test:research-phase-a` passed. |
| **Phase 3–4** | Stripped 64 KB of legacy `globals.css` selectors; replaced the 7-tab workbench with a chat-first `<ConversationThread />`, sticky `<ConversationComposer />`, optimistic pending messages, rich `MessagePart` contract, cursor pagination (`GET /api/v1/conversations`), auditable rename/archive (`PATCH /api/v1/conversations/:id`), `<md-dialog>` confirmations (`ApprovalCard`), and all Phase A–C inline Material 3 artifact cards (`ResearchPlanCard`, `ProviderScopeCard`, `ResearchProgressMessage`, `EvidenceCard`, `RecommendationCard`, `TargetDecisionCard`). | `typecheck`, Turbopack `build`, `chat-first-material-phase4.test.ts`, and `test:research-phase-a/b/c` passed. |
| **Phase 5** | Unified durable workspace queue (`GET /api/v1/work-queue`), `ReviewQueue` (`src/components/work/review-queue.tsx`) with Material filter chips across Phase A–C gates, live sidebar badges, `ContextRail` graph/checkpoint diagnostics, decommissioned legacy workbenches, and reconciled `README.md` + `docs/ARCHITECTURE.md`. | `typecheck`, Turbopack `build`, `work-queue-phase5.test.ts`, `chat-first-material-phase4.test.ts`, and `test:research-phase-a/b/c` passed. |
| **Phase 6 (Domain Phase D)** | Migrations `000017` and `000020` re-anchoring `provider_company_searches` and `account_candidates` to `ano_conversations` & `target_decisions` with dual-source (`openstreetmap` / `prospeo`) support, `signals_json`, and separated `claim_ids`; OpenStreetMap Nominatim bounded POI (and optional `OVERPASS_API_URL`) connector (`src/server/connectors/openstreetmap/osm-client.ts`) with bounded SearXNG website lookup (max 10, \$0) and 1-click free execution; Prospeo precision upgrade (`search_everywhere: false` excluding `website_pages` + industry-taxonomy fallback mapping); interactive `AccountCohortCard` preview table + slide-over `CompanyCohortArtifactDrawer` with inline dossier drill-down; grounded two-way chat agent (`conversation-chat-model.ts`) with chronological timeline interleaving; `createTargetToAccountGraph`, `GET`/`POST /api/v1/conversations/[conversationId]/company-search`, `/api/v1/conversations/[conversationId]/accounts/[accountId]/state`, `GET /api/v1/companies`; and active `/companies` directory. | `typecheck`, Turbopack `build`, `conversational-chat-and-artifact.test.ts`, `openstreetmap-company-discovery.test.ts`, `phase6-target-to-account-discovery.test.ts`, `prospeo-company-discovery.test.ts`, `work-queue-phase5.test.ts`, `chat-first-material-phase4.test.ts`, and `test:research-phase-a/b/c` passed. |
| **Phase 7 (Domain Phase E)** | Migrations `000018` and `000021` (`provider_person_searches` supporting `website_team` \$0 and `prospeo` 1-credit dual-source discovery, re-anchored `contact_candidates`, `contact_verification_runs`, `account_playbooks`); product-aware Buying Committee selector (`local_smb`/`mid_market`/`enterprise`, Seniority & Department `<md-filter-chip>` groups, Title include/exclude); SSRF-safe `website_team` team/about page extractor + fixed Prospeo `/search-person` filters & free `/search-suggestions` `job_title_search`; two-way chat `peopleUpdate` execution; `createAccountToPeopleGraph`, selective Dropcontact `/batch` client; `GET`/`POST /api/v1/conversations/[conversationId]/people-discovery`, `GET /api/v1/people`, `GET /api/v1/playbooks`; `<PeopleCohortArtifactDrawer />`, upgraded `PeopleDiscoveryCard`, `ContactVerificationCard`, `PlaybookCard`; and active `/people` and `/playbook` directories. | `typecheck`, Turbopack `build`, `phase7-buying-committee-and-website-team.test.ts`, `phase7-people-verification-playbooks.test.ts`, `phase6-target-to-account-discovery.test.ts`, `prospeo-company-discovery.test.ts`, `work-queue-phase5.test.ts`, `chat-first-material-phase4.test.ts`, and `test:research-phase-a/b/c` passed. |
| **Phase 8 (Domain Phase F)** | Migration `000019` (`outreach_drafts`, extended `proposals`, expanded `provider_action_requests`); `createOutreachExecutionGraph` (`src/server/langgraph/outreach-execution-graph.ts`), deterministic `evaluateContactEligibility` suppression/verified-email guard, `GET`/`POST /api/v1/conversations/[conversationId]/outreach`, `OutreachDraftCard` (`<ApprovalCard />` per-action confirmation, immutable `approval_decisions`, `audit_logs`, `MercuryReadConnector` proposal receipts, and `/work` pending proposal surfacing). | `typecheck`, Turbopack `build`, `phase8-outreach-mercury-proposals.test.ts`, `phase7-people-verification-playbooks.test.ts`, `phase6-target-to-account-discovery.test.ts`, `prospeo-company-discovery.test.ts`, `work-queue-phase5.test.ts`, `chat-first-material-phase4.test.ts`, and `test:research-phase-a/b/c` passed. |

### Completed roadmap — Phase 9: Exportable Leads List & Blaster-Ready Email Templates (Implemented & Verified)

> **Architecture sync rule:** Immediately after implementing and verifying **each** sub-phase (`9A`, `9B`, and `9C`), update [docs/ARCHITECTURE.md](file:///Users/tendaimidzi/Code/AnoCopilot/docs/ARCHITECTURE.md) with that phase's new tables/migrations, API routes, safety/provenance controls, and operational behavior before beginning the next phase.

| Phase | Goal | Key Scope & Migrations | Safety & Provenance Rules | Acceptance / Verification & Architecture Gate |
| --- | --- | --- | --- | --- |
| **Phase 9A** | Populate real emails on leads even without Dropcontact | Migration `20261122_000022`; `public_website` email/phone capture (\$0); Prospeo `/bulk-enrich-person` client & multi-provider verification runs; fix re-run lock in `people-playbook-store.ts`; update `evaluateContactEligibility`; add provider toggle in UI. | Publicly scraped emails (`mailto:` / `/contact`) separate personal vs shared business inboxes (`info@`, `admin@`, `contact@`) and are labelled `public_website` (never claimed SMTP-verified). Prospeo enrichment (`only_verified_email: true`, `enrich_mobile: false`, max 10/batch, 1 credit per found email, 0 on miss or 90-day dedupe, no auto-retry) requires explicit approval. | Implemented & verified (migration `000022` applied, unit tests + `typecheck` + `build` passed, `docs/ARCHITECTURE.md` synced). |
| **Phase 9B** | Generate blaster-ready human-sounding LLM outreach email templates | Migration `20261122_000023` (`public.outreach_template_packs`); `src/lib/ano/outreach-templates.ts` (anti-AI voice linter + merge renderer + grounded fallback); `src/server/agents/outreach-template-model.ts` (3-step sequence + optional LinkedIn note with bounded 1-rewrite pass); `templateUpdate` in `conversation-chat-model.ts` & `research-conversation-service.ts`; `OutreachTemplatePackCard` + `OutreachTemplateDrawer`. | Encodes human-voice cold-email rules (max 60/50/30 words, zero em/en-dashes/spaced hyphens, zero `!`/markdown/AI clichés, lowercase subjects without `{{first_name}}`/`"quick question"`/fake `re:`, zero URLs in Email 1, no self-openings on Emails 1–2); grounded strictly in brief + Phase C evidence; `$0` external spend. | Implemented & verified (migration `000023` applied, unit tests + `typecheck` + `build` passed, `docs/ARCHITECTURE.md` synced). |
| **Phase 9C** | 1-click export of Leads CSV + Outreach Templates | Pure RFC-4180 formula-safe CSV/Markdown builder (`src/lib/ano/lead-export.ts`); audited routes `GET /api/v1/conversations/[conversationId]/export` & `GET /api/v1/people/export`; `LeadExportCard` + export actions in `PeopleCohortArtifactDrawer`, `OutreachTemplateDrawer`, and `/people`. | Workspace-scoped auth + RLS enforced; neutralizes leading `=`, `+`, `-`, `@`, `\t`, `\r` spreadsheet formula injection; preserves honest `email_source` & `email_status` columns; writes `leads.exported_csv` / `templates.exported` to append-only `audit_logs`. | Implemented & verified (unit tests + `typecheck` + `build` passed, `docs/ARCHITECTURE.md` synced). |

#### Phase 9A — Multi-Source Email Acquisition (`public_website` \$0 + Prospeo `/bulk-enrich-person` + Dropcontact)

1. **Migration (`supabase/migrations/20261122_000022_phase_9a_multi_source_email_enrichment.sql`):**
   - Widen `public.contact_verification_runs.provider_key` CHECK constraint to `('dropcontact', 'prospeo')` and register the migration in `scripts/apply-ano-schema.mjs` and `scripts/check-ano-schema.mjs`.
2. **Free Public Website Email/Phone Capture (`src/server/connectors/website-team/website-team-client.ts`):**
   - During the existing SSRF-safe bounded crawl (home, `/about`, `/team`, `/contact`), extract `mailto:` addresses and clean business emails alongside named people and `tel:` numbers (`\$0` credits).
   - Match local-part tokens against a person's name when clearly tied (`dr.tan@clinic.com` → direct personal match) vs. role/shared inbox (`info@`, `contact@`, `admin@`, `reception@`, `hello@`, `appointments@` → `public_website_generic` / `office_inbox`) so export consumers never mistake a generic reception inbox for a direct executive email.
3. **Prospeo `/bulk-enrich-person` Connector (`src/server/connectors/prospeo/prospeo-client.ts`):**
   - Add `enrichProspeoPeople(pairs, fetcher)` calling `POST /bulk-enrich-person` with `{ only_verified_email: true, enrich_mobile: false, data: [...] }` using `identifier: contactId`, `first_name`, `last_name`, `full_name`, `linkedin_url`, `company_website` (max 10 contacts per approved batch, no automatic retries).
   - Map `person.email.email`, `status === "VERIFIED"`, `verification_method`, and `free_enrichment` (`1` credit per matched email; `0` credits if not matched or within 90-day Prospeo deduplication window).
4. **Persistence, Eligibility & UI (`people-playbook-store.ts`, `people-playbook-service.ts`, `outreach-execution.ts`, `contact-verification-card.tsx`, `people-discovery-card.tsx`, `people-cohort-artifact-drawer.tsx`):**
   - Fix `saveDropcontactVerificationPreview` re-run lock (`view.verificationRun.status !== "running"`) so additional contact batches can be previewed and verified after an earlier completed batch; generalize preview/execute functions across `providerKey: "prospeo" | "dropcontact"`.
   - Extend `verifiedContactDetailsSchema` (`provider: z.enum(["dropcontact", "prospeo"])`) and add optional `publicEmail` / `publicEmailKind` / `publicPhone` fields on `contactCandidateViewSchema` for `$0` website captures.
   - Update `evaluateContactEligibility()` so both Prospeo-verified and Dropcontact-verified emails satisfy `eligible` while `public_website` emails remain exportable and transparently distinguished.
   - Surface verification provider selection (`Prospeo Enrich` vs `Dropcontact`) cleanly with per-batch credit estimates (`max 1 credit per matched contact`).
5. **Phase 9A `docs/ARCHITECTURE.md` Update Gate:**
   - Update `Schema groups`, `Tool & provider safety matrix` (documenting `public_website` email provenance rules and Prospeo `/bulk-enrich-person` 10-pair cap), and `Database operation` (`000022`).

#### Phase 9B — Blaster-Ready Human-Sounding LLM Outreach Email Sequences

1. **Migration (`supabase/migrations/20261122_000023_phase_9b_outreach_template_packs.sql`):**
   - Create RLS-protected `public.outreach_template_packs` (`unique (workspace_id, target_decision_id)`) storing `version`, `tone` (`peer_direct` | `curious` | `executive_brief` | `warm_smb`), `cta_style` (`easy_yes` | `free_offer` | `direct_question`), `entry_offer`, `sender_name`, `target_roles_json`, `steps_json` (`initial` Day 0, `follow_up_1` Day 3, `follow_up_2` Day 7, optional `linkedin_note` Day 1), `claim_ids_json`, `generation_mode`, and `last_instruction`. Register in `apply-ano-schema.mjs` & `check-ano-schema.mjs`.
2. **Anti-AI Cold-Email Linter, Template Contracts & Merge Engine (`src/lib/ano/outreach-templates.ts`, `src/server/agents/outreach-template-model.ts`):**
   - Original Ano TypeScript implementation encoding Sellbird's anti-AI voice rules: plain-text formatting only, max 60/50/30 words across Steps 1–3, zero dashes between words (em/en-dash, `--`, ` - `), zero exclamation marks, curated AI-tell blacklist + `"not just X but Y"` guard (with prospect/company name blanking so e.g. `"Elevate Dental"` never false-positives), max 1 question per email, no self-opening (`I`/`We`) on Steps 1–2, lowercase 2–5 word subjects without `{{first_name}}` / `"quick question"` / fake `re:`, and zero links in Email 1.
   - Generate tailored sequences using the workspace's active Ollama/Bedrock model with a single bounded auto-rewrite pass (`max 1`) when any step trips the linter (verifying preserved `{{merge_tag}}` variables and rejecting meta-text), plus a grounded deterministic fallback (`buildDeterministicFallbackTemplatePack`) and `renderTemplateForContact()` supporting `{{first_name}}`, `{{full_name}}`, `{{job_title}}`, `{{company_name}}`, `{{city}}`, `{{country}}`, and `{{website}}`.
3. **Chat-Driven Refinement (`conversation-chat-model.ts`, `research-conversation-service.ts`, `api/v1/conversations/[conversationId]/templates/route.ts`):**
   - Add `templateUpdate` schema (`apply`, `instruction`, `tone`, `ctaStyle`, `entryOffer`, `maxWords`) so users can ask Ano in chat (*"make the opener 3 sentences and less salesy"*, *"adjust for Practice Managers"*) and regenerate/save a new template version (`\$0` external spend) automatically while keeping read-only Q&A untouched.
4. **Material 3 Card & Drawer (`src/components/artifacts/outreach-template-pack-card.tsx`, `src/components/artifacts/outreach-template-drawer.tsx`):**
   - Compact sequence preview card in chat + slide-over `<OutreachTemplateDrawer />` with inline subject/body editing, merge-tag insert chips, real-time anti-AI lint warnings, a live lead-preview selector showing interpolated copy for any discovered lead, and 1-click **Copy Subject + Body**.
5. **Phase 9B `docs/ARCHITECTURE.md` Update Gate:**
   - Document `outreach_template_packs`, anti-AI voice linter & bounded rewrite loop, template generation endpoint, merge-variable contract, and chat `templateUpdate` behavior under Phase F & Safety Matrix (`000023`).

#### Phase 9C — 1-Click Leads CSV & Outreach Templates Export Pack

1. **Pure RFC-4180 Export Formatter (`src/lib/ano/lead-export.ts`):**
   - Implement `formatCsvCell(value)` with RFC-4180 quoting (`"`, `,`, `\r\n`) and spreadsheet formula-injection neutralization (prefixing leading `=`, `+`, `-`, `@`, `\t`, `\r` with `'`).
   - Implement `buildLeadsCsv(contacts, accountsById, scope)` outputting standardized blaster-ready headers:
     `first_name,last_name,full_name,email,email_status,email_source,phone,job_title,department,seniority,company_name,company_domain,company_website,company_specialisation,city,country,linkedin_url,source_url,fit_score,lead_status`
     with filter scopes `with_email` (`verified` + `public_website`), `verified_only` (Prospeo/Dropcontact verified only), or `all` (all discovered leads + company context).
   - Implement `buildTemplatesCsv(pack)` (`step_number,step_key,step_label,channel,delay_days,subject,body,word_count,human_voice_passed`) and `buildTemplatesMarkdown(pack)` for easy paste/import into any external sender or CRM.
2. **Workspace-Scoped Audited API Routes:**
   - `GET /api/v1/conversations/[conversationId]/export?format=leads_csv|templates_csv|templates_md&scope=with_email|verified_only|all` returning `Content-Disposition: attachment` with safe filename (`ano-leads-<slug>.csv`) and recording `leads.exported_csv` or `templates.exported` in append-only `audit_logs`.
   - `GET /api/v1/people/export` for workspace-wide export from `/people`.
3. **UI Integration (`src/components/artifacts/lead-export-card.tsx`, `people-cohort-artifact-drawer.tsx`, `outreach-template-drawer.tsx`, `src/app/(app)/people/page.tsx`):**
   - Compact summary artifact card in the chat thread when leads or templates exist (readiness counters + scope selector + **Download Leads CSV** / **Download Email Templates CSV**), mirrored cleanly inside `PeopleCohortArtifactDrawer`, `OutreachTemplateDrawer`, and `/people`.
4. **Phase 9C `docs/ARCHITECTURE.md` Update Gate:**
   - Document CSV/Markdown export routes, formula-injection sanitization, `audit_logs` export events, and end-to-end blaster-ready export workflow.

### Planned roadmap — Phase 10: Autonomous Autopilot, Multi-Format Product Ingestion & Operator-Only API Usage Ledger (5 Sub-Phases)

> **Execution & Architecture Sync Rule:** Implement Phase 10 in order (`10A` → `10B` → `10C` → `10D` → `10E`), starting with the operator-only usage telemetry & silent budget boundary (`10A`) before autonomous execution runs (`10C`). After verifying **each** sub-phase (`typecheck` + `npm test` + `next build`), sync [docs/ARCHITECTURE.md](file:///Users/tendaimidzi/Code/AnoCopilot/docs/ARCHITECTURE.md) with its tables, endpoints, and safety boundaries before advancing.

| Sub-Phase | Goal | Key Scope & Migrations | Safety & Isolation Rules | Acceptance & `ARCHITECTURE.md` Gate |
| --- | --- | --- | --- | --- |
| **Phase 10A** | Operator-only internal API usage ledger & silent budget caps | Migration `20261124_000024` (`ano_internal.api_usage_logs` + write-only `record_internal_api_usage` + boolean `check_internal_usage_budget`); `src/server/telemetry/internal-api-usage.ts`; telemetry hooks in all LLM, search, discovery & enrichment clients; `scripts/report-api-usage.mjs` (`npm run usage:report`) | `ano_internal` schema revoked from `PUBLIC`/`anon`/`authenticated` & unexposed in PostgREST; zero HTTP read APIs; zero UI components; zero chat context exposure; boolean-only budget checks | **Implemented & verified** (migration `000024` registered, `phase10a` unit & isolation tests, `typecheck`, `check:migrations`, and `build` passed; `docs/ARCHITECTURE.md` synced). |
| **Phase 10B** | Multi-format product ingestion (URL, PDF, DOCX, TXT) & 2-question intake | Migration `20261124_000025` (`conversation_product_sources` + `research_briefs` intake columns); `src/server/ingestion/product-source-ingestor.ts` (`unpdf` + `mammoth` + SSRF-safe HTML fetch); `POST .../product-sources`; composer uploader/URL chips; streamlined 2-question `research-graph` intake | SSRF private-IP/redirect/size caps on URLs; magic-byte (`%PDF-`, `PK`) + 5 MB / 25-page limits; extracts normalized text only into Postgres; asks max 1 combined turn only for missing `businessLocation` + `targetMarkets`; skips plan-approval pause | **Implemented & verified** (migration `000025` registered, `phase10b` unit tests, `typecheck`, `check:migrations`, and `build` passed; `docs/ARCHITECTURE.md` synced). |
| **Phase 10C** | Checkpointed autonomous 6-stage pipeline engine | Migration `20261124_000026` (`autopilot_runs`); `src/server/domain/autopilot-orchestrator-service.ts`; `POST .../autopilot/{start,step,cancel}` (`vercel.json` `maxDuration: 300`); 3-way email waterfall + partial-failure degradation | Step-by-step checkpointing (1 stage per HTTP request) prevents Vercel serverless timeouts and page-refresh double-spend; Prospeo & Dropcontact calls checked against silent `check_internal_usage_budget` (`10A`); partial failures degrade cleanly without halting | **Implemented & verified** (migration `000026` registered, `phase10c` unit & resilience tests, `typecheck`, `check:migrations`, and `build` passed; `docs/ARCHITECTURE.md` synced). |
| **Phase 10D** | Calm chat-first UI & internalizing user-facing credit/charge copy | `<AutopilotProgressCard />`, `<ResultsJumpBar />`, client step driver in `research-conversation-workbench.tsx`; scrub credit/charge disclosures across 9 UI cards + chat prompt/notes; `Verified email` vs `Public website email` badges | Never surface `$0`, `1 cr/found`, `credit-bearing`, or API billing language to end users; keep manual confirmation buttons strictly for outbound external sends & Mercury CRM writes; jump bar opens Evidence/Company/People/Template drawers directly | **Implemented & verified** (`phase10d` UI & copy contract tests, 161/161 unit tests, `typecheck`, `check:migrations`, and `next build` passed; `docs/ARCHITECTURE.md` synced) |
| **Phase 10E** | Post-autopilot freeform reference chat & targeted partial re-runs | Grounded chat context receives product source + autopilot stage summaries; natural-language reference Q&A + downstream partial re-runs (`Stages 4–6`, `4–5`, or `6` only) under silent budgets | Read-only Q&A never mutates state; targeted re-runs execute autonomously without multi-click approval chains unless triggering outbound external send/CRM sync | **Implemented & verified** (`phase10e` chat grounding, negative telemetry leakage, Q&A & partial-rerun tests, 166/166 unit tests, `typecheck`, `check:migrations`, and `next build` passed; `docs/ARCHITECTURE.md` synced) |

#### Phase 10A — Operator-Only Internal API Usage Ledger & Silent Budget Guard

1. **Isolated Schema & Migration (`supabase/migrations/20261124_000024_internal_api_usage_ledger.sql`):**
   - Register migration in `scripts/apply-ano-schema.mjs` and `scripts/check-ano-schema.mjs`.
   - Create a private schema `ano_internal` and immediately lock down access:
     ```sql
     create schema if not exists ano_internal;
     revoke all on schema ano_internal from public, anon, authenticated;
     ```
     Because `ano_internal` is outside Supabase's exposed API schemas (`public`), PostgREST never exposes any route to it, and authenticated workspace clients have zero `SELECT`, `INSERT`, `UPDATE`, or `DELETE` privileges on its tables.
   - Create `ano_internal.api_usage_logs`:
     - `id` (`uuid primary key default gen_random_uuid()`), `created_at` (`timestamptz`), `workspace_id` (`uuid`), `conversation_id` (`uuid null`), `autopilot_run_id` (`uuid null`), `actor_id` (`uuid null`), `provider` (`'gemini' | 'bedrock' | 'ollama' | 'searxng' | 'prospeo' | 'dropcontact' | 'openstreetmap' | 'website_team' | 'product_ingest'`), `operation` (`text`), `model_or_endpoint` (`text`), `status` (`'success' | 'error' | 'timeout' | 'skipped_budget'`), `http_status` (`int null`), `request_count` (`int default 1`), `credits_used` (`numeric(10,4) default 0`), `credits_remaining` (`numeric(10,4) null`), `input_tokens` (`int null`), `output_tokens` (`int null`), `estimated_cost_usd` (`numeric(12,6) default 0`), `duration_ms` (`int null`), `metadata_json` (`jsonb default '{}'::jsonb`).
     - Indexes on `(created_at desc)` and `(provider, created_at desc)` plus `(workspace_id, provider, created_at desc)` for fast budget checks and operator queries.
     - **Zero secret or PII logging:** `metadata_json` stores structural diagnostics only (e.g. `batchSize`, `matchedCount`, `pagesFetched`, `errorCode`) — never API tokens, raw page HTML, emails, or person names.
2. **Write-Only & Boolean-Only `SECURITY DEFINER` RPCs (Minimal Trusted Surface):**
   - `public.record_internal_api_usage(...) returns void` (`SECURITY DEFINER`, `SET search_path = ''`): verifies `auth.uid()` is a member of `p_workspace_id` in `public.workspace_members` before inserting into `ano_internal.api_usage_logs`, returning `void` (zero read/return path).
   - `public.check_internal_usage_budget(p_workspace_id uuid, p_provider text, p_daily_limit numeric) returns boolean` (`SECURITY DEFINER`, `SET search_path = ''`): verifies workspace membership, checks whether today's cumulative `credits_used` / `request_count` is below `p_daily_limit`, and returns **only a `boolean`** — never returning counts, dollar figures, or remaining balances to runtime callers.
   - Note why RPCs beat placing `SUPABASE_SERVICE_ROLE_KEY` in Vercel: Ano's Vercel runtime stays strictly scoped to user-session RLS credentials with zero service-role blast radius while still guaranteeing users can never query the internal usage ledger.
3. **Unified Telemetry Helper & Provider Instrumentation (`src/server/telemetry/internal-api-usage.ts`):**
   - Expose non-throwing `logInternalApiUsage(session, entry)` (which logs even in demo mode in-memory/noop without throwing) and `isWithinInternalBudget(session, provider)` backed by env-configured silent daily ceilings (`ANO_INTERNAL_DAILY_PROSPEO_LIMIT`, `ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT`, `ANO_INTERNAL_DAILY_LLM_CALL_LIMIT`).
   - Instrument every outbound provider module:
     - `gemini-chat-model.ts` (capture `usageMetadata.promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`), `bedrock-runtime.ts`, and `ollama-chat-model.ts`.
     - `searxng-provider.ts` and `evidence-source-retriever.ts`.
     - `prospeo-client.ts` (`/search-company`, `/search-person`, `/bulk-enrich-person`, `/search-suggestions`), `dropcontact-client.ts` (`POST /batch` + `GET /batch/{id}` polling & `credits_left` snapshot), `osm-client.ts`, and `website-team-client.ts`.
4. **Operator-Only Review CLI (`scripts/report-api-usage.mjs` + `npm run usage:report`):**
   - Connects directly via local operator `SUPABASE_DB_URL` + `ANO_DATABASE_LABEL=ano` (already established as CLI-only DDL/admin credentials, never deployed in Vercel).
   - Supports `--days=7`, `--provider=all|prospeo|dropcontact|gemini|searxng`, `--workspace=<id>`, and `--json`, printing a per-provider rollup (`requests`, `errors`, `credits_used`, `latest_credits_remaining`, `input_tokens`, `output_tokens`, `estimated_cost_usd`).
   - **Hard Visibility Ban:** Never add a `/api/v1/usage` endpoint, never pass usage totals into client React props or `ConversationChatContext`, and never mention credit usage in assistant replies. Usage data is returned strictly when the operator invokes `npm run usage:report` or asks the operator-side coding agent to run it.

#### Phase 10B — Multi-Format Product Ingestion (URL, PDF, DOCX, TXT) & 2-Question Intake

1. **Migration (`supabase/migrations/20261124_000025_product_sources_and_intake.sql`):**
   - Create RLS-protected `public.conversation_product_sources` storing `id`, `workspace_id`, `conversation_id`, `source_type` (`'website_url' | 'pdf' | 'docx' | 'txt'`), `label` (filename or host), `source_url` (nullable), `mime_type`, `byte_size`, `content_sha256`, `extracted_text` (normalized excerpt capped at 20,000 chars), `summary_text`, `extraction_status` (`'ready' | 'failed'`), `error_message`, `created_at`.
   - Extend `public.research_briefs` with `business_location` (`text`), `target_markets_json` (`jsonb default '[]'::jsonb`), and `intake_complete` (`boolean default false`). Register migration in `scripts/apply-ano-schema.mjs` & `scripts/check-ano-schema.mjs`.
2. **Unified Server Extractor (`src/server/ingestion/product-source-ingestor.ts`):**
   - **Website URL (`website_url`):** Validates URL with existing SSRF protections (blocking localhost, RFC-1918/link-local/CGNAT IPs, non-80/443 ports, and unsafe redirects), fetches the main product page + up to 2 high-signal internal links (`/product`, `/features`, `/solutions`, `/about`, `/pricing`), extracts clean DOM-spaced visible text via Cheerio, and caps combined normalized text at 20,000 chars.
   - **PDF (`.pdf`):** Uses `unpdf` (`extractText`, zero native canvas/DOM dependencies so Vercel Turbopack builds cleanly) with `%PDF-` magic-byte check, max 5 MB upload, max 25 pages, and 20,000-char cap.
   - **Word (`.docx`):** Uses `mammoth` (`extractRawText`) with `PK` ZIP signature check and max 5 MB upload; cleanly rejects legacy binary `.doc` files with a clear message asking for `.docx` or `.pdf`.
   - **Plain Text / Markdown (`.txt`, `.md`):** Decodes UTF-8 directly (max 2 MB, 20,000-char cap).
   - Stores extracted text + SHA-256 directly in Postgres (no external Supabase Storage bucket setup required).
3. **API & Material 3 Composer UX (`product-sources/route.ts`, `conversation-composer.tsx`):**
   - `POST /api/v1/conversations/[conversationId]/product-sources` accepts either `multipart/form-data` (file upload) or JSON `{ url }`, runs extraction server-side, logs telemetry to `ano_internal`, and returns the saved `ProductSourceSummary` (never full raw dump if huge, plus preview snippet).
   - Add an attach button (`<md-icon-button>` calling hidden `<input type="file" accept=".pdf,.docx,.txt,.md" />`) inside `<ConversationComposer />`, automatic URL detection when the seller pastes a `https://...` product link into the composer (with one-click attach/auto-ingest), removable uploaded-source `<md-assist-chip>` tags above the input, and a friendly empty-state landing prompt inviting product link/file + description.
4. **Streamlined 2-Question Intake (`research-planning-model.ts`, `research-graph.ts`):**
   - When starting or resuming a conversation, concatenate user message text with persisted `conversation_product_sources.extracted_text` before calling Phase A interpretation (`interpretBrief`).
   - Summarize the product in 2–3 concise sentences and validate ONLY two intake fields:
     1. **`businessLocation`**: *"Where is your business located?"*
     2. **`targetMarkets`**: *"Where do you want to sell?"* (accepting named countries/regions OR *"recommend the best markets"*).
   - Ask at most **one combined clarification message** for whichever of those two answers is still missing (with clickable Material quick-reply chips such as `Recommend the best markets`).
   - Once both `businessLocation` and `targetMarkets` are populated (`intake_complete = true`), skip the manual `await_plan_approval` pause on `research-graph` when running in autopilot mode and immediately launch Phase 10C.

#### Phase 10C — Checkpointed Autonomous Pipeline Engine (`autopilot_runs`)

1. **Why Checkpointed Stepping Instead of One Monolithic Request:**
   - Even with Vercel `maxDuration: 300`, running LLM brief/plan synthesis + SearXNG multi-wave research + Phase C synthesis + Prospeo/OSM discovery + website crawling + Prospeo enrichment + async Dropcontact polling + template LLM generation in one single HTTP call risks timeout spikes, blank spinners, and duplicate API charges on network drops.
   - Instead, **one stage executes per `POST /api/v1/conversations/[conversationId]/autopilot/step` call** (~5–45s each, with `maxDuration: 300` headroom on `vercel.json`), persists atomic checkpoints in Postgres, updates `<AutopilotProgressCard />` live in the UI, and resumes cleanly after any refresh without re-running completed stages or double-charging credits.
2. **Migration (`supabase/migrations/20261124_000026_autopilot_runs.sql`):**
   - Create RLS-protected `public.autopilot_runs` with `id`, `workspace_id`, `conversation_id`, `status` (`'idle' | 'running' | 'paused' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled'`), `current_stage` (`'brief_and_plan' | 'market_research' | 'synthesis_and_lock' | 'company_discovery' | 'people_and_emails' | 'outreach_templates' | 'done'`), `completed_stages_json`, `stage_summaries_json`, `last_error`, `heartbeat_at`, `started_at`, `completed_at`, `created_at`, `updated_at`. Register migration in `apply-ano-schema.mjs` & `check-ano-schema.mjs`.
3. **Autonomous 6-Stage State Machine (`src/server/domain/autopilot-orchestrator-service.ts`):**
   - **`Stage 1 — brief_and_plan`:** Combines ingested product source(s) + 2-question intake into a grounded `research_briefs` + auto-approved `research_plans` v1 (`plan_approval_mode = 'autopilot'`).
   - **`Stage 2 — market_research`:** Runs bounded SearXNG evidence waves focused on buyer pain, segment demand, and competitor/adoption signals in the business location & target selling market(s) (autopilot budget: max 3 waves / 15 searches / 20 safe page fetches). If SearXNG is unconfigured or returns partial failures, records a safe warning and falls back to product-source + LLM synthesis instead of crashing.
   - **`Stage 3 — synthesis_and_lock`:** Runs citation-bound Phase C synthesis over saved sources/product docs, scores candidate segments, and **deterministically auto-locks** the top market + industry (`target_decisions`): honoring the user's explicit target market when given, or selecting #1 ranked evidence market when `"recommend for me"` was chosen.
   - **`Stage 4 — company_discovery`:** Selects Prospeo (`/search-company`) or OpenStreetMap (+ bounded website resolution) based on the locked industry's local vs. corporate B2B profile, executes discovery, and **auto-shortlists top 10 highest-ICP-fit companies** (giving priority boost to accounts with live websites/domains so email acquisition succeeds at high rates).
   - **`Stage 5 — people_and_emails` (Deterministic 3-Way Email Waterfall under Silent Budget Guardrails):**
     - Derives product-aware Buying Committee criteria from the locked segment and shortlisted company archetype.
     - **Tier 1 (Company Websites):** Runs `website_team` + DOM-spaced `sanitizePublicEmail` across the 10 shortlisted accounts first to capture named leaders, direct personal emails (`direct_public`), shared clinic/office inboxes (`shared_inbox`), and phone numbers.
     - **Tier 2 (Prospeo Discovery & Selective Enrich):** Checks `isWithinInternalBudget(session, "prospeo")`. If contacts with usable emails remain below target (or key accounts lack named decision-makers), runs 1-page Prospeo `/search-person` across shortlisted companies and verifies up to 10 unverified priority decision-makers via `/bulk-enrich-person` (strictly `1` batch, max `10` contacts).
     - **Tier 3 (Dropcontact Async Fallback):** Checks `isWithinInternalBudget(session, "dropcontact")` & connector readiness. Submits remaining unverified high-priority contacts (max `10`) to async `POST /batch` → `GET /batch/{request_id}` (polling cleanly without ever re-POSTing `/batch`), followed by website contact backfill on any remaining misses.
     - Records compact public counts per tier in `stage_summaries_json` (without exposing billing/credit counts) and detailed cost/credit rows in `ano_internal.api_usage_logs`.
   - **`Stage 6 — outreach_templates`:** Runs Phase 9B template generation (`outreach_template_model`) enforcing anti-AI human-voice checks (60/50/30 word caps, lowercase subjects, zero dashes/exclamation marks/clichés, bounded 1 rewrite pass), readies the Phase 9C CSV export pack, posts a clean **Executive Summary** assistant message summarizing the locked market, shortlisted accounts, email yield (`verified` vs `public website`), and ready template sequence, and marks `autopilot_runs.status = 'completed'`.
4. **Concurrency, Lease Guard & Recovery:**
   - `POST .../autopilot/step` acquires an atomic DB lease (`heartbeat_at`, `running`) matching `src/server/jobs/recover-stale-runs.ts` so double-clicks or StrictMode effects never execute the same stage twice.
   - Non-fatal failures inside Stages 2, 4, or 5 degrade gracefully to the next source/stage and transition cleanly to `completed_with_warnings` rather than dead-ending the user.

#### Phase 10D — Calm Chat-First UI Overhaul & Internalizing Credit/Charge Copy

1. **Unified Progress & Jump Navigation Components:**
   - `<AutopilotProgressCard />`: Renders a single calm Material 3 stepper card in the thread while `status === 'running'` (`1. Analyzing product & location` → `2. Market research` → `3. Target market & segment` → `4. Matching companies` → `5. Finding decision-makers & emails` → `6. Drafting email templates`), showing real-time stage summaries, `<md-linear-progress>`, and a **Pause** / **Resume** control (`/autopilot/cancel` and `/autopilot/step`).
   - `<ResultsJumpBar />`: Compact sticky/inline Material chip bar rendered cleanly after Stages 3–6 produce artifacts:
     - **Market & Evidence** (opens Evidence Drawer / `ContextRail`)
     - **Companies (N)** (opens `<CompanyCohortArtifactDrawer />`)
     - **People & Emails (N)** (opens `<PeopleCohortArtifactDrawer />`)
     - **Email Templates** (opens `<OutreachTemplateDrawer />`)
     - **Download Leads CSV** (direct RFC-4180 formula-safe Phase 9C download)
   - Wire a sequential client stepper loop inside `src/components/research-conversation-workbench.tsx`: as soon as `POST .../autopilot/start` returns `running`, the client loops `await fetch(.../autopilot/step)` sequentially until `status` leaves `running` (pausing cleanly if the user navigates away or clicks Pause, and auto-resuming cleanly if revisited while `running`).
2. **De-Cluttering the Thread & Scrubbing Credit/Charge Copy:**
   - Replace intermediate multi-button preview/approval cards during autopilot runs with `<AutopilotProgressCard />` + `<ResultsJumpBar />` + one concise Executive Summary message (keeping the full interactive Cohort, People, Playbook, and Template drawers 1 click away!).
   - Clean up user-facing billing, credit, and charge language across **all 9 UI files** + backend chat/note strings:
     - `src/components/artifacts/company-search-preview-card.tsx`
     - `src/components/artifacts/people-discovery-card.tsx`
     - `src/components/artifacts/contact-verification-card.tsx`
     - `src/components/artifacts/outreach-template-pack-card.tsx`
     - `src/components/artifacts/provider-scope-card.tsx`
     - `src/components/artifacts/target-decision-card.tsx`
     - `src/components/artifacts/people-cohort-artifact-drawer.tsx`
     - `src/components/conversation/conversation-thread.tsx`
     - `src/components/conversation/conversation-composer.tsx`
     - Plus server chat prompt/note strings in `conversation-chat-model.ts` and `research-conversation-service.ts`.
   - Replace copy like `1 cr/found`, `$0 credits`, `credit-bearing lookup`, `no auto-retry after credit spend`, and `Dropcontact vs Prospeo credit estimate` with clear capability and data-provenance labels (`Verified work email` vs `Public website email`, `Discover companies`, `Find & verify emails`, `Generate sequences`).
   - Keep explicit human confirmation **only** on `<OutreachDraftCard />` (`Send email` / `Push proposal to Mercury`), where external side effects affect real recipients or external CRMs.

#### Phase 10E — Post-Autopilot Freeform Reference Chat & Targeted Partial Re-Runs

1. **Rich Grounded Context (`conversation-chat-model.ts`, `research-conversation-service.ts`):**
   - Pass ingested product source summaries and completed `autopilot_runs.stage_summaries_json` (excluding all internal credit/token/cost telemetry!) into `ConversationChatContext` so once autopilot finishes, the user can jump into chat naturally:
     - *"Why did you pick dental clinics in Malaysia?"* → cites saved Phase C claims & product source fit.
     - *"Show me the emails and phone numbers for SmileBay Dental"* → pulls verified & public rows directly.
     - *"Which 3 contacts should I prioritize first?"* → ranks `direct` / `verified` decision-makers by role & fit.
2. **Autonomous Targeted Re-Runs via Chat:**
   - Enable follow-up directives in chat to re-run **only the affected downstream autopilot stages** without forcing manual approval buttons:
     - Geography or keyword change (*"also include Singapore"*, *"switch to Selangor clinics only"*) → updates scope and automatically executes Stages `4 → 5 → 6`.
     - More leads or role shift (*"find 10 more companies"* or *"target Practice Managers instead"*) → updates shortlist/criteria and executes Stages `4 → 5` (or `5` only).
     - Email enrichment boost (*"run another verification pass on the unverified contacts"*) → runs next waterfall tier under silent `check_internal_usage_budget`.
     - Copy change (*"make Email 1 shorter and use a soft question CTA"*) → re-runs Stage `6` (`outreach_templates`) only.
3. **Final Architecture Sync:**
   - Update `docs/ARCHITECTURE.md` with migrations `000024`–`000026`, `ano_internal` operator isolation, multi-format product ingestion, checkpointed autopilot routes, and the 3-way waterfall policy.

### Target end-state architecture (Post-Phase 10)

#### Before vs. After User Experience

| Dimension | Current (Phases 0–9) | Post-Phase 10 End State |
| --- | --- | --- |
| **Product Input** | Manual typed prompt only | Drop a **website URL, `.pdf`, `.docx`, or `.txt`/`.md`**, or type your offer |
| **Intake Questions** | Clarifying Q&A + explicit Plan approval click + Market/Industry manual lock | Max **1 combined intake prompt** asking only **business location** & **where to sell** |
| **Execution Flow** | ~7–9 separate manual approve/preview/run clicks across Phases A–9B | **1 autonomous checkpointed pipeline** runs Research → Market Lock → Top Companies → 3-Way Emails → Templates |
| **Pricing & Credits** | Mentioned across 9 UI cards, composer helper text, and chat notes (`$0 credits`, `1 cr/found`) | **Hidden from end users**; server enforces silent daily budgets and logs telemetry strictly to `ano_internal` |
| **Navigation & Review** | Scroll past sequential preview/approval cards | Unified `<AutopilotProgressCard />` + **Jump Bar** (`Evidence`, `Companies`, `People & Emails`, `Templates`, `CSV Export`) + freeform Q&A & partial re-runs |
| **API Usage Audit** | Scattered in `provider_receipt_json` without token/LLM cost rollup | Unified private `ano_internal.api_usage_logs` queried strictly on demand via operator CLI (`npm run usage:report`) |

#### End-to-End Architecture Diagram (Post-Phase 10)

```text
+---------------------------------------------------------------------------------------------------+
| BROWSER CLIENT (Next.js 16 + React 19 + Material Web 2.4.1 M3 — ZERO Credit/Usage UI)            |
|  - ConversationComposer: URL auto-detect + .pdf / .docx / .txt uploader + location/market chips   |
|  - AutopilotProgressCard: 6-stage stepper with live stage summaries + Pause / Resume              |
|  - ResultsJumpBar: 1-click drawers (Evidence, Companies, People & Emails, Templates, CSV Export)  |
|  - Freeform Reference & Steering Chat + ApprovalCard (ONLY for Outbound Sends / Mercury Writes)  |
+-------------------------------------------------+-------------------------------------------------+
                                                  | Authenticated Cookie Session + Idempotency-Key
                                                  v
+---------------------------------------------------------------------------------------------------+
| NEXT.JS 16 SERVER & DOMAIN LAYER (Vercel Serverless, maxDuration up to 300s)                      |
|                                                                                                   |
|  1. Ingestion & Intake (/api/v1/conversations/:id/product-sources + research-graph)               |
|     - product-source-ingestor.ts: SSRF-safe URL crawl | unpdf (.pdf) | mammoth (.docx) | UTF-8     |
|     - Extracts normalized text -> public.conversation_product_sources (max 20k chars + SHA-256)   |
|     - Captures 2 intake fields: business_location + target_markets -> auto-approves plan v1       |
|                                                                                                   |
|  2. Checkpointed Autopilot Engine (/api/v1/conversations/:id/autopilot/{start,step,cancel})       |
|     - One durable stage per HTTP /step call (atomic lease lock on public.autopilot_runs):         |
|       [Stage 1: brief_and_plan] -> [Stage 2: market_research (SearXNG)] ->                        |
|       [Stage 3: synthesis_and_lock] -> [Stage 4: company_discovery (Prospeo / OSM)] ->            |
|       [Stage 5: people_and_emails (3-Way Waterfall)] -> [Stage 6: outreach_templates (9B/9C)]     |
|                                                                                                   |
|  3. Post-Autopilot Chat & Partial Re-Run Router (/api/v1/conversations/:id/messages)              |
|     - Grounded Q&A over product sources + stage summaries + targeted re-runs (4-6 / 4-5 / 6 only) |
+--------------------------+-----------------------------------------------+------------------------+
                           | Provider Calls                                | Usage + Budget Guard
                           v                                               v
+----------------------------------------------------+   +------------------------------------------+
| EXTERNAL & CRAWLED PROVIDERS (Server-Only Secrets) |   | SILENT INTERNAL TELEMETRY & BUDGETS      |
|  - LLMs: Gemini (Flash-Lite) / Bedrock / Ollama    |   |  - internal-api-usage.ts                 |
|  - Research: Private SearXNG Gateway + Safe Fetch  |   |  - Checks boolean-only daily caps via    |
|  - Company Discovery: Prospeo / OpenStreetMap      |   |    check_internal_usage_budget()         |
|  - Stage 5 3-Way Email Waterfall:                  |   |  - Writes request/token/credit/USD row   |
|     Tier 1: Company Websites (website_team +       |   |    via write-only SECURITY DEFINER RPC   |
|             sanitizePublicEmail DOM-spaced parser) |   |    record_internal_api_usage()           |
|     Tier 2: Prospeo (/search-person +              |   +--------------------+---------------------+
|             /bulk-enrich-person, max 10)           |                        | Write-Only (No Select)
|     Tier 3: Dropcontact (async POST /batch ->      |                        v
|             poll GET /batch/:id, max 10)           |   +------------------------------------------+
+--------------------------+-------------------------+   | PRIVATE OPERATOR SCHEMA (`ano_internal`) |
                           |                             |  - Table: ano_internal.api_usage_logs    |
                           v                             |  - REVOKE ALL from anon & authenticated  |
+----------------------------------------------------+   |  - NOT exposed by Supabase PostgREST     |
| WORKSPACE-SCOPED RLS DATA (`public.*` + LangGraph) |   |  - Zero HTTP APIs & zero UI routes       |
|  - research_briefs, research_sources, syntheses    |   |                                          |
|  - account_candidates, contact_candidates, playbks |   |  Read exclusively on operator demand:    |
|  - outreach_template_packs, autopilot_runs         |   |  -> `scripts/report-api-usage.mjs`       |
|  - product_sources, audit_logs (immutable exports) |   |     (`npm run usage:report`)             |
+----------------------------------------------------+   |     via local `SUPABASE_DB_URL` only     |
                                                         +------------------------------------------+
```

#### Data & Security Trust-Boundary Matrix

| Data / Capability | End User (`authenticated` / Browser UI / Chat LLM) | Operator CLI (`npm run usage:report` via local `SUPABASE_DB_URL`) |
| --- | --- | --- |
| Product links, PDFs, DOCX, TXT (`conversation_product_sources`) | Read/Write within own workspace (RLS) | Admin schema access only |
| Market evidence, shortlisted companies, contacts, templates, CSVs | Full read/export + partial chat re-runs within own workspace | Inspectable for debugging |
| Email provenance (`Verified work email` vs `Public website email`) | Visible honestly on leads and CSVs | Visible |
| Internal API usage, tokens, credits left, USD costs (`ano_internal.api_usage_logs`) | **Strictly invisible** (schema revoked, no HTTP route, write-only RPC, absent from chat context) | **Full query access** on operator request by provider/date/workspace |
| Daily spend limits (`check_internal_usage_budget`) | **Silent boolean guard** on server; gracefully skips or degrades tier without showing credit math | Configurable via server env limits |
| Outbound email sending / Mercury CRM sync | **Requires explicit `ApprovalCard` confirmation** | Audited in `audit_logs` & `approval_decisions` |

#### Phase 10 Verification & Security Acceptance Gate

1. **Negative Leakage Verification:** Integration test proves an `authenticated` Supabase JWT receives `permission denied` if attempting to query `ano_internal.api_usage_logs`, zero `/api/v1/*` handlers return token/credit/USD usage fields, and grep/render checks confirm user-facing components contain zero internal credit/billing copy.
2. **Format & Pipeline Resiliency Verification:** Offline unit tests validate PDF, DOCX, TXT, and SSRF-safe URL ingestion; 2-question intake; sequential 6-stage `autopilot/step` lease & idempotency; 3-way waterfall (`website_team` → `prospeo` → `dropcontact`); and graceful continuation on partial provider outages.
3. **Full Build Gate:** After every Phase 10 sub-phase, run `npm run check:migrations && npm run typecheck && npm test && npm run build` cleanly before syncing `docs/ARCHITECTURE.md`.

### Phase 11 — Accounts, Onboarding, Multi-Workspace Switching, Admin Invite Links & Friendly Chat Naming

| Sub-Phase | Goal | Key Scope & Migrations | Safety & Isolation Rules | Status & Acceptance |
| --- | --- | --- | --- | --- |
| **Phase 11A (Part 1)** | Self-serve Sign-Up, Guided Onboarding & Top-Right Workspace Switcher | `/signup` (`SignUpForm`), upgraded `/login` (Password default + Forgot password + `/signup` links), `/auth/callback` (PKCE `code` & OTP `token_hash`), auto `/onboarding` redirect (`WORKSPACE_REQUIRED`), multi-workspace `requireWorkspaceSession()` + `POST /api/v1/workspace/switch` (`ano_active_workspace_id` HttpOnly cookie), top-right `<WorkspaceSwitcher />`, Settings membership view & Sign out | Validates inputs safely, blocks open redirects (`safeRedirectPath`), never activates a workspace not in the authenticated user's verified memberships | **Implemented & verified** (`phase11a` tests, `172/172` tests, `typecheck`, and `next build` passed) |
| **Phase 11B (Part 2)** | Admin-only Workspace Joining via Invite Links & Automatic Personal Workspace | Migration `20261124_000027_workspace_invite_links.sql` (`workspace_invites`, `is_ano_workspace_admin`, `ensure_personal_ano_workspace`, `preview_workspace_invite`, `accept_workspace_invite`); `src/lib/ano/workspace-invites.ts`; `src/server/domain/workspace-invite-service.ts`; `GET/POST /api/v1/workspace/invites`; `DELETE /api/v1/workspace/invites/[inviteId]`; `GET/POST /api/v1/invites/[token]{/accept}`; `/invite/[token]` (`InviteAcceptCard`); Settings Admin Invite Links UI | Plaintext invite tokens are shown once at mint time and never stored (SHA-256 `token_hash` only); RLS & RPCs restrict invite creation/revocation strictly to `owner`/`admin`; `accept_workspace_invite` locks `FOR UPDATE`, prevents privilege escalation to `owner`, and automatically ensures a personal owned workspace | **Implemented & verified** (migration `000027` registered, `phase11b` unit & SQL tests, `176/176` tests, `typecheck`, `check:migrations`, and `next build` passed; `docs/ARCHITECTURE.md` synced) |
| **Phase 11C (Part 3)** | Automatic User-Friendly Chat Naming & Existing Chat Backfill | Pure title engine `src/lib/ano/conversation-title.ts` (`buildFriendlyConversationTitle()`, `needsFriendlyTitleRefresh()`) formatting `"<Product / Offer> — <Target Market>"` on creation (`startResearchConversation`), Phase A intake sync (`syncResearchGraphSnapshot`), and Phase C/Stage 3 target lock (`lockMarketRouteForConversation`); idempotent `backfillFriendlyConversationTitles()` run automatically on initial sidebar fetch (`GET /api/v1/conversations`) and via `POST /api/v1/conversations/auto-rename` | Strictly honors explicit manual user renames (`conversation_renamed` in `audit_logs`); strips raw URLs, attachment filenames/wrappers, and filler prefixes cleanly; preserves `updated_at` order during backfill; never uses seller home `businessLocation` as target market | **Implemented & verified** (`phase11c` unit & persistence tests, `181/181` tests, `test:phase4b` `3/3`, `typecheck`, `check:migrations` `27`, and `next build` passed; `docs/ARCHITECTURE.md` synced) |

### Phase 12 — Live LLM Resilience, White-Label UI & Pure Material Web 3 Standardization

> [!NOTE]
> **Phases 12A–12D** are **implemented & verified**. Public homepage (`/`), full backend vendor masking, pure Material Web 3 standardization, and automated release gates are complete.

| Sub-Phase | Goal | Key Scope & Target Files | Safety, Masking & UX Rules | Status & Acceptance |
| --- | --- | --- | --- | --- |
| **Phase 12A** | Production LLM Failover, Backoff & Clean Error Recovery | `src/server/agents/bedrock.ts`, `src/server/agents/bedrock-contracts.ts`, `src/server/agents/gemini-chat-model.ts`, `src/server/agents/ollama-chat-model.ts`, `src/server/agents/research-planning-model.ts`, `src/server/agents/market-synthesis-model.ts`, `src/server/agents/iterative-research-planner.ts`, `src/lib/ano/research-conversation.ts`, `src/server/domain/research-conversation-service.ts`, `src/server/persistence/research-conversation-store.ts`, `src/components/conversation/conversation-thread.tsx`, `src/components/research-conversation-workbench.tsx` | Ordered multi-model fallback chain (`GEMINI_MODEL` primary + `GEMINI_FALLBACK_MODELS` defaulting to `gemini-3.1-flash-lite` -> `gemini-3.6-flash` -> `gemini-2.5-flash-lite`, plus optional Bedrock failover via `ANO_FALLBACK_AGENT_MODE=bedrock`); jittered exponential backoff before failing over to the next candidate model (recomputing `resolveGeminiThinkingConfig` per model) and a 60s in-memory congestion cooldown circuit breaker; deduplicated single alert banner in `conversation-thread.tsx` with one-click **Retry** (`kind: "retry"` clearing `failure_message` cleanly); sanitized user-facing error copy (`sanitizeLlmErrorForUser` & `formatDisplayErrorMessage`) while retaining redacted diagnostics in server logs & `ano_internal.api_usage_logs`. *(Production note: enable Paid Tier billing on Google AI Studio in Vercel env vars for optimal stability.)* | **Implemented & verified** (`phase12a` & `gemini-provider` tests, `185/185` tests, `test:phase4b` `3/3`, `typecheck`, `check:migrations` `27`, and `next build` passed; `docs/ARCHITECTURE.md` synced) |
| **Phase 12B** | Full Backend Vendor Masking (Zero Stack Disclosure) | `src/app/(app)/{settings,companies,people}/page.tsx`, `src/app/api/v1/{connectors/prospeo/check,conversations/[conversationId]/{company-search,people-discovery,outreach}}/route.ts`, `src/components/{login-form,signup-form,workspace-onboarding-form,research-conversation-workbench}.tsx`, `src/components/shell/{app-shell,context-rail}.tsx`, `src/components/work/review-queue.tsx`, `src/components/conversation/conversation-thread.tsx`, `src/components/artifacts/*.tsx`, `src/lib/ano/{research-conversation,lead-export,work-queue,company-discovery,people-playbooks,outreach-execution}.ts`, `src/server/domain/{research-conversation-service,target-account-discovery-service,people-playbook-service}.ts`, `src/server/connectors/{prospeo,dropcontact,openstreetmap}/*`, `src/server/research/searxng-provider.ts`, `src/server/persistence/{target-account-discovery-store,people-playbook-store}.ts`, `src/server/agents/conversation-chat-model.ts`, `tests/phase12b-vendor-masking.test.ts` | Removed user-facing mentions of backend vendors, engines, and env vars (`Prospeo`, `Dropcontact`, `Mercury`, `SearXNG`, `Tavily`, `OpenStreetMap`, `OSM`, `Nominatim`, `Overpass`, `Google AI Studio`, `Gemini`, `Bedrock`, `Ollama`, `LangGraph`, `Supabase`, `PROSPEO_KEY`, `DROPCONTACT_API_KEY`, `SEARXNG_*`, `ANO_AGENT_MODE`, `OVERPASS_API_URL`) across UI pages, components, drawers, auth forms, work-queue labels, API fallback errors, server services/connectors, CSV export (`verified_work_email`), and chat replies (`WHITE-LABEL OUTPUT RULE` + `maskVendorNamesForDisplay()`); removed `/settings` `"Provider & safety boundaries"` card, `ContextRail` `"Outreach & Mercury"` / `"Provider budget"` cards, raw filter JSON dumps, and `"Propose Mercury draft"` UI button; unified verification buttons while keeping `"Verified work email"` vs `"Public website email"` honest; verified `check:migrations` (`27`), `typecheck` (0 errors), `test:phase4b` (3/3), `npm test` (190/190 including `phase12b-vendor-masking.test.ts` static zero-leak guard), and `next build` exit `0` | **Implemented & verified** |
| **Phase 12C** | Clean Public-Facing Redesign & Pure Material Web 3 Standardization (Zero Custom UI CSS, Single M3 Font/Typescale, Native-to-M3 Controls, Remove Budgets/Phases/Footnotes) | `src/app/layout.tsx`, `src/app/globals.css`, `src/styles/{material-theme,shell,conversation,artifacts}.css`, `src/components/material/{register.ts,types.d.ts,material-button.tsx,material-input-chip.tsx}`, `src/app/(app)/{settings,library,companies,people,playbook}/page.tsx`, `src/components/shell/{app-sidebar,workspace-switcher,context-rail}.tsx`, `src/components/{login-form,workspace-onboarding-form}.tsx`, `src/components/conversation/conversation-composer.tsx`, `src/components/artifacts/*.tsx`, `tests/phase12c-material3-and-clean-ui.test.ts` | **1. Pure Material Web 3 (`@material/web`) Standardization:** Loaded self-hosted `Roboto` (`400`, `500`, `700`) via `next/font/google` in `src/app/layout.tsx`, imported `@material/web/typography/md-typescale-styles.css`, and bound `--md-ref-typeface-brand` & `--md-ref-typeface-plain` (removing `"Inter"` and `button/input/textarea/select { font: inherit; }`); deleted boxy `8px` button radius overrides in `material-theme.css` so M3 buttons render with full-pill corners; registered `elevated-button.js`, `divider.js`, `elevation.js`, and `chips/input-chip.js` with `MaterialButton` (`"elevated"`) and React-safe `MaterialInputChip`; replaced all 17 remaining raw HTML controls (`settings/page.tsx` 3x `<md-outlined-select>`, `outreach-template-drawer.tsx` `<MaterialTextField type="textarea">` + `<md-chip-set>`/`<md-assist-chip>` + `<md-outlined-select>`, `company-cohort-artifact-drawer.tsx` 3x `<MaterialButton>`, `workspace-switcher.tsx` `<md-menu>`/`<md-menu-item>`/`<md-divider>`, `app-sidebar.tsx` + `login-form.tsx` + `workspace-onboarding-form.tsx` `<MaterialButton>`, and `conversation-composer.tsx` `<md-chip-set>` + `<MaterialInputChip>`, retaining only the hidden `<input type="file" hidden>` picker); rewrote `src/styles/*.css` to pure `--md-sys-*` tokens & layout rules with zero hardcoded px `font-size`s, zero `box-shadow`s, zero dead selectors, and zero Tailwind CSS. **2. Public Copy & Layout Simplification:** Replaced internal `PHASE A–F` / `PHASE 9B/9C` / `STAGE A/B` / `ARTIFACT ·` / `CONTEXT RAIL` kickers with plain product labels; removed search/fetch/result/batch ceilings and engineering/safety footnotes; slimmed `ContextRail` to 4 M3 cards (**Brief & scope**, **Progress summary**, **Saved sources**, **Recent activity**); verified `check:migrations` (`27`), `typecheck` (0 errors), `test:phase4b` (`3/3`), `npm test` (`195/195` incl. `phase12c-material3-and-clean-ui.test.ts`), and `next build` exit `0`; `docs/ARCHITECTURE.md` synced. | **Implemented & verified** |
| **Phase 12D** | Automated White-Label, Material Web 3 Purity, Failover Release Gate & Calm Public Homepage | `tests/phase12a-llm-resilience.test.ts`, `tests/phase12b-vendor-masking.test.ts`, `tests/phase12c-material3-and-clean-ui.test.ts`, `tests/phase12d-release-gate.test.ts`, `package.json` (`test:phase12`), `src/app/page.tsx`, `src/app/layout.tsx`, `src/components/home/landing-home.tsx`, `src/styles/home.css`, `src/components/signup-form.tsx`, `src/server/auth/workspace-session.ts`, `src/server/domain/workspace-invite-service.ts` | Replaced the root `/` redirect to `/research` with a grounded, calm public homepage (`LandingHome` + `src/styles/home.css`) built strictly with Material Web 3 tokens and components (`Roboto` typescale, `MaterialButton`, `MaterialIconButton`, `<md-tabs>`, `<md-primary-tab>`, `<md-divider>`, interactive 4-tab sample workspace preview, light/dark theme toggle, and session-aware CTAs without AI-slop copy or visuals); scrubbed remaining user-facing `"Supabase"` messages in `workspace-session.ts` and `workspace-invite-service.ts`; added unified release gate suite `tests/phase12d-release-gate.test.ts` + `npm run test:phase12` enforcing zero vendor/noise copy across all TSX + `/api/v1` + auth boundaries, white-labeled CSV export & masking, Gemini 503/429 failover + cooldowns, full M3 purity, and anti-AI-slop rules on `/`; verified `check:migrations` (`27`), `typecheck` (`0` errors), `test:phase4b` (`3/3`), `test:phase12` (`20/20`), `npm test` (`201/201`), and `next build` exit `0` (`○ /` static); `docs/ARCHITECTURE.md` synced. | **Implemented & verified** |

#### Phase 12 Public-Facing Copy Mapping & Redesign Blueprint

| Internal / Exposed Term | Public-Facing White-Label Replacement |
| --- | --- |
| `Google AI Studio` / `Gemini` / `Bedrock` / `Ollama` / `LangGraph` | **Ano** / **Ano AI** *(error copy: "Ano is experiencing brief high demand — please retry in a moment.")* |
| `Private SearXNG` / `Tavily` | **Market Research** / **Public Web Research** |
| `OpenStreetMap` / `Nominatim` / `Overpass` | **Local Business Search** |
| `Prospeo` (Company / People Search) | **B2B Company Search** / **Decision-Maker Search** |
| `Prospeo Verify` / `Dropcontact` / `prospeo_verified` / `dropcontact_verified` | **Work Email Verification** / `verified_work_email` in CSV `email_source` |
| `Mercury` / `Mercury proposals` / `Outreach & Mercury` | Hidden from UI & context rail until public CRM integrations ship |
| `Phase A–F`, `Phase 9B/9C`, `Stage A/B` | Plain product stages (`Research Plan`, `Market Research`, `Recommendation`, `Companies`, `Decision-Makers`, `Email Verification`, `Outreach Templates`, `Export`) |
| `Provider budget`, `Planned ceiling`, `Search ceiling`, `Fetch ceiling`, `1-page (max 25)`, `Batch limit: Up to 10` | Removed from UI |

**Screen-by-Screen Redesign Summary:**

1. **Settings (`/settings`):** Remove the developer-facing `"Provider & safety boundaries"` card (`Google AI Studio`, `SearXNG`, `OpenStreetMap`, `Prospeo/Dropcontact`, `Mercury`, `ANO_AGENT_MODE`, done in Phase 12B); converted the 3 native `<select>` controls to `<md-outlined-select>` + `<md-select-option>` in Phase 12C. Keep only **Workspace Identity**, **Workspaces**, **Team Invite Links**, and **Account**.
2. **Main Chat & Autopilot Thread:** Clean product headers and one consolidated status/retry alert if generation pauses temporarily (no duplicate `failed_safe` + `error` banners, no model IDs or HTTP codes, no engineering footnotes under cards or dialogs). Unified **Verify emails** action, `<md-outlined-text-field type="textarea">` composer, and `<md-chip-set>` + `<MaterialInputChip>` attachment chips replacing native attachment chip buttons in `conversation-composer.tsx`.
3. **Right-Hand Context Rail:** Slimmed down to 4 clear M3 cards using `<md-divider>` and `.md-typescale-*` hierarchy: **Brief & scope**, **Progress summary**, **Saved sources**, and **Recent activity** (`Provider budget` & `Outreach & Mercury` removed in 12B; technical diagnostics/ceilings removed in 12C).
4. **Companies, People, Work, Auth & Drawers + CSV Exports:** Replaced all remaining native `<button>`/`<select>`/`<textarea>` controls across `workspace-switcher.tsx` (`<md-menu>`), `app-sidebar.tsx`, `login-form.tsx`, `workspace-onboarding-form.tsx`, `company-cohort-artifact-drawer.tsx`, and `outreach-template-drawer.tsx` with pure `@material/web` controls; replaced all phase labels and technical footnotes with plain-English buyer/research descriptions (`Verified work email`, `Public website email`, `verified_work_email` in CSV `email_source`).
5. **Pure Material Web 3 Design System & CSS Reset:** Standardized typography on self-hosted `next/font/google` `Roboto` (`400`, `500`, `700`) imported alongside `@material/web/typography/md-typescale-styles.css` in `src/app/layout.tsx` (fixing the unloaded `"Inter"` fallback mismatch between light DOM and Shadow DOM); removed boxy `8px` button radius overrides in `material-theme.css` so M3 buttons render with authentic Material 3 pill geometry, state layers, and registered `<md-elevation>`; stripped bespoke CSS chrome across `material-theme.css`, `shell.css`, `conversation.css`, and `artifacts.css` to M3 tokens + structural Grid/Flex layout using `--md-sys-*` tokens only; maintained **zero Tailwind CSS** across dependencies and stylesheets.

**Material 3 Standardization Checklist (Phase 12C Verification Targets):**
- [x] **Font & Typescale:** `Roboto` (`400/500/700`) loaded via `next/font/google` in `src/app/layout.tsx`, wired to `--md-ref-typeface-brand` & `--md-ref-typeface-plain`, with `@material/web/typography/md-typescale-styles.css` applied across UI copy.
- [x] **M3 Button & Surface Authenticity:** Removed custom `--md-*-button-container-shape: var(--md-sys-shape-corner-small)` overrides; registered `<md-elevation>`, `<md-elevated-button>`, `<md-input-chip>`, and `<md-divider>`, and applied `<md-divider>` in `workspace-switcher.tsx` & `context-rail.tsx`.
- [x] **Zero Raw Native Controls:** All remaining non-file HTML `<button>`, `<select>`, and `<textarea>` elements converted to `@material/web` elements (`MaterialButton`, `MaterialInputChip`, `<md-outlined-select>`, `<md-outlined-text-field type="textarea">`, `<md-menu>`/`<md-menu-item>`, `<md-assist-chip>`).
- [x] **CSS Trim & Zero Tailwind:** Custom pixel font sizes, custom `box-shadow`s, dead selectors, and `--ano-color-shell*` / `--ano-elevation-card` tokens removed from `src/styles/*.css` and `src/app/globals.css` (leaving M3 tokens + structural Grid/Flex layout only), with zero Tailwind dependencies or directives anywhere in the repo.

### Phase 13 — Deep-Research Remediation Programme (Phases 13A–13G)

> [!IMPORTANT]
> **Standalone Scope & Phase-Gated Execution Rule:**
> Ano remains a standalone product using Next.js **Turbopack only** with **no broad UI changes**.
> The target product flow: the user gives Ano a short description of what they sell and want to achieve → Ano performs evidence-led iterative research → identifies viable markets and industries → finds matching companies → identifies relevant buyers → verifies selected contacts → drafts outreach only (never sends email, places calls, or creates CRM records without a later explicit approval).
>
> **Execution order:** Implement strictly in order (**Phase 13A → Phase 13B → Phase 13C → Phase 13D → Phase 13E → Phase 13F → Phase 13G**). **Stop after every sub-phase**, run `npm run check:migrations && npm run typecheck && npm test && npm run build` (plus sub-phase verification), explain what changed, and **wait for explicit user approval** before beginning the next sub-phase.
>
> **Per-phase non-negotiables:** Never expose secrets, internal provider prices/credits, model IDs, or raw provider errors to end users; never fabricate evidence; preserve citations and source provenance; keep all changes scoped strictly to Ano.

| Sub-Phase (Maps to Remediation) | Goal | Key Scope & Target Files | Safety, Accuracy & Architecture Requirements | Status & Acceptance |
| --- | --- | --- | --- | --- |
| **Phase 13A** *(Remediation Phase 1)* | Security & Search Foundation | `package.json`, `package-lock.json` (`next@16.4.6`, `zod@4.6.7`), `src/lib/ano/{research-conversation,autopilot}.ts`, `deploy/searxng/searxng/settings.yml`, `deploy/searxng/render-settings-entrypoint.sh`, `deploy/searxng/compose.yaml`, `deploy/searxng/.env.example`, `deploy/searxng/README.md`, `.env.example`, `scripts/smoke-searxng-gateway.mjs`, `src/server/telemetry/internal-api-usage.ts`, `src/server/domain/{target-account-discovery-service,people-playbook-service,market-discovery-service}.ts`, `tests/phase13a-security-and-search-foundation.test.ts` | Upgraded `next` to `16.4.6` and `zod` to `4.6.7` (`0` npm audit vulnerabilities, Turbopack-only preserved, `stageSummaries` updated to `z.partialRecord` + `code: "custom"` for Zod v4); configured Brave Search (`braveapi`) and removed `duckduckgo` from `deploy/searxng/searxng/settings.yml`; added server-only `BRAVE_API_KEY` container-boot `tmpfs` rendering via `render-settings-entrypoint.sh` & scoped `compose.yaml` env vars so `caddy` never sees `BRAVE_API_KEY` or `SEARXNG_SECRET`; added authenticated SearXNG smoke check `scripts/smoke-searxng-gateway.mjs` (`smoke:searxng` / `smoke:searxng:ci`); enforced mandatory production `ANO_INTERNAL_DAILY_PROSPEO_LIMIT` / `ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT` (`validateProductionPaidProviderBudgetConfig`), converted `checkInternalUsageBudget` to fail closed on paid providers (`prospeo`, `dropcontact`) if limits or the usage ledger RPC are unavailable, and wired the guard across all direct Prospeo/Dropcontact service execution entrypoints; verified `check:migrations` (`27`), `typecheck` (`0` errors), `test:phase4b` (`3/3`), `test:phase12` (`20/20`), `npm test` (`210/210`), and `next build` exit `0` | **Implemented & verified** |
| **Phase 13B** *(Remediation Phase 2)* | Explicit Autopilot Authority | `src/lib/ano/autopilot.ts`, `src/server/domain/autopilot-orchestrator-service.ts`, `src/server/persistence/autopilot-store.ts`, `src/app/api/v1/conversations/[conversationId]/autopilot/start/route.ts`, `src/components/research-conversation-workbench.tsx`, `src/components/artifacts/{autopilot-progress-card,research-plan-card,provider-scope-card}.tsx`, `docs/CHAT_FIRST_MATERIAL_WEB_ACTION_PLAN.md`, `docs/ARCHITECTURE.md`, `README.md`, `tests/phase13b-explicit-autopilot-authority.test.ts` | Enforce one explicit authority model: user explicitly starts Autopilot with a bounded scope permitting up to **50 public searches, 100 source fetches, 25 company candidates, and 10 named contact enrichments**; never show internal credit prices to end users; never send email, place calls, or write CRM records; log all usage internally; fail closed on paid-provider calls whenever provider config, budget limits, or usage logging are unavailable; update all product, docs, and UI wording so nothing contradicts this model | **Implemented & verified** (`check:migrations`: 28/28, `typecheck`: 0 errors, `test:phase4b`: 3/3, `test:phase12`: 20/20, `npm test`: 214/214, `next build --turbopack`: exit 0) |
| **Phase 13C** *(Remediation Phase 3)* | Durable Background Execution | `supabase/migrations/20261124_000029_durable_autopilot_jobs.sql`, `scripts/{apply-ano-schema,check-ano-schema}.mjs`, `scripts/run-autopilot-worker.ts`, `src/lib/ano/autopilot.ts`, `src/server/persistence/{autopilot-store,evidence-research-store}.ts`, `src/server/domain/autopilot-orchestrator-service.ts`, `src/server/jobs/{autopilot-worker,recover-stale-runs}.ts`, `src/app/api/v1/conversations/[conversationId]/{route,messages/route,autopilot/{start,status,cancel,step}/route}.ts`, `src/app/api/internal/jobs/autopilot/route.ts`, `src/components/{research-conversation-workbench,artifacts/autopilot-progress-card}.tsx`, `vercel.json`, `package.json`, `docs/{ARCHITECTURE,CHAT_FIRST_MATERIAL_WEB_ACTION_PLAN}.md`, `tests/phase13c-durable-background-execution.test.ts` | Replaced browser-driven sequential `autopilot/step` execution with durable server worker/job execution (`autopilot_jobs` queue, atomic leases with periodic `renewAutopilotStageLease` heartbeats, detached `after()` drain, read-time stale lease recovery capped at `AUTOPILOT_MAX_RECOVERIES = 3`, protected `/api/internal/jobs/autopilot` sweep, `worker:autopilot` CLI, and read-only `/autopilot/status` browser observation surviving tab close/refresh/crash/network drop); preserved `ano_langgraph` & mid-wave continuation (`prepareEvidenceResearchRun` -> `claimEvidenceResearchRun`); sanitized progress/warnings/errors into calm outcome copy (`formatAutopilotOutcomeMessage`); verified interrupted-job & mid-wave recovery tests + `check:migrations` (`29`), `typecheck` (`0`), `test:phase4b` (`3/3`), `test:phase12` (`20/20`), `npm test` (`220/220`), `next build --turbopack` exit `0` | **Implemented & verified** (`check:migrations`: 29/29, `typecheck`: 0 errors, `test:phase4b`: 3/3, `test:phase12`: 20/20, `npm test`: 220/220, `next build --turbopack`: exit 0) |
| **Phase 13D** *(Remediation Phase 4)* | True Iterative Deep Research | Additive SQL migration (`source_provenance` on `research_sources`), `src/lib/ano/evidence-research.ts`, `src/server/agents/iterative-research-planner.ts`, `src/server/langgraph/iterative-evidence-research-graph.ts`, `src/server/research/{deep-research-assessment,evidence-source-retriever}.ts`, `src/server/persistence/evidence-research-store.ts`, `src/server/domain/autopilot-orchestrator-service.ts`, `tests/phase13d-iterative-deep-research.test.ts` | Execute the full approved **50-search / 100-fetch** budget across up to **8 waves** (replacing current `15/20/3`-wave cap in `runStageMarketResearch`): (1) derive 2–5 candidate markets; (2) plan initial market × decision-dimension wave; (3) search, deduplicate, rank, and fetch bounded excerpts; (4) assess coverage; (5) generate only gap-closing follow-up queries; (6) stop early only on strong comparison coverage, else continue until budget exhausted; (7) always produce the strongest evidence-backed report. Upgrade ranking for authority/primary-source preference, country/industry/directness relevance, freshness, root-domain/source-family diversity caps, and duplicate/syndication detection; explicitly distinguish direct evidence, comparable evidence, inference, hypothesis, and unknown; restrict vendor sources to contextual/counter evidence only (never sole proof of demand); keep workspace uploads (`workspace_supplied`) cleanly separate from `public_web` and `comparable_evidence` | **Planned — next (awaiting approval)** |
| **Phase 13E** *(Remediation Phase 5)* | Map-Reduce Evidence Synthesis | `src/lib/ano/market-synthesis.ts`, `src/server/agents/market-synthesis-model.ts`, `src/server/langgraph/market-synthesis-graph.ts`, `src/server/persistence/market-synthesis-store.ts`, `src/server/domain/market-synthesis-service.ts`, `tests/phase13e-map-reduce-synthesis.test.ts` | Replace single-prompt excerpt truncation with map-reduce synthesis: group all saved evidence by market and decision dimension → generate citation-bound per-group summaries → synthesize the final market/industry recommendation from those summaries without silently dropping evidence; require complete structured output (`recommendation`, `evidence`, `comparableEvidence`, `assumptions`, `unknowns`, `confidence`, `nextValidationActions`) | **Planned** |
| **Phase 13F** *(Remediation Phase 6)* | Downstream Sales Research Hardening | `src/server/domain/{target-account-discovery-service,people-playbook-service,outreach-template-service,outreach-execution-service}.ts`, `src/lib/ano/{company-discovery,people-playbooks,outreach-templates,outreach-execution}.ts`, `tests/phase13f-downstream-sales-research.test.ts` | Only after a market/industry route is locked: (1) search for matching companies; (2) explain clearly why each company matches; (3) support shortlisting; (4) discover named buyer candidates and roles; (5) verify only selected named people via the appropriate provider within bounded authority & fail-closed budget guards; (6) generate factual company and industry playbooks; (7) draft outreach templates only — never send emails, place calls, or write CRM records | **Planned** |
| **Phase 13G** *(Remediation Phase 7)* | Verification & Release Hardening | `tests/e2e/`, `tests/phase13g-rls-isolation.test.ts`, provider contract/fixture & restart/recovery test suites, `.github/workflows/ci.yml`, `.github/workflows/deploy-production.yml`, `scripts/`, `docs/ARCHITECTURE.md` | Add authenticated end-to-end browser tests, accessibility checks, two-workspace RLS isolation tests, provider contract/fixture tests, restart/recovery tests, production SQL migration + authenticated post-deploy smoke checks, strict deployment failure when required deployment or database secrets are absent, and unify `docs/ARCHITECTURE.md` as the single current-state architecture reference retiring obsolete phase claims | **Planned** |

**Phase 13 Execution Checklist (Stop & Verify Gate After Each Sub-Phase):**
- [x] **Phase 13A — Security & Search Foundation:** Vulnerable `next` & `zod` upgraded (Turbopack); Brave Search enabled & DuckDuckGo removed in private SearXNG; server-only Brave secrets via deployment env; authenticated SearXNG smoke check added; production Prospeo/Dropcontact limits & fail-closed ledger guard enforced; browser secret-isolation tests + build green.
- [x] **Phase 13B — Explicit Autopilot Authority:** Explicit bounded start authority (`50 searches / 100 fetches / 25 companies / 10 named enrichments`), zero credit prices in UI, fail-closed paid-provider prerequisites, zero unapproved sends/calls/CRM writes, and aligned docs/UI copy verified.
- [x] **Phase 13C — Durable Background Execution:** Server worker/job execution replaces browser-driven stepping; jobs survive refresh/tab close/network drop; LangGraph & stage checkpoints preserved; calm outcome-based progress copy; interrupted-job recovery tests green.
- [ ] **Phase 13D — True Iterative Deep Research:** Full `50/100` budget & up to 8 gap-closing waves; upgraded ranking, diversity caps, syndication dedupe, vendor counter-evidence guardrail, and distinct `source_provenance` (`workspace_supplied`, `public_web`, `comparable_evidence`) verified.
- [ ] **Phase 13E — Map-Reduce Evidence Synthesis:** Group-by `(market, dimension)` citation-bound map summaries + reduce synthesis retaining all evidence; full recommendation/evidence/comparable/assumptions/unknowns/confidence/next-actions output verified.
- [ ] **Phase 13F — Downstream Sales Research Hardening:** Route-lock prerequisite, explained company matches, shortlisting, named buyer roles, selected-only verification, factual playbooks, and draft-only outreach verified.
- [ ] **Phase 13G — Verification & Release Hardening:** Authenticated E2E browser + accessibility checks, 2-workspace RLS isolation, provider fixtures, restart/recovery, strict CI/CD secret checks, production smoke checks, and unified `docs/ARCHITECTURE.md` verified.

## 11. Accessibility and responsiveness acceptance criteria

- All Material controls have accessible names; icon-only controls have `aria-label`.
- Keyboard flow supports: sidebar selection, message composer, approval actions, dialogs, menus, source drawers, and context-rail close/open.
- Focus moves predictably after opening/closing a dialog and after a new message is added.
- Every safety status is communicated in words and not color alone.
- Desktop: sidebar, conversation, and context rail never overlap or create nested unmanageable scrolling.
- Tablet: context rail collapses without hiding evidence access.
- Mobile: the composer remains reachable above the virtual keyboard; context appears in an accessible modal/sheet; no critical approval depends on hover.
- Light and dark themes meet contrast requirements and preserve the meaning of safe/running/review/error states.

## 12. Validation checklist

### Automated

- `npm run check:migrations && npm run typecheck`
- Existing Phase A–9C tests (deep research, market synthesis, company/people discovery, email verification waterfall, anti-AI templates, RFC-4180 export)
- New tests for conversation-list pagination, selection, archive/rename authorization, typed action contracts, and artifact-reference workspace isolation
- **Phase 10 tests:** multi-format ingestion (`url`, `.pdf`, `.docx`, `.txt`), 2-question intake, checkpointed `autopilot/step` leases & idempotent resume, post-autopilot reference chat / partial re-runs, and negative leakage assertions for `ano_internal.api_usage_logs`
- Production Turbopack build

### Manual

- **Phases 0–9 baseline:** New conversation → clarification → plan edit → approval → provider-scope approval → research progress → evidence report → target decision.
- **Phase 10 autopilot flow:** Attach product URL / PDF / DOCX / TXT → answer business location + target market → verify autonomous 6-stage run completes to ready leads & email templates with zero user-facing credit prompts, jump bar opens all drawers cleanly, and `npm run usage:report` prints internal provider counts/tokens/USD costs cleanly while browser sessions never see them.
- Refresh while each state is active; verify the same conversation and safe state reappear without re-charging completed stages.
- Open two conversations in separate tabs; confirm no workspace/cross-conversation state leaks.
- Test keyboard-only and screen-reader labels for all Material elements.
- Test desktop, tablet, and mobile layouts in light and dark themes.
- Confirm outbound external sends and Mercury CRM proposals remain gated by explicit approval controls.

## 13. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Material Web is a custom-element library, not a React component suite | Register it client-side, use narrow internal adapters, maintain JSX declarations, and test SSR/hydration in production. |
| Upstream Material Web maintenance status | Pin a version, import only components used, keep Ano adapters narrow, and record an upgrade checklist. |
| Chat UI obscures consequential actions | Render typed approval artifacts with explicit language, scope, budget, and confirmation controls. |
| Rebuild accidentally changes business behaviour | Reuse existing API/domain services; add UI integration tests around current action boundaries before changing graph policy. |
| Large CSS rewrite causes regressions | Migrate shell and artifacts incrementally; delete legacy selectors only after their replacements pass acceptance. |
| Old and new research documentation disagree | Reconcile documents as Phase 0 work before external demos or onboarding material changes. |

## 14. Implementation guardrails

- No direct Bedrock, Gemini, SearXNG, Prospeo, Dropcontact, Mercury, email, call, or database capability is introduced into the browser.
- Browser-visible artifact data remains workspace-scoped and comes from existing validated routes.
- All provider starts, checkpoints, and resumptions retain idempotency keys, atomic leases, silent server budget checks (`check_internal_usage_budget`), and graceful fallback/recovery without re-charging completed stages.
- **Phase 13B Explicit Autopilot Authority:** Autopilot requires an explicit user start with a bounded authority scope (`50` public searches, `100` source fetches, `25` company candidates, `10` named contact enrichments); internal credit prices are never displayed to end users; missing provider configuration, missing daily budget limits, or unavailable `ano_internal.api_usage_logs` telemetry fail closed to block paid-provider calls; and external outbound sends, phone calls, and CRM writes remain disabled pending explicit later approval (`ApprovalCard`), while `ano_internal.api_usage_logs` remains visible solely via operator CLI (`npm run usage:report`).
- **Phase 13C Durable Background Execution:** Browser clients never invoke `/autopilot/step`; the server queues durable jobs in `public.autopilot_jobs`, drains stages asynchronously via Next.js `after()` (with detached sessions, `renewAutopilotStageLease` heartbeats, `recoverStaleAutopilotRuns`, protected `/api/internal/jobs/autopilot` sweeps, and `npm run worker:autopilot`), preserves saved stage & `ano_langgraph` checkpoints across disconnects/restarts without retrying uncertain provider actions, and surfaces only calm outcome-based copy (`formatAutopilotOutcomeMessage`).
- Keep raw external page content out of messages; show only stored excerpts, normalized product summaries, and safe source metadata.
- Preserve current RLS and audit requirements through every schema/API change.

## 15. Authoritative implementation references

- [Material Web introduction](https://material-web.dev/about/intro/) — Material 3 web components and framework compatibility.
- [Material Web theming](https://material-web.dev/theming/material-theming/) — CSS token model for Material themes.
- [Material Web component catalog](https://material-web.dev/) — exact current component APIs and imports before implementation.
- [React custom elements reference](https://react.dev/reference/react-dom/components#custom-html-elements) — React 19 custom-element properties and event handling.
- [Material Web repository](https://github.com/material-components/material-web) — versioning and upstream maintenance status.



## Update here for failed deployments
1. phase10A
2. Phase10B repush
# Ano Copilot: Chat-First Material Web Action Plan

**Status:** All Phases 0–8 implemented & verified (Domain Phases A–F unified with Material Design 3 Chat-First UI); Phase 9 (9A–9C: Multi-Source Email Acquisition, Blaster-Ready Email Templates, and 1-Click Leads CSV Export) mapped for execution  
**Scope:** Replace Ano's tabbed research workbench with a durable, ChatGPT-style research-to-revenue workspace.  
**UI standard:** Material Web (`@material/web@2.4.1`) implementing Material Design 3.  
**Date:** 2026-11-21

## 1. Decision summary

Ano will become a chat-first sales-research application. The conversation is the primary surface; research plans, approvals, provider progress, evidence, and recommendations are rendered as rich, traceable artifacts *inside* that conversation.

The visual structure will combine:

- **ChatGPT's interaction model:** persistent conversation history, a focused message thread, a sticky composer, and a clear active conversation.
- **Sellbird's information architecture:** a calm persistent sidebar, visible work waiting on the user, compact status counts, and a contextual decision workspace.
- **Ano's existing trust model:** external activity remains approval-gated; evidence and provider receipts remain inspectable; the model never gains direct tool authority.

The only component library will be **Material Web** (`@material/web`). Do not add MUI, Tailwind UI, shadcn, Radix, a React Material wrapper, or another component library. Native React, Next.js, TypeScript, CSS, and the existing application dependencies remain in scope.

## 2. Current-state correction

The repository does **not** currently have Tailwind in `package.json`, a Tailwind configuration file, or Tailwind utility classes. It uses a large custom stylesheet at `src/app/globals.css`, including legacy workbench styles and the current `phase-a`, `phase-b`, and `phase-c` styles.

Therefore this is **not a Tailwind removal project**. It is a migration from custom component styling to Material Web components and Material 3 design tokens. Layout CSS remains necessary; Material Web supplies controls, interaction states, accessibility primitives, and visual tokens, not an entire chat-application layout.

## 3. Product goal and non-goals

### Goal

Let a seller work with Ano in one coherent conversation:

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

### Non-goals for this rebuild

- Do not add autonomous email sending, campaign execution, calling, enrichment, or CRM writes.
- Do not relax any existing graph interruption, provider-budget, idempotency, RLS, audit, or evidence-citation control.
- Do not reimplement the research engine merely to change its appearance.
- Do not copy Sellbird source code, HTML, CSS, icons, brand assets, or visual assets.
- Do not add a second UI framework or a generic icon package.

## 4. Design principles

1. **Conversation first.** A seller should not need to decide which tab contains the next step.
2. **Artifacts, not hidden state.** Plans, approvals, sources, evidence confidence, and decisions appear where the user made them.
3. **Evidence before persuasion.** Every research-derived claim retains a path to its saved source and claim type.
4. **Approval is an explicit message action.** A normal text reply can never silently approve a provider call or consequential action.
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
      work-queue/route.ts           # Unified workspace review & active-run queue
      conversations/[conversationId]/
        export/route.ts             # Audited CSV & template export (Phase 9C)
    globals.css                     # Document reset and global defaults only
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
      outreach-template-pack-card.tsx   # Phase 9B (planned)
      outreach-template-drawer.tsx      # Phase 9B (planned)
      lead-export-card.tsx              # Phase 9C (planned)
    work/
      review-queue.tsx                  # Phase 5
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

### Planned roadmap — Phase 9: Exportable Leads List & Blaster-Ready Email Templates (3 Phases)

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

- `npm run typecheck`
- Existing Phase A, deep-research, and market-synthesis tests
- New tests for conversation-list pagination, selection, archive/rename authorization, typed action contracts, and artifact-reference workspace isolation
- Production Turbopack build

### Manual

- New conversation → clarification → plan edit → approval → provider-scope approval → research progress → evidence report → target decision.
- Refresh while each state is active; verify the same conversation and safe state reappear.
- Open two conversations in separate tabs; confirm no workspace/cross-conversation state leaks.
- Test keyboard-only and screen-reader labels for all Material elements.
- Test desktop, tablet, and mobile layouts in light and dark themes.
- Confirm a plain message cannot approve, restart, or expand a provider run.

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

- No direct Bedrock, SearXNG, Prospeo, Dropcontact, Mercury, email, call, or database capability is introduced into the browser.
- Browser-visible artifact data remains workspace-scoped and comes from existing validated routes.
- All provider starts and resumes retain idempotency keys, receipts, budget checks, and manual-review behaviour.
- A chat message is not a policy bypass. Typed approval/resume endpoints remain the sole route for consequential graph transitions.
- Keep raw external page content out of messages; show only stored excerpts and safe source metadata.
- Preserve current RLS and audit requirements through every schema/API change.

## 15. Authoritative implementation references

- [Material Web introduction](https://material-web.dev/about/intro/) — Material 3 web components and framework compatibility.
- [Material Web theming](https://material-web.dev/theming/material-theming/) — CSS token model for Material themes.
- [Material Web component catalog](https://material-web.dev/) — exact current component APIs and imports before implementation.
- [React custom elements reference](https://react.dev/reference/react-dom/components#custom-html-elements) — React 19 custom-element properties and event handling.
- [Material Web repository](https://github.com/material-components/material-web) — versioning and upstream maintenance status.


# Ano Architecture (Current Production State)

Ano is a standalone, tenant-safe, chat-first AI sales research and outreach-planning application built with **Next.js 16.4.6 (Turbopack only)**, **React 19**, **Material Web (`@material/web` 2.4.1)**, **LangGraph JS**, server-only reasoning models, and a dedicated **Postgres/Supabase** database. Legacy external CRM integration code remains outside the live runtime path and disconnected from all public interfaces.

## System Runtime Flow

```text
Browser client (Pure Material Web 3 + React 19 Client Components)
  -> Next 16 Proxy (`src/proxy.ts`) validates/refreshes Supabase auth claims
  -> Thin `/api/v1/*` Route Handler validates schemas, idempotency, and session access
  -> Workspace session (`requireWorkspaceSession`) resolves tenant membership, role, and domain allow-list
  -> Explicit Autopilot authorization & fail-closed internal budget preflight (`canExecutePaidProviderCall`)
  -> Durable server job queue (`autopilot_jobs`) & worker leases drain asynchronously post-response (`after()` / CLI worker)
  -> Resumable LangGraph JS subgraphs (`ano_langgraph`) + Postgres/RLS state tables preserve stage/wave checkpoints
  -> Private authenticated SearXNG gateway (Brave Search only) + SSRF-hardened source retriever gather web evidence
  -> Server-only reasoning models (Gemini with multi-model failover or Amazon Bedrock/Ollama) interpret and synthesize
  -> Bounded downstream discovery (B2B directory / OpenStreetMap + company websites + selective email verification)
  -> Audited factual playbooks, draft-only outreach sequences, and RFC-4180 formula-safe CSV/Markdown exports
```

## Layers & Ownership

| Layer | Location | Responsibility |
| --- | --- | --- |
| Presentation & Pure Material Web 3 UI | `src/app/`, `src/components/`, `src/styles/` | Public homepage (`/` via `LandingHome`), auth/onboarding/invites (`/login`, `/signup`, `/onboarding`, `/invite/[token]`), authenticated workspace shell (`AppShell`, `<WorkspaceSwitcher />`, `/research`, `/research/[conversationId]`, `/companies`, `/people`, `/playbook`, `/work`, `/library`, `/settings`), inline artifact cards & slide-over drawers (`AutopilotAuthorityCard`, `AutopilotProgressCard`, `RecommendationCard`, `AccountDossierCard`, `LeadExportCard`), standardized self-hosted `Roboto` M3 typography, pure `@material/web` controls, zero Tailwind, zero exposed vendor names/model IDs/credit prices/raw provider errors. |
| Domain Contracts & Pure Policy | `src/contracts/`, `src/lib/ano/` | Zod schemas and deterministic pure logic for briefs, bounded Autopilot authority (`50` public searches, `100` source fetches, `25` company candidates, `10` named contact enrichments), iterative evidence scoring, map-reduce 7-section market reports, company match scoring (`matchReasons`), buyer attribution & verification routing, audited playbooks, anti-AI outreach template linting, draft eligibility, and formula-safe exports. |
| Auth & Multi-Workspace Proxy | `src/proxy.ts`, `src/lib/supabase/`, `src/server/auth/` | Cookie/claim refresh via `proxy.ts`, server-validated `workspace_members` & `workspace_domains` resolution, `ano_active_workspace_id` cookie tenant switching (`POST /api/v1/workspace/switch`), SHA-256 invite-token acceptance with automatic personal workspace creation, and fail-closed production auth when Supabase config is absent. |
| HTTP Endpoints | `src/app/api/` | Health liveness (`GET /api/health`), workspace & invite APIs, conversation lifecycle, background Autopilot start/status/cancel endpoints, protected internal worker sweep (`POST /api/internal/jobs/autopilot`), downstream company/people/playbook/template/draft routes, and CSV/Markdown export downloads. |
| Domain Services & Durable Jobs | `src/server/domain/`, `src/server/jobs/` | End-to-end orchestration (`autopilot-orchestrator-service.ts`), worker lease claiming/heartbeat/stale recovery (`autopilot-worker.ts`, Next.js `after()`, `scripts/run-autopilot-worker.ts`), product source ingestion (`website_url`, PDF, DOCX, TXT), friendly conversation titling, post-run reference chat & bounded downstream reruns, and prerequisite locking across company/people/outreach stages. |
| Orchestration Graphs & Models | `src/server/langgraph/`, `src/server/agents/` | Separate resumable LangGraph subgraphs for intake/planning, iterative evidence gathering, map-reduce market synthesis, company discovery, buyer discovery/verification/playbooks, and draft-only outreach preparation, backed by schema-validated server-only Gemini (multi-model 503/429 failover + 60s circuit breaker), Amazon Bedrock, or Ollama adapters. |
| Research & Enrichment Connectors | `src/server/research/`, `src/server/connectors/` | Private HTTPS authenticated SearXNG client (`BRAVE_API_KEY` injected server-side in `deploy/searxng/`, DuckDuckGo excluded), SSRF-hardened `EvidenceSourceRetriever`, OpenStreetMap Nominatim/Overpass local business discovery, Prospeo company/people/verification client (`<= 25` companies / `<= 10` enrichments), company website team extractor, and Dropcontact async batch verifier. |
| Persistence & Internal Usage Ledger | `src/server/persistence/`, `src/server/telemetry/`, `scripts/` | Workspace-scoped RLS persistence across 53 tables (`supabase/migrations/000001` through `000031`), immutable `audit_logs`, and private `ano_internal.api_usage_logs` telemetry (written via `public.record_internal_api_usage` and checked via fail-closed `public.check_internal_usage_budget`, readable solely via operator CLI `npm run usage:report`). |

## End-to-End Product Pipeline & Safety Model

1. **Intake & Product Context (`research_briefs`, `conversation_product_sources`, `research_plans`)**
   - Converts user messages plus uploaded websites, PDFs, DOCX files, or text notes into a structured offer/goal brief, asking at most one decision-changing clarification before building a versioned research plan.
2. **Explicit Bounded Autopilot Authority (`autopilot_runs`, `autopilot_jobs`)**
   - Users must explicitly start Autopilot (`AutopilotAuthorityCard`, `explicitApproval: true`) with one bounded authority scope permitting up to **50 public searches**, **100 source fetches**, **25 company candidates**, and **10 named contact enrichments**, while locking `allowOutboundEmailSend = false`, `allowPhoneCalls = false`, and `allowCrmWrites = false`.
   - Browser clients only start, observe (`GET /api/v1/conversations/[conversationId]/autopilot/status`), pause, resume, or cancel runs; background execution survives tab closes, refreshes, and network drops via atomic database leases, periodic heartbeats, `ano_langgraph` checkpoints, stale-lease recovery (`AUTOPILOT_MAX_RECOVERIES = 3`), and calm outcome-focused status messages.
3. **True Iterative Deep Research (`ano_research_runs`, `research_waves`, `research_sources`)**
   - Derives `2–5` distinct geographic candidate markets, runs up to **8 gap-closing waves** across `(market × decision_dimension)` within the approved `50` search / `100` fetch ceiling, and stops early only when multi-domain comparative coverage is strong (`comparisonReady`).
   - Scores candidates using domain authority, geography/industry directness, `<meta>`/`<time>` publication freshness, root-domain/source-family diversity caps, PR-wire syndication detection, and shingle-Jaccard deduplication.
   - Separates `source_provenance` honestly across `public_web`, `comparable_evidence`, and `workspace_supplied`, confining vendor claims to contextual/counter-evidence roles rather than standalone proof of demand.
4. **Map-Reduce Citation-Audited Synthesis (`ano_research_syntheses`, `research_claims`, `market_profiles`, `industry_profiles`, `target_decisions`)**
   - Groups every non-duplicate saved source by `(market, decision_dimension)` into bounded `<= 8`-source map batches (`group_summaries_json`) so large evidence sets are never silently dropped for prompt length.
   - Audits every citation and epistemic claim kind across both map summaries and the reduced **7-section structured report** (`recommendation`, `evidence`, `comparableEvidence`, `assumptions`, `unknowns`, `confidence`, `nextValidationActions`), blocking vendor-only or workspace-only material from elevating to direct market demand claims.
5. **Downstream Sales Research & Playbooks (`provider_company_searches`, `account_candidates`, `provider_person_searches`, `contact_candidates`, `contact_verification_runs`, `account_playbooks`)**
   - Strictly gated on a locked `target_decisions` route prior to any search, people lookup, or budget check.
   - Company discovery caps results at `<= 25` candidates, explains concrete fit via white-label `matchReasons` rendered in `AccountDossierCard`, and scopes single and batch shortlisting to the locked `target_decision_id`.
   - Buyer discovery prevents cross-company misattribution (`matchAccountForPerson` returns `null` on conflicting company metadata) and separates named buyers from generic inbox/desk entries (`isNamedPersonCandidate`).
   - Selective email verification accepts only shortlisted, unverified named buyer candidates, caps cumulative enrichments at `<= 10`, routes between B2B directory and email-enrichment providers via `selectAppropriateVerificationProvider`, and fails closed if credentials, production daily limits (`ANO_INTERNAL_DAILY_PROSPEO_LIMIT`, `ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT`), or usage logging (`check_internal_usage_budget`) are missing or unavailable.
   - Compiles and audits factual **company playbooks** and **industry playbooks** preserving claim provenance (`Direct market research`, `Comparable market evidence`, `Market research inference`, `Market research hypothesis`, `Research gap noted`) and separating `verified_contact`, `named_unverified`, and `role_hypothesis`.
6. **Strictly Draft-Only Outreach & Export (`outreach_template_packs`, `outreach_drafts`, `proposals`, `approval_decisions`)**
   - Generates human-voice 3-step email sequences validated by anti-AI linting (`outreach-templates.ts`) and RFC-4180 formula-neutralized CSV/Markdown exports (`lead-export.ts`, separating `verified_work_email` from `public_website`).
   - Enforces `deliveryMode: "draft_only"` and `externalDispatchExecuted: false`: Ano never sends email, places calls, or writes CRM records without a later explicit approval path.

## Security, Multi-Workspace RLS & Telemetry Isolation

- **53/53 tables** across `public` and `ano_internal` enable Postgres Row-Level Security (`ENABLE ROW LEVEL SECURITY` verified statically and live by `scripts/check-ano-schema.mjs`).
- Tenant records restrict `SELECT`/`INSERT`/`UPDATE` to verified workspace memberships and roles via `is_ano_workspace_member`, `can_write_ano_workspace`, `is_ano_workspace_admin`, and `is_ano_workspace_owner` (`viewer` is strictly read-only); `audit_logs` permits select/insert only with zero client update/delete policies.
- `ano_internal.api_usage_logs` revokes all privileges from `public`, `anon`, and `authenticated` and exposes zero API routes or client components.
- Server credentials (`SUPABASE_DB_URL`, `GEMINI_API_KEY`, `PROSPEO_KEY`, `DROPCONTACT_API_KEY`, `SEARXNG_BASE_URL`, `SEARXNG_GATEWAY_TOKEN`, `AWS_*`) and internal credit prices are never bundled into browser code or returned in UI/API messages (`sanitizeDownstreamErrorMessage` and `sanitizeLlmErrorForUser`).

## Verification, Accessibility & Release Hardening

| Check | Command | What It Verifies |
| --- | --- | --- |
| Migration & RLS registration | `npm run check:migrations` | All SQL files (`000001`–`000031`) registered symmetrically in apply & status scripts |
| TypeScript & offline unit/integration suite | `npm run typecheck && npm run test:phase4b && npm test` | Full strict typecheck plus offline tests covering security/secrets isolation, authority bounds, crash recovery, iterative research, map-reduce synthesis, downstream gating, provider fixture contracts, 2-workspace RLS isolation, and white-label masking |
| Release gate & Turbopack build | `npm run test:phase12 && npm run build` | LLM failover, pure Material Web 3 controls/tokens, homepage, and production `next build --turbopack` |
| Browser E2E & WCAG 2.1 AA accessibility | `npm run test:e2e` | Playwright Chromium E2E across homepage, auth pages, authenticated workspace views, workspace switching, artifact rendering, and `@axe-core/playwright` zero critical/serious violation checks |
| Live schema, RLS & SearXNG checks | `npm run db:apply:ci && npm run db:status:ci`, `npm run test:rls:live`, `npm run smoke:searxng` | Schema/RLS enabled (`rlsEnabledReady`), transactional 2-workspace RLS probe against live Supabase, and authenticated non-DuckDuckGo Brave Search probe |
| Strict CI/CD release pipeline | `.github/workflows/ci.yml`, `.github/workflows/deploy-production.yml` (`npm run check:deploy-env`, `npm run smoke:production`) | Fails hard if required database, Vercel, Supabase public, or smoke auth secrets are absent; runs DB migrations before deploy and executes authenticated SSR cookie smoke verification across `/api/health`, `/`, `/api/v1/workspace`, `/api/v1/conversations`, and `/api/v1/work-queue` (see [docs/CI_CD_SETUP.md](file:///Users/tendaimidzi/Code/AnoCopilot/docs/CI_CD_SETUP.md)) |

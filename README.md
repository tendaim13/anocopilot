# Ano Copilot

Ano is a standalone, chat-first sales research and planning copilot built with Next.js 16 (Turbopack), React 19, Material Web (`@material/web`), LangGraph JS, server-only reasoning models, and an isolated Postgres/Supabase project.

Its workflow turns a workspace member's product description and sales goal into a clarifying question (only when decision-changing), an explicitly approved bounded Autopilot authority scope (up to **50 public searches, 100 source fetches, 25 company candidates, and 10 named contact enrichments**), bounded private SearXNG public-evidence collection, a citation-audited market and industry recommendation, explained company candidates, named buyer roles with selected work-email verification, factual account playbooks, and outreach templates/drafts only. Ano never shows internal credit prices to end users and never sends email, makes calls, or creates CRM records without a later explicit approval.

## Product & architecture documents

- [Product description](PRODUCT_DESCRIPTION.md) defines the user problem, product promise, and trust boundaries.
- [LangGraph implementation plan](IMPLEMENTATION.md) specifies the research, evidence, synthesis, and downstream execution graphs.
- [Chat-First Material Web action plan](docs/CHAT_FIRST_MATERIAL_WEB_ACTION_PLAN.md) documents the consolidated Material Design 3 UI architecture and Remediation Phases 12–13.
- [Architecture overview](docs/ARCHITECTURE.md) documents the runtime layers, safety matrix, and schema groups.

## Non-negotiable boundaries

- **Standalone tenancy:** Ano owns its own authentication, workspace membership, domain policy, RLS, audit logs, and Postgres schema.
- **Explicit Autopilot authority & fail-closed budgets:** A user explicitly starts Autopilot with a bounded authority scope (`50` public searches, `100` source fetches, `25` company candidates, `10` named contact enrichments). Missing provider configuration, missing production budget limits (`ANO_INTERNAL_DAILY_PROSPEO_LIMIT`, `ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT`), or unavailable `ano_internal` usage logging strictly prevent paid-provider calls.
- **No unapproved external writes:** Ano never sends email, places phone calls, or writes CRM records without a later explicit human approval. Internal credit costs are never shown to end users.
- **Safe public research:** Private SearXNG returns search metadata only; Ano's server-owned retriever validates URLs, DNS/IPs (SSRF guards), redirects, response sizes, and content types, storing bounded excerpts and receipts without retrying uncertain outcomes automatically.
- **Build system:** Next.js with Turbopack only (`next dev --turbopack`, `next build --turbopack`). Do not introduce webpack configuration.

## Current status

- **Core Pipeline & Schema:** Implemented and verified across SQL migrations `000001`–`000028` and `ano_langgraph` Postgres checkpoints.
- **Public Release & Material Web 3 UI:** Implemented and verified (`next@16.4.6`, `zod@4.6.7`, `@material/web@2.4.1`, Material 3 Roboto light/dark UI, public homepage `/`, full backend vendor masking, fail-closed paid usage ledger, explicit Autopilot authority scope, and inline artifact drawers).

## Server configuration

Set server-only provider and LLM environment variables (`GEMINI_API_KEY` or `ANO_AGENT_MODE=bedrock`, `SEARXNG_BASE_URL`, `SEARXNG_GATEWAY_TOKEN`, `PROSPEO_KEY`, `DROPCONTACT_API_KEY`, `ANO_INTERNAL_DAILY_PROSPEO_LIMIT`, `ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT`; plus `BRAVE_API_KEY` strictly inside the private SearXNG container env) cleanly outside Git and never prefix them with `NEXT_PUBLIC_`.

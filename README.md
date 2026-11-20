# Ano Copilot

Ano is a standalone, chat-first AI sales research and planning copilot built with Next.js 16 (Turbopack), React 19, Material Web (`@material/web`), LangGraph JS, Amazon Bedrock, and a dedicated Supabase/Postgres project.

Its complete Phase A–F workflow turns a workspace member's natural-language offer and sales goal into a clarifying question (only when decision-changing), an approval-gated research plan, bounded private SearXNG public-evidence collection, a citation-audited market and industry recommendation with explicit target-route locking, signal-backed Prospeo company discovery, two-stage people discovery (role & named-person discovery + selective Dropcontact verification) feeding factual account playbooks, and per-action approval-gated outreach drafts, call/calendar tasks, and Mercury CRM proposals.

## Product & architecture documents

- [Product description](PRODUCT_DESCRIPTION.md) defines the user problem, product promise, and trust boundaries.
- [LangGraph implementation plan](IMPLEMENTATION.md) specifies the research, evidence, synthesis, and downstream execution graphs.
- [Chat-First Material Web action plan](docs/CHAT_FIRST_MATERIAL_WEB_ACTION_PLAN.md) defines the consolidated Material Design 3 UI architecture and Phases 5–8 roadmap.
- [Architecture overview](docs/ARCHITECTURE.md) documents the runtime layers, safety matrix, and schema groups.

## Non-negotiable boundaries

- **Standalone tenancy:** Ano owns its own authentication, workspace membership, domain policy, RLS, audit logs, and Postgres schema. Mercury's database and internal services remain untouched.
- **Reasoning vs execution separation:** Amazon Bedrock (via server-only LangChain adapters) interprets briefs, drafts plans, proposes bounded search queries, and synthesizes saved excerpts. Bedrock never receives provider keys, HTTP/browser tools, or database access.
- **Explicit human approvals:** A plain chat message can never approve a provider call, spend credits, or lock a target route. Every consequential transition uses typed resume/start endpoints and explicit UI controls.
- **Safe public research:** Private SearXNG returns search metadata only; Ano's server-owned retriever validates URLs, DNS/IPs (SSRF guards), redirects, response sizes, and content types, storing bounded excerpts and receipts without retrying uncertain outcomes automatically.
- **Build system:** Next.js with Turbopack only (`next dev --turbopack`, `next build --turbopack`). Do not introduce webpack configuration.

## Current status

- **Phases A–F (Full Research-to-Revenue Pipeline):** Implemented and schema-verified across migrations `000001`–`000019` and `ano_langgraph` Postgres checkpoints.
- **Phases 0–8 (Material Design 3 Chat-First Workspace):** Implemented and verified (`@material/web@2.4.1`, Material 3 light/dark tokens, `AppShell`, `/research`, `/research/[conversationId]`, `/work` via `GET /api/v1/work-queue`, `/companies` via `GET /api/v1/companies`, `/people` via `GET /api/v1/people`, `/playbook` via `GET /api/v1/playbooks`, `/library`, `/settings`, auditable rename/archive, and complete inline Phase A–F artifact cards including `OutreachDraftCard`).

## Server configuration

Bedrock is enabled only when `ANO_AGENT_MODE=bedrock` and requires `AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION`, plus standard AWS IAM credentials (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or an IAM role/profile). Private SearXNG requires `SEARXNG_BASE_URL` and `SEARXNG_GATEWAY_TOKEN` (server-only). Keep all server secrets out of Git and never prefix them with `NEXT_PUBLIC_`.

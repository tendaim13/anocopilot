# Ano architecture

Ano is a standalone, tenant-safe, chat-first AI sales research and planning product. Mercury is a future connector—not a shared backend, internal import, or database dependency.

```text
Browser client (Material Web 2.4.1 + React 19 Client Components)
  -> Next 16 Proxy refreshes the Supabase session
  -> Thin /api/v1 route validates input and idempotency keys
  -> Workspace session resolves authenticated user, membership, and domain policy
  -> Domain service orchestrates research / synthesis / queue transitions
  -> LangGraph JS (Postgres checkpointer in ano_langgraph) manages resumable interrupts
  -> Server-only Bedrock adapters interpret, plan, and synthesize saved excerpts only
  -> Ano-owned persistence records conversations, messages, plans, sources, claims, receipts, and audit logs
  -> Controlled providers (private SearXNG, bounded Prospeo, selective Dropcontact & approval-gated Outreach/Mercury)
```

## Layers and ownership

| Layer | Location | Responsibility |
| --- | --- | --- |
| Material UI & Shell | `src/components/material/`, `src/components/shell/`, `src/components/conversation/`, `src/components/artifacts/`, `src/components/work/`, `src/styles/` | Material Web (`@material/web`) registration, Material 3 tokens, chat-first thread, inline artifact cards, context rail, and work queue. |
| Public contracts | `src/contracts/`, `src/lib/ano/` | Workspace, agent, graph-run, message-part, evidence-research, market-synthesis, company-discovery, people-playbooks, outreach-execution, and work-queue Zod schemas. |
| Auth/session | `src/lib/supabase/`, `src/proxy.ts`, `src/server/auth/` | Cookie refresh, server-validated Supabase identity, workspace membership, and domain allow-list checks. |
| HTTP | `src/app/api/v1/` | Parse, validate, enforce idempotency headers, and return safe errors; never implement business policy in the client. |
| Domain | `src/server/domain/` | Research conversation lifecycle, bounded SearXNG research orchestration, citation-bound synthesis, Prospeo target-to-account & people discovery, selective Dropcontact verification, factual playbooks, outreach/Mercury execution, and work queue aggregation. |
| Graph & Agent | `src/server/langgraph/`, `src/server/agents/` | Checkpointed Phase A/B/C/D/E/F LangGraph flows and server-only Bedrock planners/synthesizers with strict JSON schema validation. |
| Research Retrieval | `src/server/research/` | Private SearXNG client, SSRF-hardened `EvidenceSourceRetriever`, source scoring, and coverage assessment. |
| Persistence | `src/server/persistence/` | Idempotent runs, conversation pagination/rename/archive, and append-only `audit_logs` via user-session RLS. |
| Connectors & Jobs | `src/server/connectors/`, `src/server/jobs/` | Future Prospeo/Dropcontact/Mercury capability adapters and safe stale-run/lease recovery (never retries uncertain calls). |

## Schema groups

| Group | Tables | Purpose |
| --- | --- | --- |
| Identity | `workspaces`, `workspace_domains`, `workspace_members` | Workspace tenancy, roles, and optional email-domain policy. |
| Conversations & Graphs | `ano_conversations`, `ano_graph_runs`, `ano_graph_checkpoints`, `ano_messages`, `ano_graph_decisions`, `run_events` (plus `ano_langgraph.*`) | Durable chat history, LangGraph thread state, interrupts, checkpoints, and timeline events. |
| Phase A Planning | `research_briefs`, `research_questions`, `research_plans` | Structured offers, clarifying questions, and versioned approval-gated research plans. |
| Phase B Evidence | `ano_research_runs`, `provider_action_requests`, `research_waves`, `research_queries`, `research_search_results`, `research_sources`, `research_source_assessments` | Bounded SearXNG searches, SSRF-safe source excerpts, hashes, receipts, and quality scores. |
| Phase C Synthesis | `ano_research_syntheses`, `research_claims`, `market_profiles`, `industry_profiles`, `target_decisions` | Citation-audited observations, comparable evidence, inferences, market/industry profiles, and locked target route. |
| Phase D Account Discovery | `provider_company_searches`, `account_candidates` (plus `provider_action_requests` audit rows) | Canonical Prospeo search previews, 1-page cohort summaries, structured `signals_json`, fit scores, and `claim_ids` separated from industry claims. |
| Phase E People & Playbooks | `provider_person_searches`, `contact_candidates`, `contact_verification_runs`, `account_playbooks` | Buyer-role proposals, bounded Prospeo person search, selective Dropcontact verification pairs, and factual evidence-backed account playbooks. |
| Phase F Outreach & Accountability | `outreach_drafts`, `proposals`, `approval_decisions`, `audit_logs`, `notifications` | Versioned multi-channel drafts with deterministic eligibility checks, immutable per-action human decisions, Mercury proposal receipts, and append-only audit trail. |

Every table is protected by RLS. A signed-in member can only read their workspace. `viewer` is read-only; `owner`, `admin`, and `member` can write approved Ano records. `audit_logs` allows select/insert only—no client update or delete policy.

## Tool & provider safety matrix

| Capability | Current policy | Execution state |
| --- | --- | --- |
| Phase A research conversation & planning | Allow for signed-in workspace | Bedrock interprets briefs, asks at most one decision-changing question, and creates a versioned plan awaiting explicit approval. |
| Phase B private SearXNG discovery & source fetch | Separate explicit approval + budget ceiling | Up to 50 SearXNG searches and 100 safe fetches per mission; SSRF/content-type/size checks enforced server-side; uncertain outcomes require manual review and are never retried automatically. |
| Phase C citation-bound synthesis | Saved sources only | Bedrock sees only saved source IDs and excerpts; citation audit rejects ungrounded claims; target-route lock requires explicit user selection. |
| Prospeo company search | Locked `target_decisions` + free location preview + explicit approval | Re-anchored to `ano_conversations` and `target_decisions`; free suggestion canonicalization followed by strict 1-page (25-company, 1-credit max) `/search-company` execution with no automatic retries. |
| Prospeo people search | Shortlisted companies + role preview + explicit approval | Proposes buyer roles from Phase C claims and limits `/search-person` to 1 page (max 25 people) with no contact verification or auto-retry. |
| Selective Dropcontact verification | Explicit contact selection + preview + separate approval | Submits only user-checked 1–10 name/company pairs after credit disclosure; never bulk-enriches contacts automatically. |
| Outreach, calling & Mercury CRM proposals | Eligibility check + immutable per-action human approval | Compiles versioned drafts from approved playbooks, blocks suppressed or unverified email actions, and requires explicit `ApprovalCard` confirmation in `approval_decisions`; zero direct Mercury DB writes. |

## Database operation

Schema migrations live in `supabase/migrations/` (`000001` through `000019`). The application's runtime never uses a service-role key for DDL. To apply or verify migrations against Ano's dedicated database, set `SUPABASE_DB_URL` and `ANO_DATABASE_LABEL=ano` in `.env.local` and run:

```bash
npm run db:apply
npm run db:status
```

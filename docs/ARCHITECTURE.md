# Ano architecture

Ano is a standalone, tenant-safe sales research and planning product. Mercury is a future connector—not a shared backend, internal import, or database dependency.

```text
Browser client
  -> Next 16 Proxy refreshes the Supabase session
  -> Thin /api/v1 route validates input
  -> Workspace session resolves user, membership, and allowed domain
  -> Domain service owns the business action
  -> Agent policy guard permits, requests approval, or denies a tool
  -> Bounded agent runtime executes registered tools
  -> Ano-owned persistence records result, evidence, score, plan, and audit log
  -> Future connector adapter (Mercury, provider) only through declared capability
```

## Layers and ownership

| Layer | Location | Responsibility |
| --- | --- | --- |
| Public contracts | `src/contracts/` | Tool, guard, checkpoint, role, and workspace shapes. |
| Auth/session | `src/lib/supabase`, `src/proxy.ts`, `src/server/auth/` | Cookie refresh, server-validated identity, workspace membership, domain checks. |
| HTTP | `src/app/api/v1/` | Parse, validate, return safe errors; never implement business policy directly. |
| Domain | `src/server/domain/` | Research orchestration and user-initiated shortlist/review/dismiss decisions. |
| Policy | `src/server/policy/` | Tool allow/ask/deny decisions, limits, and audit labels. |
| Agent | `src/server/agents/` | Role contract, bounded runtime, evidence/scoring integrity, checkpoint support. |
| Persistence | `src/server/persistence/` | Idempotent runs and Ano-owned artefact writes through user-session RLS. |
| Connectors | `src/server/connectors/` | Capability-scoped adapters; disabled by default. |
| Jobs | `src/server/jobs/` | Safe stale-run recovery; it never retries external activity. |

## Schema groups

| Group | Tables | Purpose |
| --- | --- | --- |
| Identity | `workspaces`, `workspace_domains`, `workspace_members` | Workspace tenancy, roles, and optional email-domain policy. |
| Connections | `connector_connections` | Connector status, scopes, and credential references only—never raw secrets. |
| Research | `research_runs`, `icp_profiles`, `icp_briefs`, `evidence_items`, `work_items` | Resumable, evidence-backed ICP and research-planning artefacts. |
| Future targeting | `account_candidates`, `contact_candidates`, `scorecards`, `briefs` | Deferred until a real target account is selected or added. |
| Human control | `proposals`, `approval_decisions`, `notifications` | Future external-action proposals and review state. |
| Accountability | `audit_logs` | Append-only proposal, policy, tool, and outcome history. |

Every table is protected by RLS. A signed-in member can only read its workspace. `viewer` is read-only; `owner`, `admin`, and `member` can write approved Ano records. Audit records have only select/insert policies—no client update or delete policy.

## Tool safety matrix

| Tool category | Current policy | Execution state |
| --- | --- | --- |
| Standalone ICP setup | Allow only with a signed-in Ano workspace | User enters offer, target market, buyer, and objective; Bedrock creates a single source-constrained ICP and research plan. |
| Workspace evidence and readiness | Allow | Only manual record labels (`M-###`) are persisted; readiness measures ICP-context completeness, not market demand or buying intent. |
| Simulated company/contact/evidence research | Retired from public path | Internal test harness only; no public route or interface invokes it. |
| Mercury reads | Deny until connector Phase 3 | Adapter skeleton only; no database or API access. |
| Provider search/enrichment | Ask plus budget controls | Adapter skeleton only; no provider call. |
| Mercury proposals | Ask | Contract only; no write path. |
| Email, calls, campaign changes, generic browser/HTTP/SQL | Deny | No route or tool exists. |

## Current runtime boundary

The public runtime is a one-turn, server-only Bedrock ICP call. It receives a structured record supplied by a signed-in workspace member: product, value proposition, target market and locations, ideal customer, buyer roles, objective, and optional exclusions/context. Ano creates `M-###` manual-evidence labels before the model call. Bedrock receives no tool schema, no connector, no browser/HTTP capability, and no database access. Its JSON response must cite only these evidence IDs; any unknown citation, URL, malformed JSON, guardrail intervention, timeout, or incomplete response is rejected. Ano never substitutes a simulated result.

The public `/api/v1/brief` endpoint returns `410`: an account brief is deferred until a real target account exists. The public UI and `/api/v1/icp` create no prospect account, contact, scorecard, or outreach draft.

The earlier Phase 4A/4B mock-tool loop remains covered by regression tests but is retired from the public interface and `/api/v1/research` returns `410` rather than running it.

Bedrock never gains direct access to persistence, Mercury, providers, email, calls, browser/HTTP, SQL, or any external action. The server requires standard AWS IAM credentials—not a Bedrock API key—and exposes only safe error categories such as missing credentials, access denied, or invalid model/guardrail configuration. Guardrails do not inspect tool arguments or returned tool results, so Ano independently constrains all model inputs and validates the returned evidence labels.

## Durable-run contract

A research request includes a client idempotency UUID. `research_runs` has a unique `(workspace_id, idempotency_key)` pair. A repeat of a completed key returns the stored result; a running key returns a conflict. A stale run is marked failed, never silently replayed. This prevents duplicate writes now and prevents later provider spending from being retried unsafely.

## Database operation

The schema lives in [`supabase/migrations/20261021_000001_ano_workspace_and_research.sql`](../supabase/migrations/20261021_000001_ano_workspace_and_research.sql), with the manual-record update in [`supabase/migrations/20261021_000002_manual_workspace_records.sql`](../supabase/migrations/20261021_000002_manual_workspace_records.sql) and the Ano-only ICP records in [`supabase/migrations/20261021_000003_icp_profiles.sql`](../supabase/migrations/20261021_000003_icp_profiles.sql). The application’s service-role key is intentionally insufficient to run DDL.

To apply the schema, add these private values to `.env.local`:

```text
SUPABASE_DB_URL=
ANO_DATABASE_LABEL=ano
```

Then run:

```bash
npm run db:apply
npm run db:status
```

The script is transactional, records the migration in `ano_schema_migrations`, and refuses to run without the explicit Ano label. It must point at Ano’s dedicated Supabase database.

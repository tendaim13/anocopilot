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
| Research | `research_runs`, `account_candidates`, `contact_candidates`, `evidence_items`, `scorecards`, `briefs`, `work_items` | Resumable evidence-backed research artefacts. |
| Human control | `proposals`, `approval_decisions`, `notifications` | Future external-action proposals and review state. |
| Accountability | `audit_logs` | Append-only proposal, policy, tool, and outcome history. |

Every table is protected by RLS. A signed-in member can only read its workspace. `viewer` is read-only; `owner`, `admin`, and `member` can write approved Ano records. Audit records have only select/insert policies—no client update or delete policy.

## Tool safety matrix

| Tool category | Current policy | Execution state |
| --- | --- | --- |
| Simulated company/contact/evidence research | Allow | Implemented through the Phase 4A bounded mock loop; no network or credits. |
| Deterministic scoring and Ano plan creation | Allow | Implemented and validated before results are returned. |
| User shortlist, dismiss, review | Allow only if user-initiated | Implemented through Ano-owned state route. |
| Mercury reads | Deny until connector Phase 3 | Adapter skeleton only; no database or API access. |
| Provider search/enrichment | Ask plus budget controls | Adapter skeleton only; no provider call. |
| Mercury proposals | Ask | Contract only; no write path. |
| Email, calls, campaign changes, generic browser/HTTP/SQL | Deny | No route or tool exists. |

## Current runtime boundary

Phase 4A is an application-controlled mock executor. It executes five predefined registered tools in order, evaluates the policy before each tool, records a structured result, stops at its configured tool/turn/evidence/time limits, and writes Ano-owned audit records through the existing RLS session. The workbench displays the resulting tool trace and usage counters.

Phase 4B optionally places a server-only Bedrock Converse planner in front of that executor. It is enabled only when `ANO_AGENT_MODE=bedrock` and complete model/guardrail configuration is available. The planner receives only five no-argument mock tool schemas. Each `toolUse` must match the approved sequence, has its input independently validated, and receives a structured result with the matching `toolUseId`. Guardrail interventions, malformed output, timeouts, incomplete plans, and over-limit runs stop safely. The model’s final JSON answer is only displayed when every cited evidence ID is present in the Ano result; otherwise Ano provides a deterministic fallback.

Bedrock never gains direct access to persistence, Mercury, providers, email, calls, browser/HTTP, SQL, or any external action. Guardrails do not inspect tool arguments or returned tool results, so Ano validates and labels those values independently.

## Durable-run contract

A research request includes a client idempotency UUID. `research_runs` has a unique `(workspace_id, idempotency_key)` pair. A repeat of a completed key returns the stored result; a running key returns a conflict. A stale run is marked failed, never silently replayed. This prevents duplicate writes now and prevents later provider spending from being retried unsafely.

## Database operation

The schema lives in [`supabase/migrations/20261021_000001_ano_workspace_and_research.sql`](../supabase/migrations/20261021_000001_ano_workspace_and_research.sql). The application’s service-role key is intentionally insufficient to run DDL.

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

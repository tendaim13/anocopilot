# Ano Copilot: Phased Implementation Plan

## 1. Purpose and delivery decision

Build Ano as a standalone, tenant-safe Next.js application that uses the same agent-system shape as Mercury without sharing Mercury code, schema, or database.

Ano will be built around a single initial role—**Sales Research & Planning Copilot**—rather than several autonomous agents. The first role researches accounts, produces explainable scores, and builds a recommended work plan. It does not send email, alter campaigns, or mutate Mercury records directly.

This plan deliberately replaces the earlier one-step Bedrock prototype loop with a Mercury-style durable runtime:

```text
Ano UI
  → API and validated contracts
  → Domain and workspace policy
  → Agent runtime and bounded tool loop
  → Guardrails, approval gates, audit trail
  → Ano-owned database and connector adapters
  → Mercury / approved provider systems
```

## 2. Hard boundaries

| Boundary | Required implementation decision |
| --- | --- |
| Ano data | Ano owns its own authentication, workspace model, Postgres/Supabase database, audit data, secrets, and retention policy. |
| Mercury | Read through a narrow connector only. No direct Mercury database access, schema changes, migrations, or imports of Mercury internals. |
| Development server | Use Turbopack only: `next dev --turbopack`. Do not add or use webpack configuration or webpack development commands. |
| Bedrock | Server-side reasoning only. No browser-side model credentials. |
| Provider access | Workspace-scoped, explicit, budgeted, validated, and audited. |
| Scoring | Deterministic and versioned. The model explains score inputs but cannot silently change them. |
| External writes | Proposed first, then approved by a human. No autonomous sends or CRM mutations in the initial releases. |
| Evidence | Persist source, timestamp, tool, quoted/structured observation, and whether it is simulated. |

## 3. Architecture to reuse from Mercury

Ano should reuse these *patterns*, not Mercury's database entities or source files.

| Mercury pattern | Ano implementation |
| --- | --- |
| Typed agent contracts | `src/contracts/ano.ts`: run, tool, evidence, score, proposal, decision, and connector contracts. |
| Thin API routes | `src/app/api/v1/...`: parse input, require a session, then call domain services. |
| Domain services | `src/server/domain/...`: authorization, workspace scope, persistence, business rules. |
| Agent runtime | `src/server/agents/runtime.ts`: Bedrock chat model, bounded graph/tool loop, checkpointing, run context. |
| Tool registry | `src/server/agents/tools/...`: narrow wrappers for research, Mercury reads, scoring, and proposals. |
| Guard middleware | `src/server/agents/hooks/...`: allow, ask, deny, or shadow before a tool executes. |
| Durable run state | Ano-owned `ResearchRun`, `Proposal`, `Notification`, `AuditLog`, and `Evidence` records. |
| Resume flow | A paused run resumes after a user clarifies an ICP, chooses a shortlist, or approves/rejects a proposal. |
| Connector abstraction | `src/server/connectors/...`: Mercury, Prospeo, Dropcontact, and mock adapters behind common interfaces. |

## 4. Proposed project structure

```text
AnoCopilot/
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   ├── (workspace)/
│   │   │   ├── today/
│   │   │   ├── research/
│   │   │   ├── briefs/
│   │   │   ├── plan/
│   │   │   └── settings/
│   │   └── api/v1/
│   ├── contracts/
│   ├── client/services/
│   ├── server/
│   │   ├── http/
│   │   ├── policy/
│   │   ├── domain/
│   │   ├── agents/
│   │   │   ├── roles/
│   │   │   ├── tools/
│   │   │   ├── hooks/
│   │   │   ├── runtime.ts
│   │   │   ├── scoring.ts
│   │   │   ├── evidence.ts
│   │   │   └── resume.ts
│   │   ├── connectors/
│   │   │   ├── mercury/
│   │   │   ├── mock/
│   │   │   ├── prospeo/
│   │   │   └── dropcontact/
│   │   └── jobs/
│   └── components/
├── docs/
├── tests/
└── supabase/                 # Ano-owned migrations only, introduced in Phase 2
```

## 5. Initial agent role and allowed tools

### Role: Sales Research & Planning Copilot

The role accepts an ICP, research objective, and optionally existing Mercury account context. It can clarify missing inputs, collect approved evidence, calculate scores, rank opportunities, and recommend the next sales action.

### Tool tiers

| Tier | Tools | Default disposition |
| --- | --- | --- |
| Read-only, zero-credit | `search_companies` (mock), `search_people` (mock), `get_account_evidence` (mock), `get_mercury_lead`, `get_mercury_activity`, `get_campaign_context` | Auto in safe mode |
| Deterministic internal | `compute_score`, `build_today_plan`, `build_week_plan` | Auto after input validation |
| Credit-bearing | `provider_search`, `provider_enrich_contact` | Ask, then enforce budget and policy |
| Ano-owned state | `save_shortlist`, `dismiss_candidate`, `mark_for_review` | Ask or user-initiated only |
| Mercury write proposal | `propose_mercury_task`, `propose_mercury_draft`, `propose_mercury_update` | Create proposal only |
| Explicitly excluded initially | email send, campaign launch/edit, call placement, generic browser, generic SQL, direct Mercury write | Deny |

## 6. Tool-execution and safety model

Ano's model loop must be bounded and deterministic around side effects.

1. The model receives the user request, a concise workspace context, and allowed tool schemas.
2. The model proposes a tool call.
3. Ano validates the tool name and schema.
4. Ano checks workspace access, user permissions, connector availability, provider budget, data minimization, and run limits.
5. The hook returns `allow`, `ask`, `deny`, or `shadow`.
6. Only an allowed tool handler runs. The result is normalized, redacted where needed, and recorded as evidence or audit data.
7. The model receives that structured result and may continue until it reaches a final answer or the run limit.
8. Any approval request pauses the run and produces a reviewable proposal.
9. A user decision resumes the exact run from its checkpoint, and policy is re-evaluated before a tool executes.

### Required runtime limits

- Maximum tool calls per run
- Maximum graph/model turns per run
- Maximum provider-credit estimate per run
- Maximum evidence records attached to a brief
- Maximum user clarification attempts before the run is marked incomplete
- Time limit for a run and stale-run recovery

### Guardrails

Bedrock Guardrails may filter prompts and responses, but Ano must separately validate and redact tool arguments and results. Guardrails never replace application controls.

Initial guard categories:

- Workspace and user scope
- Tool allowlist
- Provider budget and disclosure limits
- External-action approval requirement
- Evidence-backed claim requirement
- Deterministic-score integrity
- Restricted sensitive data and credential handling
- Prompt-injection resistance in retrieved evidence

## 7. Ano-owned records to introduce in Phase 2

The exact field types and migrations are deferred until the implementation phase, but the data model needs these concepts. These are Ano records only; they do not modify Mercury.

| Record | Responsibility |
| --- | --- |
| Workspace and Membership | Tenant isolation, roles, ownership, settings. |
| ConnectorConnection | Encrypted configuration, status, scopes, and last sync/error state for Mercury and providers. |
| ResearchRun | Trigger, input, model mode, status, checkpoint key, start/end, failure state, budget usage. |
| EvidenceItem | Source, tool, observed claim, timestamp, source URL/reference, simulated/live label, account/contact association. |
| AccountCandidate and ContactCandidate | Discovery result, source metadata, lifecycle state, and linkage to shortlisted work. |
| Scorecard | Versioned deterministic components, score, confidence, exclusions, and score explanation inputs. |
| Brief | Evidence-backed summary, recommendation, confidence, and review state. |
| WorkItem | Ano-owned Today/This Week recommendation and its disposition. |
| Proposal | Any consequential suggested action, including a Mercury task or draft proposal. |
| ApprovalDecision | User approval, edit, rejection, dismissal, and rationale. |
| AuditLog | Append-only record of tool proposals, guard decisions, outcomes, provider usage, and approvals. |
| Notification | In-app reminders for paused approvals or newly ready research. |

## 8. Phased delivery

### Phase 0 — Clean foundation and contract baseline

**Goal:** Create a new, healthy Ano codebase before any feature implementation.

Build:

- Initialize a standalone Next.js TypeScript App Router project in this folder.
- Configure Turbopack-only development scripts.
- Add environment templates with names only, never live secrets.
- Establish lint, typecheck, formatting, test, and build scripts.
- Create the folder boundaries described above.
- Add product and implementation documentation from this baseline.
- Establish no-Mercury-write and no-live-provider feature flags.

Exit criteria:

- Clean local development starts with Turbopack.
- Production build and typecheck pass.
- No Mercury project files are changed.
- No provider request or Bedrock request can run by accident.

### Phase 1 — Product shell and simulated research workflow

**Goal:** Validate the rep experience with no real provider cost and no Mercury write-back.

Build:

- Mercury-aligned visual shell for Today, Research, Briefs, Plan, and Settings.
- Research form with objective, industry, geography, target role, exclusions, and result count.
- ICP clarification state for required missing inputs.
- Mock company, contact, and evidence datasets labelled simulated.
- Research run page with visible tool/evidence timeline.
- Candidate cards, scorecards, shortlist/dismiss/review states.
- Ano Brief with evidence-backed explanation and transparent scoring components.
- Ano-owned Today/This Week plan built from shortlisted candidates.

Safety:

- Only read-only mock tools exist.
- No contact reveal, enrichment, Mercury write, email send, generic web browser, or generic database tool.
- Deterministic scoring is authoritative.

Exit criteria:

- A user completes search → shortlist → brief → plan in one session.
- Each brief shows its simulated evidence trail and score inputs.
- The user can see why a candidate ranks above another.
- No real provider credits or Mercury writes are possible.

### Phase 2 — Workspace identity, persistence, and durable runs

**Goal:** Replace prototype-only state with real Ano workspace isolation and resumable workflows.

Build:

- Supabase authentication and server-side session validation.
- Ano-owned workspace and membership model.
- Row-level tenant isolation and domain authorization checks.
- Records listed in Section 7, with migrations only inside Ano's Supabase project.
- Durable research runs, evidence, shortlist states, scorecards, briefs, work items, proposals, and audit log.
- A checkpoint store for paused/resumed agent runs.
- Safe stale-run recovery and idempotency keys.

Exit criteria:

- A user sees only their workspace's records.
- Research can pause for clarification and resume without duplicating provider or save operations.
- Every tool proposal and outcome is attributable to a run and user.

### Phase 3 — Mercury connector, read-only

**Status:** Deferred by product decision. Ano remains fully standalone until a future connector phase is explicitly authorised.

**Goal:** Give Ano the context it needs from Mercury without coupling the products.

Build:

- A versioned Mercury connector interface with explicit read capabilities.
- Connection setup, connection health, and per-workspace credential management.
- Read models for lead data, conversation activity, campaign state, call outcomes, and next actions.
- Mapping from Mercury data into Ano's normalized account, activity, and evidence contracts.
- Connector sync/event idempotency and audit records.
- Today/This Week prioritization that considers Mercury engagement and urgency.

Safety:

- Read-only scope only.
- No direct database connection to Mercury.
- No reliance on Mercury internal tables or services beyond versioned connector responses.

Exit criteria:

- Ano can explain a plan item using Mercury activity without displaying unsupported claims.
- A disabled or failed Mercury connection cannot break standalone Ano research.

### Phase 4 — Agent runtime and Bedrock reasoning

**Current checkpoint — Phase 4A:** Implement the application-controlled mock-only loop first. It executes only the five registered mock/deterministic tools, enforces policy and limits before every step, validates evidence and score integrity, persists the run/audit trail, and shows a user-facing Run view. It makes no Bedrock, Mercury, provider, browser, HTTP, SQL, email, call, or external-action request.

**Phase 4B (future):** Add the server-side Bedrock planner only after the mock executor remains the sole authority for tool validation, bounded execution, tool-result handling, persistence, and approval boundaries.

**Goal:** Turn the workflow into a controlled, multi-step research agent.

Build:

- Server-side Bedrock adapter with a model configuration boundary.
- Bounded multi-tool loop using the chosen orchestration runtime.
- Structured tool-result return protocol and explicit handling of model completion, tool use, guardrail interruption, malformed calls, and timeouts.
- Sales Research & Planning system prompt that forbids unsupported claims and requests clarification when required ICP context is absent.
- Tool middleware and hooks implementing the policy model in Section 6.
- Evidence citation enforcement in brief generation.
- A Run view showing the user the intent, tool trail, evidence, proposal, and final answer.

Exit criteria:

- The model can perform a multi-step simulated research run.
- Every claim in the brief maps to actual evidence IDs or is labelled as an inference.
- Disallowed tool calls cannot execute, even if the model requests them.
- Run limits and error states are visible and recoverable.

### Phase 5 — Live provider adapters and cost controls

**Goal:** Connect approved customer-owned providers without uncontrolled data or credit use.

Build:

- Provider adapter interface with mock, Prospeo, and Dropcontact implementations.
- Workspace-level encrypted credential storage and connection testing.
- Provider capability declaration: search, preview, reveal, enrichment, bulk actions.
- Pre-flight credit estimate, confirmation, per-run limits, daily budget, and audit ledger.
- Data minimization and redaction before model exposure.
- Prospeo discovery flow where permitted by the customer's provider relationship.
- Selective Dropcontact enrichment after shortlist approval.

Safety:

- Do not expose provider data as a shared Mercury/Ano resale database.
- Do not enrich every result automatically.
- Revalidate provider terms, API access, pricing, credit expiry, and permitted use before enabling a live adapter.

Exit criteria:

- Every provider action identifies the workspace, user, estimated cost, actual usage, and resulting evidence.
- A failed provider operation cannot create a false evidence record or consume repeated credits through retries.

### Phase 6 — Proposals, approvals, and Mercury write-back

**Goal:** Deliver useful action without sacrificing human control.

Build:

- In-app proposal queue with approve, edit, reject, and dismiss decisions.
- Proposal types: Mercury task, CRM note/update, campaign enrollment suggestion, email draft, and call preparation.
- Exact diff/preview for each intended Mercury write.
- A separate Mercury write connector capability, disabled by default.
- Idempotency key and receipt for every approved connector action.
- In-app notification for awaiting decisions and failed writes.

Safety:

- Approval must be tied to a named user and fresh proposal version.
- Policy is re-evaluated immediately before the connector action.
- Email sending remains out of scope unless separately designed and approved.

Exit criteria:

- Users can approve an Ano recommendation and see exactly what Mercury received.
- Rejected or stale proposals never write through.
- The audit trail shows the proposal, decision, policy decision, connector receipt, and outcome.

### Phase 7 — Planner quality, team controls, and limited autonomy

**Goal:** Make the product operationally useful for teams while retaining explainability.

Build:

- Team-wide planning view with role-aware visibility.
- Workload balancing and follow-up risk indicators.
- Configurable score weights and approved playbooks, with version history.
- Workspace policies for auto-research of safe inputs and user-notification preferences.
- Evaluation set and regression tests for score consistency, evidence grounding, tool safety, and connector idempotency.

Autonomy rule:

- Autonomy begins only with read-only or Ano-owned state.
- Credit-bearing or external-write actions remain approval-gated unless a separately reviewed policy explicitly enables them.

Exit criteria:

- Changes to scoring or policies are versioned and explainable.
- A manager can identify why workload or priority changed.
- Evaluation and audit data make unsafe regressions visible before release.

### Phase 8 — Additional CRM connectors and product hardening

**Goal:** Prove the Ano core is portable beyond Mercury.

Build:

- Reusable connector contract tests.
- At least one additional CRM integration selected from HubSpot, Pipedrive, or Salesforce.
- Connector capability matrix and product-level permissions.
- Operational monitoring, backup/recovery, retention controls, and incident runbooks.
- Customer onboarding for connections, budgets, policies, and evidence expectations.

Exit criteria:

- The same research, scoring, planning, and proposal flow works through more than one CRM connector.
- Ano's core never requires access to a CRM's internal database.

## 9. Verification strategy

Every phase must include verification proportional to its risk.

| Area | Verification |
| --- | --- |
| Contracts | Unit tests for schemas, invalid input, and backward compatibility. |
| Scoring | Fixture-based tests with exact expected components and score versions. |
| Tools | Permit/deny/ask/shadow tests plus malformed tool-call tests. |
| Evidence | Ensure generated briefs cannot cite evidence that the run did not retrieve. |
| Provider budgets | Tests for estimates, caps, retries, double execution, and failures. |
| Tenant isolation | Workspace-scoping tests for every read and write. |
| Mercury connector | Contract tests, idempotency tests, disabled-write tests, and failure receipts. |
| UI | End-to-end research → shortlist → brief → plan → proposal scenarios. |
| Bedrock | Mocked tool-loop tests, then a controlled authenticated smoke test with limits. |

## 10. Deferred decisions

These should not be guessed during Phase 0 or Phase 1:

- Exact Ano database schema and migration tooling
- Long-term model and orchestration library selection
- Provider commercial/OEM terms and customer-key policy
- Mercury connector authentication mechanism and API capability contract
- Data retention duration and deletion workflow
- Whether and when email sending becomes a supported action
- Team-level autonomy thresholds

## 11. Current checkpoint and next action

Phase 0 and Phase 1 are implemented. Phase 2’s code and Ano-owned migration are implemented locally:

- Supabase server-session and workspace policy boundary
- Ano-owned tenant, research, evidence, scorecard, brief, work-item, proposal, decision, notification, and append-only audit tables
- RLS policies, domain-policy validation, idempotency, and stale-run recovery path
- Browser-local demo persistence when no Ano-specific Supabase project is configured

The migration has not been applied and live authentication has not been configured. The next required action is to provision Ano’s own Supabase project, apply the migration, configure an Auth method, and put that new project’s URL and publishable key in `AnoCopilot/.env.local`. Only then can the Phase 2 multi-user tenant-isolation exit criteria be exercised. Mercury, Bedrock, and providers remain out of scope until later phases.

# Ano Copilot

Ano is an independent AI sales-research and planning copilot. It helps a sales team find suitable accounts, research buying signals, rank opportunity quality, and turn existing sales activity into a clear day and week plan.

Mercury is Ano's first and deepest integration. Ano does **not** share Mercury's database, schema, credentials, or internal services. It reads Mercury through a narrow connector and proposes actions for a person to approve.

## Product documents

- [Product description](PRODUCT_DESCRIPTION.md) defines the user problem, product promise, core journeys, and boundaries.
- [Implementation plan](IMPLEMENTATION_PLAN.md) is the phased delivery contract, including the Mercury-style agent runtime, guardrails, connector model, and exit criteria.

## Non-negotiable boundaries

- Ano is a standalone application with its own authentication, workspace isolation, database, secrets, and audit trail.
- Mercury remains untouched: no Mercury database, schema, migration, or internal-service change is part of this project.
- Mercury is initially a read-first connector. Any future write-back is a human-approved proposal.
- Ano must use Turbopack for local development. Do not use or configure webpack.
- Bedrock is the reasoning layer. Deterministic application code owns tool permissions, provider budgets, evidence provenance, scoring, persistence, and approvals.
- No real provider credits are consumed until the relevant provider phase has passed review and workspace-level limits are working.

## Current status

Phase 1’s simulated research workbench runs locally with Turbopack. Phase 2’s Ano-owned workspace/session boundary, RLS migration, idempotent research-run repository, and browser-local demo persistence are implemented and applied to Ano’s dedicated Supabase project.

Phase 3 (the Mercury connector) is intentionally deferred. Phase 4A supplies the application-controlled, bounded mock-only tool loop. Phase 4B adds an optional server-only Bedrock Converse planner: it may request the five mock tools, but Ano validates every request, enforces order and limits, returns the matching structured tool result, validates the final evidence citations, persists the audit trail, and exposes the Run Trace to the user.

Bedrock remains off unless `ANO_AGENT_MODE=bedrock`. Live mode requires `AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION`, and standard AWS SDK credentials available to the server. It still uses simulated evidence only: no Mercury, provider, browser/HTTP, email, call, SQL, or external write path exists.

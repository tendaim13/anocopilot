# Ano Copilot

Ano is an independent AI sales-planning copilot. Its standalone core turns a workspace member’s offer, market, buyer, and sales-goal context into a reviewable ideal-customer profile (ICP) and research plan. External account discovery and enrichment are future, explicitly approved capabilities.

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

Ano has an authenticated, workspace-scoped ICP setup flow. It stores a user-entered offer, target market, locations, ideal-customer definition, buyer roles, objective, and exclusions; then creates evidence labels, an ICP-readiness score, a Bedrock-generated market brief, and review-only research-plan items in Ano’s own Supabase project. The follow-up migrations `20261021_000002_manual_workspace_records.sql` and `20261021_000003_icp_profiles.sql` add truthful manual records and Ano-only ICP storage.

Account briefs are deliberately deferred until a user selects or manually adds a real target account. The starting flow never invents an account, a contact, or outreach.

Phase 3 (the Mercury connector) and all provider adapters are intentionally deferred. The previous simulated research loop is retired from the public application path. Its safety tests remain as an internal reference; it neither runs from the interface nor supplies a fallback result.

Bedrock is enabled only when `ANO_AGENT_MODE=bedrock`. It does **not** use a Bedrock API key. The server needs `AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION`, plus a standard AWS SDK identity: either an IAM role/profile or `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (and `AWS_SESSION_TOKEN` for temporary credentials). Keep these server-only and out of Git. No Mercury, provider, browser/HTTP, email, call, SQL, or external write path exists.

# Phase 2: Ano-owned workspace setup

Phase 2 adds the persistence and tenancy boundary. It does not connect to Mercury, call Bedrock, or spend provider credits.

## What is implemented

- A Supabase server-session guard that obtains the authenticated user server-side.
- Ano-owned workspace, membership, domain-policy, research-run, evidence, scorecard, brief, work-item, proposal, decision, notification, and append-only audit records.
- Row-level security on every Ano table. A session can read only a workspace it belongs to; non-viewer members can create or update permitted Ano records; audit logs allow no client update or delete policy.
- A per-workspace idempotency key for a research run. Repeating a completed request returns its saved result; a running request is not duplicated.
- A safe stale-run recovery helper that marks the run failed and requires a fresh user-initiated run. It never reruns a provider or Mercury action.
- A local-only browser demo fallback for the existing mock workflow. It is visibly labelled as a demo and is disabled in production without Supabase configuration.

## Connect Ano to its own Supabase project

1. Create a dedicated Supabase project for Ano. Do not reuse or connect directly to Mercury’s database.
2. Add the project’s private PostgreSQL connection string as `SUPABASE_DB_URL` and set `ANO_DATABASE_LABEL=ano` in `.env.local`. Do not use the service-role key for DDL.
3. Run `npm run db:apply`, then `npm run db:status`. These commands apply and verify [`20261021_000001_ano_workspace_and_research.sql`](../supabase/migrations/20261021_000001_ano_workspace_and_research.sql) transactionally.
4. Populate these Ano project public values:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
   ```

5. Configure an approved Supabase Auth sign-in method and its redirect URL for local development.
6. Create the first workspace through the `create_ano_workspace(name, slug)` SQL function while signed in. This atomically creates its owner membership.
7. Restart `npm run dev`. The workspace endpoint will now require the server-validated session rather than using the local demo.

## Important boundaries

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the Supabase public client key. Never put service-role or Mercury credentials in browser variables.
- Ano uses the authenticated user session for RLS-controlled writes. No service-role key is required by the Phase 2 research route.
- `connector_connections` stores metadata and a credential reference, not raw provider or Mercury secrets.
- The Phase 2 database migration lives only under `AnoCopilot/supabase/`; it is not a Mercury migration.
- In a local build with no Ano credentials, `ANO_ALLOW_DEMO_MODE=true` uses browser-local demo persistence. This is a preview aid, not multi-user tenancy.

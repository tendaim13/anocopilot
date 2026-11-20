-- Ano durable execution leases. These timestamps do not restart work after a
-- server interruption. They make an orphaned request explicit, preserve the
-- no-retry boundary, and allow an approved continuation from saved evidence.

alter table public.ano_research_runs
  add column if not exists heartbeat_at timestamptz;

alter table public.ano_research_syntheses
  add column if not exists heartbeat_at timestamptz;

create index if not exists ano_research_runs_active_heartbeat_idx
  on public.ano_research_runs (workspace_id, status, heartbeat_at asc)
  where status = 'running';

create index if not exists ano_research_syntheses_active_heartbeat_idx
  on public.ano_research_syntheses (workspace_id, status, heartbeat_at asc)
  where status = 'running';

-- Ano Phase 13C (Remediation Phase 3): Durable background Autopilot jobs queue and leased execution state.

create table if not exists public.autopilot_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  autopilot_run_id uuid not null references public.autopilot_runs(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'completed', 'paused', 'cancelled', 'failed')),
  from_stage text null
    check (from_stage is null or from_stage in (
      'brief_and_plan',
      'market_research',
      'synthesis_and_lock',
      'company_discovery',
      'people_and_emails',
      'outreach_templates'
    )),
  worker_id text null,
  lease_token text null,
  lease_expires_at timestamptz null,
  heartbeat_at timestamptz null,
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= 10),
  max_attempts integer not null default 3 check (max_attempts >= 1 and max_attempts <= 10),
  checkpoint_json jsonb not null default '{}'::jsonb,
  outcome_note text null,
  available_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, idempotency_key)
);

create unique index if not exists autopilot_jobs_one_active_per_conversation_idx
  on public.autopilot_jobs (workspace_id, conversation_id)
  where status in ('queued', 'leased');

create index if not exists autopilot_jobs_dispatch_idx
  on public.autopilot_jobs (status, available_at asc, lease_expires_at asc)
  where status in ('queued', 'leased');

drop trigger if exists autopilot_jobs_set_updated_at on public.autopilot_jobs;
create trigger autopilot_jobs_set_updated_at
  before update on public.autopilot_jobs
  for each row execute function public.ano_set_updated_at();

alter table public.autopilot_jobs enable row level security;

drop policy if exists autopilot_jobs_read on public.autopilot_jobs;
create policy autopilot_jobs_read
  on public.autopilot_jobs for select to authenticated
  using (public.is_ano_workspace_member(workspace_id));

drop policy if exists autopilot_jobs_create on public.autopilot_jobs;
create policy autopilot_jobs_create
  on public.autopilot_jobs for insert to authenticated
  with check (public.can_write_ano_workspace(workspace_id) and requested_by = auth.uid());

drop policy if exists autopilot_jobs_update on public.autopilot_jobs;
create policy autopilot_jobs_update
  on public.autopilot_jobs for update to authenticated
  using (public.can_write_ano_workspace(workspace_id))
  with check (public.can_write_ano_workspace(workspace_id));

alter table public.autopilot_runs
  add column if not exists lease_expires_at timestamptz null;

alter table public.autopilot_runs
  add column if not exists worker_id text null;

alter table public.autopilot_runs
  add column if not exists active_job_id uuid null references public.autopilot_jobs(id) on delete set null;

alter table public.autopilot_runs
  add column if not exists recovery_count integer not null default 0 check (recovery_count >= 0);

alter table public.autopilot_runs
  add column if not exists progress_detail text null;

create index if not exists autopilot_runs_active_lease_idx
  on public.autopilot_runs (status, lease_expires_at asc, updated_at asc)
  where status = 'running';

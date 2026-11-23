-- Ano Phase 10C: Checkpointed autonomous 6-stage pipeline engine (autopilot_runs)
-- and autopilot plan approval mode tracking.

create table if not exists public.autopilot_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'paused', 'completed', 'completed_with_warnings', 'failed', 'cancelled')),
  current_stage text not null default 'brief_and_plan'
    check (current_stage in (
      'brief_and_plan',
      'market_research',
      'synthesis_and_lock',
      'company_discovery',
      'people_and_emails',
      'outreach_templates',
      'done'
    )),
  completed_stages_json jsonb not null default '[]'::jsonb,
  stage_summaries_json jsonb not null default '{}'::jsonb,
  warnings_json jsonb not null default '[]'::jsonb,
  stage_lease_token text null,
  stage_started_at timestamptz null,
  last_error text null,
  heartbeat_at timestamptz null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, conversation_id)
);

create index if not exists autopilot_runs_workspace_status_idx
  on public.autopilot_runs (workspace_id, status, updated_at desc);

drop trigger if exists autopilot_runs_set_updated_at on public.autopilot_runs;
create trigger autopilot_runs_set_updated_at
  before update on public.autopilot_runs
  for each row execute function public.ano_set_updated_at();

alter table public.autopilot_runs enable row level security;

drop policy if exists autopilot_runs_read on public.autopilot_runs;
create policy autopilot_runs_read
  on public.autopilot_runs for select to authenticated
  using (public.is_ano_workspace_member(workspace_id));

drop policy if exists autopilot_runs_create on public.autopilot_runs;
create policy autopilot_runs_create
  on public.autopilot_runs for insert to authenticated
  with check (public.can_write_ano_workspace(workspace_id) and created_by = auth.uid());

drop policy if exists autopilot_runs_update on public.autopilot_runs;
create policy autopilot_runs_update
  on public.autopilot_runs for update to authenticated
  using (public.can_write_ano_workspace(workspace_id))
  with check (public.can_write_ano_workspace(workspace_id));

alter table public.research_plans
  add column if not exists plan_approval_mode text not null default 'manual';

alter table public.research_plans
  drop constraint if exists research_plans_plan_approval_mode_check;

alter table public.research_plans
  add constraint research_plans_plan_approval_mode_check
  check (plan_approval_mode in ('manual', 'autopilot'));

-- Ano Phase B: durable market-scope checkpoints. These tables do not connect
-- to a provider and cannot contain a provider result.

alter table public.market_hypotheses drop constraint market_hypotheses_status_check;
alter table public.market_hypotheses add constraint market_hypotheses_status_check check (status in ('draft', 'awaiting_scope_decision', 'active', 'scope_locked', 'archived'));

create table public.market_scans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  product_brief_id uuid not null references public.product_briefs(id) on delete cascade,
  scope_json jsonb not null,
  comparison_criteria_json jsonb not null default '[]'::jsonb,
  evidence_ids jsonb not null default '[]'::jsonb,
  provider_key text not null default 'prospeo' check (provider_key in ('prospeo')),
  status text not null check (status in ('not_started', 'awaiting_provider_approval', 'blocked_provider')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id)
);

create index market_scans_workspace_status_idx on public.market_scans (workspace_id, status, created_at desc);
create trigger market_scans_set_updated_at before update on public.market_scans for each row execute function public.ano_set_updated_at();

alter table public.market_scans enable row level security;
create policy market_scan_read on public.market_scans for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy market_scan_create on public.market_scans for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy market_scan_update on public.market_scans for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

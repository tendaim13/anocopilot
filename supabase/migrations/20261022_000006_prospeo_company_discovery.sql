-- Ano Phase C: one-page, explicitly approved Prospeo company discovery.
-- This migration stores no provider credentials and does not enable contact
-- enrichment, CRM writes, or outreach. A search stays bounded to one page.

alter table public.market_scans drop constraint market_scans_status_check;
alter table public.market_scans add constraint market_scans_status_check check (
  status in (
    'not_started',
    'awaiting_provider_approval',
    'blocked_provider',
    'preview_ready',
    'search_in_progress',
    'completed',
    'requires_manual_review'
  )
);

create table public.provider_company_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  product_brief_id uuid not null references public.product_briefs(id) on delete cascade,
  provider_key text not null default 'prospeo' check (provider_key in ('prospeo')),
  request_hash text not null,
  scope_json jsonb not null,
  filters_json jsonb not null,
  criteria_json jsonb not null default '[]'::jsonb,
  canonical_locations_json jsonb not null default '[]'::jsonb,
  maximum_results smallint not null default 25 check (maximum_results = 25),
  estimated_max_credits smallint not null default 1 check (estimated_max_credits = 1),
  status text not null check (status in ('awaiting_approval', 'running', 'completed', 'requires_manual_review', 'failed')),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  result_count integer check (result_count is null or result_count >= 0),
  provider_receipt_json jsonb not null default '{}'::jsonb,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id)
);

create index provider_company_searches_workspace_status_idx on public.provider_company_searches (workspace_id, status, created_at desc);
create trigger provider_company_searches_set_updated_at before update on public.provider_company_searches for each row execute function public.ano_set_updated_at();

alter table public.provider_company_searches enable row level security;
create policy provider_company_search_read on public.provider_company_searches for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy provider_company_search_create on public.provider_company_searches for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy provider_company_search_update on public.provider_company_searches for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

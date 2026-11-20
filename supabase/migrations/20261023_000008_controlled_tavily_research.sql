-- Ano Phase B: provider-gated public evidence collection.
-- This migration is Ano-only. It contains no provider secret, contact record,
-- company discovery, Mercury reference, or outbound communication capability.

-- Tavily is an evidence provider, rather than a sales-data connector. Retain
-- the connector record strictly for workspace-level availability/audit state;
-- its credential remains server-only in TAVILY_API_KEY.
alter table public.connector_connections drop constraint if exists connector_connections_connector_key_check;
alter table public.connector_connections add constraint connector_connections_connector_key_check
  check (connector_key in ('mercury', 'prospeo', 'dropcontact', 'tavily'));

create table public.ano_research_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  graph_run_id uuid not null references public.ano_graph_runs(id) on delete cascade,
  research_plan_id uuid not null references public.research_plans(id) on delete restrict,
  thread_id text not null unique,
  provider_key text not null check (provider_key in ('tavily')),
  status text not null check (status in ('awaiting_provider_approval', 'running', 'sources_ready', 'requires_manual_review', 'failed_safe')),
  maximum_searches smallint not null check (maximum_searches between 1 and 12),
  maximum_fetches smallint not null check (maximum_fetches between 1 and 30),
  query_plan_json jsonb not null default '[]'::jsonb,
  failure_message text,
  started_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, conversation_id, research_plan_id)
);

create table public.provider_action_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ano_research_run_id uuid not null references public.ano_research_runs(id) on delete cascade,
  provider_key text not null check (provider_key in ('tavily')),
  action_kind text not null check (action_kind in ('research_run', 'search', 'fetch')),
  request_key text not null,
  request_json jsonb not null default '{}'::jsonb,
  status text not null check (status in ('awaiting_approval', 'running', 'succeeded', 'failed_safe', 'requires_manual_review')),
  maximum_operations smallint not null check (maximum_operations between 0 and 42),
  reported_credits numeric(12,4),
  provider_receipt_json jsonb not null default '{}'::jsonb,
  failure_message text,
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (ano_research_run_id, request_key)
);

create table public.research_search_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ano_research_run_id uuid not null references public.ano_research_runs(id) on delete cascade,
  provider_action_request_id uuid not null references public.provider_action_requests(id) on delete cascade,
  provider_result_id text not null,
  rank smallint not null check (rank between 1 and 5),
  title text not null,
  url text not null,
  canonical_url text not null,
  snippet text,
  provider_score numeric(12,8),
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (provider_action_request_id, provider_result_id),
  unique (ano_research_run_id, canonical_url)
);

create table public.research_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ano_research_run_id uuid not null references public.ano_research_runs(id) on delete cascade,
  search_result_id uuid not null unique references public.research_search_results(id) on delete cascade,
  provider_action_request_id uuid not null references public.provider_action_requests(id) on delete cascade,
  title text not null,
  canonical_url text not null,
  source_class text not null check (source_class in ('official', 'industry', 'company', 'independent', 'other')),
  content_type text,
  supporting_excerpt text,
  content_hash text,
  published_at timestamptz,
  retrieved_at timestamptz not null default timezone('utc', now()),
  status text not null check (status in ('fetched', 'failed_safe', 'rejected')),
  failure_message text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (ano_research_run_id, canonical_url)
);

create index ano_research_runs_workspace_status_idx on public.ano_research_runs (workspace_id, status, updated_at desc);
create index provider_action_requests_run_status_idx on public.provider_action_requests (ano_research_run_id, status, created_at asc);
create index research_search_results_run_rank_idx on public.research_search_results (ano_research_run_id, provider_score desc nulls last, rank asc);
create index research_sources_run_retrieved_idx on public.research_sources (ano_research_run_id, retrieved_at asc);

create trigger ano_research_runs_set_updated_at before update on public.ano_research_runs for each row execute function public.ano_set_updated_at();
create trigger provider_action_requests_set_updated_at before update on public.provider_action_requests for each row execute function public.ano_set_updated_at();

alter table public.ano_research_runs enable row level security;
alter table public.provider_action_requests enable row level security;
alter table public.research_search_results enable row level security;
alter table public.research_sources enable row level security;

create policy ano_research_run_read on public.ano_research_runs for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy ano_research_run_create on public.ano_research_runs for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and started_by = auth.uid());
create policy ano_research_run_update on public.ano_research_runs for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy provider_action_request_read on public.provider_action_requests for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy provider_action_request_create on public.provider_action_requests for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and created_by = auth.uid());
create policy provider_action_request_update on public.provider_action_requests for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy research_search_result_read on public.research_search_results for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy research_search_result_create on public.research_search_results for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy research_search_result_update on public.research_search_results for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy research_source_read on public.research_sources for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy research_source_create on public.research_sources for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy research_source_update on public.research_sources for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

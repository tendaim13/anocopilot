-- Ano iterative deep research: bounded, evidence-led research missions.
-- This is Ano-only. It preserves historic research runs and never enables
-- company discovery, contact enrichment, outreach, or Mercury access.

alter table public.ano_research_runs
  drop constraint if exists ano_research_runs_maximum_searches_check;
alter table public.ano_research_runs
  drop constraint if exists ano_research_runs_maximum_fetches_check;
alter table public.ano_research_runs
  add constraint ano_research_runs_maximum_searches_check
    check (maximum_searches between 1 and 50),
  add constraint ano_research_runs_maximum_fetches_check
    check (maximum_fetches between 1 and 100);

alter table public.provider_action_requests
  drop constraint if exists provider_action_requests_maximum_operations_check;
alter table public.provider_action_requests
  add constraint provider_action_requests_maximum_operations_check
    check (maximum_operations between 0 and 150);

alter table public.research_sources
  drop constraint if exists research_sources_source_class_check;
alter table public.research_sources
  add constraint research_sources_source_class_check
    check (source_class in ('official', 'academic', 'industry', 'company', 'vendor', 'independent', 'other'));

alter table public.ano_research_runs
  add column if not exists consumed_searches smallint not null default 0 check (consumed_searches >= 0),
  add column if not exists consumed_fetches smallint not null default 0 check (consumed_fetches >= 0),
  add column if not exists current_wave smallint not null default 0 check (current_wave >= 0),
  add column if not exists coverage_json jsonb not null default '{}'::jsonb;

create table public.research_waves (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ano_research_run_id uuid not null references public.ano_research_runs(id) on delete cascade,
  wave_number smallint not null check (wave_number between 1 and 8),
  objective text not null check (char_length(trim(objective)) between 1 and 500),
  candidate_markets_json jsonb not null default '[]'::jsonb,
  status text not null check (status in ('planned', 'running', 'assessed', 'completed', 'stopped')),
  search_budget smallint not null check (search_budget between 0 and 50),
  fetch_budget smallint not null check (fetch_budget between 0 and 100),
  coverage_before_json jsonb not null default '{}'::jsonb,
  coverage_after_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  unique (ano_research_run_id, wave_number)
);

create table public.research_queries (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ano_research_run_id uuid not null references public.ano_research_runs(id) on delete cascade,
  research_wave_id uuid not null references public.research_waves(id) on delete cascade,
  query text not null check (char_length(trim(query)) between 3 and 380),
  reason text not null check (char_length(trim(reason)) between 1 and 320),
  candidate_market text,
  comparison_dimension text not null check (comparison_dimension in ('problem_urgency', 'market_density', 'buyer_conditions', 'market_access', 'solution_fit', 'counter_evidence')),
  intended_source_class text not null check (intended_source_class in ('Government and official statistics', 'Industry bodies and primary research', 'Public company reports and filings', 'Independent reporting')),
  priority smallint not null check (priority between 1 and 100),
  status text not null check (status in ('planned', 'searched', 'stopped')),
  created_at timestamptz not null default timezone('utc', now()),
  unique (ano_research_run_id, query)
);

alter table public.research_search_results
  add column if not exists research_query_id uuid references public.research_queries(id) on delete set null;

create table public.research_source_assessments (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ano_research_run_id uuid not null references public.ano_research_runs(id) on delete cascade,
  research_source_id uuid not null unique references public.research_sources(id) on delete cascade,
  authority_score numeric(5,2) not null check (authority_score between 0 and 100),
  query_directness_score numeric(5,2) not null check (query_directness_score between 0 and 100),
  freshness_score numeric(5,2) not null check (freshness_score between 0 and 100),
  diversity_score numeric(5,2) not null check (diversity_score between 0 and 100),
  extractability_score numeric(5,2) not null check (extractability_score between 0 and 100),
  redundancy_penalty numeric(5,2) not null check (redundancy_penalty between 0 and 30),
  overall_score numeric(5,2) not null check (overall_score between 0 and 100),
  decision_relevant boolean not null,
  assessment_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index research_waves_run_number_idx on public.research_waves (ano_research_run_id, wave_number asc);
create index research_queries_run_wave_idx on public.research_queries (ano_research_run_id, research_wave_id, priority desc);
create index research_search_results_query_idx on public.research_search_results (research_query_id, provider_score desc nulls last);
create index research_source_assessments_run_score_idx on public.research_source_assessments (ano_research_run_id, overall_score desc);

alter table public.research_waves enable row level security;
alter table public.research_queries enable row level security;
alter table public.research_source_assessments enable row level security;

create policy research_wave_read on public.research_waves for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy research_wave_create on public.research_waves for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy research_wave_update on public.research_waves for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy research_query_read on public.research_queries for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy research_query_create on public.research_queries for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy research_query_update on public.research_queries for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy research_source_assessment_read on public.research_source_assessments for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy research_source_assessment_create on public.research_source_assessments for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy research_source_assessment_update on public.research_source_assessments for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

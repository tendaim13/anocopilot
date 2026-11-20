-- Ano Phase D (UI Phase 6): signals, explainable cohorts & Prospeo account discovery.
-- Re-anchors company search previews and discovered account candidates to
-- Phase C locked target decisions and ano_conversations, while retaining
-- legacy market_briefs / research_runs rows intact read-only for audit history.

-- 1. Expand provider_action_requests to audit zero-credit Prospeo previews and
--    1-page (max 25 companies / max 1 credit) Prospeo company searches.
alter table public.provider_action_requests
  drop constraint if exists provider_action_requests_provider_key_check;

alter table public.provider_action_requests
  add constraint provider_action_requests_provider_key_check
  check (provider_key in ('tavily', 'searxng', 'prospeo'));

alter table public.provider_action_requests
  drop constraint if exists provider_action_requests_action_kind_check;

alter table public.provider_action_requests
  add constraint provider_action_requests_action_kind_check
  check (action_kind in ('research_run', 'search', 'fetch', 'company_search_preview', 'company_search'));

-- 2. Re-anchor provider_company_searches to ano_conversations & target_decisions.
alter table public.provider_company_searches
  alter column research_run_id drop not null,
  alter column product_brief_id drop not null;

alter table public.provider_company_searches
  add column if not exists conversation_id uuid references public.ano_conversations(id) on delete cascade,
  add column if not exists target_decision_id uuid references public.target_decisions(id) on delete cascade,
  add column if not exists provider_action_request_id uuid references public.provider_action_requests(id) on delete set null,
  add column if not exists claim_ids_json jsonb not null default '[]'::jsonb,
  add column if not exists excluded_categories_json jsonb not null default '[]'::jsonb,
  add column if not exists cohort_summary_json jsonb not null default '{}'::jsonb;

alter table public.provider_company_searches
  drop constraint if exists provider_company_searches_status_check;

alter table public.provider_company_searches
  add constraint provider_company_searches_status_check
  check (status in ('awaiting_approval', 'running', 'completed', 'requires_manual_review', 'failed', 'failed_safe'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.provider_company_searches'::regclass
      and conname = 'provider_company_searches_workspace_target_decision_key'
  ) then
    alter table public.provider_company_searches
      add constraint provider_company_searches_workspace_target_decision_key
      unique (workspace_id, target_decision_id);
  end if;
end $$;

create index if not exists provider_company_searches_conversation_idx
  on public.provider_company_searches (workspace_id, conversation_id, created_at desc);

-- 3. Re-anchor account_candidates with structured company signals, fit scores,
--    and explicit separation from Phase C industry claim IDs.
alter table public.account_candidates
  alter column research_run_id drop not null;

alter table public.account_candidates
  add column if not exists conversation_id uuid references public.ano_conversations(id) on delete cascade,
  add column if not exists target_decision_id uuid references public.target_decisions(id) on delete cascade,
  add column if not exists company_search_id uuid references public.provider_company_searches(id) on delete cascade,
  add column if not exists provider_action_request_id uuid references public.provider_action_requests(id) on delete set null,
  add column if not exists signals_json jsonb not null default '[]'::jsonb,
  add column if not exists claim_ids jsonb not null default '[]'::jsonb,
  add column if not exists fit_score numeric(5, 2) check (fit_score is null or (fit_score >= 0 and fit_score <= 100)),
  add column if not exists fit_confidence text check (fit_confidence is null or fit_confidence in ('high', 'medium', 'low')),
  add column if not exists fit_breakdown_json jsonb not null default '{}'::jsonb,
  add column if not exists evidence_urls_json jsonb not null default '[]'::jsonb,
  add column if not exists unknowns_json jsonb not null default '[]'::jsonb,
  add column if not exists retrieved_at timestamptz not null default timezone('utc', now());

alter table public.account_candidates
  drop constraint if exists account_candidates_lifecycle_state_check;

alter table public.account_candidates
  add constraint account_candidates_lifecycle_state_check
  check (lifecycle_state in ('discovered', 'shortlisted', 'held', 'dismissed', 'review'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.account_candidates'::regclass
      and conname = 'account_candidates_workspace_search_source_key_key'
  ) then
    alter table public.account_candidates
      add constraint account_candidates_workspace_search_source_key_key
      unique (workspace_id, company_search_id, source_key);
  end if;
end $$;

create index if not exists account_candidates_conversation_idx
  on public.account_candidates (workspace_id, conversation_id, created_at desc);

create index if not exists account_candidates_company_search_idx
  on public.account_candidates (company_search_id, created_at asc);

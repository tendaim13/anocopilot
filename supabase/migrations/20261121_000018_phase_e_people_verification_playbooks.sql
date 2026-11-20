-- Ano Phase E (UI Phase 7): buyer-role & named-person discovery,
-- selective Dropcontact verification, and factual account playbooks.
-- Keeps historic Phase D and legacy rows intact; every person and playbook
-- remains tied to shortlisted account_candidates and explicit provider receipts.

-- 1. Expand provider_action_requests to audit Prospeo person searches and
--    Dropcontact verification previews/executions.
alter table public.provider_action_requests
  drop constraint if exists provider_action_requests_provider_key_check;

alter table public.provider_action_requests
  add constraint provider_action_requests_provider_key_check
  check (provider_key in ('tavily', 'searxng', 'prospeo', 'dropcontact'));

alter table public.provider_action_requests
  drop constraint if exists provider_action_requests_action_kind_check;

alter table public.provider_action_requests
  add constraint provider_action_requests_action_kind_check
  check (
    action_kind in (
      'research_run',
      'search',
      'fetch',
      'company_search_preview',
      'company_search',
      'person_search_preview',
      'person_search',
      'contact_verification_preview',
      'contact_verification'
    )
  );

-- 2. Stage A: Role recommendations & bounded 1-page Prospeo person search.
create table if not exists public.provider_person_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  target_decision_id uuid not null references public.target_decisions(id) on delete cascade,
  provider_action_request_id uuid references public.provider_action_requests(id) on delete set null,
  provider_key text not null default 'prospeo' check (provider_key in ('prospeo')),
  shortlisted_account_ids_json jsonb not null default '[]'::jsonb,
  role_recommendations_json jsonb not null default '[]'::jsonb,
  approved_roles_json jsonb not null default '[]'::jsonb,
  filters_json jsonb not null default '{}'::jsonb,
  maximum_results smallint not null default 25 check (maximum_results = 25),
  estimated_max_credits smallint not null default 1 check (estimated_max_credits = 1),
  status text not null check (status in ('awaiting_approval', 'running', 'completed', 'requires_manual_review', 'failed_safe')),
  result_count integer check (result_count is null or result_count >= 0),
  provider_receipt_json jsonb not null default '{}'::jsonb,
  failure_message text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, target_decision_id)
);

create index if not exists provider_person_searches_conversation_idx
  on public.provider_person_searches (workspace_id, conversation_id, created_at desc);

drop trigger if exists provider_person_searches_set_updated_at on public.provider_person_searches;
create trigger provider_person_searches_set_updated_at
  before update on public.provider_person_searches
  for each row execute function public.ano_set_updated_at();

alter table public.provider_person_searches enable row level security;

drop policy if exists provider_person_search_read on public.provider_person_searches;
create policy provider_person_search_read
  on public.provider_person_searches for select to authenticated
  using (public.is_ano_workspace_member(workspace_id));

drop policy if exists provider_person_search_create on public.provider_person_searches;
create policy provider_person_search_create
  on public.provider_person_searches for insert to authenticated
  with check (public.can_write_ano_workspace(workspace_id));

drop policy if exists provider_person_search_update on public.provider_person_searches;
create policy provider_person_search_update
  on public.provider_person_searches for update to authenticated
  using (public.can_write_ano_workspace(workspace_id))
  with check (public.can_write_ano_workspace(workspace_id));

-- 3. Re-anchor contact_candidates cleanly separating named identity from verification.
alter table public.contact_candidates
  alter column research_run_id drop not null;

alter table public.contact_candidates
  add column if not exists conversation_id uuid references public.ano_conversations(id) on delete cascade,
  add column if not exists target_decision_id uuid references public.target_decisions(id) on delete cascade,
  add column if not exists person_search_id uuid references public.provider_person_searches(id) on delete cascade,
  add column if not exists discovery_action_request_id uuid references public.provider_action_requests(id) on delete set null,
  add column if not exists verification_action_request_id uuid references public.provider_action_requests(id) on delete set null,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists seniority text,
  add column if not exists department text,
  add column if not exists linkedin_url text,
  add column if not exists location text,
  add column if not exists role_rationale text,
  add column if not exists confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
  add column if not exists claim_ids jsonb not null default '[]'::jsonb,
  add column if not exists selected_for_verification boolean not null default false,
  add column if not exists verification_status text not null default 'not_requested'
    check (verification_status in ('not_requested', 'awaiting_approval', 'running', 'verified', 'unverified', 'requires_manual_review', 'failed_safe')),
  add column if not exists verified_details_json jsonb,
  add column if not exists provider_receipt_json jsonb not null default '{}'::jsonb,
  add column if not exists retrieved_at timestamptz not null default timezone('utc', now()),
  add column if not exists verified_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.contact_candidates'::regclass
      and conname = 'contact_candidates_workspace_person_search_source_key_key'
  ) then
    alter table public.contact_candidates
      add constraint contact_candidates_workspace_person_search_source_key_key
      unique (workspace_id, person_search_id, source_key);
  end if;
end $$;

create index if not exists contact_candidates_conversation_idx
  on public.contact_candidates (workspace_id, conversation_id, created_at desc);

-- 4. Stage B: Selective Dropcontact verification runs.
create table if not exists public.contact_verification_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  person_search_id uuid not null references public.provider_person_searches(id) on delete cascade,
  provider_action_request_id uuid references public.provider_action_requests(id) on delete set null,
  provider_key text not null default 'dropcontact' check (provider_key in ('dropcontact')),
  selected_contact_ids_json jsonb not null default '[]'::jsonb,
  preview_pairs_json jsonb not null default '[]'::jsonb,
  estimated_credits smallint not null default 0 check (estimated_credits >= 0),
  status text not null check (status in ('awaiting_approval', 'running', 'completed', 'requires_manual_review', 'failed_safe')),
  verified_count integer check (verified_count is null or verified_count >= 0),
  provider_receipt_json jsonb not null default '{}'::jsonb,
  failure_message text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, person_search_id)
);

create index if not exists contact_verification_runs_conversation_idx
  on public.contact_verification_runs (workspace_id, conversation_id, created_at desc);

drop trigger if exists contact_verification_runs_set_updated_at on public.contact_verification_runs;
create trigger contact_verification_runs_set_updated_at
  before update on public.contact_verification_runs
  for each row execute function public.ano_set_updated_at();

alter table public.contact_verification_runs enable row level security;

drop policy if exists contact_verification_run_read on public.contact_verification_runs;
create policy contact_verification_run_read
  on public.contact_verification_runs for select to authenticated
  using (public.is_ano_workspace_member(workspace_id));

drop policy if exists contact_verification_run_create on public.contact_verification_runs;
create policy contact_verification_run_create
  on public.contact_verification_runs for insert to authenticated
  with check (public.can_write_ano_workspace(workspace_id));

drop policy if exists contact_verification_run_update on public.contact_verification_runs;
create policy contact_verification_run_update
  on public.contact_verification_runs for update to authenticated
  using (public.can_write_ano_workspace(workspace_id))
  with check (public.can_write_ano_workspace(workspace_id));

-- 5. Stage C: Factual evidence-backed account playbooks.
create table if not exists public.account_playbooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  target_decision_id uuid not null references public.target_decisions(id) on delete cascade,
  account_candidate_id uuid not null references public.account_candidates(id) on delete cascade,
  selected_contact_ids_json jsonb not null default '[]'::jsonb,
  claim_ids_json jsonb not null default '[]'::jsonb,
  signal_ids_json jsonb not null default '[]'::jsonb,
  status text not null default 'ready' check (status in ('draft', 'ready', 'approved')),
  headline text not null check (char_length(trim(headline)) between 1 and 240),
  account_thesis text not null check (char_length(trim(account_thesis)) between 1 and 1200),
  industry_context text not null check (char_length(trim(industry_context)) between 1 and 1200),
  buyer_angles_json jsonb not null default '[]'::jsonb,
  evidence_backed_points_json jsonb not null default '[]'::jsonb,
  validation_questions_json jsonb not null default '[]'::jsonb,
  unknowns_json jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, conversation_id, account_candidate_id)
);

create index if not exists account_playbooks_workspace_conversation_idx
  on public.account_playbooks (workspace_id, conversation_id, created_at desc);

drop trigger if exists account_playbooks_set_updated_at on public.account_playbooks;
create trigger account_playbooks_set_updated_at
  before update on public.account_playbooks
  for each row execute function public.ano_set_updated_at();

alter table public.account_playbooks enable row level security;

drop policy if exists account_playbook_read on public.account_playbooks;
create policy account_playbook_read
  on public.account_playbooks for select to authenticated
  using (public.is_ano_workspace_member(workspace_id));

drop policy if exists account_playbook_create on public.account_playbooks;
create policy account_playbook_create
  on public.account_playbooks for insert to authenticated
  with check (public.can_write_ano_workspace(workspace_id));

drop policy if exists account_playbook_update on public.account_playbooks;
create policy account_playbook_update
  on public.account_playbooks for update to authenticated
  using (public.can_write_ano_workspace(workspace_id))
  with check (public.can_write_ano_workspace(workspace_id));

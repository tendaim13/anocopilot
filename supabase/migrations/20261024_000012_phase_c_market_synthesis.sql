-- Ano Phase C: evidence-bound market and industry synthesis.
-- This migration is Ano-only. It does not add company, person, outreach, or
-- Mercury data access. Every conclusion persists the saved source IDs that
-- support it so the UI can distinguish evidence from Ano's inference.

create table public.ano_research_syntheses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  ano_research_run_id uuid not null references public.ano_research_runs(id) on delete cascade,
  status text not null check (status in ('awaiting_analysis', 'running', 'ready_for_decision', 'insufficient_evidence', 'requires_manual_review', 'failed_safe')),
  assessment_json jsonb not null default '{}'::jsonb,
  failure_message text,
  created_by uuid not null references auth.users(id) on delete restrict,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, ano_research_run_id)
);

create table public.research_claims (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  synthesis_id uuid not null references public.ano_research_syntheses(id) on delete cascade,
  ano_research_run_id uuid not null references public.ano_research_runs(id) on delete cascade,
  claim_kind text not null check (claim_kind in ('observation', 'inference', 'hypothesis', 'uncertainty')),
  statement text not null check (char_length(trim(statement)) between 1 and 700),
  source_ids jsonb not null,
  evidence_strength text not null check (evidence_strength in ('strong', 'moderate', 'limited', 'insufficient')),
  citation_status text not null check (citation_status in ('supported', 'limited', 'needs_review')),
  created_at timestamptz not null default timezone('utc', now())
);

create table public.market_profiles (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  synthesis_id uuid not null references public.ano_research_syntheses(id) on delete cascade,
  ano_research_run_id uuid not null references public.ano_research_runs(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 140),
  summary text not null check (char_length(trim(summary)) between 1 and 700),
  evidence_strength text not null check (evidence_strength in ('strong', 'moderate', 'limited', 'insufficient')),
  claim_ids jsonb not null,
  unknowns_json jsonb not null default '[]'::jsonb,
  next_research_actions_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.industry_profiles (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  synthesis_id uuid not null references public.ano_research_syntheses(id) on delete cascade,
  ano_research_run_id uuid not null references public.ano_research_runs(id) on delete cascade,
  market_profile_id uuid references public.market_profiles(id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 140),
  summary text not null check (char_length(trim(summary)) between 1 and 700),
  operational_problems_json jsonb not null default '[]'::jsonb,
  solution_fit_json jsonb not null default '[]'::jsonb,
  buyer_role_hypotheses_json jsonb not null default '[]'::jsonb,
  evidence_strength text not null check (evidence_strength in ('strong', 'moderate', 'limited', 'insufficient')),
  claim_ids jsonb not null,
  unknowns_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.target_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  synthesis_id uuid not null references public.ano_research_syntheses(id) on delete cascade,
  market_profile_id uuid references public.market_profiles(id) on delete restrict,
  industry_profile_id uuid references public.industry_profiles(id) on delete restrict,
  status text not null check (status in ('awaiting_selection', 'locked', 'rejected')),
  rationale text,
  selected_by uuid references auth.users(id) on delete set null,
  selected_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, synthesis_id)
);

create index ano_research_syntheses_conversation_idx on public.ano_research_syntheses (workspace_id, conversation_id, updated_at desc);
create index research_claims_synthesis_idx on public.research_claims (synthesis_id, created_at asc);
create index market_profiles_synthesis_idx on public.market_profiles (synthesis_id, created_at asc);
create index industry_profiles_synthesis_idx on public.industry_profiles (synthesis_id, created_at asc);
create index target_decisions_conversation_idx on public.target_decisions (workspace_id, conversation_id, updated_at desc);

create trigger ano_research_syntheses_set_updated_at before update on public.ano_research_syntheses for each row execute function public.ano_set_updated_at();
create trigger target_decisions_set_updated_at before update on public.target_decisions for each row execute function public.ano_set_updated_at();

alter table public.ano_research_syntheses enable row level security;
alter table public.research_claims enable row level security;
alter table public.market_profiles enable row level security;
alter table public.industry_profiles enable row level security;
alter table public.target_decisions enable row level security;

create policy ano_research_synthesis_read on public.ano_research_syntheses for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy ano_research_synthesis_create on public.ano_research_syntheses for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and created_by = auth.uid());
create policy ano_research_synthesis_update on public.ano_research_syntheses for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy research_claim_read on public.research_claims for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy research_claim_create on public.research_claims for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));

create policy market_profile_read on public.market_profiles for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy market_profile_create on public.market_profiles for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));

create policy industry_profile_read on public.industry_profiles for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy industry_profile_create on public.industry_profiles for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));

create policy target_decision_read on public.target_decisions for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy target_decision_create on public.target_decisions for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy target_decision_update on public.target_decisions for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

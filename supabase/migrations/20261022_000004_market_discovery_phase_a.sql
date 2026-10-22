-- Ano Phase A: a product brief and clearly labelled market hypotheses.
-- This intentionally sits beside the legacy ICP records; no ICP data is
-- altered, copied, or repurposed.

create table public.product_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  offer text not null,
  objective text not null,
  input_json jsonb not null,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id)
);

create table public.market_hypotheses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  product_brief_id uuid not null references public.product_briefs(id) on delete cascade,
  content_json jsonb not null,
  status text not null check (status in ('draft', 'awaiting_scope_decision', 'scope_locked', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id, product_brief_id)
);

create table public.market_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  product_brief_id uuid not null references public.product_briefs(id) on delete cascade,
  decision_type text not null check (decision_type in ('location_path')),
  status text not null check (status in ('awaiting_choice', 'selected', 'dismissed')),
  options_json jsonb not null,
  selected_key text,
  selected_by uuid references auth.users(id) on delete restrict,
  selected_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id, decision_type)
);

create index product_briefs_workspace_created_idx on public.product_briefs (workspace_id, created_at desc);
create index market_hypotheses_workspace_created_idx on public.market_hypotheses (workspace_id, created_at desc);
create index market_decisions_workspace_status_idx on public.market_decisions (workspace_id, status, created_at desc);

create trigger product_briefs_set_updated_at before update on public.product_briefs for each row execute function public.ano_set_updated_at();
create trigger market_hypotheses_set_updated_at before update on public.market_hypotheses for each row execute function public.ano_set_updated_at();
create trigger market_decisions_set_updated_at before update on public.market_decisions for each row execute function public.ano_set_updated_at();

alter table public.product_briefs enable row level security;
alter table public.market_hypotheses enable row level security;
alter table public.market_decisions enable row level security;

create policy product_brief_read on public.product_briefs for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy product_brief_create on public.product_briefs for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and created_by = auth.uid());
create policy product_brief_update on public.product_briefs for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy market_hypothesis_read on public.market_hypotheses for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy market_hypothesis_create on public.market_hypotheses for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy market_hypothesis_update on public.market_hypotheses for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy market_decision_read on public.market_decisions for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy market_decision_create on public.market_decisions for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy market_decision_update on public.market_decisions for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

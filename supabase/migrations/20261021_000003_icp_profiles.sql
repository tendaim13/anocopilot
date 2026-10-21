-- Ano-only ICP setup records. These describe the workspace's own offer and
-- target market; they are not prospect accounts and do not reference Mercury.

create table public.icp_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  product_name text not null,
  product_description text not null,
  value_proposition text not null,
  target_market text not null,
  target_locations text not null,
  ideal_customer_profile text not null,
  buyer_roles text not null,
  sales_objective text not null,
  exclusions text not null default '',
  context_notes text not null default '',
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  profile_json jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id)
);

create table public.icp_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  icp_profile_id uuid not null references public.icp_profiles(id) on delete cascade,
  title text not null,
  content_json jsonb not null,
  status text not null default 'ready_for_review' check (status in ('draft', 'ready_for_review', 'approved', 'archived')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id, icp_profile_id)
);

create index icp_profiles_workspace_created_idx on public.icp_profiles (workspace_id, created_at desc);
create index icp_briefs_workspace_created_idx on public.icp_briefs (workspace_id, created_at desc);

create trigger icp_profiles_set_updated_at before update on public.icp_profiles for each row execute function public.ano_set_updated_at();
create trigger icp_briefs_set_updated_at before update on public.icp_briefs for each row execute function public.ano_set_updated_at();

alter table public.icp_profiles enable row level security;
alter table public.icp_briefs enable row level security;

create policy icp_profile_read on public.icp_profiles for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy icp_profile_create on public.icp_profiles for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and created_by = auth.uid());
create policy icp_profile_update on public.icp_profiles for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy icp_brief_read on public.icp_briefs for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy icp_brief_create on public.icp_briefs for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy icp_brief_update on public.icp_briefs for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

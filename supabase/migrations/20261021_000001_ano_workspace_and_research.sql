-- Ano Phase 2: tenant-owned workspace identity and durable research records.
-- Apply this migration only to Ano's own Supabase project. It must never be
-- applied to Mercury or used to access Mercury's database.

create extension if not exists pgcrypto;

create or replace function public.ano_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.workspace_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  domain text not null check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, domain)
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, user_id)
);

create or replace function public.is_ano_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
  );
$$;

create or replace function public.is_ano_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.role = 'owner'
  );
$$;

create or replace function public.can_write_ano_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'admin', 'member')
  );
$$;

-- The only supported initial workspace creation path. It atomically creates
-- the caller's tenant and owner membership without allowing a self-assigned
-- role in a direct client insert.
create or replace function public.create_ano_workspace(workspace_name text, workspace_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into public.workspaces (name, slug, created_by)
  values (trim(workspace_name), lower(trim(workspace_slug)), auth.uid())
  returning id into created_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (created_workspace_id, auth.uid(), 'owner');

  return created_workspace_id;
end;
$$;

create table public.connector_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connector_key text not null check (connector_key in ('mercury', 'prospeo', 'dropcontact')),
  status text not null default 'disabled' check (status in ('disabled', 'pending', 'connected', 'error')),
  scopes text[] not null default '{}',
  credential_reference text,
  last_checked_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, connector_key)
);

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  started_by uuid not null references auth.users(id) on delete restrict,
  status text not null check (status in ('running', 'paused', 'completed', 'failed', 'cancelled')),
  mode text not null check (mode in ('mock', 'bedrock')),
  idempotency_key uuid not null,
  input_json jsonb not null,
  checkpoint jsonb not null default '{}'::jsonb,
  result_snapshot jsonb,
  heartbeat_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, idempotency_key)
);

create table public.account_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  source_key text not null,
  name text not null,
  industry text,
  location text,
  employee_band text,
  lifecycle_state text not null default 'discovered' check (lifecycle_state in ('discovered', 'shortlisted', 'dismissed', 'review')),
  source_label text not null check (source_label in ('simulated', 'provider', 'mercury')),
  raw_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id, source_key)
);

create table public.contact_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  account_candidate_id uuid not null references public.account_candidates(id) on delete cascade,
  source_key text not null,
  full_name text not null,
  title text,
  availability text not null,
  source_label text not null check (source_label in ('simulated', 'provider', 'mercury')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id, source_key)
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  account_candidate_id uuid references public.account_candidates(id) on delete cascade,
  evidence_key text not null,
  source_name text not null,
  source_kind text not null,
  source_reference text,
  observation text not null,
  captured_at text not null,
  is_simulated boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id, evidence_key)
);

create table public.scorecards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  account_candidate_id uuid not null references public.account_candidates(id) on delete cascade,
  score_version text not null,
  total_score numeric(5, 2) not null check (total_score >= 0 and total_score <= 100),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  components_json jsonb not null,
  explanation_json jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, research_run_id, account_candidate_id, score_version)
);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  account_candidate_id uuid not null references public.account_candidates(id) on delete cascade,
  title text not null,
  content_json jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'ready_for_review', 'approved', 'archived')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid references public.research_runs(id) on delete set null,
  account_candidate_id uuid references public.account_candidates(id) on delete set null,
  title text not null,
  recommended_action text not null,
  priority text not null check (priority in ('now', 'today', 'this_week')),
  rationale text not null,
  position integer not null default 0 check (position >= 0),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed', 'completed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid references public.research_runs(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  proposal_type text not null check (proposal_type in ('mercury_task', 'mercury_draft', 'mercury_update')),
  target_reference text,
  payload_json jsonb not null,
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval', 'approved', 'rejected', 'dismissed', 'stale', 'executed')),
  version integer not null default 1 check (version > 0),
  idempotency_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, idempotency_key)
);

create table public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved', 'edited', 'rejected', 'dismissed')),
  proposal_version integer not null check (proposal_version > 0),
  rationale text,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  research_run_id uuid references public.research_runs(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  outcome text not null,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  notification_type text not null,
  title text not null,
  body text not null,
  reference_type text,
  reference_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index research_runs_workspace_created_idx on public.research_runs (workspace_id, created_at desc);
create index account_candidates_workspace_state_idx on public.account_candidates (workspace_id, lifecycle_state, created_at desc);
create index evidence_items_run_idx on public.evidence_items (research_run_id, created_at asc);
create index work_items_workspace_status_idx on public.work_items (workspace_id, status, priority, position);
create index audit_logs_workspace_created_idx on public.audit_logs (workspace_id, created_at desc);
create index notifications_workspace_user_idx on public.notifications (workspace_id, user_id, read_at);

create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.ano_set_updated_at();
create trigger workspace_members_set_updated_at before update on public.workspace_members for each row execute function public.ano_set_updated_at();
create trigger connector_connections_set_updated_at before update on public.connector_connections for each row execute function public.ano_set_updated_at();
create trigger research_runs_set_updated_at before update on public.research_runs for each row execute function public.ano_set_updated_at();
create trigger account_candidates_set_updated_at before update on public.account_candidates for each row execute function public.ano_set_updated_at();
create trigger contact_candidates_set_updated_at before update on public.contact_candidates for each row execute function public.ano_set_updated_at();
create trigger briefs_set_updated_at before update on public.briefs for each row execute function public.ano_set_updated_at();
create trigger work_items_set_updated_at before update on public.work_items for each row execute function public.ano_set_updated_at();
create trigger proposals_set_updated_at before update on public.proposals for each row execute function public.ano_set_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspace_domains enable row level security;
alter table public.workspace_members enable row level security;
alter table public.connector_connections enable row level security;
alter table public.research_runs enable row level security;
alter table public.account_candidates enable row level security;
alter table public.contact_candidates enable row level security;
alter table public.evidence_items enable row level security;
alter table public.scorecards enable row level security;
alter table public.briefs enable row level security;
alter table public.work_items enable row level security;
alter table public.proposals enable row level security;
alter table public.approval_decisions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

create policy workspace_read on public.workspaces for select to authenticated using (public.is_ano_workspace_member(id));
create policy workspace_update on public.workspaces for update to authenticated using (public.is_ano_workspace_owner(id)) with check (public.is_ano_workspace_owner(id));

create policy workspace_domain_read on public.workspace_domains for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy workspace_domain_create on public.workspace_domains for insert to authenticated with check (public.is_ano_workspace_owner(workspace_id));
create policy workspace_domain_update on public.workspace_domains for update to authenticated using (public.is_ano_workspace_owner(workspace_id)) with check (public.is_ano_workspace_owner(workspace_id));
create policy workspace_domain_delete on public.workspace_domains for delete to authenticated using (public.is_ano_workspace_owner(workspace_id));

create policy membership_read on public.workspace_members for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy membership_create on public.workspace_members for insert to authenticated with check (public.is_ano_workspace_owner(workspace_id));
create policy membership_update on public.workspace_members for update to authenticated using (public.is_ano_workspace_owner(workspace_id)) with check (public.is_ano_workspace_owner(workspace_id));
create policy membership_delete on public.workspace_members for delete to authenticated using (public.is_ano_workspace_owner(workspace_id));

create policy connector_read on public.connector_connections for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy connector_create on public.connector_connections for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy connector_update on public.connector_connections for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy research_run_read on public.research_runs for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy research_run_create on public.research_runs for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and started_by = auth.uid());
create policy research_run_update on public.research_runs for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy candidate_read on public.account_candidates for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy candidate_create on public.account_candidates for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy candidate_update on public.account_candidates for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy contact_read on public.contact_candidates for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy contact_create on public.contact_candidates for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy contact_update on public.contact_candidates for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy evidence_read on public.evidence_items for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy evidence_create on public.evidence_items for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));

create policy scorecard_read on public.scorecards for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy scorecard_create on public.scorecards for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));

create policy brief_read on public.briefs for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy brief_create on public.briefs for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy brief_update on public.briefs for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy work_item_read on public.work_items for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy work_item_create on public.work_items for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy work_item_update on public.work_items for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy proposal_read on public.proposals for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy proposal_create on public.proposals for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and created_by = auth.uid());
create policy proposal_update on public.proposals for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy approval_read on public.approval_decisions for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy approval_create on public.approval_decisions for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and decided_by = auth.uid());

-- Audit records are append-only for authenticated users: select and insert only.
create policy audit_read on public.audit_logs for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy audit_create on public.audit_logs for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));

create policy notification_read on public.notifications for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy notification_create on public.notifications for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy notification_update on public.notifications for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

grant execute on function public.create_ano_workspace(text, text) to authenticated;
grant execute on function public.is_ano_workspace_member(uuid) to authenticated;
grant execute on function public.is_ano_workspace_owner(uuid) to authenticated;
grant execute on function public.can_write_ano_workspace(uuid) to authenticated;

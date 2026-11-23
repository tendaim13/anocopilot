-- Ano Part 2 / Phase 11B: Admin-only workspace invite links + automatic personal workspace provisioning.
-- Apply this migration only to Ano's dedicated Supabase project.

create or replace function public.is_ano_workspace_admin(target_workspace_id uuid)
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
      and membership.role in ('owner', 'admin')
  );
$$;

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_preview text not null check (char_length(token_preview) between 4 and 16),
  label text check (label is null or char_length(trim(label)) between 1 and 120),
  role text not null default 'member' check (role in ('admin', 'member', 'viewer')),
  max_uses integer not null default 1 check (max_uses between 1 and 100),
  uses_count integer not null default 0 check (uses_count >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists workspace_invites_workspace_created_idx
  on public.workspace_invites (workspace_id, created_at desc);

drop trigger if exists workspace_invites_set_updated_at on public.workspace_invites;
create trigger workspace_invites_set_updated_at
  before update on public.workspace_invites
  for each row execute function public.ano_set_updated_at();

alter table public.workspace_invites enable row level security;

drop policy if exists workspace_invite_admin_read on public.workspace_invites;
create policy workspace_invite_admin_read
  on public.workspace_invites
  for select
  to authenticated
  using (public.is_ano_workspace_admin(workspace_id));

drop policy if exists workspace_invite_admin_create on public.workspace_invites;
create policy workspace_invite_admin_create
  on public.workspace_invites
  for insert
  to authenticated
  with check (
    public.is_ano_workspace_admin(workspace_id)
    and created_by = auth.uid()
    and role in ('admin', 'member', 'viewer')
  );

drop policy if exists workspace_invite_admin_update on public.workspace_invites;
create policy workspace_invite_admin_update
  on public.workspace_invites
  for update
  to authenticated
  using (public.is_ano_workspace_admin(workspace_id))
  with check (public.is_ano_workspace_admin(workspace_id));

create or replace function public.ensure_personal_ano_workspace(display_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid;
  existing_workspace_id uuid;
  actor_email text;
  meta_full_name text;
  first_label text;
  ws_name text;
  base_slug text;
  ws_slug text;
  actor_domain text;
  created_workspace_id uuid;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  select membership.workspace_id
  into existing_workspace_id
  from public.workspace_members membership
  where membership.user_id = actor_id
    and membership.role = 'owner'
  order by membership.created_at asc
  limit 1;

  if existing_workspace_id is not null then
    return existing_workspace_id;
  end if;

  select
    lower(coalesce(u.email, auth.jwt() ->> 'email', '')),
    nullif(trim(coalesce(display_name, u.raw_user_meta_data ->> 'full_name', '')), '')
  into actor_email, meta_full_name
  from auth.users u
  where u.id = actor_id;

  if actor_email is null or actor_email = '' then
    actor_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  end if;

  first_label := null;
  if meta_full_name is not null then
    first_label := regexp_replace(split_part(meta_full_name, ' ', 1), '[^a-zA-Z0-9-]', '', 'g');
  end if;
  if first_label is null or char_length(first_label) < 2 then
    first_label := regexp_replace(split_part(split_part(actor_email, '@', 1), '.', 1), '[^a-zA-Z0-9]', '', 'g');
  end if;

  if first_label is not null and char_length(first_label) >= 2 then
    first_label := upper(substr(first_label, 1, 1)) || lower(substr(first_label, 2));
    ws_name := left(first_label || '''s Workspace', 120);
  else
    ws_name := 'My Workspace';
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(ws_name), '[^a-z0-9]+', '-', 'g'));
  if base_slug is null or char_length(base_slug) < 2 then
    base_slug := 'workspace';
  end if;
  ws_slug := left(base_slug, 68) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.workspaces (name, slug, created_by)
  values (ws_name, ws_slug, actor_id)
  returning id into created_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (created_workspace_id, actor_id, 'owner');

  actor_domain := split_part(actor_email, '@', 2);
  if actor_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    insert into public.workspace_domains (workspace_id, domain)
    values (created_workspace_id, actor_domain)
    on conflict (workspace_id, domain) do nothing;
  end if;

  return created_workspace_id;
end;
$$;

create or replace function public.preview_workspace_invite(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  inv record;
  invite_status text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object(
      'valid', false,
      'status', 'not_found'
    );
  end if;

  select
    i.role,
    i.max_uses,
    i.uses_count,
    i.expires_at,
    i.revoked_at,
    w.name as workspace_name,
    w.slug as workspace_slug
  into inv
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = p_token_hash
  limit 1;

  if not found then
    return jsonb_build_object(
      'valid', false,
      'status', 'not_found'
    );
  end if;

  if inv.revoked_at is not null then
    invite_status := 'revoked';
  elsif inv.expires_at <= timezone('utc', now()) then
    invite_status := 'expired';
  elsif inv.uses_count >= inv.max_uses then
    invite_status := 'exhausted';
  else
    invite_status := 'active';
  end if;

  return jsonb_build_object(
    'valid', invite_status = 'active',
    'status', invite_status,
    'workspaceName', inv.workspace_name,
    'workspaceSlug', inv.workspace_slug,
    'role', inv.role,
    'expiresAt', to_char(inv.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'remainingUses', greatest(0, inv.max_uses - inv.uses_count)
  );
end;
$$;

create or replace function public.accept_workspace_invite(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_id uuid;
  inv record;
  existing_role text;
  personal_workspace_id uuid;
  actor_email text;
  actor_domain text;
  joined_role text;
  already_member boolean;
begin
  actor_id := auth.uid();
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  select
    i.id,
    i.workspace_id,
    i.role,
    i.max_uses,
    i.uses_count,
    i.expires_at,
    i.revoked_at,
    w.name as workspace_name,
    w.slug as workspace_slug
  into inv
  from public.workspace_invites i
  join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = p_token_hash
  for update of i;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  if inv.revoked_at is not null then
    raise exception 'INVITE_REVOKED';
  end if;

  if inv.expires_at <= timezone('utc', now()) then
    raise exception 'INVITE_EXPIRED';
  end if;

  select membership.role
  into existing_role
  from public.workspace_members membership
  where membership.workspace_id = inv.workspace_id
    and membership.user_id = actor_id
  limit 1;

  if existing_role is null and inv.uses_count >= inv.max_uses then
    raise exception 'INVITE_EXHAUSTED';
  end if;

  personal_workspace_id := public.ensure_personal_ano_workspace(null);

  select lower(coalesce(u.email, auth.jwt() ->> 'email', ''))
  into actor_email
  from auth.users u
  where u.id = actor_id;

  if actor_email is null or actor_email = '' then
    actor_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  end if;

  actor_domain := split_part(actor_email, '@', 2);
  if actor_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    insert into public.workspace_domains (workspace_id, domain)
    values (inv.workspace_id, actor_domain)
    on conflict (workspace_id, domain) do nothing;
  end if;

  if existing_role is null then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (inv.workspace_id, actor_id, inv.role);

    update public.workspace_invites
    set uses_count = uses_count + 1,
        updated_at = timezone('utc', now())
    where id = inv.id;

    insert into public.audit_logs (workspace_id, actor_id, event_type, outcome, details_json)
    values (
      inv.workspace_id,
      actor_id,
      'workspace.invite_accepted',
      'succeeded',
      jsonb_build_object(
        'invite_id', inv.id,
        'role', inv.role,
        'personal_workspace_id', personal_workspace_id
      )
    );

    joined_role := inv.role;
    already_member := false;
  else
    joined_role := existing_role;
    already_member := true;
  end if;

  return jsonb_build_object(
    'workspaceId', inv.workspace_id,
    'workspaceName', inv.workspace_name,
    'workspaceSlug', inv.workspace_slug,
    'role', joined_role,
    'alreadyMember', already_member,
    'personalWorkspaceId', personal_workspace_id
  );
end;
$$;

revoke all on function public.is_ano_workspace_admin(uuid) from public;
revoke all on function public.ensure_personal_ano_workspace(text) from public;
revoke all on function public.preview_workspace_invite(text) from public;
revoke all on function public.accept_workspace_invite(text) from public;

grant execute on function public.is_ano_workspace_admin(uuid) to authenticated;
grant execute on function public.ensure_personal_ano_workspace(text) to authenticated;
grant execute on function public.preview_workspace_invite(text) to anon, authenticated;
grant execute on function public.accept_workspace_invite(text) to authenticated;

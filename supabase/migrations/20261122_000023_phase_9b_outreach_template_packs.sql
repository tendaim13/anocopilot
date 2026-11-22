-- Ano Phase 9B: Blaster-ready, human-sounding LLM outreach template packs
-- tied to a locked Phase C target decision and workspace.
-- Preserves all Phase A-F tenancy and RLS boundaries; zero external email sending.

create table if not exists public.outreach_template_packs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  target_decision_id uuid not null references public.target_decisions(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  tone text not null default 'peer_direct' check (
    tone in ('peer_direct', 'curious', 'executive_brief', 'warm_smb')
  ),
  cta_style text not null default 'easy_yes' check (
    cta_style in ('easy_yes', 'free_offer', 'direct_question')
  ),
  entry_offer text,
  sender_name text,
  target_roles_json jsonb not null default '[]'::jsonb,
  steps_json jsonb not null default '[]'::jsonb,
  claim_ids_json jsonb not null default '[]'::jsonb,
  generation_mode text not null default 'llm' check (
    generation_mode in ('llm', 'fallback', 'manual')
  ),
  last_instruction text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, target_decision_id)
);

create index if not exists outreach_template_packs_conversation_idx
  on public.outreach_template_packs (workspace_id, conversation_id, updated_at desc);

drop trigger if exists outreach_template_packs_set_updated_at on public.outreach_template_packs;
create trigger outreach_template_packs_set_updated_at
  before update on public.outreach_template_packs
  for each row execute function public.ano_set_updated_at();

alter table public.outreach_template_packs enable row level security;

drop policy if exists outreach_template_pack_read on public.outreach_template_packs;
create policy outreach_template_pack_read
  on public.outreach_template_packs for select to authenticated
  using (public.is_ano_workspace_member(workspace_id));

drop policy if exists outreach_template_pack_create on public.outreach_template_packs;
create policy outreach_template_pack_create
  on public.outreach_template_packs for insert to authenticated
  with check (public.can_write_ano_workspace(workspace_id) and created_by = auth.uid());

drop policy if exists outreach_template_pack_update on public.outreach_template_packs;
create policy outreach_template_pack_update
  on public.outreach_template_packs for update to authenticated
  using (public.can_write_ano_workspace(workspace_id))
  with check (public.can_write_ano_workspace(workspace_id));

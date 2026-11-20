-- Ano Phase F (UI Phase 8): approval-gated outreach preparation,
-- deterministic contact eligibility, scheduling/calling tasks, and Mercury CRM proposals.
-- Preserves all Phase A-E schema and RLS boundaries; no autonomous sending or direct
-- Mercury database access is permitted.

-- 1. Expand provider_action_requests to audit outreach and Mercury proposal executions.
alter table public.provider_action_requests
  drop constraint if exists provider_action_requests_provider_key_check;

alter table public.provider_action_requests
  add constraint provider_action_requests_provider_key_check
  check (provider_key in ('tavily', 'searxng', 'prospeo', 'dropcontact', 'mercury', 'outreach'));

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
      'contact_verification',
      'outreach_proposal',
      'mercury_proposal'
    )
  );

-- 2. Versioned outreach drafts tied to factual playbooks, accounts, and contacts.
create table if not exists public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  target_decision_id uuid not null references public.target_decisions(id) on delete cascade,
  account_playbook_id uuid not null references public.account_playbooks(id) on delete cascade,
  account_candidate_id uuid not null references public.account_candidates(id) on delete cascade,
  contact_candidate_id uuid references public.contact_candidates(id) on delete set null,
  channel text not null check (channel in ('email', 'linkedin', 'call_script', 'follow_up')),
  version integer not null default 1 check (version > 0),
  subject text not null check (char_length(trim(subject)) between 1 and 240),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  call_script_points_json jsonb not null default '[]'::jsonb,
  claim_ids_json jsonb not null default '[]'::jsonb,
  signal_ids_json jsonb not null default '[]'::jsonb,
  eligibility_status text not null check (
    eligibility_status in (
      'eligible',
      'blocked_unverified_email',
      'blocked_missing_contact',
      'blocked_suppressed',
      'review_only_channel'
    )
  ),
  eligibility_reasons_json jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (
    status in ('draft', 'ready_for_proposal', 'proposed', 'approved', 'rejected', 'executed')
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, account_playbook_id, channel, version)
);

create index if not exists outreach_drafts_conversation_idx
  on public.outreach_drafts (workspace_id, conversation_id, updated_at desc);

drop trigger if exists outreach_drafts_set_updated_at on public.outreach_drafts;
create trigger outreach_drafts_set_updated_at
  before update on public.outreach_drafts
  for each row execute function public.ano_set_updated_at();

alter table public.outreach_drafts enable row level security;

drop policy if exists outreach_draft_read on public.outreach_drafts;
create policy outreach_draft_read
  on public.outreach_drafts for select to authenticated
  using (public.is_ano_workspace_member(workspace_id));

drop policy if exists outreach_draft_create on public.outreach_drafts;
create policy outreach_draft_create
  on public.outreach_drafts for insert to authenticated
  with check (public.can_write_ano_workspace(workspace_id) and created_by = auth.uid());

drop policy if exists outreach_draft_update on public.outreach_drafts;
create policy outreach_draft_update
  on public.outreach_drafts for update to authenticated
  using (public.can_write_ano_workspace(workspace_id))
  with check (public.can_write_ano_workspace(workspace_id));

-- 3. Extend existing proposals table for Phase F outreach, scheduling, calling, and Mercury sync.
alter table public.proposals
  drop constraint if exists proposals_proposal_type_check;

alter table public.proposals
  add constraint proposals_proposal_type_check
  check (
    proposal_type in (
      'mercury_task',
      'mercury_draft',
      'mercury_update',
      'email_send',
      'calendar_schedule',
      'call_task'
    )
  );

alter table public.proposals
  add column if not exists conversation_id uuid references public.ano_conversations(id) on delete cascade,
  add column if not exists target_decision_id uuid references public.target_decisions(id) on delete set null,
  add column if not exists account_playbook_id uuid references public.account_playbooks(id) on delete set null,
  add column if not exists account_candidate_id uuid references public.account_candidates(id) on delete set null,
  add column if not exists contact_candidate_id uuid references public.contact_candidates(id) on delete set null,
  add column if not exists outreach_draft_id uuid references public.outreach_drafts(id) on delete set null,
  add column if not exists provider_action_request_id uuid references public.provider_action_requests(id) on delete set null,
  add column if not exists execution_receipt_json jsonb not null default '{}'::jsonb,
  add column if not exists executed_at timestamptz;

create index if not exists proposals_conversation_idx
  on public.proposals (workspace_id, conversation_id, created_at desc);

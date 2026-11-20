-- Ano Phase A: durable LangGraph conversations and research planning.
-- This migration is exclusively for Ano's dedicated Supabase/Postgres project.
-- It does not read, write, reference, or alter Mercury in any way.

create schema if not exists ano_langgraph;

create table public.ano_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 1 and 160),
  active_graph text not null check (active_graph in ('research')),
  active_thread_id text not null unique,
  status text not null check (status in ('draft', 'awaiting_context', 'planning', 'awaiting_plan_approval', 'complete_without_research', 'failed_safe', 'requires_manual_review')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.ano_graph_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  started_by uuid not null references auth.users(id) on delete restrict,
  graph_name text not null check (graph_name in ('research')),
  graph_version text not null,
  thread_id text not null,
  status text not null check (status in ('draft', 'awaiting_context', 'planning', 'awaiting_plan_approval', 'complete_without_research', 'failed_safe', 'requires_manual_review')),
  current_node text not null,
  checkpoint_ref text,
  state_snapshot jsonb not null default '{}'::jsonb,
  failure_message text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, conversation_id, graph_name)
);

create table public.ano_graph_checkpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  graph_run_id uuid not null references public.ano_graph_runs(id) on delete cascade,
  checkpoint_ref text not null,
  current_node text not null,
  safe_state_json jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (graph_run_id, checkpoint_ref)
);

create table public.ano_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  message_type text not null check (message_type in ('message', 'clarifying_question', 'research_plan', 'decision')),
  content_json jsonb not null,
  idempotency_key uuid,
  dedupe_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  check ((role = 'user' and created_by is not null) or role = 'assistant'),
  unique (workspace_id, conversation_id, idempotency_key),
  unique (conversation_id, dedupe_key)
);

create table public.research_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null unique references public.ano_conversations(id) on delete cascade,
  graph_run_id uuid not null references public.ano_graph_runs(id) on delete cascade,
  content_json jsonb not null,
  status text not null check (status in ('awaiting_context', 'ready')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.research_questions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  graph_run_id uuid not null references public.ano_graph_runs(id) on delete cascade,
  question text not null,
  purpose text not null,
  status text not null check (status in ('open', 'resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.research_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  graph_run_id uuid not null references public.ano_graph_runs(id) on delete cascade,
  version integer not null check (version > 0),
  approval_status text not null check (approval_status in ('awaiting_approval', 'approved', 'declined')),
  content_json jsonb not null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (conversation_id, version)
);

create table public.ano_graph_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  graph_run_id uuid not null references public.ano_graph_runs(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  decision_type text not null check (decision_type in ('graph_interrupt')),
  response_json jsonb not null,
  idempotency_key uuid not null,
  decided_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (graph_run_id, idempotency_key)
);

create table public.run_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  graph_run_id uuid not null references public.ano_graph_runs(id) on delete cascade,
  event_key text not null,
  label text not null,
  detail text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (graph_run_id, event_key)
);

create index ano_conversations_workspace_updated_idx on public.ano_conversations (workspace_id, updated_at desc);
create index ano_graph_runs_conversation_idx on public.ano_graph_runs (conversation_id, started_at desc);
create index ano_graph_checkpoints_run_created_idx on public.ano_graph_checkpoints (graph_run_id, created_at desc);
create index ano_messages_conversation_created_idx on public.ano_messages (conversation_id, created_at asc);
create index research_questions_conversation_status_idx on public.research_questions (conversation_id, status, created_at desc);
create index research_plans_conversation_version_idx on public.research_plans (conversation_id, version desc);
create index run_events_graph_run_created_idx on public.run_events (graph_run_id, created_at asc);

create trigger ano_conversations_set_updated_at before update on public.ano_conversations for each row execute function public.ano_set_updated_at();
create trigger ano_graph_runs_set_updated_at before update on public.ano_graph_runs for each row execute function public.ano_set_updated_at();
create trigger research_briefs_set_updated_at before update on public.research_briefs for each row execute function public.ano_set_updated_at();
create trigger research_plans_set_updated_at before update on public.research_plans for each row execute function public.ano_set_updated_at();

alter table public.ano_conversations enable row level security;
alter table public.ano_graph_runs enable row level security;
alter table public.ano_graph_checkpoints enable row level security;
alter table public.ano_messages enable row level security;
alter table public.research_briefs enable row level security;
alter table public.research_questions enable row level security;
alter table public.research_plans enable row level security;
alter table public.ano_graph_decisions enable row level security;
alter table public.run_events enable row level security;

create policy ano_conversation_read on public.ano_conversations for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy ano_conversation_create on public.ano_conversations for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and created_by = auth.uid());
create policy ano_conversation_update on public.ano_conversations for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy ano_graph_run_read on public.ano_graph_runs for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy ano_graph_run_create on public.ano_graph_runs for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and started_by = auth.uid());
create policy ano_graph_run_update on public.ano_graph_runs for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy ano_graph_checkpoint_read on public.ano_graph_checkpoints for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy ano_graph_checkpoint_create on public.ano_graph_checkpoints for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));

create policy ano_message_read on public.ano_messages for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy ano_message_create on public.ano_messages for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and (created_by is null or created_by = auth.uid()));
create policy ano_message_update on public.ano_messages for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy research_brief_read on public.research_briefs for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy research_brief_create on public.research_briefs for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy research_brief_update on public.research_briefs for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy research_question_read on public.research_questions for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy research_question_create on public.research_questions for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy research_question_update on public.research_questions for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy research_plan_read on public.research_plans for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy research_plan_create on public.research_plans for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));
create policy research_plan_update on public.research_plans for update to authenticated using (public.can_write_ano_workspace(workspace_id)) with check (public.can_write_ano_workspace(workspace_id));

create policy ano_graph_decision_read on public.ano_graph_decisions for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy ano_graph_decision_create on public.ano_graph_decisions for insert to authenticated with check (public.can_write_ano_workspace(workspace_id) and decided_by = auth.uid());

create policy run_event_read on public.run_events for select to authenticated using (public.is_ano_workspace_member(workspace_id));
create policy run_event_create on public.run_events for insert to authenticated with check (public.can_write_ano_workspace(workspace_id));

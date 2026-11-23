-- Ano Phase 10B: Multi-format product source ingestion (URL, PDF, DOCX, TXT)
-- and streamlined 2-question intake metadata on research briefs.

create table if not exists public.conversation_product_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.ano_conversations(id) on delete cascade,
  source_type text not null check (source_type in ('website_url', 'pdf', 'docx', 'txt')),
  label text not null check (char_length(trim(label)) between 1 and 200),
  source_url text null,
  mime_type text null,
  byte_size integer not null default 0 check (byte_size >= 0),
  content_sha256 text not null check (char_length(content_sha256) between 16 and 128),
  extracted_text text not null,
  summary_text text null,
  extraction_status text not null default 'ready' check (extraction_status in ('ready', 'failed')),
  error_message text null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (conversation_id, content_sha256)
);

create index if not exists conversation_product_sources_conv_idx
  on public.conversation_product_sources (workspace_id, conversation_id, created_at asc);

drop trigger if exists conversation_product_sources_set_updated_at on public.conversation_product_sources;
create trigger conversation_product_sources_set_updated_at
  before update on public.conversation_product_sources
  for each row execute function public.ano_set_updated_at();

alter table public.conversation_product_sources enable row level security;

drop policy if exists product_sources_read on public.conversation_product_sources;
create policy product_sources_read
  on public.conversation_product_sources for select to authenticated
  using (public.is_ano_workspace_member(workspace_id));

drop policy if exists product_sources_create on public.conversation_product_sources;
create policy product_sources_create
  on public.conversation_product_sources for insert to authenticated
  with check (public.can_write_ano_workspace(workspace_id) and created_by = auth.uid());

drop policy if exists product_sources_update on public.conversation_product_sources;
create policy product_sources_update
  on public.conversation_product_sources for update to authenticated
  using (public.can_write_ano_workspace(workspace_id))
  with check (public.can_write_ano_workspace(workspace_id));

drop policy if exists product_sources_delete on public.conversation_product_sources;
create policy product_sources_delete
  on public.conversation_product_sources for delete to authenticated
  using (public.can_write_ano_workspace(workspace_id));

alter table public.research_briefs
  add column if not exists business_location text,
  add column if not exists target_markets_json jsonb not null default '[]'::jsonb,
  add column if not exists intake_complete boolean not null default false;

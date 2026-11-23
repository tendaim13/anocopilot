-- Ano Phase 10A: Operator-only internal API usage ledger and silent budget checks.
-- `ano_internal` is never exposed to PostgREST or selectable by anon/authenticated roles.

create schema if not exists ano_internal;
revoke all on schema ano_internal from public, anon, authenticated;

create table if not exists ano_internal.api_usage_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid null references public.ano_conversations(id) on delete set null,
  autopilot_run_id uuid null,
  actor_id uuid null references auth.users(id) on delete set null,
  provider text not null check (
    provider in (
      'gemini',
      'bedrock',
      'ollama',
      'searxng',
      'prospeo',
      'dropcontact',
      'openstreetmap',
      'website_team',
      'product_ingest'
    )
  ),
  operation text not null check (char_length(trim(operation)) between 1 and 80),
  model_or_endpoint text null check (
    model_or_endpoint is null or char_length(trim(model_or_endpoint)) <= 160
  ),
  status text not null check (
    status in ('success', 'error', 'timeout', 'rate_limited', 'skipped_budget')
  ),
  http_status integer null,
  request_count integer not null default 1 check (request_count >= 0),
  credits_used numeric(10,4) not null default 0 check (credits_used >= 0),
  credits_remaining numeric(12,4) null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  estimated_cost_usd numeric(12,6) not null default 0 check (estimated_cost_usd >= 0),
  duration_ms integer null check (duration_ms is null or duration_ms >= 0),
  metadata_json jsonb not null default '{}'::jsonb
);

create index if not exists api_usage_logs_created_at_idx
  on ano_internal.api_usage_logs (created_at desc);

create index if not exists api_usage_logs_provider_created_at_idx
  on ano_internal.api_usage_logs (provider, created_at desc);

create index if not exists api_usage_logs_workspace_budget_idx
  on ano_internal.api_usage_logs (workspace_id, provider, created_at desc);

revoke all on table ano_internal.api_usage_logs from public, anon, authenticated;
alter table ano_internal.api_usage_logs enable row level security;

create or replace function public.record_internal_api_usage(
  p_workspace_id uuid,
  p_provider text,
  p_operation text,
  p_status text,
  p_conversation_id uuid default null,
  p_autopilot_run_id uuid default null,
  p_model_or_endpoint text default null,
  p_http_status integer default null,
  p_request_count integer default 1,
  p_credits_used numeric default 0,
  p_credits_remaining numeric default null,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_estimated_cost_usd numeric default 0,
  p_duration_ms integer default null,
  p_metadata_json jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text;
  v_endpoint text;
begin
  if not public.is_ano_workspace_member(p_workspace_id) then
    raise exception 'FORBIDDEN';
  end if;

  v_operation := left(nullif(trim(coalesce(p_operation, '')), ''), 80);
  if v_operation is null then
    v_operation := 'unknown';
  end if;

  v_endpoint := left(nullif(trim(coalesce(p_model_or_endpoint, '')), ''), 160);

  insert into ano_internal.api_usage_logs (
    workspace_id,
    conversation_id,
    autopilot_run_id,
    actor_id,
    provider,
    operation,
    model_or_endpoint,
    status,
    http_status,
    request_count,
    credits_used,
    credits_remaining,
    input_tokens,
    output_tokens,
    estimated_cost_usd,
    duration_ms,
    metadata_json
  ) values (
    p_workspace_id,
    p_conversation_id,
    p_autopilot_run_id,
    auth.uid(),
    p_provider,
    v_operation,
    v_endpoint,
    p_status,
    p_http_status,
    greatest(0, coalesce(p_request_count, 1)),
    greatest(0, coalesce(p_credits_used, 0)),
    p_credits_remaining,
    greatest(0, coalesce(p_input_tokens, 0)),
    greatest(0, coalesce(p_output_tokens, 0)),
    greatest(0, coalesce(p_estimated_cost_usd, 0)),
    case when p_duration_ms is null then null else greatest(0, p_duration_ms) end,
    coalesce(p_metadata_json, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.record_internal_api_usage(
  uuid, text, text, text, uuid, uuid, text, integer, integer, numeric, numeric, integer, integer, numeric, integer, jsonb
) from public, anon;

grant execute on function public.record_internal_api_usage(
  uuid, text, text, text, uuid, uuid, text, integer, integer, numeric, numeric, integer, integer, numeric, integer, jsonb
) to authenticated;

create or replace function public.check_internal_usage_budget(
  p_workspace_id uuid,
  p_provider text,
  p_daily_limit numeric,
  p_metric text default 'credits'
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_used numeric := 0;
begin
  if not public.is_ano_workspace_member(p_workspace_id) then
    return false;
  end if;

  if p_daily_limit is null or p_daily_limit <= 0 then
    return true;
  end if;

  select
    case
      when p_metric = 'credits' then coalesce(sum(credits_used), 0)
      else coalesce(sum(request_count), 0)
    end
  into v_used
  from ano_internal.api_usage_logs
  where workspace_id = p_workspace_id
    and provider = p_provider
    and status <> 'skipped_budget'
    and created_at >= date_trunc('day', timezone('utc', now()));

  return coalesce(v_used, 0) < p_daily_limit;
end;
$$;

revoke all on function public.check_internal_usage_budget(uuid, text, numeric, text) from public, anon;
grant execute on function public.check_internal_usage_budget(uuid, text, numeric, text) to authenticated;

-- PostgreSQL shortens identifiers beyond 63 characters. The original unique
-- constraint therefore exists under a truncated name in deployed databases.
-- Remove it by its definition so a new, explicitly approved attempt can be
-- created for a stopped research plan. The per-attempt uniqueness remains.

do $$
declare
  legacy_constraint text;
begin
  select conname
    into legacy_constraint
  from pg_constraint
  where conrelid = 'public.ano_research_runs'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (workspace_id, conversation_id, research_plan_id)'
  limit 1;

  if legacy_constraint is not null then
    execute format(
      'alter table public.ano_research_runs drop constraint %I',
      legacy_constraint
    );
  end if;
end $$;

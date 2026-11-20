-- A stopped provider run is never replayed automatically. A user may prepare a
-- new, separately approved attempt for the same approved research plan.

alter table public.ano_research_runs
  add column attempt_number smallint not null default 1 check (attempt_number > 0);

alter table public.ano_research_runs
  drop constraint if exists ano_research_runs_workspace_id_conversation_id_research_plan_id_key;

alter table public.ano_research_runs
  add constraint ano_research_runs_workspace_conversation_plan_attempt_key
  unique (workspace_id, conversation_id, research_plan_id, attempt_number);

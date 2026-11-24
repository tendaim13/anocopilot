-- Ano Phase 13E (Remediation Phase 5): Map-reduce evidence group summaries and structured synthesis report.
-- Preserves full source analysis across (market, decision dimension) groups and stores
-- the complete 7-part evidence report without truncating saved evidence.

alter table public.ano_research_syntheses
  add column if not exists group_summaries_json jsonb not null default '[]'::jsonb;

alter table public.ano_research_syntheses
  add column if not exists report_json jsonb not null default '{}'::jsonb;

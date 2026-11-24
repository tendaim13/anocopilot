-- Ano Phase 13D (Remediation Phase 4): Distinct source provenance, root domain diversity, and syndication deduplication.

alter table public.research_sources
  add column if not exists source_provenance text not null default 'public_web';

alter table public.research_sources
  drop constraint if exists research_sources_source_provenance_check;

alter table public.research_sources
  add constraint research_sources_source_provenance_check
  check (source_provenance in ('public_web', 'comparable_evidence', 'workspace_supplied'));

alter table public.research_sources
  add column if not exists root_domain text null;

alter table public.research_sources
  add column if not exists duplicate_of_source_id uuid null references public.research_sources(id) on delete set null;

update public.research_sources rs
set source_provenance = 'workspace_supplied'
where rs.canonical_url like 'https://product-brief.ano.local/%'
   or exists (
     select 1 from public.provider_action_requests par
     where par.id = rs.provider_action_request_id
       and par.request_key like 'autopilot-product-seed:%'
   );

create index if not exists research_sources_run_provenance_idx
  on public.research_sources (ano_research_run_id, source_provenance, status);

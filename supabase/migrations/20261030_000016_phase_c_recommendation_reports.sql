-- Phase C revision: research quality calibrates a report instead of blocking it.
-- Ano still preserves source provenance, bounded provider behaviour, and the
-- explicit human decision before a route can be handed to company discovery.

alter table public.ano_research_syntheses
  add column if not exists recommendation_mode text not null default 'pending';

alter table public.ano_research_syntheses
  drop constraint if exists ano_research_syntheses_status_check;

alter table public.ano_research_syntheses
  add constraint ano_research_syntheses_status_check check (
    status in (
      'awaiting_analysis',
      'running',
      'ready_for_decision',
      'ready_for_review',
      'insufficient_evidence',
      'requires_manual_review',
      'failed_safe'
    )
  );

alter table public.ano_research_syntheses
  add constraint ano_research_syntheses_recommendation_mode_check check (
    recommendation_mode in (
      'pending',
      'directly_supported',
      'comparative_inference',
      'exploratory',
      'no_usable_evidence'
    )
  );

alter table public.research_claims
  add column if not exists comparison_basis text;

alter table public.research_claims
  drop constraint if exists research_claims_claim_kind_check;

alter table public.research_claims
  add constraint research_claims_claim_kind_check check (
    claim_kind in ('observation', 'comparable', 'inference', 'hypothesis', 'uncertainty')
  );

alter table public.research_claims
  add constraint research_claims_comparable_basis_check check (
    claim_kind <> 'comparable' or char_length(trim(coalesce(comparison_basis, ''))) between 1 and 280
  );

update public.ano_research_syntheses
set recommendation_mode = case
  when status = 'ready_for_decision' then 'directly_supported'
  when status = 'insufficient_evidence' then 'exploratory'
  else 'pending'
end
where recommendation_mode = 'pending';

-- Ano Phase 9A: Multi-source selective email verification (Prospeo /bulk-enrich-person + Dropcontact)
-- while keeping public website emails transparently separated in contact_candidates.provider_receipt_json.

alter table public.contact_verification_runs
  drop constraint if exists contact_verification_runs_provider_key_check;

alter table public.contact_verification_runs
  add constraint contact_verification_runs_provider_key_check
  check (provider_key in ('dropcontact', 'prospeo'));

-- Ano Phase E (UI Phase 7): Dual-source people discovery (Website Team/About extraction + Prospeo People Search)
-- and structured Buying Committee targeting.

alter table public.provider_action_requests
  drop constraint if exists provider_action_requests_provider_key_check;

alter table public.provider_action_requests
  add constraint provider_action_requests_provider_key_check
  check (provider_key in ('tavily', 'searxng', 'prospeo', 'openstreetmap', 'website_team', 'dropcontact', 'mercury', 'outreach'));

alter table public.provider_person_searches
  drop constraint if exists provider_person_searches_provider_key_check;

alter table public.provider_person_searches
  add constraint provider_person_searches_provider_key_check
  check (provider_key in ('prospeo', 'website_team'));

alter table public.provider_person_searches
  drop constraint if exists provider_person_searches_estimated_max_credits_check;

alter table public.provider_person_searches
  add constraint provider_person_searches_estimated_max_credits_check
  check (estimated_max_credits in (0, 1));

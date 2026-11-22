-- Ano Phase D (UI Phase 6): Dual-source discovery (OpenStreetMap local business discovery + Prospeo B2B database).
-- Allows `openstreetmap` in `provider_action_requests` and `provider_company_searches` alongside `prospeo`,
-- and permits 0-credit estimates on `provider_company_searches` for free local map discovery.

alter table public.provider_action_requests
  drop constraint if exists provider_action_requests_provider_key_check;

alter table public.provider_action_requests
  add constraint provider_action_requests_provider_key_check
  check (provider_key in ('tavily', 'searxng', 'prospeo', 'openstreetmap', 'dropcontact', 'mercury', 'outreach'));

alter table public.provider_company_searches
  drop constraint if exists provider_company_searches_provider_key_check;

alter table public.provider_company_searches
  add constraint provider_company_searches_provider_key_check
  check (provider_key in ('prospeo', 'openstreetmap'));

alter table public.provider_company_searches
  drop constraint if exists provider_company_searches_estimated_max_credits_check;

alter table public.provider_company_searches
  add constraint provider_company_searches_estimated_max_credits_check
  check (estimated_max_credits in (0, 1));

-- Ano Phase B: make the private SearXNG service available for new evidence
-- runs without rewriting historic Tavily receipts or research records.
-- Ano keeps source retrieval, text extraction, and Bedrock synthesis itself.

alter table public.connector_connections drop constraint if exists connector_connections_connector_key_check;
alter table public.connector_connections add constraint connector_connections_connector_key_check
  check (connector_key in ('mercury', 'prospeo', 'dropcontact', 'tavily', 'searxng'));

alter table public.ano_research_runs drop constraint if exists ano_research_runs_provider_key_check;
alter table public.ano_research_runs add constraint ano_research_runs_provider_key_check
  check (provider_key in ('tavily', 'searxng'));

alter table public.provider_action_requests drop constraint if exists provider_action_requests_provider_key_check;
alter table public.provider_action_requests add constraint provider_action_requests_provider_key_check
  check (provider_key in ('tavily', 'searxng'));

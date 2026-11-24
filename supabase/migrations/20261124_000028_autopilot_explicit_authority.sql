-- Ano Phase 13B (Remediation Phase 2): Explicit bounded Autopilot authority scope and authorization metadata.

alter table public.autopilot_runs
  add column if not exists authority_scope_json jsonb not null default '{"maxPublicSearches":50,"maxSourceFetches":100,"maxCompanyCandidates":25,"maxNamedContactEnrichments":10,"allowOutboundEmailSend":false,"allowPhoneCalls":false,"allowCrmWrites":false}'::jsonb;

alter table public.autopilot_runs
  add column if not exists authorized_at timestamptz null;

alter table public.autopilot_runs
  add column if not exists authorized_by uuid null references auth.users(id) on delete set null;

-- Ano standalone core: records entered or pasted by a workspace member are
-- neither simulated nor fetched from a provider. This applies only to Ano's
-- Supabase project; Mercury is not referenced or changed.

alter table public.account_candidates
  drop constraint if exists account_candidates_source_label_check;

alter table public.account_candidates
  add constraint account_candidates_source_label_check
  check (source_label in ('manual', 'simulated', 'provider', 'mercury'));

alter table public.contact_candidates
  drop constraint if exists contact_candidates_source_label_check;

alter table public.contact_candidates
  add constraint contact_candidates_source_label_check
  check (source_label in ('manual', 'simulated', 'provider', 'mercury'));

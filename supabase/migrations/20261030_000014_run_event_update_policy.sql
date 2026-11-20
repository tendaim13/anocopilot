-- Repeated graph checkpoints update an existing (graph_run_id, event_key)
-- activity record. The original foundation migration allowed inserts only,
-- which made those idempotent updates fail under authenticated RLS.
create policy run_event_update on public.run_events
  for update to authenticated
  using (public.can_write_ano_workspace(workspace_id))
  with check (public.can_write_ano_workspace(workspace_id));

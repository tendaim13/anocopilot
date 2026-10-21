import { z } from "zod";

import type { WorkspaceSession } from "@/contracts/ano";

export const candidateStateSchema = z.object({
  runId: z.string().uuid(),
  state: z.enum(["shortlisted", "dismissed", "review"]),
});

export type CandidateStateChange = z.infer<typeof candidateStateSchema>;

export async function saveCandidateState(session: WorkspaceSession, candidateKey: string, change: CandidateStateChange) {
  if (session.kind === "demo") return { candidateKey, state: change.state, persistence: "browser-demo" as const };

  const { client, workspace, actorId } = session;
  const { data: candidate, error: candidateError } = await client
    .from("account_candidates")
    .update({ lifecycle_state: change.state })
    .eq("workspace_id", workspace.id)
    .eq("research_run_id", change.runId)
    .eq("source_key", candidateKey)
    .select("id, name")
    .maybeSingle();

  if (candidateError || !candidate) {
    throw new Error("Ano could not update that candidate in this workspace.");
  }

  const { error: auditError } = await client.from("audit_logs").insert({
    workspace_id: workspace.id,
    research_run_id: change.runId,
    actor_id: actorId,
    event_type: "candidate.state_changed",
    outcome: "completed",
    details_json: { candidate_key: candidateKey, state: change.state },
  });

  if (auditError) throw new Error("Ano could not write the candidate-state audit record.");
  return { candidateKey, state: change.state, persistence: "supabase" as const };
}

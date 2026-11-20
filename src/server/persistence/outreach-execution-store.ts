import "server-only";

import type { SupabaseWorkspaceSession, WorkspaceSession } from "@/contracts/ano";
import {
  approvalDecisionViewSchema,
  assertDraftCanCreateProposal,
  compilePlaybookOutreachDrafts,
  contactEligibilityCheckSchema,
  evaluateContactEligibility,
  executionProposalViewSchema,
  outreachDraftViewSchema,
  outreachExecutionViewSchema,
  proposalSummaryFor,
  type ApprovalDecisionView,
  type ExecutionProposalType,
  type ExecutionProposalView,
  type OutreachChannel,
  type OutreachDraftView,
  type OutreachExecutionView,
} from "@/lib/ano/outreach-execution";
import type { AccountPlaybookView, ContactCandidateView } from "@/lib/ano/people-playbooks";
import {
  buildMercuryProposalReceipt,
  mercuryConfiguration,
} from "@/server/connectors/mercury/mercury-read-connector";
import {
  loadShortlistedContext,
  readPeopleDiscoveryForConversation,
} from "@/server/persistence/people-playbook-store";

export class OutreachExecutionPersistenceError extends Error {
  constructor(message: string, readonly code: string = "OUTREACH_EXECUTION_UNAVAILABLE") {
    super(message);
    this.name = "OutreachExecutionPersistenceError";
  }
}

type Row = Record<string, unknown>;

function requireLiveSession(
  session: WorkspaceSession,
): asserts session is SupabaseWorkspaceSession {
  if (session.kind === "demo") {
    throw new OutreachExecutionPersistenceError(
      "Sign in before Ano can prepare outreach drafts or stage approval proposals.",
      "AUTH_REQUIRED",
    );
  }
}

function iso(value: unknown) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new OutreachExecutionPersistenceError("Ano found an invalid Phase F timestamp.");
  }
  return date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function mapDraftRow(
  row: Row,
  accountNamesById: Map<string, string>,
  contactsById: Map<string, ContactCandidateView>,
): OutreachDraftView {
  const contactId = row.contact_candidate_id ? String(row.contact_candidate_id) : null;
  const contact = contactId ? contactsById.get(contactId) ?? null : null;
  const channel = String(row.channel) as OutreachChannel;
  const fallbackEligibility = evaluateContactEligibility(contact, channel);
  const reasons = asStringArray(row.eligibility_reasons_json);

  const eligibility = contactEligibilityCheckSchema.parse({
    status: String(row.eligibility_status ?? fallbackEligibility.status),
    canProposeEmailSend:
      String(row.eligibility_status) === "eligible"
        ? true
        : fallbackEligibility.canProposeEmailSend,
    canProposeCalendarSchedule:
      String(row.eligibility_status) === "eligible"
        ? true
        : fallbackEligibility.canProposeCalendarSchedule,
    canProposeCallTask:
      String(row.eligibility_status) !== "blocked_suppressed" &&
      fallbackEligibility.canProposeCallTask,
    canProposeMercurySync:
      String(row.eligibility_status) !== "blocked_suppressed" &&
      fallbackEligibility.canProposeMercurySync,
    reasons: reasons.length > 0 ? reasons : fallbackEligibility.reasons,
  });

  return outreachDraftViewSchema.parse({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    targetDecisionId: String(row.target_decision_id),
    accountPlaybookId: String(row.account_playbook_id),
    accountCandidateId: String(row.account_candidate_id),
    accountName:
      accountNamesById.get(String(row.account_candidate_id)) ?? "Shortlisted account",
    contactCandidateId: contactId,
    contactName: contact?.fullName ?? null,
    contactEmail: contact?.verifiedDetails?.email ?? null,
    channel,
    version: Number(row.version ?? 1),
    subject: String(row.subject),
    body: String(row.body),
    callScriptPoints: asStringArray(row.call_script_points_json),
    claimIds: asStringArray(row.claim_ids_json),
    signalIds: asStringArray(row.signal_ids_json),
    eligibility,
    status: String(row.status ?? "draft"),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

function mapDecisionRow(row: Row): ApprovalDecisionView {
  return approvalDecisionViewSchema.parse({
    id: String(row.id),
    decision: String(row.decision),
    proposalVersion: Number(row.proposal_version ?? 1),
    rationale: row.rationale ? String(row.rationale) : null,
    decidedBy: String(row.decided_by),
    createdAt: iso(row.created_at),
  });
}

function mapProposalRow(
  row: Row,
  accountNamesById: Map<string, string>,
  contactsById: Map<string, ContactCandidateView>,
  decisionsByProposalId: Map<string, ApprovalDecisionView[]>,
): ExecutionProposalView {
  const payload = asRecord(row.payload_json);
  const contactId = row.contact_candidate_id ? String(row.contact_candidate_id) : null;
  const contact = contactId ? contactsById.get(contactId) ?? null : null;
  const accountId = row.account_candidate_id ? String(row.account_candidate_id) : null;

  return executionProposalViewSchema.parse({
    id: String(row.id),
    conversationId: String(row.conversation_id),
    accountPlaybookId: row.account_playbook_id ? String(row.account_playbook_id) : null,
    accountCandidateId: accountId,
    accountName:
      (accountId ? accountNamesById.get(accountId) : undefined) ??
      (typeof payload.accountName === "string" && payload.accountName
        ? payload.accountName
        : "Target account"),
    contactCandidateId: contactId,
    contactName:
      contact?.fullName ??
      (typeof payload.contactName === "string" && payload.contactName
        ? payload.contactName
        : null),
    contactEmail:
      contact?.verifiedDetails?.email ??
      (typeof payload.contactEmail === "string" && payload.contactEmail
        ? payload.contactEmail
        : null),
    outreachDraftId: row.outreach_draft_id ? String(row.outreach_draft_id) : null,
    providerActionRequestId: row.provider_action_request_id
      ? String(row.provider_action_request_id)
      : null,
    proposalType: String(row.proposal_type),
    targetReference: row.target_reference ? String(row.target_reference) : null,
    status: String(row.status),
    version: Number(row.version ?? 1),
    summary:
      typeof payload.summary === "string" && payload.summary
        ? payload.summary
        : `Approved action proposal (${String(row.proposal_type)})`,
    payload,
    executionReceipt: asRecord(row.execution_receipt_json),
    decisions: decisionsByProposalId.get(String(row.id)) ?? [],
    executedAt: row.executed_at ? iso(row.executed_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

export async function readOutreachExecutionForConversation(
  session: WorkspaceSession,
  conversationId: string,
): Promise<OutreachExecutionView> {
  if (session.kind === "demo") {
    return {
      drafts: [],
      proposals: [],
      mercuryConnected: mercuryConfiguration().available,
    };
  }

  const peopleDiscovery = await readPeopleDiscoveryForConversation(session, conversationId);
  const contactsById = new Map(
    peopleDiscovery.contacts.map((contact) => [contact.id, contact]),
  );
  const accountNamesById = new Map<string, string>();
  for (const playbook of peopleDiscovery.playbooks) {
    accountNamesById.set(playbook.accountCandidateId, playbook.accountName);
  }
  for (const contact of peopleDiscovery.contacts) {
    accountNamesById.set(contact.accountCandidateId, contact.accountName);
  }

  const [draftsRes, proposalsRes] = await Promise.all([
    session.client
      .from("outreach_drafts")
      .select("*")
      .eq("workspace_id", session.workspace.id)
      .eq("conversation_id", conversationId)
      .order("account_candidate_id", { ascending: true })
      .order("channel", { ascending: true })
      .order("version", { ascending: false }),
    session.client
      .from("proposals")
      .select("*")
      .eq("workspace_id", session.workspace.id)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false }),
  ]);

  if (draftsRes.error || proposalsRes.error) {
    throw new OutreachExecutionPersistenceError(
      "Ano could not load saved outreach drafts and execution proposals.",
    );
  }

  const proposalRows = (proposalsRes.data ?? []) as Row[];
  const proposalIds = proposalRows.map((row) => String(row.id));
  const decisionsByProposalId = new Map<string, ApprovalDecisionView[]>();

  if (proposalIds.length > 0) {
    const { data: decisions, error: decisionError } = await session.client
      .from("approval_decisions")
      .select("*")
      .eq("workspace_id", session.workspace.id)
      .in("proposal_id", proposalIds)
      .order("created_at", { ascending: true });

    if (decisionError) {
      throw new OutreachExecutionPersistenceError(
        "Ano could not read immutable proposal approval decisions.",
      );
    }

    for (const row of (decisions ?? []) as Row[]) {
      const pid = String(row.proposal_id);
      const list = decisionsByProposalId.get(pid) ?? [];
      list.push(mapDecisionRow(row));
      decisionsByProposalId.set(pid, list);
    }
  }

  return outreachExecutionViewSchema.parse({
    drafts: ((draftsRes.data ?? []) as Row[]).map((row) =>
      mapDraftRow(row, accountNamesById, contactsById),
    ),
    proposals: proposalRows.map((row) =>
      mapProposalRow(row, accountNamesById, contactsById, decisionsByProposalId),
    ),
    mercuryConnected: mercuryConfiguration().available,
  });
}

export async function generateOutreachDrafts(
  session: WorkspaceSession,
  conversationId: string,
  playbookId?: string,
): Promise<OutreachExecutionView> {
  requireLiveSession(session);
  const [context, peopleDiscovery] = await Promise.all([
    loadShortlistedContext(session, conversationId),
    readPeopleDiscoveryForConversation(session, conversationId),
  ]);

  const targetPlaybooks: AccountPlaybookView[] = playbookId
    ? peopleDiscovery.playbooks.filter((item) => item.id === playbookId)
    : peopleDiscovery.playbooks;

  if (targetPlaybooks.length === 0) {
    throw new OutreachExecutionPersistenceError(
      "Compile at least one factual Phase E playbook before generating outreach drafts.",
      "PLAYBOOK_REQUIRED",
    );
  }

  const now = new Date().toISOString();
  const rowsToUpsert: Record<string, unknown>[] = [];

  for (const playbook of targetPlaybooks) {
    const compiled = compilePlaybookOutreachDrafts({
      playbook,
      contacts: peopleDiscovery.contacts,
      nowIso: now,
    });
    for (const draft of compiled) {
      rowsToUpsert.push({
        id: draft.id,
        workspace_id: session.workspace.id,
        conversation_id: conversationId,
        target_decision_id: context.targetDecisionId,
        account_playbook_id: draft.accountPlaybookId,
        account_candidate_id: draft.accountCandidateId,
        contact_candidate_id: draft.contactCandidateId,
        channel: draft.channel,
        version: 1,
        subject: draft.subject,
        body: draft.body,
        call_script_points_json: draft.callScriptPoints,
        claim_ids_json: draft.claimIds,
        signal_ids_json: draft.signalIds,
        eligibility_status: draft.eligibility.status,
        eligibility_reasons_json: draft.eligibility.reasons,
        status: draft.status,
        created_by: session.actorId,
        updated_at: now,
      });
    }
  }

  const { error } = await session.client
    .from("outreach_drafts")
    .upsert(rowsToUpsert, {
      onConflict: "workspace_id,account_playbook_id,channel,version",
    });

  if (error) {
    throw new OutreachExecutionPersistenceError(
      "Ano could not save the compiled outreach drafts.",
    );
  }

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "outreach.drafts_compiled",
    outcome: "completed",
    details_json: {
      conversation_id: conversationId,
      draft_count: rowsToUpsert.length,
    },
  });

  await session.client.from("run_events").upsert(
    {
      workspace_id: session.workspace.id,
      graph_run_id: context.graphRunId,
      event_key: `phase-f-drafts:${conversationId}`,
      label: "Versioned outreach drafts ready",
      detail: `Compiled ${rowsToUpsert.length} review-only outreach draft${rowsToUpsert.length === 1 ? "" : "s"} with deterministic contact-eligibility checks. Nothing has been sent.`,
    },
    { onConflict: "graph_run_id,event_key" },
  );

  return readOutreachExecutionForConversation(session, conversationId);
}

export async function saveEditedOutreachDraftVersion(
  session: WorkspaceSession,
  conversationId: string,
  draftId: string,
  subject: string,
  body: string,
): Promise<OutreachExecutionView> {
  requireLiveSession(session);
  const { data: existing, error: fetchError } = await session.client
    .from("outreach_drafts")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .eq("id", draftId)
    .maybeSingle();

  if (fetchError || !existing) {
    throw new OutreachExecutionPersistenceError(
      "Ano could not find that outreach draft.",
      "DRAFT_NOT_FOUND",
    );
  }

  const { data: maxVersionRow } = await session.client
    .from("outreach_drafts")
    .select("version")
    .eq("workspace_id", session.workspace.id)
    .eq("account_playbook_id", existing.account_playbook_id)
    .eq("channel", existing.channel)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = Number(maxVersionRow?.version ?? existing.version ?? 1) + 1;
  const now = new Date().toISOString();

  const { error: insertError } = await session.client
    .from("outreach_drafts")
    .insert({
      id: crypto.randomUUID(),
      workspace_id: session.workspace.id,
      conversation_id: conversationId,
      target_decision_id: existing.target_decision_id,
      account_playbook_id: existing.account_playbook_id,
      account_candidate_id: existing.account_candidate_id,
      contact_candidate_id: existing.contact_candidate_id,
      channel: existing.channel,
      version: nextVersion,
      subject: subject.trim(),
      body: body.trim(),
      call_script_points_json: existing.call_script_points_json,
      claim_ids_json: existing.claim_ids_json,
      signal_ids_json: existing.signal_ids_json,
      eligibility_status: existing.eligibility_status,
      eligibility_reasons_json: existing.eligibility_reasons_json,
      status: existing.status === "executed" || existing.status === "approved" ? "draft" : existing.status,
      created_by: session.actorId,
      updated_at: now,
    });

  if (insertError) {
    throw new OutreachExecutionPersistenceError(
      "Ano could not save the new outreach draft version.",
    );
  }

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "outreach.draft_version_created",
    outcome: "completed",
    details_json: {
      conversation_id: conversationId,
      channel: existing.channel,
      version: nextVersion,
    },
  });

  return readOutreachExecutionForConversation(session, conversationId);
}

export async function stageExecutionProposalFromDraft(
  session: WorkspaceSession,
  input: {
    conversationId: string;
    draftId: string;
    proposalType: ExecutionProposalType;
    scheduledFor?: string;
    note?: string;
  },
): Promise<OutreachExecutionView> {
  requireLiveSession(session);
  const { conversationId, draftId, proposalType, scheduledFor, note } = input;
  const [context, view] = await Promise.all([
    loadShortlistedContext(session, conversationId),
    readOutreachExecutionForConversation(session, conversationId),
  ]);

  const draft = view.drafts.find((item) => item.id === draftId);
  if (!draft) {
    throw new OutreachExecutionPersistenceError(
      "Ano could not find that outreach draft.",
      "DRAFT_NOT_FOUND",
    );
  }

  assertDraftCanCreateProposal(draft, proposalType);

  const summary = proposalSummaryFor(proposalType, draft, scheduledFor);
  const proposalId = crypto.randomUUID();
  const actionRequestId = crypto.randomUUID();
  const now = new Date().toISOString();
  const isMercury = proposalType.startsWith("mercury_");

  const { error: actionError } = await session.client
    .from("provider_action_requests")
    .insert({
      id: actionRequestId,
      workspace_id: session.workspace.id,
      ano_research_run_id: context.anoResearchRunId,
      provider_key: isMercury ? "mercury" : "outreach",
      action_kind: isMercury ? "mercury_proposal" : "outreach_proposal",
      request_key: `phase-f-proposal:${proposalId}`,
      request_json: {
        proposalType,
        draftId: draft.id,
        draftVersion: draft.version,
        channel: draft.channel,
        accountName: draft.accountName,
        contactName: draft.contactName,
        contactEmail: draft.contactEmail,
        scheduledFor: scheduledFor ?? null,
        note: note ?? null,
      },
      status: "awaiting_approval",
      maximum_operations: 1,
      reported_credits: 0,
      created_by: session.actorId,
    });

  if (actionError) {
    throw new OutreachExecutionPersistenceError(
      "Ano could not record the approval-gated provider action request.",
    );
  }

  const payloadJson = {
    summary,
    channel: draft.channel,
    draftVersion: draft.version,
    subject: draft.subject,
    body: draft.body,
    callScriptPoints: draft.callScriptPoints,
    accountName: draft.accountName,
    contactName: draft.contactName,
    contactEmail: draft.contactEmail,
    claimIds: draft.claimIds,
    signalIds: draft.signalIds,
    scheduledFor: scheduledFor ?? null,
    note: note ?? null,
  };

  const { error: proposalError } = await session.client.from("proposals").insert({
    id: proposalId,
    workspace_id: session.workspace.id,
    conversation_id: conversationId,
    target_decision_id: context.targetDecisionId,
    account_playbook_id: draft.accountPlaybookId,
    account_candidate_id: draft.accountCandidateId,
    contact_candidate_id: draft.contactCandidateId,
    outreach_draft_id: draft.id,
    provider_action_request_id: actionRequestId,
    created_by: session.actorId,
    proposal_type: proposalType,
    target_reference: draft.contactEmail ?? draft.accountName,
    payload_json: payloadJson,
    status: "awaiting_approval",
    version: 1,
    idempotency_key: crypto.randomUUID(),
    updated_at: now,
  });

  if (proposalError) {
    throw new OutreachExecutionPersistenceError(
      "Ano could not stage that execution proposal.",
    );
  }

  await session.client
    .from("outreach_drafts")
    .update({ status: "proposed", updated_at: now })
    .eq("workspace_id", session.workspace.id)
    .eq("id", draft.id);

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type: "proposal.staged",
    outcome: "awaiting_approval",
    details_json: {
      conversation_id: conversationId,
      proposal_id: proposalId,
      proposal_type: proposalType,
      draft_id: draft.id,
    },
  });

  await session.client.from("run_events").upsert(
    {
      workspace_id: session.workspace.id,
      graph_run_id: context.graphRunId,
      event_key: `phase-f-proposal:${proposalId}`,
      label: "Execution proposal awaiting approval",
      detail: summary,
    },
    { onConflict: "graph_run_id,event_key" },
  );

  return readOutreachExecutionForConversation(session, conversationId);
}

export async function decideAndExecuteProposal(
  session: WorkspaceSession,
  input: {
    conversationId: string;
    proposalId: string;
    decision: "approved" | "rejected" | "dismissed";
    rationale?: string;
  },
): Promise<OutreachExecutionView> {
  requireLiveSession(session);
  const { conversationId, proposalId, decision, rationale } = input;
  const context = await loadShortlistedContext(session, conversationId);

  const { data: beforeRow, error: beforeError } = await session.client
    .from("proposals")
    .select("*")
    .eq("workspace_id", session.workspace.id)
    .eq("conversation_id", conversationId)
    .eq("id", proposalId)
    .maybeSingle();

  if (beforeError || !beforeRow) {
    throw new OutreachExecutionPersistenceError(
      "Ano could not find that execution proposal.",
      "PROPOSAL_NOT_FOUND",
    );
  }

  if (String(beforeRow.status) !== "awaiting_approval") {
    return readOutreachExecutionForConversation(session, conversationId);
  }

  const now = new Date().toISOString();
  const nextProposalStatus = decision === "approved" ? "executed" : decision;
  const proposalType = String(beforeRow.proposal_type) as ExecutionProposalType;
  const payload = asRecord(beforeRow.payload_json);

  const receipt =
    decision === "approved"
      ? proposalType.startsWith("mercury_")
        ? buildMercuryProposalReceipt(
            proposalId,
            proposalType as Extract<
              ExecutionProposalType,
              "mercury_task" | "mercury_draft" | "mercury_update"
            >,
            payload,
            now,
          )
        : {
            provider: "outreach",
            proposalId,
            proposalType,
            status: "recorded_after_human_approval",
            targetReference: beforeRow.target_reference ?? null,
            approvedBy: session.actorId,
            executedAt: now,
          }
      : {
          decision,
          closedAt: now,
        };

  const { data: updated, error: updateError } = await session.client
    .from("proposals")
    .update({
      status: nextProposalStatus,
      execution_receipt_json: receipt,
      executed_at: decision === "approved" ? now : null,
      updated_at: now,
    })
    .eq("workspace_id", session.workspace.id)
    .eq("id", proposalId)
    .eq("status", "awaiting_approval")
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    return readOutreachExecutionForConversation(session, conversationId);
  }

  const { error: decisionError } = await session.client
    .from("approval_decisions")
    .insert({
      workspace_id: session.workspace.id,
      proposal_id: proposalId,
      decided_by: session.actorId,
      decision,
      proposal_version: Number(beforeRow.version ?? 1),
      rationale: rationale?.trim() || null,
    });

  if (decisionError) {
    throw new OutreachExecutionPersistenceError(
      "Ano could not persist the immutable proposal decision.",
    );
  }

  if (beforeRow.provider_action_request_id) {
    await session.client
      .from("provider_action_requests")
      .update({
        status: decision === "approved" ? "succeeded" : "failed_safe",
        approved_by: decision === "approved" ? session.actorId : null,
        approved_at: decision === "approved" ? now : null,
        completed_at: now,
        provider_receipt_json: receipt,
      })
      .eq("id", String(beforeRow.provider_action_request_id));
  }

  if (beforeRow.outreach_draft_id) {
    await session.client
      .from("outreach_drafts")
      .update({
        status: decision === "approved" ? "executed" : "rejected",
        updated_at: now,
      })
      .eq("workspace_id", session.workspace.id)
      .eq("id", String(beforeRow.outreach_draft_id));
  }

  await session.client.from("audit_logs").insert({
    workspace_id: session.workspace.id,
    actor_id: session.actorId,
    event_type:
      decision === "approved" ? "proposal.approved_and_executed" : `proposal.${decision}`,
    outcome: nextProposalStatus,
    details_json: {
      conversation_id: conversationId,
      proposal_id: proposalId,
      proposal_type: proposalType,
      rationale: rationale ?? null,
    },
  });

  await session.client.from("run_events").upsert(
    {
      workspace_id: session.workspace.id,
      graph_run_id: context.graphRunId,
      event_key: `phase-f-decision:${proposalId}`,
      label:
        decision === "approved"
          ? "Proposal approved & recorded"
          : `Proposal ${decision}`,
      detail:
        typeof payload.summary === "string"
          ? `${payload.summary} (${decision})`
          : `Proposal ${proposalType} marked ${decision}.`,
    },
    { onConflict: "graph_run_id,event_key" },
  );

  return readOutreachExecutionForConversation(session, conversationId);
}

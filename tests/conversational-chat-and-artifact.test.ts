import type { SupabaseClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceSession } from "@/contracts/ano";
import {
  formatAccountForCohortTable,
  scoreAndBuildAccountDossier,
  type CompanySearchView,
} from "@/lib/ano/company-discovery";
import {
  conversationMessageSchema,
  sortChronologicalThreadEntries,
  type ResearchConversationView,
} from "@/lib/ano/research-conversation";
import {
  buildConversationChatPrompt,
  parseConversationChatResponse,
} from "@/server/agents/conversation-chat-model";
import { appendAssistantMessage } from "@/server/persistence/research-conversation-store";

const convId = "00000000-0000-4000-8000-000000000601";
const runId = "00000000-0000-4000-8000-000000000602";
const decisionId = "00000000-0000-4000-8000-000000000603";
const searchId = "00000000-0000-4000-8000-000000000604";
const dossierId = "00000000-0000-4000-8000-000000000605";
const claimId = "00000000-0000-4000-8000-000000000606";

test("formatAccountForCohortTable extracts specialisation, city, country, and domain cleanly", () => {
  const dossier = scoreAndBuildAccountDossier(
    {
      provider: "openstreetmap",
      id: "node-77",
      name: "Pro Heal Dental",
      website: "https://prohealdental.com",
      domain: "prohealdental.com",
      industry: "Dental Clinic (OpenStreetMap)",
      location: { city: "Kuala Lumpur", country: "Malaysia" },
      address: "Jalan Perak, Bukit Bintang, Kuala Lumpur, Malaysia",
      osmTags: { amenity: "dentist" },
    },
    {
      dossierId,
      conversationId: convId,
      targetDecisionId: decisionId,
      companySearchId: searchId,
      providerKey: "openstreetmap",
      targetMarketName: "Kuala Lumpur, Malaysia",
      targetIndustryName: "Dental industry",
      canonicalLocations: ["Kuala Lumpur, Malaysia"],
      linkedClaimIds: [claimId],
      capturedAt: "2026-11-21T10:00:00.000Z",
    },
  );

  const row = formatAccountForCohortTable(dossier);
  assert.equal(row.name, "Pro Heal Dental");
  assert.equal(row.specialisation, "Dental Clinic");
  assert.equal(row.city, "Kuala Lumpur");
  assert.equal(row.country, "Malaysia");
  assert.equal(row.domain, "prohealdental.com");
  assert.equal(row.fitScore, dossier.fit.totalScore);
  assert.equal(row.lifecycleState, "discovered");
});

test("sortChronologicalThreadEntries interleaves follow-up chat beneath Phase D cohort artifact", () => {
  const sorted = sortChronologicalThreadEntries([
    { id: "msg-follow-up", timestamp: "2026-11-21T12:00:00.000Z", orderHint: 1 },
    { id: "artifact-cohort", timestamp: "2026-11-21T11:30:00.000Z", orderHint: 170 },
    { id: "msg-opening", timestamp: "2026-11-21T10:00:00.000Z", orderHint: 0 },
    { id: "artifact-plan", timestamp: "2026-11-21T10:01:00.000Z", orderHint: 100 },
    { id: "msg-ano-reply", timestamp: "2026-11-21T12:00:10.000Z", orderHint: 2 },
  ]);

  assert.deepEqual(
    sorted.map((entry) => entry.id),
    ["msg-opening", "artifact-plan", "artifact-cohort", "msg-follow-up", "msg-ano-reply"],
  );
});

test("buildConversationChatPrompt and parseConversationChatResponse handle grounded Q&A, filter updates, and fallback", () => {
  const conversation: ResearchConversationView = {
    conversation: {
      id: convId,
      title: "Dental clinics outbound",
      status: "complete_without_research",
      threadId: `ano:ws:${convId}`,
      createdAt: "2026-11-21T10:00:00.000Z",
      updatedAt: "2026-11-21T10:00:00.000Z",
    },
    run: {
      id: runId,
      status: "complete_without_research",
      graphVersion: "phase-a-v1",
      currentNode: "complete",
      checkpointRef: null,
      failureMessage: null,
    },
    messages: [
      {
        id: "00000000-0000-4000-8000-000000000607",
        role: "user",
        kind: "message",
        text: "We sell patient recall software for multi-chair dental clinics.",
        createdAt: "2026-11-21T10:00:00.000Z",
      },
    ],
    brief: {
      offer: "Automated patient-recall software",
      goal: "Find multi-chair dental clinics",
      marketHints: ["Australia", "Malaysia"],
      locationHints: ["Kuala Lumpur"],
      buyerHints: ["Principal Dentist"],
      constraints: [],
      unknowns: [],
      sourceMessageIds: ["00000000-0000-4000-8000-000000000607"],
    },
    pendingQuestion: null,
    plan: null,
    events: [],
  };

  const companySearch: CompanySearchView = {
    id: searchId,
    conversationId: convId,
    targetDecisionId: decisionId,
    providerActionRequestId: null,
    providerKey: "openstreetmap",
    status: "completed",
    targetMarketName: "Kuala Lumpur, Malaysia",
    targetIndustryName: "Dental industry",
    requestedLocations: ["Kuala Lumpur, Malaysia"],
    canonicalLocations: ["Kuala Lumpur, Malaysia"],
    canonicalIndustries: [],
    industryKeywords: ["dental clinic", "dentist"],
    excludedCategories: [],
    linkedClaimIds: [claimId],
    criteria: ["Strict 25-business cap"],
    providerFilters: { source: "openstreetmap" },
    maximumResults: 25,
    estimatedMaximumCredits: 0,
    estimateDetail: "Free discovery",
    resultCount: 1,
    providerReceipt: { free: true, credit_bearing_request: false },
    failureMessage: null,
    cohort: null,
    accounts: [
      scoreAndBuildAccountDossier(
        {
          provider: "openstreetmap",
          id: "node-77",
          name: "Pro Heal Dental",
          website: "https://prohealdental.com",
          domain: "prohealdental.com",
          industry: "Dental Clinic (OpenStreetMap)",
          location: { city: "Kuala Lumpur", country: "Malaysia" },
          osmTags: { amenity: "dentist" },
        },
        {
          dossierId,
          conversationId: convId,
          targetDecisionId: decisionId,
          companySearchId: searchId,
          providerKey: "openstreetmap",
          targetMarketName: "Kuala Lumpur, Malaysia",
          targetIndustryName: "Dental industry",
          canonicalLocations: ["Kuala Lumpur, Malaysia"],
          linkedClaimIds: [claimId],
          capturedAt: "2026-11-21T10:05:00.000Z",
        },
      ),
    ],
    approvedAt: "2026-11-21T10:05:00.000Z",
    completedAt: "2026-11-21T10:05:05.000Z",
    createdAt: "2026-11-21T10:04:00.000Z",
    updatedAt: "2026-11-21T10:05:05.000Z",
  };

  const { user } = buildConversationChatPrompt(
    { conversation, companySearch },
    "Compare these clinics and tell me which ones have domains.",
  );
  assert.ok(user.includes("Pro Heal Dental | Dental Clinic | Kuala Lumpur, Malaysia"));

  const qa = parseConversationChatResponse(
    '```json\n{"reply": "Pro Heal Dental has prohealdental.com verified.", "filterUpdate": null}\n```',
  );
  assert.equal(qa.reply, "Pro Heal Dental has prohealdental.com verified.");
  assert.equal(qa.filterUpdate, null);

  const filterReq = parseConversationChatResponse(
    JSON.stringify({
      reply: "I will exclude university faculties and narrow to Melbourne and Singapore.",
      filterUpdate: {
        apply: true,
        providerKey: "openstreetmap",
        locations: ["Melbourne, Australia", "Singapore"],
        excludedCategories: ["university", "fakulti"],
        reason: "Exclude universities and switch cities",
      },
    }),
  );
  assert.equal(filterReq.filterUpdate?.apply, true);
  assert.deepEqual(filterReq.filterUpdate?.locations, ["Melbourne, Australia", "Singapore"]);
  assert.deepEqual(filterReq.filterUpdate?.excludedCategories, ["university", "fakulti"]);

  const plainFallback = parseConversationChatResponse(
    "You currently have 1 dental clinic with a verified domain.",
  );
  assert.equal(plainFallback.reply, "You currently have 1 dental clinic with a verified domain.");
  assert.equal(plainFallback.filterUpdate, null);

  const parsedMessage = conversationMessageSchema.parse({
    id: "00000000-0000-4000-8000-000000000608",
    role: "assistant",
    kind: "message",
    text: "Updated the cohort.",
    createdAt: "2026-11-21T10:10:00.000Z",
    metadata: {
      companySearchUpdated: true,
      companySearchProvider: "openstreetmap",
      companySearchId: searchId,
      companySearchResultCount: 15,
      awaitingCreditApproval: false,
    },
  });
  assert.equal(parsedMessage.metadata?.companySearchResultCount, 15);
});

test("appendAssistantMessage keys dedupe_key instead of uuid idempotency_key", async () => {
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
  const insertedRows: Array<Record<string, unknown>> = [];

  const mockClient = {
    from(table: string) {
      const state: { op: string; filterCount: number } = { op: "select", filterCount: 0 };
      const chain = {
        select() {
          state.op = "select";
          return chain;
        },
        update() {
          state.op = "update";
          return chain;
        },
        insert(row: Record<string, unknown>) {
          insertedRows.push(row);
          if ("idempotency_key" in row && row.idempotency_key !== undefined) {
            return Promise.resolve({
              error: { code: "22P02", message: "invalid input syntax for type uuid" },
            });
          }
          return Promise.resolve({ error: null });
        },
        eq(column: string, value: unknown) {
          state.filterCount += 1;
          eqCalls.push({ table, column, value });
          if (table === "ano_conversations" && state.op === "update" && state.filterCount >= 2) {
            return Promise.resolve({ error: null });
          }
          return chain;
        },
        maybeSingle() {
          if (table === "ano_conversations") {
            return Promise.resolve({
              data: {
                id: convId,
                title: "Dental clinics outbound",
                status: "complete_without_research",
                active_thread_id: `ano:ws:${convId}`,
                created_at: "2026-11-21T10:00:00.000Z",
                updated_at: "2026-11-21T10:00:00.000Z",
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };

  const session: WorkspaceSession = {
    kind: "supabase",
    actorId: "00000000-0000-4000-8000-000000000901",
    actorEmail: "seller@example.com",
    workspace: {
      id: "00000000-0000-4000-8000-000000000902",
      name: "Test Workspace",
      slug: "test-ws",
      role: "owner",
    },
    client: mockClient as unknown as SupabaseClient,
  };

  const dedupeKey = `assistant:${runId}`;
  const res = await appendAssistantMessage(
    session,
    convId,
    "Target Principal Dentists and Practice Managers.",
    dedupeKey,
    { peopleSearchUpdated: true, peopleSearchProvider: "website_team" },
  );

  assert.equal(res.created, true);
  assert.ok(
    eqCalls.some(
      (call) =>
        call.table === "ano_messages" &&
        call.column === "dedupe_key" &&
        call.value === dedupeKey,
    ),
  );
  assert.ok(
    !eqCalls.some(
      (call) => call.table === "ano_messages" && call.column === "idempotency_key",
    ),
  );
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0]?.dedupe_key, dedupeKey);
  assert.equal("idempotency_key" in (insertedRows[0] ?? {}), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SupabaseWorkspaceSession } from "@/contracts/ano";
import {
  buildFriendlyConversationTitle,
  conversationTitle,
  DEFAULT_CONVERSATION_TITLE,
  needsFriendlyTitleRefresh,
} from "@/lib/ano/research-conversation";
import {
  autoUpdateConversationTitle,
  backfillFriendlyConversationTitles,
} from "@/server/persistence/research-conversation-store";

type TableRows = Record<string, Array<Record<string, unknown>>>;

function createMockSupabaseSession(initialTables: TableRows) {
  const tables: TableRows = structuredClone(initialTables);
  const updateCalls: Array<{
    table: string;
    patch: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];
  const auditInserts: Array<Record<string, unknown>> = [];

  function matchesFilters(
    row: Record<string, unknown>,
    eqFilters: Record<string, unknown>,
    neqFilters: Record<string, unknown>,
    inFilters: Record<string, unknown[]>,
  ) {
    for (const [key, value] of Object.entries(eqFilters)) {
      if (row[key] !== value) return false;
    }
    for (const [key, value] of Object.entries(neqFilters)) {
      if (row[key] === value) return false;
    }
    for (const [key, values] of Object.entries(inFilters)) {
      if (!values.includes(row[key])) return false;
    }
    return true;
  }

  const client = {
    from(table: string) {
      const eqFilters: Record<string, unknown> = {};
      const neqFilters: Record<string, unknown> = {};
      const inFilters: Record<string, unknown[]> = {};
      let mode: "select" | "update" = "select";
      let updatePatch: Record<string, unknown> = {};
      let orderKey: string | null = null;
      let orderAsc = true;
      let limitVal: number | null = null;

      const execute = () => {
        const rows = tables[table] ?? [];
        const matched = rows.filter((row) =>
          matchesFilters(row, eqFilters, neqFilters, inFilters),
        );

        if (mode === "update") {
          for (const row of matched) {
            Object.assign(row, updatePatch);
          }
          updateCalls.push({
            table,
            patch: { ...updatePatch },
            filters: { ...eqFilters },
          });
          return { data: matched, error: null };
        }

        let sorted = [...matched];
        if (orderKey) {
          const key = orderKey;
          sorted.sort((left, right) => {
            const a = String(left[key] ?? "");
            const b = String(right[key] ?? "");
            return orderAsc ? a.localeCompare(b) : b.localeCompare(a);
          });
        }
        if (limitVal !== null) {
          sorted = sorted.slice(0, limitVal);
        }
        return { data: sorted, error: null };
      };

      const builder = {
        select() {
          mode = "select";
          return builder;
        },
        update(patch: Record<string, unknown>) {
          mode = "update";
          updatePatch = patch;
          return builder;
        },
        insert(row: Record<string, unknown>) {
          if (table === "audit_logs") {
            auditInserts.push(row);
          }
          tables[table] = tables[table] ?? [];
          tables[table].push(row);
          return Promise.resolve({ data: [row], error: null });
        },
        eq(col: string, val: unknown) {
          eqFilters[col] = val;
          return builder;
        },
        neq(col: string, val: unknown) {
          neqFilters[col] = val;
          return builder;
        },
        in(col: string, vals: unknown[]) {
          inFilters[col] = vals;
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderKey = col;
          orderAsc = opts?.ascending !== false;
          return builder;
        },
        limit(n: number) {
          limitVal = n;
          return builder;
        },
        maybeSingle() {
          const res = execute();
          return Promise.resolve({
            data: res.data[0] ?? null,
            error: res.error,
          });
        },
        then<TResult1 = { data: Array<Record<string, unknown>>; error: null }>(
          onfulfilled?:
            | ((value: { data: Array<Record<string, unknown>>; error: null }) => TResult1 | PromiseLike<TResult1>)
            | null,
        ) {
          return Promise.resolve(execute()).then(onfulfilled);
        },
      };

      return builder;
    },
  };

  const session: SupabaseWorkspaceSession = {
    kind: "supabase",
    actorId: "11111111-1111-4111-8111-111111111111",
    actorEmail: "founder@example.com",
    workspace: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Acme Workspace",
      slug: "acme",
      role: "owner",
    },
    client: client as unknown as SupabaseClient,
  };

  return { session, tables, updateCalls, auditInserts };
}

test("buildFriendlyConversationTitle formats natural prompts cleanly", () => {
  assert.equal(
    buildFriendlyConversationTitle({
      openingMessage: "I am selling shoes to south east asia",
    }),
    "Shoes — Southeast Asia",
  );
  assert.equal(
    conversationTitle("selling shoes to south eat asia"),
    "Shoes — Southeast Asia",
  );
  assert.equal(
    buildFriendlyConversationTitle({
      openingMessage:
        "We sell automated patient-recall software for multi-chair dental clinics in Malaysia",
    }),
    "Automated Patient-Recall Software — Malaysia",
  );
  assert.equal(
    buildFriendlyConversationTitle({
      openingMessage: "selling shoes to retailers in Malaysia",
    }),
    "Shoes — Malaysia",
  );
  assert.equal(
    buildFriendlyConversationTitle({
      openingMessage: "We sell cybersecurity software to banks in the UK",
    }),
    "Cybersecurity Software — UK",
  );
  assert.equal(
    buildFriendlyConversationTitle({
      openingMessage: "selling dental software to clinics",
    }),
    "Dental Software",
  );
  assert.equal(
    buildFriendlyConversationTitle({
      openingMessage: "I sell building materials to Malaysia",
    }),
    "Building Materials — Malaysia",
  );
  assert.equal(
    buildFriendlyConversationTitle({
      brief: { offer: "Running Shoes" },
    }),
    "Running Shoes",
  );
});

test("buildFriendlyConversationTitle handles URLs, attached files, and acronyms without clutter", () => {
  assert.equal(
    buildFriendlyConversationTitle({
      openingMessage: "Analyze my attached product source(s): acme-footwear-catalog.pdf",
    }),
    "Acme Footwear Catalog",
  );

  assert.equal(
    buildFriendlyConversationTitle({
      openingMessage: "Analyze my attached product source(s): https://www.acme-shoes.com/catalog",
      brief: {
        offer: "",
        goal: "",
        targetMarkets: ["Southeast Asia"],
      },
      productSourceLabels: ["acme-shoes.com"],
      productSourceSummaries: ["Acme Shoes manufactures handmade leather running shoes for humid climates."],
    }),
    "Handmade Leather Running Shoes — Southeast Asia",
  );

  assert.equal(
    buildFriendlyConversationTitle({
      openingMessage: "https://www.acme-shoes.com/catalog",
    }),
    "Acme Shoes",
  );

  assert.equal(
    buildFriendlyConversationTitle({
      openingMessage: "we build ai b2b saas crm tools for smbs in uae",
    }),
    "AI B2B SaaS CRM Tools — UAE",
  );
});

test("buildFriendlyConversationTitle ignores seller home location and upgrades on Phase C market lock", () => {
  const phaseATitle = buildFriendlyConversationTitle({
    openingMessage: "I sell shoes",
    brief: {
      offer: "Shoes",
      goal: "Find retail distributors",
      businessLocation: "Zimbabwe",
      targetMarkets: ["Recommend the best markets"],
    },
  });
  assert.equal(phaseATitle, "Shoes");

  const phaseCTitle = buildFriendlyConversationTitle({
    openingMessage: "I sell shoes",
    brief: {
      offer: "Shoes",
      goal: "Find retail distributors",
      businessLocation: "Zimbabwe",
      targetMarkets: ["Recommend the best markets"],
    },
    lockedMarketName: "Singapore",
  });
  assert.equal(phaseCTitle, "Shoes — Singapore");

  const multiMarketTitle = buildFriendlyConversationTitle({
    brief: {
      offer: "Shoes",
      targetMarkets: ["Malaysia", "Singapore"],
    },
  });
  assert.equal(multiMarketTitle, "Shoes — Malaysia & Singapore");
});

test("needsFriendlyTitleRefresh detects messy/incomplete titles and preserves clean ones", () => {
  assert.equal(needsFriendlyTitleRefresh("Shoes — Southeast Asia", "Shoes — Southeast Asia"), false);
  assert.equal(needsFriendlyTitleRefresh("Custom Brand Playbook", DEFAULT_CONVERSATION_TITLE), false);
  assert.equal(needsFriendlyTitleRefresh("https://acme-shoes.com/deck"), true);
  assert.equal(
    needsFriendlyTitleRefresh("Analyze my attached product source(s): product-deck.pdf"),
    true,
  );
  assert.equal(needsFriendlyTitleRefresh("I am selling shoes to south east asia"), true);
  assert.equal(needsFriendlyTitleRefresh("selling shoes to south east asia"), true);
  assert.equal(needsFriendlyTitleRefresh("Long prompt that gets cut off cleanly at the end…"), true);
  assert.equal(needsFriendlyTitleRefresh("Shoes", "Shoes — Singapore"), true);
  assert.equal(needsFriendlyTitleRefresh("Shoes — Primary Target Market"), true);
});

test("autoUpdateConversationTitle and backfillFriendlyConversationTitles respect manual renames and preserve updated_at", async () => {
  const workspaceId = "22222222-2222-4222-8222-222222222222";
  const convManualId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const convRawPromptId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const convLockedUpgradeId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const convAttachmentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const convAlreadyCleanId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const marketSingaporeId = "99999999-9999-4999-8999-999999999999";

  const mock = createMockSupabaseSession({
    ano_conversations: [
      {
        id: convManualId,
        workspace_id: workspaceId,
        active_graph: "research",
        status: "complete_without_research",
        title: "Q4 Priority SEA Shoe Push",
        active_thread_id: `ano:${workspaceId}:${convManualId}`,
        created_at: "2026-11-20T10:00:00.000Z",
        updated_at: "2026-11-20T11:00:00.000Z",
      },
      {
        id: convRawPromptId,
        workspace_id: workspaceId,
        active_graph: "research",
        status: "awaiting_plan_approval",
        title: "I am selling shoes to south eat asia for B2B wholesale buyers…",
        active_thread_id: `ano:${workspaceId}:${convRawPromptId}`,
        created_at: "2026-11-21T10:00:00.000Z",
        updated_at: "2026-11-21T11:00:00.000Z",
      },
      {
        id: convLockedUpgradeId,
        workspace_id: workspaceId,
        active_graph: "research",
        status: "complete_without_research",
        title: "Shoes",
        active_thread_id: `ano:${workspaceId}:${convLockedUpgradeId}`,
        created_at: "2026-11-22T10:00:00.000Z",
        updated_at: "2026-11-22T11:00:00.000Z",
      },
      {
        id: convAttachmentId,
        workspace_id: workspaceId,
        active_graph: "research",
        status: "complete_without_research",
        title: "Analyze my attached product source(s): https://acme.example/deck.pdf",
        active_thread_id: `ano:${workspaceId}:${convAttachmentId}`,
        created_at: "2026-11-23T10:00:00.000Z",
        updated_at: "2026-11-23T11:00:00.000Z",
      },
      {
        id: convAlreadyCleanId,
        workspace_id: workspaceId,
        active_graph: "research",
        status: "complete_without_research",
        title: "Dental Software — Malaysia",
        active_thread_id: `ano:${workspaceId}:${convAlreadyCleanId}`,
        created_at: "2026-11-23T12:00:00.000Z",
        updated_at: "2026-11-23T13:00:00.000Z",
      },
    ],
    audit_logs: [
      {
        workspace_id: workspaceId,
        event_type: "conversation_renamed",
        details_json: {
          conversationId: convManualId,
          title: "Q4 Priority SEA Shoe Push",
        },
      },
    ],
    research_briefs: [
      {
        workspace_id: workspaceId,
        conversation_id: convManualId,
        content_json: { offer: "Shoes", goal: "Wholesale buyers", sourceMessageIds: [] },
        business_location: "Zimbabwe",
        target_markets_json: ["Southeast Asia"],
        intake_complete: true,
      },
      {
        workspace_id: workspaceId,
        conversation_id: convRawPromptId,
        content_json: { offer: "Running Shoes", goal: "Find distributors", sourceMessageIds: [] },
        business_location: "Malaysia",
        target_markets_json: ["south eat asia"],
        intake_complete: true,
      },
      {
        workspace_id: workspaceId,
        conversation_id: convLockedUpgradeId,
        content_json: { offer: "Shoes", goal: "Find retailers", sourceMessageIds: [] },
        business_location: "Zimbabwe",
        target_markets_json: ["Recommend the best markets"],
        intake_complete: true,
      },
    ],
    target_decisions: [
      {
        workspace_id: workspaceId,
        conversation_id: convLockedUpgradeId,
        status: "locked",
        market_profile_id: marketSingaporeId,
        industry_profile_id: null,
      },
    ],
    market_profiles: [
      {
        id: marketSingaporeId,
        workspace_id: workspaceId,
        name: "Singapore",
      },
    ],
    industry_profiles: [],
    conversation_product_sources: [
      {
        workspace_id: workspaceId,
        conversation_id: convAttachmentId,
        label: "deck.pdf",
        summary_text: "Cloud CRM software for automotive dealerships in Indonesia.",
        created_at: "2026-11-23T10:00:05.000Z",
      },
    ],
    ano_messages: [
      {
        workspace_id: workspaceId,
        conversation_id: convAttachmentId,
        role: "user",
        content_json: {
          text: "Analyze my attached product source(s): https://acme.example/deck.pdf",
        },
        created_at: "2026-11-23T10:00:00.000Z",
      },
    ],
  });

  // Manual rename lock protects against autoUpdateConversationTitle even with forceUpgrade
  const manualAttempt = await autoUpdateConversationTitle(
    mock.session,
    convManualId,
    "Shoes — Southeast Asia",
    { forceUpgrade: true },
  );
  assert.equal(manualAttempt, null);

  // Backfill updates raw/attachment/upgraded chats while skipping manual and already-clean chats
  const backfill = await backfillFriendlyConversationTitles(mock.session);
  assert.equal(backfill.updatedCount, 3);
  assert.deepEqual(backfill.titles, {
    [convRawPromptId]: "Running Shoes — Southeast Asia",
    [convLockedUpgradeId]: "Shoes — Singapore",
    [convAttachmentId]: "Cloud CRM Software — Indonesia",
  });

  // Manually renamed and already-clean rows received zero updates
  const updatedIds = mock.updateCalls.map((call) => call.filters.id);
  assert.equal(updatedIds.includes(convManualId), false);
  assert.equal(updatedIds.includes(convAlreadyCleanId), false);

  // updated_at was preserved on all backfilled rows, and zero conversation_renamed audits were inserted
  for (const call of mock.updateCalls) {
    assert.equal("updated_at" in call.patch, false);
  }
  assert.equal(mock.auditInserts.length, 0);

  // Check exact stored titles & timestamps
  const rawRow = mock.tables.ano_conversations.find((r) => r.id === convRawPromptId);
  assert.equal(rawRow?.title, "Running Shoes — Southeast Asia");
  assert.equal(rawRow?.updated_at, "2026-11-21T11:00:00.000Z");

  // Running backfill a second time is completely idempotent (0 updates)
  const secondPass = await backfillFriendlyConversationTitles(mock.session);
  assert.equal(secondPass.updatedCount, 0);
});

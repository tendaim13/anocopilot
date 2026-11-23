import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  AUTOPILOT_STAGE_METADATA,
  AUTOPILOT_STAGES,
  buildLeadsCsvDownloadUrl,
} from "@/lib/ano/autopilot";

const ROOT = process.cwd();

const FORBIDDEN_UI_BILLING_PATTERN =
  /\b1[- ]credit\b|\bcr\/found\b|\bcredit[- ]bearing\b|\$0\b|external spend|estimated credits|credit cost|spending 1 credit|\b0 credits\b|0 search credits/i;

const FORBIDDEN_CHAT_SERVICE_PATTERN =
  /\$0 credits|max 1 credit|Approve 1-credit|external spend|credit provider/i;

test("AUTOPILOT_STAGE_METADATA covers all 6 pipeline stages in order and buildLeadsCsvDownloadUrl builds CSV routes", () => {
  assert.equal(AUTOPILOT_STAGE_METADATA.length, AUTOPILOT_STAGES.length);
  assert.deepEqual(
    AUTOPILOT_STAGE_METADATA.map((item) => item.stage),
    [...AUTOPILOT_STAGES],
  );
  assert.deepEqual(
    AUTOPILOT_STAGE_METADATA.map((item) => item.stepNumber),
    [1, 2, 3, 4, 5, 6],
  );

  for (const item of AUTOPILOT_STAGE_METADATA) {
    assert.equal(FORBIDDEN_UI_BILLING_PATTERN.test(item.title), false);
    assert.equal(FORBIDDEN_UI_BILLING_PATTERN.test(item.activeHint), false);
  }

  assert.equal(
    buildLeadsCsvDownloadUrl("conv-123", "with_email"),
    "/api/v1/conversations/conv-123/export?format=leads_csv&scope=with_email",
  );
  assert.equal(
    buildLeadsCsvDownloadUrl("conv-123", "verified_only"),
    "/api/v1/conversations/conv-123/export?format=leads_csv&scope=verified_only",
  );
});

test("all user-facing UI components contain zero credit, pricing, or billing disclosures", async () => {
  const uiFiles = [
    "src/components/artifacts/company-search-preview-card.tsx",
    "src/components/artifacts/people-discovery-card.tsx",
    "src/components/artifacts/contact-verification-card.tsx",
    "src/components/artifacts/outreach-template-pack-card.tsx",
    "src/components/artifacts/provider-scope-card.tsx",
    "src/components/artifacts/target-decision-card.tsx",
    "src/components/artifacts/people-cohort-artifact-drawer.tsx",
    "src/components/conversation/conversation-thread.tsx",
    "src/components/conversation/conversation-composer.tsx",
    "src/components/shell/context-rail.tsx",
    "src/components/artifacts/autopilot-progress-card.tsx",
    "src/components/artifacts/results-jump-bar.tsx",
    "src/components/artifacts/lead-export-card.tsx",
  ];

  for (const relPath of uiFiles) {
    const contents = await readFile(path.join(ROOT, relPath), "utf8");
    const match = contents.match(FORBIDDEN_UI_BILLING_PATTERN);
    assert.equal(
      match,
      null,
      `Found unexpected user-facing billing copy (${match?.[0]}) in ${relPath}`,
    );
  }
});

test("conversation service chat copy contains zero internal billing or credit notes", async () => {
  const serviceContents = await readFile(
    path.join(ROOT, "src/server/domain/research-conversation-service.ts"),
    "utf8",
  );
  const match = serviceContents.match(FORBIDDEN_CHAT_SERVICE_PATTERN);
  assert.equal(
    match,
    null,
    `Found unexpected billing/credit copy (${match?.[0]}) in research-conversation-service.ts`,
  );
});

test("outbound approval boundary remains gated and honest email provenance labels are preserved", async () => {
  const outreachCard = await readFile(
    path.join(ROOT, "src/components/artifacts/outreach-draft-card.tsx"),
    "utf8",
  );
  assert.match(outreachCard, /ApprovalCard/);

  const peopleDrawer = await readFile(
    path.join(ROOT, "src/components/artifacts/people-cohort-artifact-drawer.tsx"),
    "utf8",
  );
  assert.match(peopleDrawer, /Verified work email/);
  assert.match(peopleDrawer, /Public website email/);
});

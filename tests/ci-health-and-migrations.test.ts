import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { GET as getHealth } from "@/app/api/health/route";

test("GET /api/health returns safe runtime metadata without secrets", async () => {
  const response = await getHealth();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");

  const text = await response.text();
  const payload = JSON.parse(text) as {
    ok: boolean;
    service: string;
    commit: string;
    agentMode: string;
    supabaseConfigured: boolean;
    timestamp: string;
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.service, "ano-copilot");
  assert.ok(payload.commit.length >= 1);
  assert.ok(["disabled", "gemini", "ollama", "bedrock", "invalid"].includes(payload.agentMode));
  assert.equal(typeof payload.supabaseConfigured, "boolean");
  assert.ok(!Number.isNaN(new Date(payload.timestamp).getTime()));
  assert.ok(!text.includes("SUPABASE_DB_URL"));
  assert.ok(!text.includes("GEMINI_API_KEY"));
});

test("scripts/check-migrations-registered.mjs confirms every SQL migration is registered", () => {
  const stdout = execFileSync(process.execPath, ["scripts/check-migrations-registered.mjs"], {
    encoding: "utf8",
  });
  const parsed = JSON.parse(stdout) as {
    ok: boolean;
    migrationCount: number;
    missingFromApply: string[];
    missingFromStatus: string[];
  };

  assert.equal(parsed.ok, true);
  assert.ok(parsed.migrationCount >= 23);
  assert.deepEqual(parsed.missingFromApply, []);
  assert.deepEqual(parsed.missingFromStatus, []);
});

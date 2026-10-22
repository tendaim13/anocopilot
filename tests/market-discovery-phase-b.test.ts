import assert from "node:assert/strict";
import test from "node:test";

import type { ProductBriefInput } from "../src/lib/ano/market-discovery";
import { canTransition, disabledProviderReadiness, MarketStateTransitionError, scopeForDecision, scopeForManualLocation } from "../src/server/domain/market-state-machine";
import { DisabledCompanyDiscoveryProvider } from "../src/server/providers/company-discovery-provider";

const brief: ProductBriefInput = {
  offer: "AI workflows that move quotes into scheduled jobs.",
  objective: "Find an initial outbound market.",
  marketHunch: "",
  locationPreference: "Malaysia, Australia",
  buyerHunch: "",
  customerExamples: "",
  exclusions: "",
  additionalContext: "",
};

test("a confirmed location becomes a paused provider-approval checkpoint, not a discovery result", () => {
  const scope = scopeForDecision(brief, "lock_location");
  assert.equal(scope.state, "awaiting_provider_approval");
  assert.deepEqual(scope.locations, ["Malaysia", "Australia"]);
  assert.match(scope.summary, /Company discovery remains unavailable/i);
  assert.equal(canTransition("awaiting_scope_decision", scope.state), true);
});

test("Ano refuses to lock a location scope when none was supplied", () => {
  assert.throws(
    () => scopeForDecision({ ...brief, locationPreference: "" }, "lock_location"),
    (error: unknown) => error instanceof MarketStateTransitionError,
  );
});

test("a manually added location resumes only the paused location-input checkpoint", () => {
  const requested = scopeForDecision({ ...brief, locationPreference: "" }, "set_preference");
  assert.equal(requested.state, "awaiting_location_input");
  assert.equal(canTransition(requested.state, "awaiting_provider_approval"), true);
  const locked = scopeForManualLocation("Kuala Lumpur");
  assert.equal(locked.kind, "location");
  assert.deepEqual(locked.locations, ["Kuala Lumpur"]);
});

test("disabled company discovery returns an honest block with no fabricated candidates or credit estimate", async () => {
  const provider = new DisabledCompanyDiscoveryProvider();
  const status = await provider.status();
  const preview = await provider.preview(scopeForDecision(brief, "lock_location"));
  assert.equal(status.state, "disabled");
  assert.equal(preview.status, "blocked_provider");
  assert.equal(preview.estimatedCredits, null);
  assert.deepEqual(preview.candidates, []);
  assert.match(preview.message, /will not fabricate/i);
  assert.equal(disabledProviderReadiness().action, "none");
});

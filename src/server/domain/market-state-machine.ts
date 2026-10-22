import type { MarketDecisionInput, MarketRunState, MarketScope, ProductBriefInput, ProviderReadiness } from "@/lib/ano/market-discovery";

export class MarketStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketStateTransitionError";
  }
}

export function disabledProviderReadiness(): ProviderReadiness {
  return {
    key: "prospeo",
    state: "disabled",
    message: "Company discovery is not connected yet. Ano cannot search for or fabricate companies in this workspace.",
    action: "none",
  };
}

function locations(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function scopeForDecision(input: ProductBriefInput, choice: MarketDecisionInput["choice"]): MarketScope {
  if (choice === "lock_location") {
    const selected = locations(input.locationPreference);
    if (selected.length === 0) throw new MarketStateTransitionError("Ano needs a location before it can lock a location scope.");
    return { state: "awaiting_provider_approval", kind: "location", locations: selected, source: "workspace_input", summary: `Location scope locked to ${selected.join(", ")}. Company discovery remains unavailable until a later approved provider phase.` };
  }
  if (choice === "compare_markets") {
    return { state: "awaiting_market_evidence", kind: "compare", locations: [], source: "none", summary: "Market comparison requested. Ano has no research evidence or enabled source to recommend a location yet." };
  }
  if (choice === "set_preference") {
    return { state: "awaiting_location_input", kind: "unselected", locations: [], source: "none", summary: "Add a location preference to lock the initial market scope." };
  }
  return { state: "provider_unavailable", kind: "open", locations: [], source: "none", summary: "Location remains open. Ano will not claim a preferred market without research evidence." };
}

export function scopeForManualLocation(location: string): MarketScope {
  const selected = locations(location);
  if (selected.length === 0) throw new MarketStateTransitionError("Ano needs a location before it can lock a location scope.");
  return { state: "awaiting_provider_approval", kind: "location", locations: selected, source: "workspace_decision", summary: `Location scope locked to ${selected.join(", ")}. Company discovery remains unavailable until a later approved provider phase.` };
}

export function canTransition(from: MarketRunState, to: MarketRunState) {
  const allowed: Record<MarketRunState, MarketRunState[]> = {
    awaiting_scope_decision: ["awaiting_location_input", "awaiting_market_evidence", "awaiting_provider_approval", "provider_unavailable"],
    awaiting_location_input: ["awaiting_provider_approval"],
    awaiting_market_evidence: ["awaiting_location_input", "awaiting_provider_approval", "provider_unavailable"],
    market_scope_locked: ["awaiting_provider_approval"],
    awaiting_provider_approval: [],
    provider_unavailable: ["awaiting_location_input", "awaiting_market_evidence", "awaiting_provider_approval"],
  };
  return from === to || allowed[from].includes(to);
}

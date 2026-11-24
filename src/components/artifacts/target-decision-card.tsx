"use client";

import type { MarketSynthesis } from "@/lib/ano/market-synthesis";
import { MaterialButton } from "@/components/material/material-button";
import { useMaterialWeb } from "@/components/material/register";

export interface TargetDecisionCardProps {
  synthesis: MarketSynthesis;
  selectedMarketId: string;
  selectedIndustryId: string;
  onSelectMarket: (marketId: string) => void;
  onSelectIndustry: (industryId: string) => void;
  onLockRoute: () => void;
  isWorking: boolean;
}

export function TargetDecisionCard({
  synthesis,
  selectedMarketId,
  selectedIndustryId,
  onSelectMarket,
  onSelectIndustry,
  onLockRoute,
  isWorking,
}: TargetDecisionCardProps) {
  useMaterialWeb();

  const selectableIndustries = synthesis.industries.filter(
    (industry) => !industry.marketProfileId || industry.marketProfileId === selectedMarketId,
  );
  const selectedMarket = synthesis.markets.find((item) => item.id === selectedMarketId);
  const selectedIndustry = selectableIndustries.find((item) => item.id === selectedIndustryId);

  if (synthesis.decision?.status === "locked") {
    const lockedMarket = synthesis.markets.find(
      (item) => item.id === synthesis.decision?.marketProfileId,
    );
    const lockedIndustry = synthesis.industries.find(
      (item) => item.id === synthesis.decision?.industryProfileId,
    );

    return (
      <article className="m3-artifact-card m3-locked-card" aria-label="Locked target route">
        <header className="m3-artifact-header">
          <div>
            <p className="m3-artifact-kicker">TARGET ROUTE LOCKED</p>
            <h2>
              {lockedMarket?.name ?? "Selected market"} · {lockedIndustry?.name ?? "Selected industry"}
            </h2>
          </div>
          <span className="m3-status-badge status-approved">Locked</span>
        </header>
        <p className="m3-artifact-lead">
          Your target route is locked and ready for company discovery.
        </p>
      </article>
    );
  }

  if (
    synthesis.decision?.status !== "awaiting_selection" &&
    !(synthesis.decision == null && synthesis.markets.length > 0 && selectableIndustries.length > 0)
  ) {
    return null;
  }

  return (
    <article className="m3-artifact-card m3-decision-artifact" aria-label="Select target route">
      <header className="m3-artifact-header">
        <div>
          <p className="m3-artifact-kicker">YOUR DECISION</p>
          <h2>Lock the route for later company discovery</h2>
        </div>
        <span className="m3-status-badge status-awaiting_approval">Selection required</span>
      </header>

      <p className="m3-artifact-lead">
        This records your chosen market and industry only. It does not search companies, look up
        contacts, or start outreach.
      </p>

      <div className="m3-decision-controls">
        <md-outlined-select
          label="Target market"
          value={selectedMarketId}
          display-text={selectedMarket?.name ?? undefined}
          disabled={isWorking || undefined}
          onChange={(event) => {
            const target = event.currentTarget as unknown as { value?: string };
            onSelectMarket(target.value ?? "");
          }}
        >
          {synthesis.markets.map((market) => (
            <md-select-option
              key={market.id}
              value={market.id}
              selected={market.id === selectedMarketId}
            >
              <div slot="headline">{market.name}</div>
            </md-select-option>
          ))}
        </md-outlined-select>

        <md-outlined-select
          label="Target industry"
          value={selectedIndustryId}
          display-text={selectedIndustry?.name ?? undefined}
          disabled={isWorking || undefined}
          onChange={(event) => {
            const target = event.currentTarget as unknown as { value?: string };
            onSelectIndustry(target.value ?? "");
          }}
        >
          {selectableIndustries.map((industry) => (
            <md-select-option
              key={industry.id}
              value={industry.id}
              selected={industry.id === selectedIndustryId}
            >
              <div slot="headline">{industry.name}</div>
            </md-select-option>
          ))}
        </md-outlined-select>

        <MaterialButton
          variant="filled"
          disabled={isWorking || !selectedMarketId || !selectedIndustryId}
          onClick={onLockRoute}
        >
          {isWorking ? "Locking…" : "Lock target route"}
        </MaterialButton>
      </div>
    </article>
  );
}

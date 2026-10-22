import type { MarketScope } from "@/lib/ano/market-discovery";

export type CompanyDiscoveryProviderStatus = {
  key: "prospeo";
  state: "disabled" | "ready";
  message: string;
};

export type CompanyDiscoveryPreview = {
  scope: MarketScope;
  status: "blocked_provider" | "awaiting_approval";
  estimatedCredits: null;
  candidates: never[];
  message: string;
};

/**
 * Phase B sets the contract, but deliberately ships only the disabled adapter.
 * A provider adapter must never turn this boundary into invented companies.
 */
export interface CompanyDiscoveryProvider {
  status(): Promise<CompanyDiscoveryProviderStatus>;
  preview(scope: MarketScope): Promise<CompanyDiscoveryPreview>;
}

export class DisabledCompanyDiscoveryProvider implements CompanyDiscoveryProvider {
  async status(): Promise<CompanyDiscoveryProviderStatus> {
    return { key: "prospeo", state: "disabled", message: "Prospeo is not connected. Company discovery is unavailable until the dedicated provider phase." };
  }

  async preview(scope: MarketScope): Promise<CompanyDiscoveryPreview> {
    return {
      scope,
      status: "blocked_provider",
      estimatedCredits: null,
      candidates: [],
      message: "No company preview is available because the provider is disabled. Ano will not fabricate discovery results.",
    };
  }
}

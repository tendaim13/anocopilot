import type { AnoConnector, ConnectorStatus } from "@/server/connectors/contracts";

export class MockResearchConnector implements AnoConnector {
  key = "prospeo" as const;

  async status(): Promise<ConnectorStatus> {
    return { connector: this.key, health: "disabled", enabledCapabilities: [], message: "The simulated research dataset is local and does not call a provider." };
  }
}

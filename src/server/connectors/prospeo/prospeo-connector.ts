import { ConnectorUnavailableError, type AnoConnector, type ConnectorStatus } from "@/server/connectors/contracts";

export class ProspeoConnector implements AnoConnector {
  key = "prospeo" as const;

  async status(): Promise<ConnectorStatus> {
    return { connector: this.key, health: "disabled", enabledCapabilities: [], message: "Provider discovery is disabled until Phase 5 approval and budget controls." };
  }

  async search() {
    throw new ConnectorUnavailableError(this.key, "Prospeo is not enabled for this Ano workspace.");
  }
}

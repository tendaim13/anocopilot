import { ConnectorUnavailableError, type AnoConnector, type ConnectorStatus } from "@/server/connectors/contracts";

export class DropcontactConnector implements AnoConnector {
  key = "dropcontact" as const;

  async status(): Promise<ConnectorStatus> {
    return { connector: this.key, health: "disabled", enabledCapabilities: [], message: "Contact enrichment is disabled until Phase 5 approval and budget controls." };
  }

  async enrich() {
    throw new ConnectorUnavailableError(this.key, "Dropcontact is not enabled for this Ano workspace.");
  }
}

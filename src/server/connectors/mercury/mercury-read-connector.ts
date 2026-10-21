import { ConnectorUnavailableError, type AnoConnector, type ConnectorStatus } from "@/server/connectors/contracts";

/** Deliberately inert until Phase 3 exposes a versioned read-only Mercury API. */
export class MercuryReadConnector implements AnoConnector {
  key = "mercury" as const;

  async status(): Promise<ConnectorStatus> {
    return { connector: this.key, health: "disabled", enabledCapabilities: [], message: "Mercury is not connected. Ano has no direct Mercury database access." };
  }

  async getLead() {
    throw new ConnectorUnavailableError(this.key, "Mercury read access has not been enabled for this workspace.");
  }
}

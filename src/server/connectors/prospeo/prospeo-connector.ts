import { ConnectorUnavailableError, type AnoConnector, type ConnectorStatus } from "@/server/connectors/contracts";

export class ProspeoConnector implements AnoConnector {
  key = "prospeo" as const;

  async status(): Promise<ConnectorStatus> {
    return {
      connector: this.key,
      health: "pending",
      enabledCapabilities: ["search"],
      message: "Prospeo company discovery is available only through Ano’s explicit account check, query preview, and one-page approval flow.",
    };
  }

  async search() {
    throw new ConnectorUnavailableError(this.key, "Direct Prospeo search is not available. Ano must claim an approved one-page request before it can call the provider.");
  }
}

import { ConnectorUnavailableError, type AnoConnector, type ConnectorStatus } from "@/server/connectors/contracts";

export class DropcontactConnector implements AnoConnector {
  key = "dropcontact" as const;

  async status(): Promise<ConnectorStatus> {
    const configured = Boolean(process.env.DROPCONTACT_API_KEY?.trim());
    return {
      connector: this.key,
      health: configured ? "pending" : "disabled",
      enabledCapabilities: configured ? ["enrich"] : [],
      message: configured
        ? "Dropcontact selective contact verification is available only for user-selected pairs with upfront credit approval."
        : "Contact enrichment requires DROPCONTACT_API_KEY on the server and explicit per-batch user approval.",
    };
  }

  async enrich() {
    throw new ConnectorUnavailableError(
      this.key,
      "Direct Dropcontact enrichment is not available. Ano must record a per-batch preview and explicit user approval first.",
    );
  }
}

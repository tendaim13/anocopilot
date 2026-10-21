export type ConnectorKey = "mercury" | "prospeo" | "dropcontact";
export type ConnectorCapability = "read_leads" | "read_activity" | "read_campaigns" | "search" | "enrich" | "propose_write";
export type ConnectorHealth = "disabled" | "pending" | "connected" | "error";

export type ConnectorStatus = {
  connector: ConnectorKey;
  health: ConnectorHealth;
  enabledCapabilities: ConnectorCapability[];
  message: string;
};

export class ConnectorUnavailableError extends Error {
  constructor(readonly connector: ConnectorKey, message: string) {
    super(message);
    this.name = "ConnectorUnavailableError";
  }
}

export interface AnoConnector {
  key: ConnectorKey;
  status(): Promise<ConnectorStatus>;
}

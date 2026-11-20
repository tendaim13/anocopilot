import type {
  ExecutionProposalType,
  MercuryConnectorState,
} from "@/lib/ano/outreach-execution";
import { ConnectorUnavailableError, type AnoConnector, type ConnectorStatus } from "@/server/connectors/contracts";

export function mercuryConfiguration(): MercuryConnectorState {
  const configured = Boolean(process.env.MERCURY_PROPOSAL_WEBHOOK_URL?.trim());
  return {
    connector: "mercury",
    available: configured,
    mode: configured ? "proposal_preview" : "disabled",
    note: configured
      ? "Mercury operates strictly via approval-gated CRM proposals with recorded receipts; no direct Mercury DB write access exists."
      : "Mercury direct sync is not configured; approved Mercury proposals are recorded as immutable proposal receipts in Ano.",
  };
}

export function buildMercuryProposalReceipt(
  proposalId: string,
  proposalType: Extract<ExecutionProposalType, "mercury_task" | "mercury_draft" | "mercury_update">,
  payload: Record<string, unknown>,
  decidedAt: string,
) {
  return {
    connector: "mercury",
    proposalId,
    proposalType,
    mode: mercuryConfiguration().mode,
    directDbAccess: false,
    stagedAt: decidedAt,
    payloadKeys: Object.keys(payload),
  };
}

/**
 * Maintains Ano's tenant isolation: Mercury has zero direct database imports
 * or unapproved background write capability.
 */
export class MercuryReadConnector implements AnoConnector {
  key = "mercury" as const;

  async status(): Promise<ConnectorStatus> {
    const config = mercuryConfiguration();
    return {
      connector: this.key,
      health: config.available ? "pending" : "disabled",
      enabledCapabilities: config.available ? ["propose_write"] : [],
      message: config.note,
    };
  }

  async getLead() {
    throw new ConnectorUnavailableError(
      this.key,
      "Direct Mercury database reads remain disabled. Use approval-gated proposals.",
    );
  }
}

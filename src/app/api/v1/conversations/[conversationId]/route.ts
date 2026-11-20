import { NextResponse } from "next/server";

import { buildConversationMessageParts } from "@/lib/ano/research-conversation";
import { requireWorkspaceSession, WorkspaceSessionError } from "@/server/auth/workspace-session";
import {
  EvidenceResearchServiceError,
  getEvidenceResearchForConversation,
} from "@/server/domain/evidence-research-service";
import {
  getMarketSynthesisForConversation,
  MarketSynthesisServiceError,
} from "@/server/domain/market-synthesis-service";
import {
  getOutreachExecutionForConversation,
  OutreachExecutionServiceError,
} from "@/server/domain/outreach-execution-service";
import {
  getPeopleDiscoveryForConversation,
  PeoplePlaybookServiceError,
} from "@/server/domain/people-playbook-service";
import {
  getResearchConversation,
  patchResearchConversation,
  ResearchConversationServiceError,
} from "@/server/domain/research-conversation-service";
import {
  getCompanySearchForConversation,
  TargetAccountDiscoveryServiceError,
} from "@/server/domain/target-account-discovery-service";
import { EvidenceResearchPersistenceError } from "@/server/persistence/evidence-research-store";
import { MarketSynthesisPersistenceError } from "@/server/persistence/market-synthesis-store";
import { OutreachExecutionPersistenceError } from "@/server/persistence/outreach-execution-store";
import { PeoplePlaybookPersistenceError } from "@/server/persistence/people-playbook-store";
import { ResearchConversationPersistenceError } from "@/server/persistence/research-conversation-store";
import { TargetAccountDiscoveryPersistenceError } from "@/server/persistence/target-account-discovery-store";
import { searxngConfiguration } from "@/server/research/searxng-provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof WorkspaceSessionError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (
    error instanceof ResearchConversationServiceError ||
    error instanceof ResearchConversationPersistenceError ||
    error instanceof EvidenceResearchServiceError ||
    error instanceof EvidenceResearchPersistenceError ||
    error instanceof MarketSynthesisServiceError ||
    error instanceof MarketSynthesisPersistenceError ||
    error instanceof TargetAccountDiscoveryServiceError ||
    error instanceof TargetAccountDiscoveryPersistenceError ||
    error instanceof PeoplePlaybookServiceError ||
    error instanceof PeoplePlaybookPersistenceError ||
    error instanceof OutreachExecutionServiceError ||
    error instanceof OutreachExecutionPersistenceError
  ) {
    return NextResponse.json(
      { error: error.message, code: "RESEARCH_CONVERSATION_UNAVAILABLE" },
      { status: 422 },
    );
  }
  return NextResponse.json({ error: "Ano could not read this conversation." }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await requireWorkspaceSession();
    const { conversationId } = await context.params;
    const [conversation, research, synthesis, companyDiscovery, peopleState, outreachState] = await Promise.all([
      getResearchConversation(session, conversationId),
      getEvidenceResearchForConversation(session, conversationId),
      getMarketSynthesisForConversation(session, conversationId),
      getCompanySearchForConversation(session, conversationId),
      getPeopleDiscoveryForConversation(session, conversationId),
      getOutreachExecutionForConversation(session, conversationId),
    ]);
    const provider = searxngConfiguration();
    const messageParts = buildConversationMessageParts(
      conversation,
      research,
      synthesis,
      companyDiscovery.companySearch,
      peopleState.peopleDiscovery,
      outreachState.outreachExecution,
    );
    return NextResponse.json({
      conversation,
      research,
      synthesis,
      provider,
      companySearch: companyDiscovery.companySearch,
      prospeo: companyDiscovery.prospeo,
      peopleDiscovery: peopleState.peopleDiscovery,
      dropcontact: peopleState.dropcontact,
      outreachExecution: outreachState.outreachExecution,
      mercury: outreachState.mercury,
      messageParts,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const body: unknown = await request.json().catch(() => null);
  try {
    const { conversationId } = await context.params;
    const result = await patchResearchConversation(
      await requireWorkspaceSession(),
      conversationId,
      body,
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

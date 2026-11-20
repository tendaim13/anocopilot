import { getAnoAgentMode, getBedrockPlannerConfig } from "@/server/agents/bedrock";
import { createBedrockResearchPlanningModel, ResearchPlanningModelError } from "@/server/agents/research-planning-model";

async function main() {
  if (getAnoAgentMode() !== "bedrock") {
    throw new Error("Bedrock smoke check requires ANO_AGENT_MODE=bedrock.");
  }

  const model = createBedrockResearchPlanningModel(getBedrockPlannerConfig());
  const messageId = "00000000-0000-4000-8000-000000000100";
  const interpretation = await model.interpret([{
    id: messageId,
    role: "user",
    text: "I sell AI workflows that help service businesses turn quotes into jobs. Help me find a first outbound market.",
  }]);

  if (interpretation.outcome !== "ready") {
    throw new Error("Bedrock did not recognise the harmless smoke brief as sufficient.");
  }

  const plan = await model.createPlan({ ...interpretation.brief, sourceMessageIds: [messageId] });
  console.log(JSON.stringify({
    outcome: interpretation.outcome,
    planQuestions: plan.researchQuestions.length,
    comparisonCriteria: plan.comparisonCriteria.length,
    externalActions: "none",
  }));
}

void main().catch((error) => {
  if (error instanceof ResearchPlanningModelError && error.reason) {
    console.error(`Bedrock adapter detail: ${error.reason}`);
  }
  throw error;
});

import type { Candidate, PlanItem, ResearchInput, ResearchResult, ScoreComponent } from "@/lib/ano/types";

const capturedAt = "21 Oct 2026";

function score(components: ScoreComponent[]) {
  return components.reduce((total, component) => total + component.score, 0);
}

const allCandidates: Omit<Candidate, "score">[] = [
  {
    id: "harbor-facilities",
    name: "Harbor Facilities Group",
    industry: "Facilities services",
    location: "Sydney, Australia",
    employees: "51–200 employees",
    description: "Multi-site facilities operator supporting compliance-heavy commercial properties.",
    fitLabel: "High fit",
    confidence: "High",
    contact: {
      name: "Maya Patel",
      role: "Operations Director",
      availability: "Candidate contact",
    },
    signals: ["Growing service footprint", "Compliance workflow signal", "Operational owner identified"],
    scoreComponents: [
      { label: "ICP fit", score: 31, maximum: 35, explanation: "Industry and operating model match the requested profile.", tone: "emerald" },
      { label: "Buying signals", score: 24, maximum: 30, explanation: "Publicly simulated evidence suggests growing multi-site coordination needs.", tone: "emerald" },
      { label: "Reachability", score: 17, maximum: 20, explanation: "A relevant operational decision-maker is available for review.", tone: "emerald" },
      { label: "Timing", score: 11, maximum: 15, explanation: "The current workflow signal makes near-term research worthwhile.", tone: "amber" },
    ],
    evidence: [
      { id: "E-101", source: "Simulated company profile", kind: "company", observation: "Operates across multiple commercial facility portfolios in New South Wales.", capturedAt, simulated: true },
      { id: "E-102", source: "Simulated hiring signal", kind: "hiring", observation: "Recent operations hiring suggests a growing field coordination workload.", capturedAt, simulated: true },
      { id: "E-103", source: "Simulated service overview", kind: "workflow", observation: "Compliance and quote coordination are named service capabilities.", capturedAt, simulated: true },
    ],
    recommendedAction: "Prepare a discovery call",
    recommendationReason: "Strong ICP fit plus an identifiable operational owner makes this the best immediate research-to-call candidate.",
  },
  {
    id: "northbeam-fire",
    name: "Northbeam Fire Services",
    industry: "Fire protection",
    location: "Melbourne, Australia",
    employees: "11–50 employees",
    description: "Fire-service contractor managing recurring compliance and maintenance work.",
    fitLabel: "High fit",
    confidence: "High",
    contact: {
      name: "James Park",
      role: "General Manager",
      availability: "Candidate contact",
    },
    signals: ["Recurring service model", "Quoting workload signal", "Executive contact identified"],
    scoreComponents: [
      { label: "ICP fit", score: 33, maximum: 35, explanation: "The organisation closely matches the requested service and workflow profile.", tone: "emerald" },
      { label: "Buying signals", score: 20, maximum: 30, explanation: "Simulated evidence indicates recurring inspection and quoting activity.", tone: "emerald" },
      { label: "Reachability", score: 16, maximum: 20, explanation: "A senior operating contact is available to research further.", tone: "emerald" },
      { label: "Timing", score: 9, maximum: 15, explanation: "The signal is useful but does not establish an immediate purchase event.", tone: "amber" },
    ],
    evidence: [
      { id: "E-201", source: "Simulated company profile", kind: "company", observation: "Provides inspection, testing, maintenance, and project work across commercial sites.", capturedAt, simulated: true },
      { id: "E-202", source: "Simulated workflow signal", kind: "workflow", observation: "Service positioning refers to rapid quotations and recurring compliance visits.", capturedAt, simulated: true },
      { id: "E-203", source: "Simulated contact record", kind: "contact", observation: "A general manager is listed as an appropriate operational stakeholder.", capturedAt, simulated: true },
    ],
    recommendedAction: "Research the current quoting workflow",
    recommendationReason: "The account is highly aligned, but the next useful step is validating where administrative friction sits before outreach.",
  },
  {
    id: "riverside-maintenance",
    name: "Riverside Maintenance Co.",
    industry: "Building maintenance",
    location: "Brisbane, Australia",
    employees: "51–200 employees",
    description: "Commercial maintenance provider with distributed field crews and customer follow-up work.",
    fitLabel: "Promising",
    confidence: "Medium",
    contact: {
      name: "Alex Chen",
      role: "Service Delivery Manager",
      availability: "Needs enrichment",
    },
    signals: ["Distributed field teams", "Service coordination signal", "Contact needs verification"],
    scoreComponents: [
      { label: "ICP fit", score: 26, maximum: 35, explanation: "The service model is relevant, though it is broader than the primary target.", tone: "emerald" },
      { label: "Buying signals", score: 18, maximum: 30, explanation: "Simulated evidence suggests coordination complexity but no urgent trigger.", tone: "amber" },
      { label: "Reachability", score: 10, maximum: 20, explanation: "The role is relevant but requires verified contact data before outreach.", tone: "amber" },
      { label: "Timing", score: 8, maximum: 15, explanation: "Suitable for this week rather than an immediate call.", tone: "slate" },
    ],
    evidence: [
      { id: "E-301", source: "Simulated company profile", kind: "company", observation: "Supports distributed maintenance teams across commercial customer sites.", capturedAt, simulated: true },
      { id: "E-302", source: "Simulated service overview", kind: "workflow", observation: "Customer updates and mobile field work are core service themes.", capturedAt, simulated: true },
      { id: "E-303", source: "Simulated contact record", kind: "contact", observation: "A relevant service-delivery role was located, but no live contact enrichment has been run.", capturedAt, simulated: true },
    ],
    recommendedAction: "Verify the service-delivery contact",
    recommendationReason: "The operating model is promising, but confirming the decision-maker is the right next step before any outreach.",
  },
];

export type MockResearchFixture = Omit<ResearchResult, "toolTrail">;

/**
 * Local fixture data only. The bounded runtime owns the actual tool execution
 * order and produces the trace that is returned to the user.
 */
export function runMockResearch(input: ResearchInput): MockResearchFixture {
  const candidates = allCandidates
    .slice(0, input.maxResults)
    .map((candidate) => ({ ...candidate, score: score(candidate.scoreComponents) }))
    .sort((left, right) => right.score - left.score);

  const plan: PlanItem[] = candidates.map((candidate, index) => ({
    id: `plan-${candidate.id}`,
    candidateId: candidate.id,
    title: candidate.name,
    action: index === 0 ? "Prepare call" : index === 1 ? "Research" : "Draft follow-up",
    priority: index === 0 ? "Now" : index === 1 ? "Today" : "This week",
    reason: candidate.recommendationReason,
  }));

  return {
    run: {
      id: "mock-run-oct21",
      status: "completed",
      mode: "mock",
      clarification: null,
      message: `Ano completed a simulated research run for ${input.industry} in ${input.geography}.`,
    },
    candidates,
    plan,
  };
}

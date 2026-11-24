# Ano Copilot: Product Description

## One-line description

Ano is an AI sales copilot that turns scattered lead, account, inbox, campaign, call, and public-research information into an evidence-backed answer to one practical question:

> What should I do next, with which account, and why?

## Product position

Ano is both:

1. A standalone sales-research and planning product that can eventually connect to several CRMs.
2. A first-class companion to Mercury, where it reads the sales context already held in Mercury and returns research briefs, transparent scores, and proposed daily work.

Mercury is the launch integration, not Ano's data store or architectural base. This preserves Ano's ability to support HubSpot, Pipedrive, Salesforce, and future sales systems later.

## The problem

Salespeople lose time deciding where to focus. Useful information is fragmented across:

- CRM lead records and campaign enrolments
- Email replies, conversations, and promised follow-ups
- Calls and their outcomes
- Public company information and buying signals
- Contact databases and enrichment providers

The result is a workflow based on memory, inbox noise, and intuition. Important work is missed, low-value accounts receive too much attention, and it is difficult to explain why one prospect is worth contacting before another.

## The promise

Ano does not claim to replace a salesperson's judgment. It prepares the context and ranks the work so the salesperson can decide faster and with evidence.

For every recommendation, Ano should make clear:

- What it found
- Which sources or Mercury records support it
- Why the account or task ranks where it does
- How confident it is
- What Ano inferred versus what is directly observed
- What action, if any, still needs a human approval

## Primary users

### Individual sales rep

Wants a trustworthy daily agenda: the right calls, follow-ups, account research, and next actions without manually reconstructing every conversation.

### Sales manager or founder

Wants visibility into account quality, rep focus, research quality, and the reason behind recommended work—not an opaque AI score.

### Revenue operations or workspace administrator

Wants to enforce bounded provider limits, fail-closed usage logging, workspace rules, roles, and approved integration actions without exposing internal provider costs or one customer's data to another.

## Core jobs Ano must perform

### 1. Discover candidates

A user provides an ICP and an objective. Ano identifies relevant companies and people through approved providers or, in early phases, a simulated discovery catalogue.

### 2. Research and explain account fit

Ano combines structured provider results, public evidence, and Mercury context into an account brief. It must distinguish evidence from interpretation.

### 3. Rank opportunity quality

Ano calculates an explainable score from deterministic factors such as ICP fit, evidence strength, engagement, campaign state, reply urgency, call outcome, and exclusions. The language model may explain a score; it does not invent or override one.

### 4. Build an actionable plan

Ano turns ranked accounts and Mercury activity into `Today` and `This week` work: reply, call, research, follow up, nurture, or dismiss.

### 5. Draft, never silently perform, consequential external actions

A user explicitly starts Autopilot under one bounded authority scope (up to 50 public searches, 100 source fetches, 25 company candidates, and 10 named contact enrichments). Ano drafts outreach only and never sends emails, places calls, or writes CRM records without a separate later explicit approval.

## First experience

The first usable Ano journey is deliberately narrow:

1. A user opens **Research** and describes their ICP and objective.
2. Ano identifies missing essentials such as industry, geography, target role, or exclusions.
3. Ano runs only approved, read-only discovery and evidence tools.
4. The user sees candidate company and contact cards, score breakdowns, and evidence references.
5. The user shortlists, dismisses, or marks candidates for review.
6. Ano prepares an **Ano Brief** explaining the ranking and suggested next action.
7. Ano may add the selected work to its own `Today` or `This week` plan.
8. In the Mercury-connected phase, Ano can propose—not directly create—a Mercury task or draft.

## Product surfaces

### Today

The personal sales agenda. It contains only actionable work, ordered by urgency and potential impact, with the reason for each recommendation visible.

### Research

An ICP and objective workbench. It hosts clarification, search, discovery, evidence collection, and shortlist selection.

### Briefs

Account-level research reports with score inputs, evidence provenance, confidence, suggestions, and review status.

### Plan

The week-level view of pending calls, replies, research, follow-ups, and proposed actions. It remains distinct from Mercury's operational task state until a user approves a connector write-back.

### Connections and controls

Workspace administrator area for Mercury connection status, customer-owned provider credentials, budgets, retention, and automation policy.

## What Ano is not

- Not a replacement for Mercury's CRM, inbox, campaign, dialer, or database.
- Not a shared lead-data reseller built on one provider account.
- Not an unrestricted web-browsing or database-query agent.
- Not an autonomous email-sending product in its first releases.
- Not an opaque lead-scoring system.

## Data-provider stance

Ano treats providers as workspace-scoped server capabilities. Paid company and contact enrichment requests must pass fail-closed configuration, daily budget limit, and `ano_internal` usage-logging checks before execution. Internal credit costs are never disclosed to end users.

Initial provider roles are:

- **Mock discovery:** validate product flow locally without live provider calls.
- **Public web research:** bounded SearXNG discovery + SSRF-safe excerpt retrieval.
- **Company & contact discovery:** B2B company matching, named buyer identification, and selective email verification within the explicitly approved Autopilot scope.

## Trust model

Ano's trust model is simple:

> The model can reason and draft. The application verifies, records, limits, and enforces explicit authority.

Every user-facing recommendation must retain the evidence trail that produced it, and paid provider execution fails closed if configuration, daily limits, or internal usage logging are unavailable.

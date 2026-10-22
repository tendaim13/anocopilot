# Ano: Standalone Market-Discovery Copilot

## Locked product decision

Ano is a **sales research copilot**, not an ICP questionnaire and not a CRM.

The user starts with the smallest useful brief:

1. **What do you sell?**
2. **What are you trying to achieve?**

Everything else is optional context: a market hunch, a preferred location, a buyer hunch, existing customers, exclusions, or a constraint. Ano must never make the user research their own market before it can help.

Ano turns those fragments into a progressive, reviewable discovery process:

```text
Offer + objective
  → Ano forms target-company hypotheses
  → Ano asks only the decision questions that remain
  → Market and location scan
  → user chooses or locks a market scope
  → company discovery through Prospeo
  → user reviews and shortlists companies
  → contact verification/enrichment through Dropcontact
  → evidence-backed industry, company, and buyer problem statements
  → a sales playbook for the approved shortlist
```

Ano never presents a hypothesis as external research. It must visibly distinguish:

| Label | Meaning |
| --- | --- |
| **You told Ano** | Directly entered by the workspace member. |
| **Ano hypothesis** | A proposed segment, buyer, problem, or location that still needs research or user confirmation. |
| **Research evidence** | A timestamped, source-labelled observation returned by an approved provider or research source. |
| **Ano recommendation** | A conclusion drawn from visible evidence and deterministic rules. |

## Scope and hard boundaries

This plan is entirely self-contained within Ano.

| Boundary | Decision |
| --- | --- |
| Application and data | Ano owns its own Next.js app, Supabase project, authentication, workspace isolation, migrations, secrets, audit trail, and retention policy. |
| Development | Turbopack only: `next dev --turbopack`. No webpack configuration or webpack commands. |
| Model | Bedrock is a server-side reasoning component. It never receives browser credentials, provider credentials, or direct database access. |
| Research providers | Every call is workspace-scoped, schema-validated, budgeted, auditable, and visible to the user. |
| Sales actions | Ano may prepare a recommendation or draft. It does not send email, place calls, create CRM records, or change campaigns. |
| Data integrity | Provider results are evidence; model text is not evidence. Ano does not invent company facts, buyer details, market demand, or location rankings. |
| External integrations | No CRM dependency belongs to this workflow. Provider connections are introduced only after the standalone product flow is correct. |

## The product journey

### 1. Start a market search

The first screen is a short conversation-style brief, not an ICP form.

Required inputs:

- **Offer** — what the user sells, in their own words.
- **Objective** — what they want to achieve, for example “find our first outbound segment” or “identify companies to approach.”

Optional inputs:

- Market or industry hunch
- Preferred location or “no preference”
- Existing customer examples
- Buyer hunch
- Exclusions or constraints

There are no arbitrary minimum-character requirements. A short answer, uncertainty, or “not sure” is valid context for Ano to work with.

### 2. Form a market hypothesis

From the brief, Ano produces a **draft market map**, not a claimed ICP:

- Candidate company types and operating characteristics
- Likely operational or commercial pains the offer may address
- Candidate buyer roles
- A list of unresolved assumptions
- The next most useful decision question

Example:

> “Your workflow offer may be relevant to service businesses with frequent handoffs between site work, quotes, approvals, and follow-up. This is a hypothesis based on your description, not external research. Do you have a location preference, or should Ano compare candidate markets?”

Ano must ask a focused question when the answer changes the next research step. It must not ask the user to fill every blank up front.

### 3. Choose or research the market scope

If a user specifies a location, Ano treats it as a constraint and asks whether to lock it.

If no location is specified, Ano proposes a small set of candidate markets to investigate. Before any conclusion such as “start in Malaysia,” Ano must have visible research evidence. A provider’s company coverage and fit signals can support a discovery recommendation; they cannot by themselves prove demand, market size, or purchasing likelihood.

The user can:

- Lock one or more locations
- Ask Ano to compare locations
- Add a location manually
- Keep the scope open and postpone company discovery

Every choice creates a resumable decision checkpoint.

### 4. Discover companies with Prospeo

After a market scope is locked and the workspace explicitly approves a provider search, Ano builds a Prospeo query from the approved hypothesis:

- Location
- Industry or company-type filters
- Company size or operating signals, when available
- Exclusions
- Search rationale and expected credit use

Ano shows the query and estimated provider cost before a credit-bearing action. The result is a list of company candidates—not an assertion that they are customers.

For every candidate, Ano shows:

- Provider source and retrieval time
- Matching signals and exclusions
- Evidence-backed fit explanation
- Confidence and missing information
- A user choice: shortlist, dismiss, or research later

Ano must not reveal or enrich all people automatically.

### 5. Verify people with Dropcontact

Dropcontact is used only after a user shortlists a company and asks Ano to find or verify relevant people.

Ano displays:

- The approved company or companies
- Proposed buyer roles and the reason for each role
- What will be sent to the provider
- Estimated credit use

Only then may the server perform an enrichment/verification call. The resulting contacts remain tied to their source, retrieval time, company, and user-approved request.

### 6. Prepare the sales playbook

Ano creates three levels of output, each with a different evidence rule:

| Output | Evidence standard |
| --- | --- |
| **Industry problem statement** | Clearly labelled as a hypothesis unless supported by an approved market-research source. |
| **Company problem statement** | Must cite a company-level provider result or another approved evidence source. If evidence is absent, Ano says so. |
| **Contact and buyer angle** | Must be based on the approved role and verified company/contact context. |

The playbook contains a concise problem framing, why the company was shortlisted, recommended buyer roles, unknowns to validate, and suggested talking points. It does not send messages or create external tasks.

## Provider responsibilities

| Provider | Role in Ano | Not permitted |
| --- | --- | --- |
| **Prospeo** | Company and person discovery, preview, and available fit signals after the user approves a scoped search. | Unapproved bulk search, automatic contact revelation, or presenting its data as Ano-owned resale data. |
| **Dropcontact** | Selective contact verification/enrichment for user-approved shortlisted companies. | Initial market selection, automatic enrichment of every candidate, or enrichment without company context. |
| **Future market-research source** | Evidence for market-level claims such as location comparison or demand signals, after an explicit source and method are selected. | Silent browsing, unsupported market claims, or unlabelled evidence. |

Provider API availability, credit policy, pricing, rate limits, terms, and permitted use must be verified immediately before live integration. The product must have a no-provider fallback state that says research is unavailable; it must never fabricate a result.

## Architecture

```text
Ano UI
  → typed API route
  → workspace/session authorization
  → domain service and decision state machine
  → policy gate: allow / ask / deny
  → bounded Bedrock reasoning OR approved provider adapter
  → normalized evidence and deterministic ranking
  → Ano-owned persistence and audit trail
  → reviewable user decision
```

### Application-owned responsibilities

- Validate input and workspace scope
- Decide whether a provider action requires approval
- Estimate, cap, and record provider credit use
- Validate and redact provider inputs and responses
- Store evidence provenance and user decisions
- Apply deterministic ranking and exclusion rules
- Reject unsupported model claims and uncited company facts
- Resume exactly from a decision checkpoint without duplicating a provider call

### Bedrock responsibilities

- Turn the user’s brief into explicit hypotheses and clarifying questions
- Summarize normalized evidence
- Explain a deterministic ranking
- Draft a research or sales playbook only from supplied evidence

Bedrock cannot call a provider, persist records, decide a budget, or perform an external action.

## Core state machine

```text
draft_brief
  → hypothesis_ready
  → awaiting_scope_decision
  → market_scope_locked
  → awaiting_provider_approval
  → discovering_companies
  → shortlist_review
  → awaiting_contact_approval
  → verifying_contacts
  → playbook_ready
```

Failures return to a safe prior state with a visible explanation. Repeating a confirmed request reuses its idempotency key; it does not repeat a credit-bearing provider call.

## Ano-owned data model

Existing standalone workspace, run, evidence, audit, and connection records remain Ano-owned. The current form-led `IcpProfile` / `IcpBrief` records are no longer the canonical starting point. The replacement build needs these concepts:

| Record | Purpose |
| --- | --- |
| `ProductBrief` | The offer, objective, optional hints, exclusions, and current user-confirmed facts. |
| `MarketHypothesis` | Ano’s proposed company types, buyer roles, pains, assumptions, and open questions. |
| `ResearchDecision` | A user choice to lock a market, continue, edit a hypothesis, approve a provider action, or dismiss a candidate. |
| `MarketScan` | The method, scope, source evidence, comparison criteria, and status for a location/segment research step. |
| `ProviderCompanySearch` | The immutable one-page Prospeo preview, user approval, provider receipt, outcome, and safe no-retry state. |
| `CompanyCandidate` | A provider-discovered company, its source metadata, state, and evidence-backed fit signals. |
| `Shortlist` | User-approved companies selected for deeper research. |
| `ContactResearchRequest` | The company, roles, approval, estimate, and idempotency record for enrichment. |
| `ContactCandidate` | A verified/enriched person with source provenance and company linkage. |
| `SalesPlaybook` | Industry/company/contact framing, cited evidence, unknowns, and review status. |

The implementation must use a new Ano-only migration when these records are introduced. Existing ICP records may be retained for history, but no data is silently reinterpreted or migrated as a new market hypothesis.

## Phased build plan

### Phase A — Replace the wrong starting experience

**Goal:** Replace the current ICP questionnaire with the product-first brief and hypothesis flow.

Build:

- Replace the current required-field ICP form with Offer + Objective and optional hints.
- Remove the readiness score from the starting experience.
- Replace “Review your ICP” with **Market hypothesis**.
- Render direct input, Ano hypotheses, assumptions, and unanswered questions as distinct UI blocks.
- Add a location-decision checkpoint: preferred location, compare locations, or no preference.
- Preserve the existing workspace/session boundary and use no provider request.

Exit criteria:

- A user can start with only an offer and objective.
- “Not sure” and omitted optional context create questions, never form errors.
- Ano does not label a hypothesis as a confirmed ICP or market fact.
- No provider, enrichment, browser, email, call, or external CRM action occurs.

### Phase B — Standalone market-discovery runtime

**Goal:** Implement the decision state machine and evidence contracts before connecting a live provider.

Build:

- Add typed contracts for product briefs, hypotheses, decisions, market scans, candidates, and playbooks.
- Implement paused/resumed research runs and idempotent decision transitions.
- Add a bounded Bedrock hypothesis/clarification runtime that receives only user-entered context.
- Create a provider adapter interface and disabled-provider state; never return fabricated discovery results.
- Add the market-scope screen, evidence ledger, and audit timeline.

Exit criteria:

- The user can edit or lock a hypothesis and resume the same run.
- Ano makes no location or company claim without the correct evidence label.
- A missing provider connection produces an honest blocked state, not a simulated result.

### Phase C — Prospeo company discovery — implemented

**Goal:** Enable approved, paid company discovery safely.

Build:

- Add a workspace-scoped Prospeo account check using `PROSPEO_KEY`; the credential stays server-only and is never stored in Ano.
- Use the free location-suggestion endpoint to canonicalise a user-locked location only after the user requests a preview.
- Build a company-search preview that is permanently capped at one page (25 companies) and discloses the maximum one-credit impact before the company-search request.
- Atomically claim the user-approved search before it leaves Ano. A completed, in-progress, or uncertain provider request cannot be reissued automatically.
- Store only normalized company candidates, matching signals, provider retrieval time, provider receipt metadata, evidence records, candidate review state, and an audit trail. No contact search, enrichment, CRM write, or outreach path is enabled.

Exit criteria:

- No Prospeo request occurs without a user-approved scope and estimated cost.
- Every candidate shows its provider provenance and matching signals.
- Retrying cannot duplicate the same credit-bearing request.

Implementation note: the connection check and location suggestions are free Prospeo endpoints, but they remain explicit user actions. The only credit-bearing action is labelled **Run 1-page company search**. A provider failure after that action is marked for manual review rather than retried.

### Phase D — Dropcontact contact verification

**Goal:** Find or verify people only for user-approved company shortlists.

Build:

- Add Dropcontact connection setup, capability verification, and budget controls.
- Create an approval screen listing companies, buyer-role hypotheses, data sent, and estimate.
- Enrich/verify only approved company-role requests.
- Store contact provenance separately from company evidence.

Exit criteria:

- Ano never enriches a contact before a company is shortlisted and approved.
- The user can see why a person was requested and where their information came from.

### Phase E — Evidence-backed sales playbooks

**Goal:** Turn approved research into useful sales context without inventing facts.

Build:

- Create industry, company, and buyer playbook views.
- Enforce claim-level provenance and label hypotheses explicitly.
- Add deterministic candidate-fit explanations, confidence, exclusions, and unknowns.
- Add review/edit/dismiss states for every playbook.

Exit criteria:

- A company-level pain statement cannot appear without linked company evidence.
- A user can trace each recommendation to direct input, provider evidence, or an explicitly labelled hypothesis.
- No outbound message or external task is performed.

### Phase F — Quality, controls, and operational readiness

**Goal:** Make the standalone flow trustworthy and affordable in repeated use.

Build:

- Workspace budgets, daily limits, and provider usage ledger
- Consent and retention controls
- Evaluation fixtures for hypothesis quality, evidence grounding, and ranking consistency
- Run recovery, provider error handling, and connection health states
- End-to-end tests: brief → hypothesis → scope decision → company search → shortlist → contact approval → playbook

Exit criteria:

- Unsafe or unsupported claims are rejected or clearly labelled.
- Provider cost, evidence provenance, and user approvals remain inspectable.
- Ano remains useful with no external integration connected.

## Explicitly out of scope

- CRM integration or CRM database access
- Email delivery, calling, campaign editing, or any autonomous outreach
- Generic web browsing or arbitrary HTTP/SQL access for the model
- Automatic provider spending, bulk contact enrichment, or automatic contact reveal
- Claims about market demand, location quality, a company’s pain, or a buyer’s priority without supporting evidence

## Verification contract

Every phase requires:

| Area | Required verification |
| --- | --- |
| Input and hypotheses | Short/uncertain input is accepted; output distinguishes direct input, hypothesis, and question. |
| Decisions | Valid state transitions, authorization, idempotency, pause/resume, and stale-run tests. |
| Bedrock | Schema/format tests, source-bound outputs, guardrail handling, and a controlled live smoke test. |
| Providers | Query validation, approval gate, estimate/budget caps, duplicate prevention, provenance, and failure receipt tests. |
| Evidence | Company and contact claims cannot cite absent, mismatched, or unapproved evidence. |
| UI | End-to-end flow from product brief through approved playbook, including every blocked/approval state. |
| Build | Typecheck, test suite, `next build --turbopack`, and `git diff --check`. |

## Current checkpoint

**Phase A, Phase B, and Phase C are complete.** Ano now starts with the minimal product brief, persists unverified hypotheses separately from direct input, pauses at a durable market-scope decision, and restores the latest run. A user can edit hypotheses before choosing a scope, provide a manual location, or keep/comparison-request the scope open.

With a locked location, a user can explicitly check Prospeo, request a free canonical-location preview, inspect a permanently one-page query and its maximum one-credit impact, then decide whether to run it. Returned companies are stored with provider provenance and can be shortlisted, reviewed, or dismissed. Ano never searches people, enriches contacts, writes to a CRM, or starts outreach in Phase C; those remain Phase D or later.

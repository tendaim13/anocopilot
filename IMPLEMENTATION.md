# Ano implementation plan: LangGraph research-to-revenue platform

> [!NOTE]
> **Historical design record:** This document captures the initial LangGraph specification. For Ano's unified current-state production architecture, safety boundaries, migrations (`000001`–`000031`), and verification suite, see [docs/ARCHITECTURE.md](file:///Users/tendaimidzi/Code/AnoCopilot/docs/ARCHITECTURE.md).

**Status:** Superseded as a current-state reference by [docs/ARCHITECTURE.md](file:///Users/tendaimidzi/Code/AnoCopilot/docs/ARCHITECTURE.md). The initial Tavily pilot is retained purely as a schema audit record; new runs use private authenticated SearXNG (`BRAVE_API_KEY` injected server-side), server-worker execution, map-reduce synthesis, and explicit bounded authority.

**Supersedes for future work:** `IMPLEMENTATION_PLAN.md`. The earlier plan started with a form-led market hypothesis and moved too quickly to company discovery. This document replaces that direction with a research-first, chat-led product.

## 1. Decisions already locked

| Area | Locked decision |
| --- | --- |
| Product | Ano is a standalone sales copilot. It is not a CRM, a form-driven ICP generator, or a resale database. |
| Orchestration | Use **LangGraph JS** as Ano's durable orchestration layer. Do not build a one-off Bedrock loop as the core workflow. |
| Reasoning | Use Amazon Bedrock through a server-only LangChain Bedrock adapter. Bedrock interprets, plans, evaluates, and synthesises; it does not own application state or external permissions. |
| Research | Use a **private self-hosted SearXNG instance** for search discovery and an Ano-owned, application-controlled source retriever. Do not depend on AWS's managed Bedrock Web Search, AWS Console access, a public SearXNG instance, a generic browser, or arbitrary HTTP controlled by the model. |
| Evidence | Recommendations require source-backed reasoning. Model text is never evidence by itself, but incomplete direct evidence changes confidence and framing rather than automatically withholding a useful recommendation. |
| Prospecting | Research and market selection happen before Prospeo company discovery. |
| People | A selected company leads to role recommendations, then named-person discovery, then optional Dropcontact verification. |
| Actions | Email, scheduling, and calling are later graphs. No provider may send an email, create a campaign, schedule a call, or place a call without a separate explicit approval. |
| Data | Ano owns its own Supabase/Postgres schema, provider records, audit events, and graph state. Mercury remains completely untouched. |
| Build system | Next.js with Turbopack only. No webpack configuration or webpack command is introduced. |

## 2. The product Ano is building

Ano begins with one normal-language message. The user may give a complete idea, a short fragment, or uncertainty.

> “I sell AI workflows that help service businesses turn quotes into jobs. Help me find the best outbound market.”

The message is ready when Ano can identify a saleable offer and an intended outcome. There is **no character minimum** and no required location, industry, ICP, or buyer-role form.

Ano then works as a guided research partner:

```text
User message
  → understand the offer and goal
  → ask one decision-changing question only when needed
  → show a research plan
  → user starts research
  → collect, rank, and assess public evidence
  → compare markets, industries, problems, and buyer roles using direct and comparable evidence
  → present Ano's best evidence-calibrated recommendation
  → make sources, confidence, and reasoning available when the user wants them
  → user chooses a target route
  → search companies in Prospeo
  → identify named people at approved companies
  → verify selected contacts when needed
  → prepare and approve outreach or call work
```

The important distinction is:

```text
Bedrock suggests a research method.
The controlled research provider returns source material.
Ano stores, validates, and scores the evidence.
Bedrock explains only what the evidence supports.
The user makes every consequential decision.
```

## 3. Target architecture

Ano is one product composed of several focused graphs. It is not one unrestricted autonomous agent.

```text
Ano coordinator graph
  ├─ Research graph                 Phase A–C
  ├─ Target-to-account graph        Phase D
  ├─ Account-to-people graph        Phase E
  ├─ Contact-verification graph     Phase E
  ├─ Outreach preparation graph     Phase F
  ├─ Email execution graph          Future
  └─ Calling and follow-up graph    Future
```

### 3.1 Why separate graphs

Each graph has a narrow job, its own state contract, permitted tools, approval points, and recovery rules.

| Graph | May do | Must not do |
| --- | --- | --- |
| Research | Ask clarifying questions, search, fetch, extract evidence, compare markets, propose a target route. | Spend provider credits, find people, or create outreach. |
| Target-to-account | Build and preview a Prospeo company search after the user selects a route. | Claim that a company is a buyer before reviewing evidence. |
| Account-to-people | Recommend roles and search for named people at approved companies. | Reveal or enrich every contact automatically. |
| Contact verification | Submit only user-selected name-and-company records to Dropcontact. | Use Dropcontact as the initial discovery source. |
| Outreach preparation | Create research-backed account briefs and drafts. | Send or schedule communication. |
| Future execution graphs | Send a user-approved message, create an approved call task, capture outcomes. | Act without a per-action approval, budget, and receipt. |

### 3.2 LangGraph responsibilities

LangGraph provides:

- typed graph state and node boundaries;
- conditional routing;
- checkpointing and pause/resume through a conversation `thread_id`;
- human-in-the-loop interruptions;
- node-level retries for safe transient failures;
- streaming progress for the UI; and
- reusable subgraphs as Ano expands into outreach and calling.

Ano, rather than LangGraph or Bedrock, remains responsible for authorization, budgets, persistence policy, data retention, provider permissions, idempotency, audit records, and rendering the user interface.

### 3.3 Bedrock responsibilities

Bedrock is used through server-only code. The browser never receives AWS credentials, provider credentials, raw model prompts, or unrestricted tool definitions.

Bedrock may:

- interpret the user's message into a structured research brief;
- decide whether one clarification is necessary;
- turn an approved brief into a research plan;
- propose schema-valid search queries from the plan;
- classify and compare normalised evidence;
- identify gaps, contradictions, and weak evidence;
- draft a cited market, industry, company, or buyer explanation; and
- prepare a draft email or call plan in future phases.

Bedrock may not:

- call search, fetch, Prospeo, Dropcontact, email, dialler, or database APIs directly;
- receive any provider secret;
- decide an action budget;
- bypass a graph interrupt;
- persist its own version of a user decision; or
- turn unsupported knowledge into a claimed fact.

## 4. Phase B research architecture: private SearXNG and Ano-owned retrieval

SearXNG is the search-discovery service, not the evidence extractor. Ano deliberately separates the two stages so a search result, a source fetch, and a stored evidence excerpt each have a clear provenance and failure state.

```text
Approved research scope
  → Ano validates a bounded query
  → private SearXNG returns result metadata only
  → Ano stores candidate result IDs and canonical URLs
  → Ano selects stored result IDs only
  → Ano-owned retriever fetches the selected public pages
  → Ano extracts a safe, short evidence excerpt
  → Bedrock synthesises only from retained evidence IDs and excerpts
```

### 4.1 Service boundary and deployment

| Component | Responsibility | Must not do |
| --- | --- | --- |
| Private SearXNG | Aggregate configured web-search engines and return result metadata. It has an internal Caddy peer network plus a no-published-port outbound engine network. | Extract pages, store Ano data, hold Bedrock/Supabase credentials, or accept anonymous public use. |
| Valkey | Remain isolated on the internal network for SearXNG support services; it is not an Ano data store. | Hold application data or secrets. |
| Reverse proxy | Terminate TLS and require Ano-to-service authentication. | Expose SearXNG's internal port directly. |
| Ano search adapter | Validate a search request, call SearXNG, normalise result metadata, and persist a receipt. | Give Bedrock direct network access. |
| Ano source retriever | Fetch only an Ano-saved search result, apply SSRF/content controls, extract evidence, and persist a bounded excerpt. | Fetch arbitrary model URLs, retain raw pages, or automatically replay an uncertain request. |

The first deployment is one small Amazon Linux 2023 EC2 host running pinned Docker images for **SearXNG**, **Valkey**, and a reverse proxy. SearXNG and Valkey have no published host ports. SearXNG shares an internal peer network with Caddy and a dedicated no-published-port egress bridge for its configured engines; Valkey remains internal-only. The reverse proxy is the sole HTTPS entry point and requires an Ano-held gateway credential. No public SearXNG instance will be used.

The deployment requires a domain and TLS before Ano enables the provider. The EC2 host's SSH arrangement is operational access only; it is not used as Ano's application authentication mechanism.

### 4.2 Ano provider and retriever contracts

The LangGraph model node continues to receive no raw HTTP capability. Ano exposes only these schema-validated application tools:

```text
research_search(query, scope, reason)
research_fetch(search_result_id, reason)
```

`research_search` calls private SearXNG and accepts only validated query, language, date, domain, and engine-scope fields. Ano persists title, canonical URL, snippet, ranking metadata, selected engine metadata when available, and a request receipt.

`research_fetch` accepts only an ID returned by the same Ano research run. Before a request, the retriever must validate the URL scheme, hostname, DNS resolution, redirects, and resolved IP addresses. It rejects localhost, private, link-local, loopback, metadata-service, and non-web destinations. It uses a strict timeout, response-size ceiling, content-type allow-list, redirect ceiling, and per-run fetch cap. HTML and plain text are in scope initially; unsupported media, downloads, and PDFs receive a visible source-level failure rather than a silent fallback.

Ano extracts readable page text server-side, strips executable/interactive content, retains only the approved short excerpt and a content hash, and treats every fetched word as untrusted data. It records structured diagnostics such as HTTP status, content type, byte count, redirect count, and response-shape keys—never credentials or full failed-page content.

### 4.3 Provider configuration and operational controls

| Configuration | Owner | Rule |
| --- | --- | --- |
| `SEARXNG_BASE_URL` | Ano server environment | HTTPS URL of the private reverse proxy; never exposed to the browser. |
| `SEARXNG_GATEWAY_TOKEN` | Ano server environment and reverse proxy | Rotatable, long random shared credential; never stored in Supabase or passed to Bedrock. |
| `SEARXNG_SECRET_KEY` | EC2 server environment | Generated once for SearXNG; never copied into Ano. |
| Engine allow-list | SearXNG configuration | Enable engines only after a documented terms/reliability check; do not make Google scraping the default. |
| Limiting | Caddy + Ano | The private Caddy credential gate plus Ano's explicit approval, durable action claims, 12-search/30-fetch ceilings, and no-replay policy. SearXNG's public JSON API limiter is disabled because it caps authenticated API clients at four searches per IP per hour. |
| Health check | Ano server | Authenticated, no-query health check; it records availability only and never triggers research. |

| Control | Initial limit |
| --- | --- |
| Search queries per research run | 12 |
| Source fetches per research run | 30 |
| Sources admitted to final synthesis | 20 |
| Source response size | 2 MB before extraction |
| Source retrieval timeout | 12 seconds |
| Redirects per source | 3 |
| Bedrock reasoning turns per run | 8 |
| Research-run elapsed time | 15 minutes |
| Automatic replay after uncertain source request | 0; require a fresh, separately approved run |

Before a live run, Ano shows: **SearXNG as the search service, the maximum number of web searches and page requests, the fact that no Tavily credit is used, and the remaining operational risk that websites may rate-limit or reject retrieval.** The user must approve this scope separately from the research plan.

### 4.4 Historical Tavily boundary

Tavily migrations, provider receipts, and stopped attempts remain intact for audit. Ano must not delete them, retry them, or initiate a new Tavily request. Migration `20261023_000011_searxng_research_provider` permits the separate `searxng` provider key for new runs; it does not reinterpret historical Tavily records as SearXNG evidence.

## 5. Evidence and recommendation policy

**Product rule:** Ano does not make a user wait for a perfect evidence matrix. When it has usable evidence, it produces the strongest useful recommendation that evidence supports. Research coverage controls the recommendation's confidence, the type of wording Ano may use, and what Ano proposes to validate next. It does not become a user-facing dead end.

### 5.1 Evidence labels

Every displayed statement has one of the following labels:

| Label | Meaning |
| --- | --- |
| **You told Ano** | A direct user statement. It is retained as user context, not independently verified fact. |
| **Source observation** | A statement or datum derived from a retrieved source, linked to that source and retrieval time. |
| **Comparable evidence** | A source observation from a meaningfully similar industry, market, country, sales motion, or operating model. Ano states why it is comparable and never presents it as direct evidence about the target. |
| **Ano inference** | A conclusion combining one or more source observations. It links to every supporting source. |
| **Hypothesis to test** | A plausible but unverified route; it cannot be worded as a confirmed market fact. |
| **Unknown / validate next** | A decision-relevant point for which Ano found no adequate direct or comparable evidence. It is a stated gap, not a fabricated fact or a reason to hide the rest of the report. |

### 5.2 Source quality policy

For market and industry claims, Ano ranks sources in this order:

1. Government, statutory, regulatory, and official statistical sources.
2. Recognised industry bodies, professional associations, and primary research.
3. Public company reports, filings, and verifiable company material.
4. Reputable independent reporting and analyst material.
5. Vendor, agency, or competitor content used only as supporting context.

Ano must never use a vendor blog alone to claim that a country, industry, company, or buyer is a good target.

### 5.3 Claim-quality gate

Before synthesis, Ano validates every claim against the evidence ledger:

- a claim must cite one or more stored source IDs;
- citations must refer to the claim's topic, not merely the same industry;
- a strong market ranking needs comparable evidence for every compared market; otherwise Ano may show a candidate route with an exploratory or moderate confidence label;
- conflicting sources are shown, not silently averaged away;
- a company-level pain statement needs company-level evidence;
- an industry-level pain statement must remain industry-level when company evidence is absent; and
- no source, weak source, or conflicting source must be rendered as a gap, comparable finding, or qualified inference rather than a confirmed fact.

### 5.4 Recommendation outcomes and confidence

Ano must persist its internal coverage assessment, but the primary user outcome is an insight report rather than an internal pass/fail screen.

| Research outcome | What Ano presents | What Ano must not do |
| --- | --- | --- |
| **Directly supported comparison** | A ranked market recommendation, the supporting findings, trade-offs, confidence, and a recommended first route. | Claim that the selected market guarantees demand or revenue. |
| **Partial direct evidence with useful comparables** | A candidate market route with direct findings, comparable-market/industry findings, clearly labelled Ano inferences, and targeted validation suggestions. | Say the comparable evidence is direct evidence about the target market. |
| **Sparse but usable evidence** | A narrow exploratory recommendation or two defensible routes, with the assumptions the user is being asked to accept. | Hide the result behind an internal coverage score or manufacture precision. |
| **No usable evidence** | A short, honest result: what Ano searched, that no usable public support was found, the least-assumptive next question, and an option to approve a different research scope. | Invent a market recommendation, statistics, sources, or customer pain. |

Every recommendation contains four visible sections:

1. **What Ano found** — direct observations from sources.
2. **What this may mean for you** — comparable evidence and Ano's explicit reasoning.
3. **Recommended starting route** — market, industries, buyer roles, likely problems, and why this route is worth testing.
4. **What to validate next** — material unknowns and the next bounded research question.

The source ledger, coverage score, query count, retrieval diagnostics, provider receipts, and budget consumption remain available in the later **Sources / Why Ano thinks this** view and the Activity audit trail. They are not the report that a seller has to interpret before receiving an answer.

## 6. Persistent data and state design

Ano's Supabase/Postgres database is the durable system of record. LangGraph checkpoints make graph execution resumable; they do not replace Ano's domain records or audit trail.

### 6.1 Existing application baseline

The existing standalone application already uses Next.js, React, TypeScript, Supabase, Zod, the Bedrock runtime SDK, Turbopack commands, and Ano-only migrations. It also contains earlier form-led market brief and Prospeo company-search work.

That work is not deleted in the first LangGraph phase. It is retained for history and later adapted where useful. New user journeys must use the new research graph instead of reinterpreting old ICP data as fresh research.

### 6.2 New Ano-owned records

The exact SQL is deferred to the implementing phase, but the schema must include these concepts.

| Record | Key contents | Purpose |
| --- | --- | --- |
| `ano_conversations` | workspace, owner, status, active graph, active thread ID, title | Top-level chat and navigation object. |
| `ano_graph_runs` | conversation, graph name/version, state, current node, started/completed timestamps, error status | Durable runtime record and recovery point. |
| `ano_graph_checkpoints` | graph run, LangGraph checkpoint reference, serialised safe state, sequence | Resumption without replaying paid or approved work. |
| `research_briefs` | original message, extracted offer, outcome, optional constraints, user confirmations | The chat-led brief; no arbitrary mandatory ICP fields. |
| `research_questions` | question, purpose, status, answer, source requirement | Explains what Ano intends to find out. |
| `research_plans` | scope, comparison dimensions, planned queries, budget, user approval, version | Reviewable plan before live research starts. |
| `research_sources` | provider reference, URL, title, source class, fetch status, timestamps, allowed excerpt/hash | Source provenance without copying web content wholesale. |
| `research_claims` | statement, type, confidence, source IDs, contradiction status, generated-at | Claim-level evidence ledger. |
| `market_profiles` | country/region, score dimensions, recommendation status, linked claims | Evidence-backed market comparison. |
| `industry_profiles` | market, industry, operational problems, buyer roles, linked claims | Industry-level opportunity analysis. |
| `target_decisions` | user-selected market, industry, constraints, decision rationale, handoff status | Explicit boundary before Prospeo. |
| `provider_action_requests` | provider, scope, estimate, approval, idempotency key, receipt, outcome | Reusable approval and audit object for all paid or consequential calls. |
| `run_events` | run, node, timestamp, safe progress payload, error category | Timeline, debugging, and UI status. |

Later phases add provider-specific company, person, contact, outreach, and call records. They must link back to the originating `target_decision` and evidence claim IDs.

### 6.3 Graph state principles

Graph state stores raw, structured data and references. It does not store large formatted prompts, secret material, arbitrary HTML, or a second copy of the entire database.

The research graph state contains, at minimum:

- workspace and conversation IDs;
- LangGraph `thread_id` and graph version;
- original user messages and approved clarification answers;
- readiness assessment and any pending question;
- research brief and approved research plan IDs;
- bounded research budget and consumed usage;
- source IDs and claim IDs, not unrestricted page content;
- current route, error category, and retry counter;
- pending human decision; and
- final market/industry recommendations and evidence references.

The graph version is stored on every run. A new graph version must either migrate compatible state deliberately or leave older runs resumable on their original version.

## 7. Research graph specification

### 7.1 Research graph flow

```text
capture_message
  → validate_message
  → interpret_brief
  → readiness_route
       ├─ needs_context → ask_clarifying_question → resume_interpretation
       └─ ready → create_research_plan
  → await_plan_approval
       ├─ edit → update_brief
       ├─ decline → completed_without_research
       └─ approve → create_research_run
  → plan_queries
  → execute_search
  → select_sources_to_fetch
  → execute_fetch
  → normalise_evidence
  → assess_evidence_coverage
       ├─ research budget remains and a targeted gap can be addressed → refine_queries
       └─ usable evidence or research is complete → synthesise_market_report
  → citation_audit
  → await_target_decision
  → handoff_to_prospecting
```

### 7.2 Node responsibilities

| Node | Owner | Input | Output | Possible next route |
| --- | --- | --- | --- | --- |
| `capture_message` | Application | User message | Immutable message record | `validate_message` |
| `validate_message` | Application | Message | Non-empty/safe input result | `interpret_brief` or `ask_clarifying_question` |
| `interpret_brief` | Bedrock | User context only | Structured offer, outcome, known constraints, unknowns | `readiness_route` |
| `ask_clarifying_question` | Bedrock + LangGraph interrupt | Missing decision | One concise question plus why it matters | Resume after user response |
| `create_research_plan` | Bedrock | Confirmed brief | Questions, comparison criteria, source classes, search scope | `await_plan_approval` |
| `await_plan_approval` | LangGraph interrupt | Plan and budget | User approve/edit/decline action | Appropriate route |
| `plan_queries` | Bedrock | Approved plan | Validated search intents; no direct provider call | `execute_search` |
| `execute_search` | Application | Validated search intent | Normalised search-result records | `select_sources_to_fetch` |
| `select_sources_to_fetch` | Bedrock | Search-result metadata | Ranked result IDs and reasons | `execute_fetch` |
| `execute_fetch` | Application | Approved result IDs | Normalised source records | `normalise_evidence` |
| `normalise_evidence` | Application | Source records | Safe excerpts, metadata, source classification | `assess_evidence_coverage` |
| `assess_evidence_coverage` | Bedrock + deterministic checks | Source and claim records | Coverage, contradiction, gaps, comparable-evidence opportunities, and recommendation mode | Refine while a targeted approved wave remains; otherwise synthesise |
| `synthesise_market_report` | Bedrock | Evidence IDs and allowed excerpts | Direct findings, comparable findings, labelled inferences, unknowns, and market/industry route candidates | `citation_audit` |
| `citation_audit` | Application | Draft claims | Verified claim/source links or blocked claims | `await_target_decision` or repair |
| `await_target_decision` | LangGraph interrupt | Evidence-backed recommendations | User market/industry choice | `handoff_to_prospecting` |

### 7.3 Clarification rules

Ano asks a question only if the answer would change the research design. It asks one question at a time.

Good clarification examples:

- “Should I optimise for the fastest first sales, strongest willingness to pay, or broadest reachable market?”
- “Do you need Ano to stay in a particular country, or should it compare markets?”
- “Is this offer for small operators, larger multi-site businesses, or should Ano test both?”

Bad clarification examples:

- “Please complete your ideal customer profile.”
- “Enter at least 100 characters.”
- “Choose an industry, location, company size, buyer role, and budget before Ano can help.”

### 7.4 Error and retry policy

| Situation | Handling |
| --- | --- |
| Missing or ambiguous user context | Pause and ask one question. Do not manufacture an answer. |
| Bedrock formatting failure | Retry once with the same bounded input, then show an honest recoverable error. |
| Search/fetch rate limit or temporary network failure | Retry only within the configured safe retry policy. |
| Uncertain provider outcome or charge | Stop at `requires_manual_review`; never replay automatically. |
| Limited but usable evidence | Complete the report with an exploratory or moderate confidence label, direct/comparable/inference separation, and a concise next-validation list. |
| No usable evidence | Complete a short no-evidence result, preserve the audit record, and offer one decision-changing clarification or a separately approved new scope. |
| Contradictory evidence | Show the conflict, avoid a confident ranking, and offer the most defensible candidate routes or a targeted next-validation question. |
| Prompt-injection content in a source | Treat as untrusted content, exclude it from instructions, log the event, and continue only when safe. |

## 8. UI information architecture

The application uses tabs. It does not render a long vertical, all-stages-at-once wizard.

### 8.1 Tabs over the life of a conversation

| Tab | Availability | Purpose |
| --- | --- | --- |
| **Ask Ano** | Phase A | Conversational intake, clarification, plan approval, and current request. |
| **Research** | Phase B | Plain-language progress while Ano is working. After completion, it is a secondary history of the question and research run—not a prerequisite to reading the outcome. |
| **Markets** | Phase C | The primary completed-research report: recommended market routes, confidence, trade-offs, and selection. |
| **Industries** | Phase C | The supporting opportunity view: industry problems, solution fit, buyer roles, and confidence. |
| **Sources / Why Ano thinks this** | Phase C | Optional evidence drill-down: sources, direct versus comparable evidence, citations, research gaps, and audit-safe retrieval status. |
| **Accounts** | Phase D | Prospeo company preview, approved search results, shortlist, and account fit. |
| **People** | Phase E | Role recommendations, named-person discovery, and selected contacts. |
| **Playbook** | Phase E/F | Evidence-backed account/industry/contact angles and reviewed drafts. |
| **Activity** | Phase A onward | Read-only run history, provider approvals, receipts, errors, and decisions. |

Only tabs relevant to the current conversation state are enabled. Each tab owns its own internal scrolling area; changing tabs does not discard graph state.

### 8.2 Research progress and result UI

The Research tab shows an understandable timeline rather than hidden agent behaviour:

```text
Research plan approved
Searching official market and industry sources
Reviewing 12 candidate sources
Comparing Australia and Malaysia
Evidence gap: Malaysia sector-specific data is weak
Decision ready: review findings
```

While research runs, Ano shows only seller-relevant progress such as the research focus, comparison being explored, and whether it needs a decision. It does not make the user interpret query budgets, fetch limits, source-class counts, or provider diagnostics.

When research completes, Ano lands the user on **Markets**, not a source ledger. The report starts with the recommended starting route and its confidence; it then explains direct findings, comparable evidence, Ano's inference, and the next thing worth validating. **Sources / Why Ano thinks this** is a non-blocking drill-down for people who want to inspect the evidence.

Internal statuses remain durable for audit and operations: queued, running, paused for a user decision, completed, completed with limited evidence, failed safely, and requires manual review. Only an actual decision the user must make is presented as a blocking UI state.

## 9. Detailed delivery phases

### Phase A — LangGraph foundation and chat-led research planning

**Purpose:** Replace the form-led entry point with a real LangGraph conversation that can pause, resume, and create an approved research plan. This phase establishes the architecture that every later capability uses.

#### A.1 Read-only implementation audit

- Inspect the actual Bedrock model ID, region, authentication path, existing Supabase tables, current run records, and current route ownership.
- Confirm the current Next.js/Turbopack environment and LangGraph package compatibility before changing source code.
- Preserve existing user records and provider work; do not silently reinterpret an ICP as a research brief.
- Record the decision that AWS managed web search is out of scope and that Ano will use a controlled search/fetch provider.

#### A.2 Dependency and server boundary

- Add LangGraph JS and the LangChain core/AWS Bedrock integration required by the current Bedrock model.
- Keep Bedrock and LangGraph imports in server-only modules. No graph code runs in the browser.
- Retain existing AWS credentials in local server environment variables only; do not rename, print, migrate, or expose secret values.
- Add a compatibility check that fails clearly if the configured Bedrock model cannot support the required structured-output/tool-calling pattern.

#### A.3 New graph contracts

- Define Zod contracts for all Phase A graph input, state, nodes, interrupts, and outputs.
- Introduce a stable `GraphRunStatus` taxonomy: `draft`, `awaiting_context`, `planning`, `awaiting_plan_approval`, `complete_without_research`, `failed_safe`, and `requires_manual_review`.
- Define a `ResearchBrief` contract with only offer, goal, optional hints, confirmed constraints, unknowns, and source message IDs.
- Define a `ResearchPlan` contract with research questions, comparison criteria, intended source classes, tool budget, and approval status.

#### A.4 Durable checkpointing

- Add Ano-only migrations for conversations, graph runs, checkpoints, research briefs, research plans, run events, and user decisions.
- Configure a production-safe Postgres-backed LangGraph checkpointer or an equivalent checkpoint adapter that persists graph state in Ano's Supabase/Postgres environment.
- Use `thread_id` to bind every LangGraph run to exactly one Ano conversation and workspace.
- Ensure an interrupted graph resumes without replaying any completed node with an external side effect.

#### A.5 Graph implementation

- Implement `capture_message`, `validate_message`, `interpret_brief`, `ask_clarifying_question`, `create_research_plan`, and `await_plan_approval`.
- Require Bedrock structured output for readiness, clarifications, and plan generation.
- Add an application-level schema validator around every model response.
- Ensure `ask_clarifying_question` is an actual LangGraph interrupt, not a modal approximation or browser-only state.
- Stream safe node status to the UI. Do not stream prompts, secrets, or raw provider data.

#### A.6 API and UI

- Create conversation, send message, resume interrupt, fetch current run, and approve/edit/decline research-plan APIs.
- Replace the current long-form starting flow with the **Ask Ano** tab.
- Add the **Research plan** tab/surface with an editable, versioned plan and explicit **Start research** action.
- Keep all existing legacy screens available only where needed for history until a deliberate replacement is complete.

#### A.7 Tests and Phase A exit gate

- Unit-test each node and contract.
- Test a sufficient one-sentence brief, an ambiguous brief, a user who says “not sure,” an edited plan, and a declined plan.
- Test page refresh and resume using the same `thread_id`.
- Run a bounded Bedrock smoke test using the real configured model, with no search/fetch or provider spending.
- Run typecheck, Turbopack build, migration status, and UI verification.

**Phase A is complete only when:** a user can start with one sentence, receive only necessary clarification, approve an accurate research plan, leave the page, return later, and continue exactly where they stopped.

**Explicitly excluded from Phase A:** live web research, Prospeo, Dropcontact, emails, calls, campaigns, and legacy data deletion.

#### Phase A delivery record — 2026-10-23

- Added the server-only LangGraph research graph, dedicated Postgres checkpoints, Ano conversation/run/message/decision/audit records, and a new tabbed **Ask Ano / Research plan / Activity** workspace.
- The graph handles a sufficient normal-language offer/outcome, one decision-changing clarification, plan editing, approval, and decline through durable LangGraph interrupts and one conversation `thread_id`.
- The configured Bedrock model did not return a native tool call for LangChain's structured-output helper. Ano therefore uses a server-only, two-attempt JSON response path with explicit response-shape prompts, a concise-list normaliser, and Zod validation before graph state is accepted. This is a compatibility adaptation, not a relaxation of validation.
- Applied and verified Ano-only migration `20261023_000007_langgraph_research_foundation`, including the `ano_langgraph` checkpoint schema. Mercury remains untouched.
- Automated graph paths, typecheck, Turbopack production build, schema status, and the bounded live Bedrock smoke check passed. The browser shell was visually verified; its authenticated end-to-end interaction remains pending because the verification browser was not signed in to Ano.

### Phase B — Private SearXNG evidence runtime

**Purpose:** Replace the Tavily pilot with a no-credit, private web-discovery service and a bounded Ano-owned source retriever. A current mission may use up to 50 searches and 100 source fetches, but only when the approved research objective requires them. This phase does not call Prospeo, discover people, or create outreach.

#### B.0 Deploy and verify the private research service

- Provision the existing Amazon Linux 2023 EC2 host with Docker Engine, Docker Compose, security updates, and only the ports needed for SSH and the authenticated HTTPS gateway.
- Deploy pinned SearXNG, Valkey, and reverse-proxy images through a version-controlled Compose file. SearXNG and Valkey must not publish host ports.
- Generate separate server and gateway secrets, store them only in the EC2/Ano server environments, and verify that neither appears in Git, browser bundles, Bedrock context, Supabase, logs, or screenshots.
- Configure SearXNG JSON search output, an explicit engine allow-list, safe-search defaults, and structured service logs. Keep the public SearXNG API limiter disabled: Caddy authentication and Ano-owned approval/limits control this private machine-to-machine path.
- Add an authenticated health endpoint/check. It may verify service availability but may not make a research query.
- Do not connect Ano to this service until the gateway, TLS, auth, health check, and a manual one-query smoke test are all confirmed.

#### B.1 Introduce the SearXNG provider boundary

- Add a provider-neutral `SearxngResearchProvider` server-only adapter. It calls only the authenticated SearXNG search endpoint and produces normalised result metadata.
- Add Ano-only migration(s) that permit `searxng` provider state and action records without mutating or removing Tavily history.
- Update the provider preview to name SearXNG, show the 50-search/100-fetch mission ceilings, state that there is no Tavily credit use, and disclose web-source retrieval risk.
- Preserve the durable action model: a run and each search/fetch request are claimed before execution; duplicate clicks and ambiguous outcomes cannot replay a network request.
- Remove Tavily from all new Phase B routes and configuration checks. Do not remove the old adapter or secret until the replacement has passed acceptance; it simply cannot be selected for a new run.

#### B.2 Build Ano-owned safe source retrieval

- Implement a server-only `EvidenceSourceRetriever` separate from SearXNG. It accepts a saved search-result ID, not a URL, and produces one explicit source outcome: `fetched`, `rejected`, `failed_safe`, or `requires_manual_review`.
- Enforce scheme, hostname, DNS/IP, redirect, timeout, 2 MB response-size, content-type, and 100-source-per-mission limits before extraction.
- Extract readable HTML/plain-text evidence; retain only a bounded excerpt, source metadata, hash, and diagnostic receipt. Reject unsupported content visibly rather than handing opaque pages to Bedrock.
- Store non-sensitive diagnostics sufficient to investigate failures: request stage, HTTP status when received, content type, byte count, redirect count, and safe response-shape metadata. Never collapse a failed parse into an unexplained generic provider error.
- Treat fetched material as untrusted: it cannot introduce instructions, alter graph policy, request more tools, or enter a system/developer prompt.

#### B.3 Connect the research subgraph and UI

- Keep the existing bounded sequence: `plan_queries → execute_search → select_sources_to_fetch → execute_fetch → normalise_evidence`.
- The planner may generate 2–5 search intents but cannot choose unbounded engines, URLs, or retrieval parameters.
- The Evidence tab shows a compact activity timeline, selected sources, per-source outcome, source excerpts, and clear explanation of any rejected/failed source. It must not require a long page scroll.
- A stopped run remains stopped. The user may prepare a new, separately approved scope; Ano never silently retries a failed SearXNG search or website retrieval.

#### B.4 Tests and Phase B exit gate

- Test SearXNG auth failure, unavailable service, invalid JSON, engine failure, malformed result, duplicate search, and connection timeout.
- Test SSRF protections, redirect revalidation, content-type rejection, response-size ceiling, source-ID-only fetch, partial source failures, and no retry after unknown retrieval outcome.
- Test migration compatibility: historical Tavily attempts remain readable while new SearXNG runs are independently recorded.
- Run one deliberately bounded live smoke test after explicit approval and verify that Ano shows at least one saved source plus its provenance and excerpt.
- Run typecheck, Turbopack production build, migrations, server health check, and authenticated browser acceptance.

**Phase B is complete only when:** Ano can execute an explicitly approved, bounded SearXNG-backed research run; safely fetch evidence from stored result IDs; explain every source failure; show source provenance; and stop without duplicate web requests.

**Explicitly excluded from Phase B:** market ranking, Prospeo, contacts, Dropcontact, emails, calls, campaigns, and Mercury integration.

#### Phase B implementation record — 2026-10-23

- Added the provider-neutral research contract, `SearxngResearchProvider`, and `EvidenceSourceRetriever`. New runs use SearXNG search metadata only; Ano independently validates every stored-result source URL, DNS resolution, redirect, response size, and content type before extracting a bounded excerpt.
- Added Ano-only migration `20261023_000011_searxng_research_provider`. It permits `searxng` for future runs while retaining historic Tavily rows and receipts unchanged.
- The UI now discloses private SearXNG, its 12-search/30-source limit, no Tavily credit use, and the distinction between rejected sources and safe retrieval failures.
- Added a non-secret, digest-pinned Compose deployment bundle for SearXNG, Valkey, and an authenticated Caddy HTTPS gateway. Docker and Compose are installed on the dedicated EC2 host, and the bundle is staged at `/opt/ano-searxng`.
- **Gateway activation record:** `deepresearch.nervastudios.com` resolves to the dedicated EC2 host. On 2026-10-23, the pinned SearXNG, Valkey, and Caddy services were started with host-only generated credentials and automatic TLS. The authenticated `/healthz` route returned `200`; unauthenticated `/healthz` and `/search` returned `401`. Ano's ignored, server-only local environment now holds the gateway URL and token. No `/search` request, source fetch, or research run was made.
- **Limiter correction:** On 2026-10-24, the public SearXNG limiter was disabled for the private authenticated gateway. Its default API quota is four JSON searches per IP per hour and its bot checks reject Ano's machine-to-machine JSON request shape. Ano now identifies its server request explicitly; Caddy authentication and Ano's durable approval, bounded-run, and no-retry controls remain mandatory.
- **Egress correction:** On 2026-10-24, SearXNG was given a dedicated no-published-port Docker egress bridge after its initial internal-only network prevented DNS resolution and engine access. This permits outbound calls to the configured engines only; it does not make SearXNG directly reachable from the internet.
- **Live smoke record:** On 2026-10-24, a user-approved bounded SearXNG run completed. Ano persisted 17 fetched source excerpts and three safe retrieval-failure records under a durable receipt. This verified the full preview → explicit approval → bounded discovery → source retrieval path without a retry or any Prospeo, person, contact, or outreach action.

#### B.5 Iterative deep-research mission — implemented and schema-applied; pending live acceptance

- Replaced the fixed one-pass sequence for new runs with `plan wave → search → score candidates → fetch → assess coverage → targeted follow-up wave → complete`.
- The approved mission is a hard ceiling of **50 SearXNG searches and 100 safe source fetches**. Previous 12/30 runs retain their original limits and receipts; no historic run is replayed or relabelled.
- Added persisted research waves, query records, source-to-query traceability, and per-source assessment records. Bedrock proposes only the next bounded question set. It has no SearXNG credential, HTTP/browser access, or ability to expand the approved mission.
- Candidate retrieval is ranked before fetching. The score combines source-class authority, query directness, publication freshness, source-class diversity, extractability, and a near-duplicate penalty. A vendor page can provide terminology but is not decision-relevant evidence by itself.
- The coverage assessment measures direct coverage, comparable-market/industry coverage, source diversity, contradiction, and material unknowns across problem urgency, market density, buyer conditions, market access, and solution fit. Counter-evidence is explicitly requested during follow-up waves.
- Phase C consumes the mission coverage ledger to calibrate its recommendation. It does not withhold synthesis merely because a strict cross-market comparison gate is not met: usable evidence produces an evidence-backed, exploratory, or no-usable-evidence report as defined in Section 5.4.
- Added deterministic assessment and LangGraph tests for source quality, comparison coverage, and an evidence-gap-driven second wave. No new web search, source retrieval, company search, contact enrichment, or outreach was performed while implementing this replacement.
- Applied and verified Ano-only migration `20261024_000013_iterative_deep_research`; the dedicated Ano schema now reports 44/44 required tables. Typecheck, Phase A/B/C regressions, the new deep-research tests, SearXNG contracts, and a Turbopack production build pass.

#### Superseded Tavily pilot record — 2026-10-23

- Tavily search and extract were implemented as a bounded Phase B pilot. A live attempt completed search discovery but did not produce a valid Extract response for source retrieval. No request was replayed.
- The pilot's schema, audit receipts, and stopped attempts are retained. It is superseded as the active research path and must not be resumed automatically or presented as successful evidence collection.

### Phase C — Evidence synthesis, market comparison, and target choice

**Purpose:** Turn live research into the most useful evidence-calibrated recommendation Ano can make about where to sell and which industries to examine. A perfect comparative dataset improves confidence; it is not a prerequisite for a report.

#### C.1 Evidence assessment

- Implement `assess_evidence_coverage`, `refine_queries`, and `citation_audit`.
- Use the same comparison dimensions across every market where evidence permits.
- Score evidence coverage separately from commercial attractiveness. A high score for evidence means “well supported,” not “guaranteed revenue.”
- Detect direct evidence, comparable evidence, contradictions, stale evidence, and material unknowns.
- Treat coverage as a recommendation-calibration input, not a synthesis gate when at least one usable source exists.

#### C.2 Research synthesis

- Implement `synthesise_market_profiles` using only approved evidence IDs and permitted excerpts.
- Produce structured outputs for direct findings, comparable findings, Ano inferences, market profiles, industry profiles, operational problems, solution fit, buyer-role hypotheses, confidence, unknowns, and next research actions.
- Enforce the distinction between observation, inference, and hypothesis at render time as well as in the model contract.
- Require Ano to state why any source is considered comparable—for example, shared industry, sales motion, operating model, adjacent geography, or regulatory/economic fingerprint.

#### C.3 Markets and Industries UI

- Activate **Research**, **Markets**, **Industries**, and **Sources / Why Ano thinks this** tabs.
- Land completed research on **Markets** and present recommendation-first cards, not an internal evidence-coverage dashboard.
- Present direct evidence, comparable evidence, Ano inferences, and unknowns in distinct visual treatments; sources are linked but do not dominate the initial report.
- Let the user compare, narrow, reject, lock a route, or request a new separately approved research question.
- Add a `target_decision` interrupt: the graph cannot move to company discovery until the user selects or locks a route.

#### C.4 Tests and Phase C exit gate

- Test citation mismatch rejection, direct/comparable/inference labels, no-usable-evidence reports, contradictory-source reports, and no-location/no-industry inputs.
- Use a representative product prompt and verify that conclusions are materially more useful than a restatement of the prompt.
- Review a live research result visually: a seller can understand the recommended route before opening source details; sources, inference labels, uncertainty, and decision controls remain visible and understandable.

**Phase C is complete only when:** Ano can provide a useful report for direct, comparable, sparse, and no-usable-evidence outcomes; show why it recommends a market and industry (or why it cannot responsibly recommend one); separate observation, comparable evidence, inference, and unknowns; and let the user choose a target route when a route is proposed.

**Explicitly excluded from Phase C:** paying for Prospeo, person discovery, enrichment, and outreach.

#### Phase C implementation record — 2026-10-24

- Added the Ano-only `20261024_000012_phase_c_market_synthesis` migration. It stores one evidence synthesis per research run, citation-bound claims, market and industry profiles, and an explicit target-decision record. No company, person, contact, or Mercury tables are involved.
- Added a dedicated `phase-c-v1` LangGraph subgraph. It assesses saved fetched excerpts first, routes fewer than three excerpts to an insufficient-evidence stop, invokes Bedrock only with bounded saved excerpts and source IDs, then applies a deterministic citation audit before any findings are persisted.
- The audit rejects claim source IDs outside the saved ledger, unknown claim references, duplicate profiles, and mismatched market-to-industry links. Evidence coverage and commercial attractiveness are not conflated: source count and source-class diversity control whether a route may be locked.
- Added **Markets** and **Industries** tabs with compact findings cards, expandable cited-evidence drawers, explicit observation/inference/hypothesis/uncertainty labels, visible gaps and contradictions, and a target-route lock. Locking records the user decision only; it does not invoke SearXNG, Prospeo, Dropcontact, a CRM, email, or telephony.
- **Verification record:** the Ano-only migration is applied and schema status is current. Phase C contract tests, the existing Phase B/SearXNG regression tests, and a Turbopack production build pass. An authenticated live run on 2026-10-24 analyzed the existing source ledger once. It correctly stopped at `insufficient_evidence`: 17 fetched excerpts were available, but all were classified as one source class and none carried a publication date, so no market or industry route was invented or locked. The UI exposes the coverage gap plus review and new-question controls. The Phase C model action remains user-triggered and is never retried automatically.

#### Phase C recommendation-policy revision — 2026-10-30 (authoritative for future implementation)

The prior implementation record is retained as history, but its `insufficient_evidence` stop is no longer the intended user outcome. The following work replaces that behaviour without weakening evidence integrity or provider safety:

1. **Preserve assessment; remove it as a hard user gate.** Keep `comparison_ready`, coverage, source-class diversity, contradictions, and retrieval outcomes as audit fields. Add a persisted `recommendation_mode`: `directly_supported`, `comparative_inference`, `exploratory`, or `no_usable_evidence`.
2. **Synthesize whenever usable evidence exists.** The graph may run targeted follow-up waves while the approved mission remains. Once it has usable excerpts—or exhausts the approved mission—it produces the appropriate report mode. Only zero usable evidence bypasses the normal market synthesis, and it still receives a short, useful no-evidence result.
3. **Use an explicit evidence-aware Bedrock contract.** For every conclusion, the model must return source IDs; an evidence kind (`direct`, `comparable`, or `inference`); a concise rationale; confidence; and a statement of what would disprove or validate it. The application rejects unsupported direct claims, unlinked comparable claims, and inferred statistics presented as observations.
4. **Define comparable fingerprints deterministically.** A comparable route must name the shared dimensions: industry/operating model, customer size or sales motion, adjacent geography or economic/regulatory context, buyer role, and problem mechanism. Bedrock may explain the comparison but cannot silently turn a weak analogy into a market fact.
5. **Render report-first.** Completed research opens a concise market recommendation report. It shows the strongest route, alternatives, confidence, direct findings, comparable reasoning, likely problems, buyer roles, and a next validation step. The source ledger becomes a voluntary Sources / Why Ano thinks this view, not the page that blocks forward progress.
6. **Retain human control at the hand-off.** Ano can recommend a route; it cannot call Prospeo until the user deliberately locks a market/industry route. A user may instead reject the recommendation or approve a new question. No company, person, contact, email, calling, or scheduling provider action is introduced by this revision.
7. **Verify four end-to-end cases.** (a) strong direct comparison, (b) mixed direct and comparable evidence, (c) sparse but useful evidence, and (d) no usable evidence. Each must leave a readable result and audit trail; none may strand the user on a coverage error page.

### Phase D — Research-backed Prospeo account discovery

**Purpose:** Convert a user-selected target route into an approved company search.

#### D.1 Reposition existing Prospeo work

- Retain existing safe patterns: server-only key use, connection check, canonical location suggestions, one-page cap, cost disclosure, atomic approval claim, receipts, provenance, and no automatic retry after uncertain results.
- Move the entry condition: the company-search preview now requires a `target_decision`, not a legacy form-led market brief.
- Do not delete prior `market_brief` or company-search records; add explicit compatibility/mapping code only when required and preserve history.

#### D.2 Target-to-query graph

- Implement a graph subflow that turns the selected market/industry/constraints into a Prospeo query proposal.
- Show the user each proposed filter, the research claim behind it, excluded categories, expected page size, and maximum credit impact.
- Use Prospeo's location and filter validation only at preview time; do not pretend that free-text locations are already canonical.
- Require an explicit user approval before the credit-bearing company search.

#### D.3 Account qualification

- Store normalised company records, matching signals, retrieval time, provider receipt, and candidate review status.
- Generate an account-fit explanation from research evidence plus provider data.
- Keep industry-level problem statements separate from company-level evidence.
- Let the user shortlist, hold, or dismiss companies.

#### D.4 Tests and Phase D exit gate

- Test target-decision requirement, preview/approval separation, query validation, max-credit disclosure, idempotency, provider error state, and candidate provenance.
- Verify no company search occurs from a recommendation the user has not selected.

**Phase D is complete only when:** an evidence-backed target decision becomes a transparent, user-approved Prospeo company search and a reviewable shortlist.

### Phase E — People discovery and selective Dropcontact verification

**Purpose:** Close the company-to-person gap before enrichment.

#### E.1 Role and person discovery

- From each shortlisted company, Ano proposes buyer roles with an evidence-backed rationale.
- Use Prospeo person search only for selected companies and approved role criteria.
- Store named people, title, company linkage, provider provenance, retrieval time, and confidence separately from contact details.
- Require the user to select the people worth verifying.

#### E.2 Dropcontact verification

- Add a provider-action preview showing each selected name, company/domain, data sent, expected result, and estimated cost.
- Require a separate approval from person discovery.
- Submit only selected name-and-company pairs.
- Store verified or failed results with provider receipt, retrieval time, contact status, and user approval record.
- Never enrich all discovered people automatically and never expose a provider result as a permanent Ano-owned contact database.

#### E.3 Playbook preparation

- Build account, industry, and buyer playbooks from only approved research, company, and selected-contact evidence.
- Show unknowns and items to validate in the first conversation.
- Keep personalisation claims factual and source-linked; no invented company pain or personal detail.

#### E.4 Tests and Phase E exit gate

- Test company-shortlist prerequisite, role approval, people selection, Dropcontact preview/approval, failed verification, and no-contact-result states.
- Confirm that every person in a playbook has a traceable company and provider source.

**Phase E is complete only when:** Ano can move from a selected company to a user-selected named person, optionally verify the person, and create a factual sales playbook.

### Phase F — Outreach, scheduling, and calling graphs

**Purpose:** Expand Ano from research and preparation into controlled sales execution.

This phase is intentionally downstream. It begins only after Phases A–E are stable and after the relevant email, calendar, telephony, and compliance decisions are separately approved.

#### F.1 Outreach preparation graph

- Turn an approved playbook into email, LinkedIn, call, and follow-up drafts.
- Store draft versions, source evidence, user edits, and approval status.
- Require a contact eligibility check before any message is made available for send.

#### F.2 Email execution graph

- Accept only a user-approved draft, selected contact, account, channel, schedule, and maximum send count.
- Create an immutable action request before any email provider call.
- Record provider receipt, delivery outcome, retries, suppression/bounce events, and manual-review errors.
- Do not automatically enrol contacts into a campaign without a separate approval.

#### F.3 Calling and scheduling graph

- Create call tasks from approved research and outreach context.
- Allow an approved scheduling integration or dialler connection only after connector-specific scope, consent, budget, and audit requirements are defined.
- Store call purpose, approved script/brief, scheduled time, outcome, and next action.
- Never place a call, change a schedule, or transmit sensitive context without explicit user approval.

#### F.4 Tests and Phase F exit gate

- Test approval, idempotency, schedule changes, cancellation, provider error handling, receipts, and post-action state transitions.
- Test that a graph cannot cross from draft into send/call without the required approval records.

**Phase F is complete only when:** every communication is attributable to a user-approved graph action with a visible audit trail and recoverable provider receipt.

## 10. API plan

These are intended API responsibilities, not a commitment to final route names.

| API responsibility | Phase | Required behaviour |
| --- | --- | --- |
| Create/list conversation | A | Workspace-scoped, authenticated, starts a LangGraph thread. |
| Send a chat message | A | Appends an immutable message, advances only safe graph nodes, streams progress. |
| Resume an interrupt | A | Validates the user response against the pending decision schema and resumes the same thread. |
| Fetch conversation/run state | A | Returns safe UI state, current node/status, tabs, and no secrets. |
| Approve/edit/decline research plan | A | Versioned decision, idempotent, recorded in audit trail. |
| Start research | B | Requires approved plan, provider scope, cost/quota disclosure, and user approval. |
| View sources/claims | B/C | Returns citation-ready evidence records and source access metadata. |
| Select target route | C | Locks chosen market/industry constraints and hands off to Phase D. |
| Preview/approve company search | D | Reuses the provider-action request pattern and has a separate paid-action approval. |
| Search/select people | E | Requires shortlisted company and role criteria. |
| Preview/approve verification | E | Requires selected people and provider estimate. |
| Draft/approve/send/schedule/call | F | Separate action routes, each with their own explicit state and receipt. |

## 11. Security, privacy, and operational rules

- All provider and Bedrock credentials stay server-side.
- Every database query is workspace-scoped and authorization is rechecked in every API route and graph node that performs a provider action.
- Tool input and tool results are schema-validated independently of Bedrock guardrails.
- Web content, snippets, and provider text are untrusted input. They cannot override Ano instructions or cause an external request.
- Research facts, provider results, and model inferences are retained with distinct labels and retention rules.
- Costs are bounded before a run begins. A model cannot increase a budget dynamically.
- Paid, contact-revealing, message-sending, scheduling, and calling actions are idempotent and require a user approval record.
- Uncertain external outcomes are never retried automatically.
- Observability uses Ano's run events and redacted logs by default. LangSmith or another external observability service is optional, never a prerequisite, and requires a separate data-handling decision before activation.

## 12. Migration and legacy transition strategy

1. Add the LangGraph research records in new Ano-only migrations.
2. Keep legacy ICP, market-brief, and existing Prospeo records intact and readable.
3. Make new conversations enter the LangGraph research graph.
4. Mark old form-led flows as legacy in the UI once the Phase A path passes acceptance testing.
5. Adapt the current Prospeo safety layer in Phase D; do not delete it and do not loosen its approval/credit protections.
6. Do not automatically convert an old ICP or market brief into a new research decision. A user may choose to start a new research conversation or explicitly import facts.
7. Remove legacy UI or tables only after a separate migration plan, data-retention decision, and user approval.

## 13. Verification standard for every phase

| Category | Required verification |
| --- | --- |
| Contracts | Zod/schema tests for every graph input, output, interrupt, provider call, and persisted record. |
| Graph logic | Node, route, pause/resume, stale-run, and graph-version tests. |
| Authorization | Workspace isolation tests for every conversation, run, evidence record, and provider action. |
| Bedrock | Structured-output tests, malformed-output handling, bounded live smoke test, and no secret exposure. |
| Research | Search/fetch validation, source policy, citations, evidence-gap handling, and source-to-claim matching. |
| Providers | Preview/approval split, budget cap, idempotency, receipt storage, error paths, and no auto-retry of uncertain outcomes. |
| UI | Tab state, in-tab scrolling, refresh/resume, accessibility labels, loading/error/paused states, and source visibility. |
| Build | `npm run typecheck`, relevant phase tests, `npm run build`, and Ano schema status. |

No phase is marked complete merely because code exists. It is complete only after its exit criteria, tests, migration checks, and a visual review of the real interaction have passed.

## 14. Delivery sequence and repository practice

For each approved phase:

1. Inspect the actual checkout and existing user changes before edits.
2. Implement only that phase's stated scope.
3. Add or update Ano-only migrations where the phase requires persisted data.
4. Run the phase-specific and shared verification checks.
5. Present the working result for review.
6. Commit and push to `origin/main` after the user approves phase completion, preserving any unrelated user changes.

## 15. Immediate next action

The next authorised implementation is the **Phase C recommendation-policy revision** above. It is deliberately limited to the research-to-recommendation boundary:

1. Inspect the current Phase C contracts, graph routes, persistence schema, and UI state without altering the provider adapter or prior source records.
2. Add the `recommendation_mode`, confidence, direct finding, comparable finding, inference, unknown, and validation-next contract fields. Preserve old coverage fields as audit metadata.
3. Route every run with one or more usable excerpts through evidence-aware synthesis; route zero-usable-evidence runs to a concise no-evidence report. Do not replay a source request, bypass approval, or spend new provider budget in this change.
4. Update the market and industry report so the recommended route appears first, while sources and raw research diagnostics move into a non-blocking Sources / Why Ano thinks this view.
5. Add contract, graph, persistence, and UI tests for the four outcome modes; run the established Ano verification suite and review the live interaction before calling the revision complete.

Do not begin Prospeo changes, Dropcontact work, message sending, scheduling, or calling until the relevant later phase is explicitly authorised.

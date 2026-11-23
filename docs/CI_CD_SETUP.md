# CI/CD Setup Guide (GitHub Actions + Vercel + Ano Supabase)

This repository uses a cost-optimized single-job GitHub Actions pipeline so **all builds, tests, schema migrations, and production deployments** run cleanly without leaking DDL credentials into Vercel or hitting double-build costs.

---

## 1. Repository Files Created

- `.github/workflows/ci.yml` — Runs on PRs and pushes to `main`:
  - Checks Node `22.x`, ensures `.env.local` / `.env.production` are never tracked, and checks no server secret uses a `NEXT_PUBLIC_` prefix.
  - Verifies all `supabase/migrations/*.sql` files are registered (`npm run check:migrations`).
  - Runs `npm run typecheck`, unified offline `npm test`, and `npm run build` (`ANO_AGENT_MODE=disabled`).
- `.github/workflows/deploy-production.yml` — Runs on pushes to `main`:
  - Re-verifies `check:migrations`, `typecheck`, and `npm test`.
  - Runs `npm run db:apply:ci && npm run db:status:ci` against Ano's Supabase database **before** code deployment (when `SUPABASE_DB_URL` is configured).
  - Builds once via `vercel build --prod` and deploys via `vercel deploy --prebuilt --prod` (when Vercel secrets are configured).
  - Smoke checks `GET /api/health` (`200`, `"ok":true`) and verifies `GET /api/v1/conversations` rejects unauthenticated traffic (`401`/`403`).
- `vercel.json` — Configures Fluid Compute `maxDuration` (`300s` for deep Phase B/C/D/E routes, `120s` for Phase 9B templates/chat) and security headers.
- `src/app/api/health/route.ts` — Unauthenticated liveness probe returning `{ ok, service, commit, agentMode, supabaseConfigured, timestamp }`.

---

## 2. One-Time Linking on Vercel (Run Locally Once)

Run these commands once from your local repo to link your Vercel project and retrieve your IDs:

```bash
npx vercel login
npx vercel link
```

When `npx vercel link` finishes, inspect `.vercel/project.json` (already gitignored in `.gitignore`) to read:
- `orgId` → **`VERCEL_ORG_ID`**
- `projectId` → **`VERCEL_PROJECT_ID`**

Then create an access token in **Vercel Account Settings → Tokens** → **`VERCEL_TOKEN`**.

> **Important (Avoid Double Deploys):** Because `.github/workflows/deploy-production.yml` runs `vercel deploy --prebuilt --prod` after applying Supabase migrations, disable Vercel's automatic Production branch deploy on `main` (Vercel Project Settings → Git → Ignored Build Step or Production Branch auto-deploy off), while optionally keeping PR Preview deployments enabled.

---

## 3. Secrets to Add in GitHub

In your GitHub repo **Settings → Environments → New environment: `production`** (and optionally enable **Required reviewers** if you want a 1-click gate before migrations & production deploys):

| Secret Name | Value | Required For |
| --- | --- | --- |
| `SUPABASE_DB_URL` | Ano's Postgres URI from `.env.local` | Applying & verifying migrations in CI (`db:apply:ci`) |
| `SUPABASE_DB_SSL_CA` | Optional: raw PEM contents (or base64) of Supabase CA cert | Strict CA verification in GitHub Actions |
| `VERCEL_TOKEN` | Vercel Personal Access Token | Prebuilt deploy to Vercel |
| `VERCEL_ORG_ID` | From `.vercel/project.json` (`orgId`) | Vercel CLI pull/build/deploy |
| `VERCEL_PROJECT_ID` | From `.vercel/project.json` (`projectId`) | Vercel CLI pull/build/deploy |

---

## 4. Environment Variables to Add in Vercel (Production & Preview)

Add these in **Vercel Project Settings → Environment Variables** (**never** put `SUPABASE_DB_URL` in Vercel — runtime LangGraph execution uses Supabase RLS tables plus an in-memory checkpointer whenever `SUPABASE_DB_URL` is absent):

### Required Runtime & Auth
- `NEXT_PUBLIC_SUPABASE_URL` — Ano's Supabase URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Ano's Supabase publishable/anon key
- `ANO_ALLOW_DEMO_MODE` — `false` in Production

### Reasoning LLM (Google AI Studio Gemini — Free/Token-Conserving)
- `ANO_AGENT_MODE` — `gemini`
- `GEMINI_API_KEY` — Google AI Studio API key
- `GEMINI_MODEL` — `gemini-3.5-flash-lite` (or `gemini-3.1-flash-lite`)
- *(Later, when switching back to AWS Bedrock, add `AWS_REGION`, `BEDROCK_MODEL_ID`, `BEDROCK_GUARDRAIL_ID`, `BEDROCK_GUARDRAIL_VERSION`, AWS IAM role/keys and switch `ANO_AGENT_MODE=bedrock`.)*

### Research & Lead Connectors
- `SEARXNG_BASE_URL` — Public/authenticated HTTPS endpoint of your SearXNG gateway (Phase B)
- `SEARXNG_GATEWAY_TOKEN` — Server bearer token for SearXNG gateway (Phase B)
- `PROSPEO_KEY` — Prospeo server API key (Phases D, E, 9A)
- `DROPCONTACT_API_KEY` — Optional Dropcontact key (Phase E/9A fallback verifier)

*(Note: For GitHub billing protection, set GitHub Actions spending limit to `$0` on your personal/org billing settings so free 2,000 min/month usage is never exceeded unexpectedly.)*

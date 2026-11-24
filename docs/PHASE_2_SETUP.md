# Historical Initial Workspace Setup Note

> [!NOTE]
> This historical bootstrap checklist has been superseded as the architecture reference by [docs/ARCHITECTURE.md](file:///Users/tendaimidzi/Code/AnoCopilot/docs/ARCHITECTURE.md) and for CI/CD, database migrations (`000001`–`000031`), and environment setup by [docs/CI_CD_SETUP.md](file:///Users/tendaimidzi/Code/AnoCopilot/docs/CI_CD_SETUP.md).

## Quick local schema & environment summary

1. Create a dedicated Supabase project for Ano and add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_URL`, and `ANO_DATABASE_LABEL=ano` to `.env.local` (never reuse external CRM databases or expose `SUPABASE_DB_URL` to browser/Vercel runtime).
2. Run `npm run db:apply && npm run db:status` to apply and verify all SQL migrations (`000001`–`000031`), RLS policies across all 53 tables, `ano_langgraph` checkpoints, and private `ano_internal.api_usage_logs` telemetry.
3. Configure server-only reasoning model credentials (`GEMINI_API_KEY`, or `ANO_AGENT_MODE=bedrock` / `ollama`), private research gateway settings (`SEARXNG_BASE_URL`, `SEARXNG_GATEWAY_TOKEN`), and bounded provider limits (`ANO_INTERNAL_DAILY_PROSPEO_LIMIT`, `ANO_INTERNAL_DAILY_DROPCONTACT_LIMIT`) per `.env.example` and [docs/ARCHITECTURE.md](file:///Users/tendaimidzi/Code/AnoCopilot/docs/ARCHITECTURE.md).

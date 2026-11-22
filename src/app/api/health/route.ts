import { NextResponse } from "next/server";

import { getAnoAgentMode } from "@/server/agents/bedrock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let agentMode: string = "disabled";
  try {
    agentMode = getAnoAgentMode();
  } catch {
    agentMode = "invalid";
  }

  const commit = (
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    "local"
  ).slice(0, 7);

  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
  );

  return NextResponse.json(
    {
      ok: true,
      service: "ano-copilot",
      commit,
      agentMode,
      supabaseConfigured,
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

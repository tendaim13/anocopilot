import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Kept for existing bookmarks; it has no execution path to the retired mock runtime. */
export function POST() {
  return NextResponse.json(
    {
      error: "Ano’s simulated research workflow has been retired. Use the workspace brief flow with records you enter or paste into Ano.",
      code: "SIMULATED_WORKFLOW_RETIRED",
    },
    { status: 410 },
  );
}

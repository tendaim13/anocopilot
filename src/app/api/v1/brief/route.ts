import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Account briefs are deferred until a user selects or adds a real target account. */
export function POST() {
  return NextResponse.json(
    { error: "Account briefs are not the Ano starting point. Create an ICP and research plan first.", code: "ACCOUNT_BRIEF_DEFERRED" },
    { status: 410 },
  );
}

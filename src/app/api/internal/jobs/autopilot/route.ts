import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { runGlobalAutopilotWorkerSweep } from "@/server/jobs/autopilot-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function readConfiguredWorkerSecret(): string | null {
  const secret = process.env.ANO_WORKER_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  return secret || null;
}

function isAuthorizedWorkerRequest(request: Request, expectedSecret: string): boolean {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const supplied = match?.[1]?.trim() ?? "";
  if (!supplied) return false;

  const expectedBuf = Buffer.from(expectedSecret, "utf8");
  const suppliedBuf = Buffer.from(supplied, "utf8");
  if (expectedBuf.length !== suppliedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, suppliedBuf);
}

async function handleWorkerRequest(request: Request) {
  const secret = readConfiguredWorkerSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error: "Background worker authentication is not configured.",
        code: "WORKER_SECRET_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  if (!isAuthorizedWorkerRequest(request, secret)) {
    return NextResponse.json(
      { error: "Unauthorized.", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const sweep = await runGlobalAutopilotWorkerSweep();
  return NextResponse.json({ ok: true, ...sweep });
}

export async function GET(request: Request) {
  return handleWorkerRequest(request);
}

export async function POST(request: Request) {
  return handleWorkerRequest(request);
}

import { runGlobalAutopilotWorkerSweep } from "@/server/jobs/autopilot-worker";

const args = process.argv.slice(2);
const runOnce = args.includes("--once");
const intervalArg = args.find((arg) => arg.startsWith("--interval-ms="));
const parsedInterval = intervalArg ? Number(intervalArg.split("=")[1]) : 5_000;
const intervalMs =
  Number.isFinite(parsedInterval) && parsedInterval >= 1_000 ? parsedInterval : 5_000;

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

async function main() {
  if (runOnce) {
    const result = await runGlobalAutopilotWorkerSweep();
    console.log(JSON.stringify(result));
    return;
  }

  console.log(
    JSON.stringify({
      worker: "autopilot",
      status: "started",
      intervalMs,
    }),
  );

  while (!stopping) {
    const result = await runGlobalAutopilotWorkerSweep();
    if (!result.configured) {
      console.error(
        JSON.stringify({
          worker: "autopilot",
          status: "unconfigured",
          detail: "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to run the standalone worker.",
        }),
      );
      process.exitCode = 1;
      return;
    }

    if (result.inspected > 0 || result.recovered > 0 || result.drained > 0 || result.paused > 0) {
      console.log(JSON.stringify(result));
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      timer.unref?.();
    });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Autopilot worker failed.");
  process.exitCode = 1;
});

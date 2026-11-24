import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

function resolveChromiumExecutable(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  if (process.env.CI) {
    return undefined;
  }

  const cacheDir = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  if (!existsSync(cacheDir)) {
    return undefined;
  }

  const entries = readdirSync(cacheDir).sort().reverse();
  for (const entry of entries) {
    if (entry.startsWith("chromium-")) {
      const candidates = [
        path.join(
          cacheDir,
          entry,
          "chrome-mac-arm64",
          "Google Chrome for Testing.app",
          "Contents",
          "MacOS",
          "Google Chrome for Testing",
        ),
        path.join(cacheDir, entry, "chrome-linux", "chrome"),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }
    if (entry.startsWith("chromium_headless_shell-")) {
      const candidates = [
        path.join(
          cacheDir,
          entry,
          "chrome-headless-shell-mac-arm64",
          "chrome-headless-shell",
        ),
        path.join(cacheDir, entry, "chrome-linux", "headless_shell"),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

const externalBaseUrl = process.env.ANO_E2E_BASE_URL?.trim();
const port = Number(process.env.ANO_E2E_PORT ?? 3100);
const baseURL = externalBaseUrl || `http://127.0.0.1:${port}`;
const executablePath = resolveChromiumExecutable();

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: `npx next start -H 127.0.0.1 -p ${port}`,
          url: `${baseURL}/api/health`,
          timeout: 60_000,
          reuseExistingServer: !process.env.CI,
          env: {
            ...process.env,
            NEXT_PUBLIC_SUPABASE_URL:
              process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "https://example.supabase.co",
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
              process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
              "sb_publishable_e2e_placeholder",
            ANO_AGENT_MODE: "disabled",
            ANO_ALLOW_DEMO_MODE: "false",
          },
        },
      }),
});

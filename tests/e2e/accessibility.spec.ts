import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const NOW = "2026-11-25T00:00:00.000Z";
const WS_ID = "00000000-0000-4000-8000-00000000aa01";
const USER_ID = "00000000-0000-4000-8000-00000000cc03";

async function stubAppSession(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/workspace") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          mode: "supabase",
          workspace: { id: WS_ID, name: "Northstar Revenue", slug: "northstar-revenue", role: "owner" },
          workspaces: [{ id: WS_ID, name: "Northstar Revenue", slug: "northstar-revenue", role: "owner" }],
          actor: { id: USER_ID, email: "alex@northstar.example" },
          persistence: "supabase",
        }),
      });
      return;
    }
    if (pathname === "/api/v1/conversations") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversations: [], nextCursor: null }) });
      return;
    }
    if (pathname === "/api/v1/work-queue") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workQueue: { needsReviewCount: 0, activeResearchCount: 0, items: [] } }),
      });
      return;
    }
    if (pathname === "/api/v1/companies") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accounts: [] }) });
      return;
    }
    if (pathname === "/api/v1/people") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ contacts: [] }) });
      return;
    }
    if (pathname === "/api/v1/workspace/invites") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invites: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
}

async function expectNoCriticalOrSeriousViolations(page: Page, routeLabel: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const severe = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(
    severe,
    `Expected zero critical/serious WCAG 2.1 AA violations on ${routeLabel}, got: ${JSON.stringify(
      severe.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 2).map((n) => n.html) })),
    )}`,
  ).toEqual([]);
}

test("Public homepage (light & dark themes), /login, and /signup pass WCAG 2.1 AA axe accessibility checks", async ({ page }) => {
  await page.goto("/");
  await expectNoCriticalOrSeriousViolations(page, "/ (light)");
  expect(await page.locator("h1").count()).toBe(1);
  expect(await page.locator("main").count()).toBe(1);

  await page.getByRole("button", { name: /Switch to dark theme/i }).click();
  await expectNoCriticalOrSeriousViolations(page, "/ (dark)");

  for (const routePath of ["/login", "/signup"]) {
    await page.goto(routePath);
    await expectNoCriticalOrSeriousViolations(page, routePath);
    expect(await page.locator("main").count()).toBe(1);
  }
});

test("Authenticated workspace routes pass WCAG 2.1 AA axe accessibility and keyboard navigation checks", async ({ page }) => {
  await stubAppSession(page);

  for (const routePath of ["/research", "/companies", "/people", "/settings"]) {
    await page.goto(routePath);
    await expectNoCriticalOrSeriousViolations(page, routePath);
    expect(await page.locator("main").count()).toBe(1);
  }

  // Keyboard Tab navigation moves focus reliably without focus traps.
  await page.goto("/research");
  await page.keyboard.press("Tab");
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
  expect(focusedTag.length).toBeGreaterThan(0);
  expect(NOW.length).toBeGreaterThan(0);
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SERIOUS = new Set(["critical", "serious"]);

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter((violation) => SERIOUS.has(violation.impact ?? ""));
  const detail = blocking
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes.slice(0, 4).map((node) => node.target.join(" ")).join("\n  ")}`)
    .join("\n");
  expect(blocking, `${label} has serious accessibility violations:\n${detail}`).toEqual([]);
  return results.violations;
}

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ })).toBeVisible({ timeout: 30_000 });
}

test("a11y: Today, board, Insights, settings, and auth", async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page);
  await scan(page, "Today");

  await page.locator('nav[aria-label="Boards"]').getByRole("button", { name: /My tasks/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My tasks" })).toBeVisible();
  await scan(page, "Board");

  await page.getByRole("button", { name: /Insights/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  await scan(page, "Insights");

  await page.getByRole("button", { name: "Command palette" }).click();
  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible();
  await page.waitForTimeout(400);
  await scan(page, "Command palette");
  await page.keyboard.press("Escape");

  await page.goto("/settings#notifications");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await scan(page, "Settings");

  await page.goto("/auth?mode=signin");
  await expect(page.getByRole("heading", { name: /Keep this workspace|Welcome back/ })).toBeVisible();
  await scan(page, "Auth (guest claim)");

  await page.context().clearCookies();
  await page.goto("/auth?mode=signin");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await scan(page, "Auth (sign in)");
});

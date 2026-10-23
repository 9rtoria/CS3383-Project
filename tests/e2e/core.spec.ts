import { expect, test, type Page } from "@playwright/test";

const TITLE_PREFIX = "E2E";

function uniqueTitle(label: string): string {
  return `${TITLE_PREFIX} ${label} ${Date.now().toString(36)}`;
}

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ })).toBeVisible({ timeout: 30_000 });
}

async function capture(page: Page, text: string) {
  await page.keyboard.press("c");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("What needs doing?")).toBeVisible();
  await dialog.getByLabel("What needs doing?").fill(text);
  await dialog.getByRole("button", { name: /Add task/ }).click();
  await expect(dialog).toBeHidden();
}

async function openBoard(page: Page) {
  await page.locator('nav[aria-label="Boards"]').getByRole("button", { name: /My tasks/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My tasks" })).toBeVisible();
  return page.getByRole("region", { name: "My tasks board" });
}

test("AC-009: a guest captures a first task in under 60 seconds without signup", async ({ page }) => {
  const started = Date.now();
  const title = uniqueTitle("first task");
  await openApp(page);
  await expect(page.getByRole("link", { name: /Save this workspace to an account/ })).toBeVisible();

  await capture(page, `${title} tomorrow 2pm !high #Work ~25m`);
  await expect(page.getByText("Task captured.")).toBeVisible();

  const board = await openBoard(page);
  await expect(board.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(60_000);

  const bootstrap = await page.evaluate(async () => {
    const response = await fetch("/api/bootstrap");
    return response.json() as Promise<{ user: { isGuest: boolean; email: string | null }; workspaces: unknown[] }>;
  });
  expect(bootstrap.user.isGuest).toBe(true);
  expect(bootstrap.user.email).toBeNull();
  expect(bootstrap.workspaces.length).toBeGreaterThan(0);
});

test("AC-001/AC-002: keyboard move, undo, persistence, and accessible announcement", async ({ page }) => {
  const title = uniqueTitle("keyboard move");
  await openApp(page);
  await capture(page, title);
  const board = await openBoard(page);
  const card = board.getByRole("button", { name: new RegExp(title) });
  await expect(card).toBeVisible();

  await card.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByText(`Moved ${title} to In progress.`)).toBeAttached();
  await expect(page.getByRole("region", { name: /^In progress/ }).getByRole("button", { name: new RegExp(title) })).toBeVisible();

  const toast = page.getByRole("status").filter({ hasText: "Moved to In progress" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("region", { name: /^To do/ }).getByRole("button", { name: new RegExp(title) })).toBeVisible();

  const movedCard = page.getByRole("region", { name: /^To do/ }).getByRole("button", { name: new RegExp(title) });
  await movedCard.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByRole("region", { name: /^In progress/ }).getByRole("button", { name: new RegExp(title) })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "My tasks" })).toBeVisible();
  await expect(page.getByRole("region", { name: /^In progress/ }).getByRole("button", { name: new RegExp(title) })).toBeVisible();
});

test("search is instant, scoped, and filterable", async ({ page }) => {
  const title = uniqueTitle("search needle");
  await openApp(page);
  await capture(page, `${title} #Research !urgent`);
  await page.keyboard.press("/");
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  const input = page.getByRole("textbox", { name: "Search tasks" });
  await input.fill(title);
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  await page.getByRole("group", { name: "Search filters" }).getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by priority" }).selectOption("urgent");
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  await input.fill("a needle that cannot exist in this workspace");
  await expect(page.getByRole("heading", { name: "No matching tasks" })).toBeVisible();
});

test("offline capture queues locally and syncs after reconnect", async ({ page, context }) => {
  const title = uniqueTitle("offline capture");
  await openApp(page);
  await context.setOffline(true);
  await capture(page, title);
  await expect(page.getByRole("status").filter({ hasText: "Saved on this device" })).toBeVisible();
  await expect(page.getByText(/You are offline/)).toBeVisible();
  await expect(page.getByText(/waiting to sync/)).toBeVisible();

  await context.setOffline(false);
  const retry = page.getByRole("button", { name: /Retry now|Sync now/ });
  if (await retry.isVisible().catch(() => false)) await retry.click();
  await expect(page.getByText(/waiting to sync/)).toBeHidden({ timeout: 20_000 });

  await openBoard(page);
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
});

test("read-only public share opens without a session", async ({ page, browser }) => {
  const title = uniqueTitle("shared task");
  await openApp(page);
  await capture(page, title);
  await openBoard(page);
  await page.getByRole("button", { name: "Board actions" }).click();
  const shareResponse = page.waitForResponse((response) => response.url().includes("/share") && response.request().method() === "POST");
  await page.getByRole("menuitem", { name: "Share read-only link" }).click();
  const response = await shareResponse;
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as { url: string | null };
  expect(payload.url).toMatch(/\/share\//);

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(payload.url!);
  await expect(publicPage.getByRole("heading", { level: 1, name: "My tasks" })).toBeVisible();
  await expect(publicPage.getByText(title)).toBeVisible();
  await expect(publicPage.getByText(/read-only/i).first()).toBeVisible();
  await publicContext.close();
});

test("settings persist capacity, digest, and quiet hours", async ({ page }) => {
  await openApp(page);
  await page.goto("/settings#notifications");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  const digest = page.getByRole("switch", { name: "Daily email digest" });
  const before = await digest.getAttribute("aria-checked");
  await digest.click();
  await expect(digest).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  await page.getByRole("combobox", { name: "Quiet hours start" }).selectOption("22");
  await page.getByRole("combobox", { name: "Quiet hours end" }).selectOption("7");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Quiet hours start" })).toHaveValue("22");
  await expect(page.getByRole("combobox", { name: "Quiet hours end" })).toHaveValue("7");
  const settings = await page.evaluate(async () => {
    const response = await fetch("/api/bootstrap");
    return response.json() as Promise<{ settings: { capacityMinutes: number; quietStart: number | null; quietEnd: number | null } }>;
  });
  expect(settings.settings.capacityMinutes).toBeGreaterThanOrEqual(15);
  expect(settings.settings.quietStart).toBe(22);
  expect(settings.settings.quietEnd).toBe(7);
});

import { expect, test, type Page } from "@playwright/test";

// Settings tests exercise direct API failures. A service worker would bypass
// Playwright's request interception in WebKit, so this file runs without it.
test.use({ serviceWorkers: "block" });

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up|早安|午安|晚安|還醒著/ })).toBeVisible({ timeout: 30_000 });
}

async function openSettings(page: Page, section = "appearance") {
  await openApp(page);
  await page.goto(`/settings#${section}`);
  await expect(page.getByRole("heading", { level: 1, name: /Settings|設定/ })).toBeVisible({ timeout: 30_000 });
}

async function saved(page: Page) {
  await expect(page.locator(".settings-save-state")).toHaveText(/Saved|已儲存/, { timeout: 10_000 });
}

test("appearance controls change the document and survive reload", async ({ page }) => {
  await openSettings(page, "appearance");
  await page.locator("#appearance .settings-theme-card").filter({ hasText: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#appearance .settings-theme-card").filter({ hasText: "System" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "system");

  await page.locator("#appearance .settings-swatch").filter({ hasText: "Ink" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "ink");
  await page.locator("#appearance .settings-choice").filter({ hasText: "Modern" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-display-font", "modern");
  const beforeReading = await page.locator("#appearance .settings-row .settings-copy span").first().evaluate((element) => getComputedStyle(element).fontSize);
  await page.getByRole("group", { name: "Reading text" }).getByRole("button", { name: "Large" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-reading-size", "large");
  const afterReading = await page.locator("#appearance .settings-row .settings-copy span").first().evaluate((element) => getComputedStyle(element).fontSize);
  expect(Number.parseFloat(afterReading)).toBeGreaterThan(Number.parseFloat(beforeReading));

  const beforeDensity = await page.locator("#appearance .settings-row").first().evaluate((element) => getComputedStyle(element).paddingTop);
  await page.getByRole("group", { name: "Density" }).getByRole("button", { name: "Compact" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  const afterDensity = await page.locator("#appearance .settings-row").first().evaluate((element) => getComputedStyle(element).paddingTop);
  expect(Number.parseFloat(afterDensity)).toBeLessThan(Number.parseFloat(beforeDensity));

  await page.getByRole("group", { name: "Motion" }).getByRole("button", { name: "Reduced motion" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await saved(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /Settings|設定/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "ink");
  await expect(page.locator("html")).toHaveAttribute("data-display-font", "modern");
  await expect(page.locator("html")).toHaveAttribute("data-reading-size", "large");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");

  await page.locator("#appearance").getByRole("button", { name: /Restore defaults/ }).click();
  await saved(page);
  await expect(page.locator("html")).toHaveAttribute("data-accent", "moss");
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "system");
});

test("system theme follows the OS while the preference stays System", async ({ page }) => {
  await openSettings(page, "appearance");
  await page.locator("#appearance .settings-theme-card").filter({ hasText: "System" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#appearance .settings-theme-card").filter({ hasText: "System" })).toHaveAttribute("aria-pressed", "true");
});

test("planning capacity and week start reach Today and Calendar", async ({ page }) => {
  await openSettings(page, "planning");
  const capacity = page.getByLabel("Capacity (minutes)").last();
  await capacity.fill("120");
  await saved(page);

  await openApp(page);
  await expect(page.getByText(/of 120 min/)).toBeVisible();

  await openSettings(page, "language");
  await page.getByRole("combobox", { name: "Week starts on" }).selectOption("0");
  await saved(page);
  await page.goto("/?view=calendar");
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(page.locator(".calendar-weekdays span").first()).toHaveText("Sun");
});

test("language switches core chrome, date formatting, and persists", async ({ page }) => {
  await openSettings(page, "language");
  await page.locator("#language select").first().selectOption("zh-TW");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(page.getByRole("heading", { level: 1, name: "設定" })).toBeVisible();
  await expect(page.getByRole("link", { name: "外觀" })).toBeVisible();
  await expect(page.getByText("語言與地區").first()).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "設定" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /早安|午安|晚安|還醒著/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "捕捉任務" })).toBeVisible();
});

test("rapid notification changes are queued and persisted", async ({ page }) => {
  await openSettings(page, "notifications");
  const inApp = page.getByRole("switch", { name: "In-app notifications" });
  const mentions = page.getByRole("switch", { name: "Mentions and assignments" });
  const email = page.getByRole("switch", { name: "Email reminders" });
  const before = await inApp.getAttribute("aria-checked");
  await inApp.click();
  await mentions.click();
  await email.click();
  await page.getByRole("combobox", { name: /Quiet hours start/ }).selectOption("22");
  await page.getByRole("combobox", { name: /Quiet hours end/ }).selectOption("7");
  await saved(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /Settings|設定/ })).toBeVisible();
  await expect(inApp).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  await expect(page.getByRole("combobox", { name: /Quiet hours start/ })).toHaveValue("22");
  await expect(page.getByRole("combobox", { name: /Quiet hours end/ })).toHaveValue("7");
  const settings = await page.evaluate(async () => {
    const response = await fetch("/api/bootstrap");
    return response.json() as Promise<{ settings: { notificationsJson: string } }>;
  });
  const prefs = JSON.parse(settings.settings.notificationsJson) as { inApp: boolean; mentions: boolean; email: boolean };
  expect(typeof prefs.inApp).toBe("boolean");
  expect(typeof prefs.mentions).toBe("boolean");
  expect(typeof prefs.email).toBe("boolean");
});

test("feature toggles remove Day Flow and voice without hiding text capture", async ({ page }) => {
  await openSettings(page, "features");
  await page.getByRole("switch", { name: "Day Flow" }).click();
  await page.getByRole("switch", { name: "Voice capture (experimental)" }).click();
  await saved(page);
  await openApp(page);
  await expect(page.locator(".day-flow")).toHaveCount(0);
  await page.keyboard.press("c");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("What needs doing?")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Speak a task/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Add task/ })).toBeVisible();
});

test("focus and capture defaults apply to the real screens", async ({ page }) => {
  await openSettings(page, "focus");
  await page.getByRole("combobox", { name: "Default focus length" }).selectOption("45");
  await page.getByRole("switch", { name: "Auto-start focus" }).click();
  await page.getByRole("switch", { name: "Close capture after adding" }).click();
  await saved(page);

  const title = `E2E focus default ${Date.now()}`;
  await openApp(page);
  await page.keyboard.press("c");
  const capture = page.getByRole("dialog");
  await capture.getByLabel("What needs doing?").fill(title);
  await capture.getByRole("button", { name: /Add task/ }).click();
  await expect(capture).toBeVisible();
  await expect(capture.getByLabel("What needs doing?")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(capture).toBeHidden();

  const card = page.locator("article.focus-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: new RegExp(`Start focus on ${title}`) }).click();
  const focus = page.getByRole("dialog");
  await expect(focus.getByText(/of 45m estimated/)).toBeVisible();
  await expect(focus.getByText("In focus")).toBeVisible({ timeout: 5_000 });
  await focus.getByRole("button", { name: /Leave focus/ }).click();
});

test("workday shading, plan buffer, block buffer, and start view reach Today", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("c");
  const capture = page.getByRole("dialog");
  await capture.getByLabel("What needs doing?").fill(`E2E buffer task ${Date.now()} ~30m`);
  await capture.getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByText("Task captured.")).toBeVisible();
  await openSettings(page, "planning");
  await page.getByRole("combobox", { name: "Workday Start" }).selectOption("10");
  await page.getByRole("combobox", { name: "Workday End" }).selectOption("16");
  await page.getByRole("combobox", { name: "Buffer between blocks" }).selectOption("10");
  await page.getByRole("combobox", { name: "Default view" }).selectOption("board");
  const planBuffer = page.getByRole("slider", { name: "Plan buffer" });
  await planBuffer.focus();
  await planBuffer.press("End");
  for (let index = 0; index < 4; index += 1) await planBuffer.press("ArrowLeft");
  await saved(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "My tasks" })).toBeVisible();
  await page.getByRole("button", { name: "Today" }).first().click();
  await expect(page.locator(".day-flow-outside")).toHaveCount(2);
  await page.getByRole("button", { name: /Smart Plan/ }).click();
  await expect(page.locator(".plan-changes").getByText(/breathing room/)).toBeVisible();
});

test("a failed settings save rolls the UI back", async ({ page }) => {
  await openSettings(page, "appearance");
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL_ERROR", message: "Could not save settings." }) });
    } else {
      await route.continue();
    }
  });
  await page.locator("#appearance .settings-swatch").filter({ hasText: "Ink" }).click();
  await expect(page.locator(".settings-save-state")).toHaveText("Could not save");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "moss");
});

test("settings search and mobile section picker are usable", async ({ page }) => {
  await openSettings(page, "appearance");
  const search = page.getByRole("textbox", { name: "Search settings" });
  await search.fill("sound");
  await search.press("Enter");
  await expect(page.locator("#sound")).toBeVisible();
  await expect(page.locator("#sound")).toHaveClass(/settings-section/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings#appearance");
  await expect(page.getByRole("heading", { level: 1, name: /Settings|設定/ })).toBeVisible();
  const picker = page.locator(".settings-mobile-section");
  await expect(picker).toBeVisible();
  await picker.selectOption("planning");
  await expect(page.locator("#planning")).toBeVisible();
  await expect(page.locator(".settings-nav .nav-section").first()).toBeHidden();
});

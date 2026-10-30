import { expect, test, type Page } from "@playwright/test";

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up|早安|午安|晚安|還醒著/ })).toBeVisible({ timeout: 30_000 });
}

async function capture(page: Page, title: string) {
  await page.keyboard.press("c");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("What needs doing?").fill(title);
  await dialog.getByRole("button", { name: /Add task/ }).click();
  await expect(dialog).toBeHidden();
}

async function workspaceId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const boot = await (await fetch("/api/bootstrap")).json() as { workspaces: { id: string }[] };
    return boot.workspaces[0]!.id;
  });
}

async function patchSettings(page: Page, patch: Record<string, unknown>) {
  const result = await page.evaluate(async (body) => {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, patch);
  expect(result.status).toBe(200);
}

async function calendarBlocks(page: Page, workspaceIdValue: string) {
  return page.evaluate(async (workspace) => {
    const today = (await (await fetch(`/api/today?workspaceId=${encodeURIComponent(workspace)}`)).json()) as { date: string };
    const month = today.date.slice(0, 7);
    const calendar = (await (await fetch(`/api/calendar?month=${month}&workspaceId=${encodeURIComponent(workspace)}`)).json()) as {
      blocksByDate?: Record<string, { taskId: string; minutes: number }[]>;
    };
    return Object.values(calendar.blocksByDate ?? {}).flat();
  }, workspaceIdValue);
}

test("Auto-plan previews options and applies a real schedule with undo", async ({ page, context }) => {
  await openApp(page);
  await capture(page, "Auto plan pricing tomorrow ~45m");
  await capture(page, "Auto plan copy tomorrow ~30m");
  await capture(page, "Auto plan notes tomorrow ~15m");
  const workspace = await workspaceId(page);
  await patchSettings(page, {
    workdayStart: 0,
    workdayEnd: 24,
    capacityMinutes: 600,
    autoPlanEnabled: true,
    autoPlanMode: "suggest",
    autoPlanWeeklyMinutes: 1200,
    autoPlanRestMinutes: 10,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ })).toBeVisible();
  await expect(page.locator(".auto-plan-card")).toBeVisible();
  await page.getByRole("button", { name: "Review plans" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Auto-plan" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Balanced/ })).toBeVisible();
  await dialog.getByRole("button", { name: /Apply this plan/ }).click();
  await expect(page.getByText(/Auto-plan applied/).first()).toBeVisible();
  await page.waitForTimeout(500);
  const blocks = await calendarBlocks(page, workspace);
  expect(blocks.length).toBeGreaterThan(0);
  const calendarPage = await context.newPage();
  await calendarPage.goto("/?view=calendar", { waitUntil: "domcontentloaded" });
  await expect(calendarPage.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(calendarPage.locator(".day-task.scheduled").first()).toBeVisible();
  await calendarPage.close();
  const toast = page.getByRole("status").filter({ hasText: "Auto-plan applied" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Previous plan restored.")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await calendarBlocks(page, workspace)).toHaveLength(0);
});

test("safe auto-apply schedules without an explicit apply", async ({ page }) => {
  await openApp(page);
  await capture(page, "Safe auto plan tomorrow ~30m");
  const workspace = await workspaceId(page);
  await patchSettings(page, {
    workdayStart: 0,
    workdayEnd: 24,
    capacityMinutes: 600,
    autoPlanEnabled: true,
    autoPlanMode: "safe",
    autoPlanWeeklyMinutes: 1200,
    autoPlanRestMinutes: 10,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Auto-plan applied/).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await calendarBlocks(page, workspace)).length).toBeGreaterThan(0);
});

test("a weekly limit refuses work even when the day has room", async ({ page }) => {
  await openApp(page);
  await capture(page, "Too much for the week tomorrow ~90m");
  const workspace = await workspaceId(page);
  await patchSettings(page, {
    workdayStart: 0,
    workdayEnd: 24,
    capacityMinutes: 600,
    autoPlanEnabled: true,
    autoPlanMode: "suggest",
    autoPlanWeeklyMinutes: 60,
  });
  const preview = await page.evaluate(async (workspaceIdValue) => {
    const response = await fetch("/api/auto-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "preview", workspaceId: workspaceIdValue, horizonDays: 7 }),
    });
    return response.json() as Promise<{ preview: { options: { id: string; blocks: unknown[]; unscheduled: { reason: string }[]; weeks: { over: boolean }[] }[] } }>;
  }, workspace);
  const balanced = preview.preview.options.find((option) => option.id === "balanced")!;
  expect(balanced.blocks).toHaveLength(0);
  expect(balanced.unscheduled.some((item) => item.reason.includes("Weekly"))).toBe(true);
});

test("settings expose Auto-plan limits and persist", async ({ page }) => {
  await openApp(page);
  await page.goto("/settings#auto-plan", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: /Settings|設定/ })).toBeVisible();
  await expect(page.locator("#auto-plan")).toBeVisible();
  await page.getByRole("combobox", { name: "Automation level" }).selectOption("full");
  await page.getByRole("combobox", { name: "Rest between tasks" }).selectOption("15");
  await expect(page.locator(".settings-save-state")).toHaveText(/Saved|已儲存/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("combobox", { name: "Automation level" })).toHaveValue("full");
  await expect(page.getByRole("combobox", { name: "Rest between tasks" })).toHaveValue("15");
});

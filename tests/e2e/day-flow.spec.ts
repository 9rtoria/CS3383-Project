import { expect, test, type Page } from "@playwright/test";

const TITLE_PREFIX = "E2EFLOW";

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

async function guestBoard(page: Page): Promise<{ workspaceId: string; boardId: string }> {
  return page.evaluate(async () => {
    const response = await fetch("/api/bootstrap");
    const boot = await response.json() as { workspaces: { id: string; boards: { id: string }[] }[] };
    return { workspaceId: boot.workspaces[0]!.id, boardId: boot.workspaces[0]!.boards[0]!.id };
  });
}

test("voice capture fills the composer and keeps the text fallback", async ({ page }) => {
  await page.addInitScript(() => {
    const FakeRecognition = function (this: any) {
      this.lang = "en-US";
      this.continuous = false;
      this.interimResults = false;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
    } as any;
    FakeRecognition.prototype.start = function (this: any) {
      window.setTimeout(() => {
        const result = Object.assign([{ transcript: "Draft voice note tomorrow ~20m" }], { isFinal: true });
        const results = Object.assign([result], { length: 1 });
        this.onresult?.({ resultIndex: 0, results });
      }, 30);
      window.setTimeout(() => this.onend?.(), 60);
    };
    FakeRecognition.prototype.stop = function (this: any) {
      this.onend?.();
    };
    FakeRecognition.prototype.abort = function (this: any) {
      this.onend?.();
    };
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: FakeRecognition });
  });

  await openApp(page);
  await page.keyboard.press("c");
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("What needs doing?");
  await expect(input).toBeEditable();
  await dialog.getByRole("button", { name: "Speak a task" }).click();
  await expect(input).toHaveValue(/Draft voice note tomorrow/);
  await expect(dialog.getByRole("button", { name: "Stop voice capture" })).toBeHidden();
  await dialog.getByRole("button", { name: /Add task/ }).click();
  await expect(page.getByText("Task captured.")).toBeVisible();

  const mute = page.getByRole("button", { name: "Mute interface sounds" });
  await expect(mute).toBeVisible();
  await mute.click();
  await expect(page.getByRole("button", { name: "Enable interface sounds" })).toBeVisible();
  await page.getByRole("button", { name: "Enable interface sounds" }).click();
  await expect(page.getByRole("button", { name: "Mute interface sounds" })).toBeVisible();
});

test("Smart Plan previews, applies, and undoes a local plan", async ({ page }) => {
  await openApp(page);
  await capture(page, `${uniqueTitle("plan one")} ~25m`);
  await capture(page, `${uniqueTitle("plan two")} ~45m`);

  await page.getByRole("button", { name: /Smart Plan/ }).click();
  const plan = page.getByRole("dialog");
  await expect(plan.getByRole("heading", { name: "Smart Plan" })).toBeVisible();
  await expect(plan.getByText(/Preview first/)).toBeVisible();
  await expect(plan.getByRole("button", { name: /Apply this plan/ })).toBeVisible();
  await plan.getByRole("button", { name: /Apply this plan/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Smart Plan applied" })).toBeVisible();
  await page.getByRole("status").filter({ hasText: "Smart Plan applied" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Previous plan restored.")).toBeVisible();
});

test("Focus mode logs tracked time and completes the task", async ({ page }) => {
  const title = uniqueTitle("focus");
  await openApp(page);
  await capture(page, `${title} ~25m`);
  const { workspaceId, boardId } = await guestBoard(page);

  await page.getByRole("button", { name: new RegExp(`Start focus on ${title}`) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
  await dialog.getByRole("button", { name: /Begin focus/ }).click();
  await page.waitForTimeout(1_200);
  await dialog.getByRole("button", { name: /Complete task/ }).click();
  await expect(dialog.getByRole("heading", { name: /enough/ })).toBeVisible();
  await dialog.getByRole("button", { name: /Return to Today/ }).click();

  const board = await page.evaluate(async ({ id, workspace }) => {
    const response = await fetch(`/api/boards/${id}`, { headers: { "x-workspace-id": workspace } });
    return response.json() as Promise<{ tasks: { title: string; actualMinutes: number | null; completedAt: string | null }[] }>;
  }, { id: boardId, workspace: workspaceId });
  const task = board.tasks.find((entry) => entry.title === title);
  expect(task).toBeTruthy();
  expect(task!.completedAt).toBeTruthy();
  expect(task!.actualMinutes ?? 0).toBeGreaterThanOrEqual(1);
});

test("a Day Flow block can be dragged to Later", async ({ page }) => {
  const title = uniqueTitle("later");
  await openApp(page);
  await capture(page, `${title} ~30m`);
  const block = page.locator(`.day-flow-block[aria-label^="${title}"]`);
  const later = page.locator(".day-flow-later");
  await expect(block).toBeVisible();
  // Playwright's native dragTo does not always preserve a DataTransfer in
  // Chromium headless; dispatch the same HTML5 events the UI listens for.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await block.dispatchEvent("dragstart", { dataTransfer });
  await later.dispatchEvent("dragover", { dataTransfer });
  await later.dispatchEvent("drop", { dataTransfer });
  await expect(page.getByText("Moved to Later for today.")).toBeVisible();
  await expect(block).toHaveCount(0);
});

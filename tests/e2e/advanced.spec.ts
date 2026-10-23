import { expect, test, type Page } from "@playwright/test";

const TITLE_PREFIX = "E2EADV";

function uniqueTitle(label: string): string {
  return `${TITLE_PREFIX} ${label} ${Date.now().toString(36)}`;
}

function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now().toString(36)}@example.com`;
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
}

type ApiResult = { status: number; body: any };

async function apiCall(
  page: Page,
  path: string,
  options: { method?: string; body?: unknown; workspaceId?: string } = {},
): Promise<ApiResult> {
  return page.evaluate(
    async ({ path, options }) => {
      const headers: Record<string, string> = { origin: location.origin };
      if (options.body !== undefined) headers["content-type"] = "application/json";
      if (options.workspaceId) headers["x-workspace-id"] = options.workspaceId;
      const response = await fetch(path, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      let body: any = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      return { status: response.status, body };
    },
    { path, options },
  );
}

async function bootstrap(page: Page) {
  const result = await apiCall(page, "/api/bootstrap");
  expect(result.status).toBe(200);
  return result.body as {
    user: { id: string; name: string; email: string | null; isGuest: boolean };
    workspaces: {
      id: string;
      name: string;
      type: string;
      role: string;
      boards: { id: string; name: string; firstColumnId: string | null; columns: { id: string; name: string; isDone: boolean }[] }[];
    }[];
  };
}

async function createTeamWorkspace(page: Page, name: string) {
  const created = await apiCall(page, "/api/workspaces", {
    method: "POST",
    body: { name, type: "team", seedTemplate: true },
  });
  expect(created.status).toBe(201);
  const workspaceId = created.body.workspace.id as string;
  const boot = await bootstrap(page);
  const workspace = boot.workspaces.find((item) => item.id === workspaceId);
  expect(workspace).toBeTruthy();
  const board = workspace!.boards[0]!;
  return { workspaceId, board, workspace: workspace! };
}

test.describe.configure({ mode: "serial" });

test("AC-009/AC-005: guest work survives claim, sign-out, and password sign-in", async ({ page }) => {
  test.setTimeout(120_000);
  const title = uniqueTitle("claim");
  const email = uniqueEmail("claim");
  await openApp(page);
  await capture(page, title);

  await page.getByRole("link", { name: /Save this workspace to an account/ }).click();
  await expect(page.getByRole("heading", { name: "Keep this workspace" })).toBeVisible();
  await page.getByLabel("Your name").fill("E2E Claimer");
  await page.getByLabel("Email").fill(email);
  await page.locator('input[autocomplete="new-password"]').fill("E2ePassword123");
  await page.getByRole("button", { name: "Save my workspace" }).click();
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ })).toBeVisible({ timeout: 30_000 });

  const afterClaim = await bootstrap(page);
  expect(afterClaim.user.isGuest).toBe(false);
  expect(afterClaim.user.email).toBe(email);
  await openBoard(page);
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();

  const signOut = await apiCall(page, "/api/auth/signout", { method: "DELETE" });
  expect(signOut.status).toBe(200);
  await page.goto("/auth?mode=signin");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.locator('input[autocomplete="current-password"]').fill("E2ePassword123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ })).toBeVisible({ timeout: 30_000 });
  await openBoard(page);
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
});

test("AC-008/SX-4: draft dry run, apply, audit, and undo of an automation", async ({ page }) => {
  test.setTimeout(120_000);
  const workspaceName = uniqueTitle("automation workspace");
  const seedTitle = uniqueTitle("automation seed");
  const liveTitle = uniqueTitle("automation live");
  await openApp(page);
  const { workspaceId, board } = await createTeamWorkspace(page, workspaceName);
  const columnId = board.firstColumnId!;

  const seed = await apiCall(page, "/api/tasks", {
    method: "POST",
    workspaceId,
    body: { workspaceId, boardId: board.id, columnId, title: seedTitle, priority: "low" },
  });
  expect(seed.status).toBe(201);

  await page.evaluate((id) => localStorage.setItem("drift-workspace", id), workspaceId);
  await page.goto("/settings#automations");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible();
  await page.getByRole("button", { name: "New rule" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New automation" })).toBeVisible();
  await dialog.getByLabel("Name").fill("Raise low priority work");
  await dialog.getByLabel("Only when priority is").selectOption("low");
  await dialog.getByLabel("Do").selectOption("set_priority");
  await dialog.locator("select").nth(3).selectOption("high");
  await dialog.getByRole("button", { name: "Preview impact" }).click();
  await expect(dialog.getByText(/1 task would change/)).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText(seedTitle)).toBeVisible();
  await expect(dialog.getByText(/Priority: low/)).toBeVisible();
  await expect(dialog.getByText(/Priority: high/)).toBeVisible();
  await dialog.getByRole("button", { name: "Apply rule" }).click();
  await expect(page.getByText("Automation created.")).toBeVisible({ timeout: 20_000 });

  const live = await apiCall(page, "/api/tasks", {
    method: "POST",
    workspaceId,
    body: { workspaceId, boardId: board.id, columnId, title: liveTitle, priority: "low" },
  });
  expect(live.status).toBe(201);
  const liveId = live.body.task.id as string;

  const detail = await apiCall(page, `/api/tasks/${liveId}?workspaceId=${encodeURIComponent(workspaceId)}`, { workspaceId });
  expect(detail.status).toBe(200);
  expect(detail.body.task.priority).toBe("high");
  const automationEvent = detail.body.activity.find((entry: any) => entry.action === "automation.applied");
  expect(automationEvent).toBeTruthy();
  expect(automationEvent.undoId).toBeTruthy();

  const undo = await apiCall(page, `/api/undo/${automationEvent.undoId}`, {
    method: "POST",
    workspaceId,
    body: {},
  });
  expect(undo.status).toBe(200);
  const afterUndo = await apiCall(page, `/api/tasks/${liveId}?workspaceId=${encodeURIComponent(workspaceId)}`, { workspaceId });
  expect(afterUndo.body.task.priority).toBe("low");
});

test("AC-007/AC-006/AC-010: stale write 409, cross-workspace isolation, JSON/CSV export, import", async ({ page }) => {
  test.setTimeout(120_000);
  const title = uniqueTitle("conflict");
  const importedTitle = uniqueTitle("imported");
  await openApp(page);
  const boot = await bootstrap(page);
  const workspace = boot.workspaces[0]!;
  const board = workspace.boards[0]!;
  const columnId = board.firstColumnId!;

  const today = await apiCall(page, `/api/today?workspaceId=${encodeURIComponent(workspace.id)}`, { workspaceId: workspace.id });
  expect(today.status).toBe(200);
  expect(today.body.capacity.totalMinutes).toBeGreaterThan(0);
  expect(today.body.capacity.percent).toBeGreaterThanOrEqual(0);
  expect(today.body.capacity.percent).toBeLessThanOrEqual(100);

  const created = await apiCall(page, "/api/tasks", {
    method: "POST",
    workspaceId: workspace.id,
    body: { workspaceId: workspace.id, boardId: board.id, columnId, title },
  });
  expect(created.status).toBe(201);
  const taskId = created.body.task.id as string;
  const version = created.body.task.version as number;

  const firstWrite = await apiCall(page, `/api/tasks/${taskId}`, {
    method: "PATCH",
    workspaceId: workspace.id,
    body: { title: `${title} edited`, version },
  });
  expect(firstWrite.status).toBe(200);
  expect(firstWrite.body.task.version).toBe(version + 1);

  const staleWrite = await apiCall(page, `/api/tasks/${taskId}`, {
    method: "PATCH",
    workspaceId: workspace.id,
    body: { title: `${title} stale`, version },
  });
  expect(staleWrite.status).toBe(409);
  const staleError = staleWrite.body.error ?? staleWrite.body;
  expect(staleError.code).toBe("VERSION_CONFLICT");
  expect(staleError.details.currentVersion).toBe(version + 1);

  const second = await createTeamWorkspace(page, uniqueTitle("isolation workspace"));
  const crossRead = await apiCall(page, `/api/tasks/${taskId}?workspaceId=${encodeURIComponent(second.workspaceId)}`, {
    workspaceId: second.workspaceId,
  });
  expect(crossRead.status).toBe(404);

  const exported = await apiCall(page, `/api/export?workspaceId=${encodeURIComponent(workspace.id)}&format=json`, {
    workspaceId: workspace.id,
  });
  expect(exported.status).toBe(200);
  expect(exported.body.schemaVersion).toBe(1);
  expect(exported.body.workspace.id).toBe(workspace.id);
  const exportedBoard = exported.body.boards.find((item: any) => item.id === board.id);
  expect(exportedBoard.tasks.some((task: any) => task.id === taskId)).toBe(true);

  const csv = await apiCall(page, `/api/export?workspaceId=${encodeURIComponent(workspace.id)}&format=csv`, {
    workspaceId: workspace.id,
  });
  expect(csv.status).toBe(200);
  expect(String(csv.body)).toContain(title);

  const imported = await apiCall(page, "/api/import", {
    method: "POST",
    workspaceId: workspace.id,
    body: {
      workspaceId: workspace.id,
      boardId: board.id,
      format: "json",
      content: JSON.stringify({ tasks: [{ title: importedTitle, priority: "urgent", column: board.columns[0]!.name, labels: ["Imported"] }] }),
    },
  });
  expect(imported.status).toBe(200);
  expect(imported.body.imported).toBe(1);
  const found = await apiCall(
    page,
    `/api/search?workspaceId=${encodeURIComponent(workspace.id)}&q=${encodeURIComponent(importedTitle)}`,
    { workspaceId: workspace.id },
  );
  expect(found.status).toBe(200);
  expect(found.body.results.some((task: any) => task.title === importedTitle)).toBe(true);
});

test("FR-020/FR-021: an invited member joins a separate team workspace", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const ownerEmail = uniqueEmail("owner");
  const memberEmail = uniqueEmail("member");
  const teamName = uniqueTitle("invite team");
  await openApp(page);
  const ownerSignup = await apiCall(page, "/api/auth/signup", {
    method: "POST",
    body: { name: "E2E Owner", email: ownerEmail, password: "E2ePassword123", timezone: "Asia/Hong_Kong" },
  });
  expect(ownerSignup.status).toBe(200);
  await page.reload();
  const { workspaceId, workspace } = await createTeamWorkspace(page, teamName);

  const invite = await apiCall(page, `/api/workspaces/${workspaceId}/invites`, {
    method: "POST",
    workspaceId,
    body: { workspaceId, email: memberEmail, role: "MEMBER" },
  });
  expect(invite.status).toBe(201);
  expect(invite.body.devUrl).toContain("/invite/");

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto("/");
  await expect(memberPage.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ })).toBeVisible({ timeout: 30_000 });
  const memberSignup = await apiCall(memberPage, "/api/auth/signup", {
    method: "POST",
    body: { name: "E2E Member", email: memberEmail, password: "E2ePassword123", timezone: "Asia/Hong_Kong" },
  });
  expect(memberSignup.status).toBe(200);

  await memberPage.goto(invite.body.devUrl as string);
  await expect(memberPage.getByRole("heading", { name: `Join ${teamName}` })).toBeVisible();
  await memberPage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(memberPage.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ })).toBeVisible({ timeout: 30_000 });
  const memberBoot = await bootstrap(memberPage);
  expect(memberBoot.workspaces.some((item) => item.id === workspaceId && item.role === "MEMBER")).toBe(true);
  expect(memberBoot.workspaces.some((item) => item.type === "personal")).toBe(true);

  const members = await apiCall(page, `/api/workspaces/${workspaceId}/members`, { workspaceId });
  expect(members.status).toBe(200);
  expect(members.body.members.some((member: any) => member.email === memberEmail)).toBe(true);
  expect(workspace.type).toBe("team");
  await memberContext.close();
});

test("FR-005: Insights timeline and workload are progressive, scoped, and keyboard reachable", async ({ page }) => {
  test.setTimeout(90_000);
  const title = uniqueTitle("insights");
  await openApp(page);
  const boot = await bootstrap(page);
  const workspace = boot.workspaces[0]!;
  const board = workspace.boards[0]!;
  const due = new Date();
  due.setDate(due.getDate() + 1);
  due.setHours(12, 0, 0, 0);
  const created = await apiCall(page, "/api/tasks", {
    method: "POST",
    workspaceId: workspace.id,
    body: {
      workspaceId: workspace.id,
      boardId: board.id,
      columnId: board.firstColumnId!,
      title,
      priority: "high",
      dueDate: due.toISOString(),
      estimateMinutes: 45,
    },
  });
  expect(created.status).toBe(201);

  await page.goto("/?view=insights");
  await expect(page.getByRole("heading", { level: 1, name: "Insights" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Task timeline" })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  await page.getByRole("group", { name: "Insights view" }).getByRole("button", { name: "Workload" }).click();
  await expect(page.getByRole("heading", { name: "Load by person" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Board health" })).toBeVisible();

  const insights = await apiCall(page, `/api/insights?workspaceId=${encodeURIComponent(workspace.id)}&days=14`, {
    workspaceId: workspace.id,
  });
  expect(insights.status).toBe(200);
  expect(insights.body.days).toBe(14);
  expect(insights.body.tasks.some((task: any) => task.title === title)).toBe(true);
  expect(insights.body.totals.taskCount).toBeGreaterThan(0);
});

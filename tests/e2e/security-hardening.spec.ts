import { expect, test, type Page } from "@playwright/test";

async function openApp(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ })).toBeVisible({ timeout: 30_000 });
}

async function apiCall(
  page: Page,
  path: string,
  options: { method?: string; body?: unknown; workspaceId?: string } = {},
): Promise<{ status: number; body: any }> {
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
    workspaces: {
      id: string;
      type: string;
      role: string;
      boards: { id: string; name: string; columns: { id: string }[] }[];
    }[];
  };
}

function uniqueEmail(label: string) {
  return `e2e-${label}-${Date.now().toString(36)}@example.com`;
}

test("magic links are bound to the requesting browser", async ({ browser }) => {
  const requester = await browser.newContext();
  const other = await browser.newContext();
  const page = await requester.newPage();
  await openApp(page);

  const email = uniqueEmail("magic");
  const result = (await page.evaluate(async (address) => {
    const response = await fetch("/api/auth/magic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: address, next: "/" }),
    });
    return { status: response.status, body: (await response.json()) as { devUrl?: string } };
  }, email)) as { status: number; body: { devUrl?: string } };

  expect(result.status).toBe(200);
  expect(result.body.devUrl).toContain("/api/auth/magic/verify");
  const devUrl = result.body.devUrl!;

  const foreign = await other.request.get(devUrl);
  expect(foreign.status()).toBeGreaterThanOrEqual(400);

  await page.goto(devUrl);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ })).toBeVisible({ timeout: 30_000 });

  await requester.close();
  await other.close();
});

test("API tokens cannot read another workspace or user-level routes", async ({ page }) => {
  await openApp(page);

  const workspaceId = await page.evaluate(async () => {
    const boot = (await (await fetch("/api/bootstrap")).json()) as { workspaces: { id: string }[] };
    const workspace = boot.workspaces[0]!;
    const response = await fetch("/api/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", "x-workspace-id": workspace.id },
      body: JSON.stringify({ workspaceId: workspace.id, name: "scope regression test" }),
    });
    if (!response.ok) throw new Error(await response.text());
    const token = (await response.json()) as { token: string };
    (window as unknown as { __scopeToken?: string }).__scopeToken = token.token;
    return workspace.id;
  });

  const token = await page.evaluate(() => (window as unknown as { __scopeToken?: string }).__scopeToken ?? "");
  expect(token).toMatch(/^drift_pat_/);

  const userLevel = await page.request.get("/api/bootstrap", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(userLevel.status()).toBe(403);

  const scoped = await page.request.get(`/api/today?workspaceId=${encodeURIComponent(workspaceId)}`, {
    headers: { Authorization: `Bearer ${token}`, "x-workspace-id": workspaceId },
  });
  expect(scoped.status()).toBe(200);
});

test("private-board task writes are hidden from workspace members", async ({ browser }) => {
  test.setTimeout(150_000);
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const member = await memberContext.newPage();
  await openApp(owner);
  await openApp(member);

  const ownerEmail = uniqueEmail("private-owner");
  const memberEmail = uniqueEmail("private-member");
  expect((await apiCall(owner, "/api/auth/signup", {
    method: "POST",
    body: { name: "Private Owner", email: ownerEmail, password: "E2ePassword123", timezone: "Asia/Hong_Kong" },
  })).status).toBe(200);
  expect((await apiCall(member, "/api/auth/signup", {
    method: "POST",
    body: { name: "Private Member", email: memberEmail, password: "E2ePassword123", timezone: "Asia/Hong_Kong" },
  })).status).toBe(200);

  const created = await apiCall(owner, "/api/workspaces", {
    method: "POST",
    body: { name: `Private board team ${Date.now()}`, type: "team", seedTemplate: true },
  });
  expect(created.status).toBe(201);
  const workspaceId = created.body.workspace.id as string;

  const invite = await apiCall(owner, `/api/workspaces/${workspaceId}/invites`, {
    method: "POST",
    workspaceId,
    body: { workspaceId, email: memberEmail, role: "MEMBER" },
  });
  expect(invite.status).toBe(201);
  const invitePath = new URL(invite.body.devUrl as string).pathname;
  const inviteToken = decodeURIComponent(invitePath.split("/invite/")[1]!);
  expect((await apiCall(member, `/api/invites/${encodeURIComponent(inviteToken)}`, {
    method: "POST",
    body: {},
  })).status).toBe(200);

  const boardResult = await apiCall(owner, "/api/boards", {
    method: "POST",
    workspaceId,
    body: { workspaceId, name: `Private board ${Date.now()}`, template: "blank", visibility: "private" },
  });
  expect(boardResult.status).toBe(201);
  const boardId = boardResult.body.board.id as string;
  const ownerBoot = await bootstrap(owner);
  const privateBoard = ownerBoot.workspaces.find((workspace) => workspace.id === workspaceId)!.boards.find((board) => board.id === boardId)!;
  const columnId = privateBoard.columns[0]!.id;

  const taskResult = await apiCall(owner, "/api/tasks", {
    method: "POST",
    workspaceId,
    body: { workspaceId, boardId, columnId, title: "Private task", estimateMinutes: 30 },
  });
  expect(taskResult.status).toBe(201);
  const taskId = taskResult.body.task.id as string;
  const version = taskResult.body.task.version as number;

  const update = await apiCall(member, `/api/tasks/${taskId}`, {
    method: "PATCH",
    workspaceId,
    body: { title: "Leaked update", version },
  });
  expect(update.status).toBe(404);

  const comment = await apiCall(member, `/api/tasks/${taskId}/comments`, {
    method: "POST",
    workspaceId,
    body: { body: "Leaked comment" },
  });
  expect(comment.status).toBe(404);

  const boardRead = await apiCall(member, `/api/boards/${boardId}`, { workspaceId });
  expect(boardRead.status).toBe(404);

  await ownerContext.close();
  await memberContext.close();
});

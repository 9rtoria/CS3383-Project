import { expect, test } from "@playwright/test";

test("Today counts every chosen task when the day is over capacity", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ })).toBeVisible({ timeout: 30_000 });

  const result = await page.evaluate(async () => {
    const boot = await (await fetch("/api/bootstrap")).json() as {
      workspaces: { id: string; boards: { id: string; columns: { id: string }[] }[] }[];
    };
    const workspace = boot.workspaces[0]!;
    const board = workspace.boards[0]!;
    const column = board.columns[0]!;
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capacityMinutes: 120, autoPlanEnabled: false }),
    });
    const created = await Promise.all(["Capacity A", "Capacity B"].map(async (title) => {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify({
          workspaceId: workspace.id,
          boardId: board.id,
          columnId: column.id,
          title,
          estimateMinutes: 120,
        }),
      });
      return (await response.json()) as { task: { id: string } };
    }));
    for (const item of created) {
      const response = await fetch("/api/today", {
        method: "POST",
        headers: { "content-type": "application/json", "x-workspace-id": workspace.id },
        body: JSON.stringify({ action: "accept", workspaceId: workspace.id, taskId: item.task.id }),
      });
      if (!response.ok) throw new Error(await response.text());
    }
    return (await (await fetch(`/api/today?workspaceId=${workspace.id}`)).json()) as {
      capacity: { selectedMinutes: number; overbooked: boolean };
      suggestions: { accepted: boolean }[];
    };
  });

  expect(result.suggestions.filter((task) => task.accepted)).toHaveLength(2);
  expect(result.capacity.selectedMinutes).toBe(240);
  expect(result.capacity.overbooked).toBe(true);
});

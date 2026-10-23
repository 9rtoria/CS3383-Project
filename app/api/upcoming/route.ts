import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace } from "@/lib/authz";
import { canReadBoard } from "@/lib/rbac";
import { addDaysToDateString, dateStringInTimeZone, todayInTimeZone } from "@/lib/time";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
    const url = new URL(request.url);
    const days = Math.max(1, Math.min(60, Number(url.searchParams.get("days") ?? 14)));
    const today = todayInTimeZone(viewer.user.timezone);
    const end = addDaysToDateString(today, days);
    const tasks = await prisma.task.findMany({
      where: { workspaceId, completedAt: null, deletedAt: null, archivedAt: null, dueDate: { not: null } },
      include: {
        labels: { include: { label: true } },
        board: { select: { id: true, name: true, visibility: true, createdById: true } },
        column: { select: { id: true, name: true, isDone: true } },
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 2000,
    });
    const visible = tasks.filter(
      (task) => canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id) && dateStringInTimeZone(new Date(task.dueDate!), viewer.user.timezone) <= end,
    );
    const grouped: Record<string, any[]> = {};
    for (const task of visible) {
      const date = dateStringInTimeZone(new Date(task.dueDate!), viewer.user.timezone);
      if (date < today) continue;
      (grouped[date] ??= []).push({
        id: task.id,
        title: task.title,
        priority: task.priority,
        dueDate: task.dueDate,
        dueAllDay: task.dueAllDay,
        estimateMinutes: task.estimateMinutes,
        focusDate: task.focusDate,
        version: task.version,
        labels: task.labels.map((entry) => entry.label),
        board: task.board,
        column: task.column,
        assignee: task.assignee,
      });
    }
    return ok({ today, end, grouped, count: visible.length, days });
  });
}

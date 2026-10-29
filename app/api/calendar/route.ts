import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace } from "@/lib/authz";
import { canReadBoard } from "@/lib/rbac";
import { endOfLocalDayUtc, startOfLocalDayUtc, todayInTimeZone } from "@/lib/time";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
    const url = new URL(request.url);
    const monthParam = url.searchParams.get("month");
    const today = todayInTimeZone(viewer.user.timezone);
    const [year, month] = monthParam
      ? monthParam.split("-").map(Number)
      : [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    if (!year || !month || month < 1 || month > 12) throw new ApiError("VALIDATION_ERROR", "Month must be YYYY-MM.");
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const start = startOfLocalDayUtc(`${prefix}-01`, viewer.user.timezone);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const end = endOfLocalDayUtc(`${prefix}-${String(last).padStart(2, "0")}`, viewer.user.timezone);
    const [tasks, planBlocks] = await Promise.all([
      prisma.task.findMany({
        where: { workspaceId, deletedAt: null, archivedAt: null, dueDate: { gte: start, lte: end } },
        include: {
          labels: { include: { label: true } },
          board: { select: { id: true, name: true, visibility: true, createdById: true } },
          column: { select: { id: true, name: true, isDone: true } },
          assignee: { select: { id: true, name: true } },
        },
        orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
        take: 1000,
      }),
      prisma.planBlock.findMany({
        where: {
          userId: viewer.user.id,
          workspaceId,
          date: { gte: `${prefix}-01`, lte: `${prefix}-${String(last).padStart(2, "0")}` },
          task: { completedAt: null, archivedAt: null, deletedAt: null },
        },
        include: { task: { select: { id: true, title: true, priority: true, dueDate: true, dueAllDay: true, estimateMinutes: true, focusDate: true } } },
        orderBy: [{ date: "asc" }, { startMinute: "asc" }],
      }),
    ]);
    const visible = tasks.filter((task) => canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id));
    const byDate: Record<string, any[]> = {};
    const blocksByDate: Record<string, any[]> = {};
    for (const block of planBlocks) {
      (blocksByDate[block.date] ??= []).push({
        id: block.id,
        userId: block.userId,
        workspaceId: block.workspaceId,
        taskId: block.taskId,
        date: block.date,
        startMinute: block.startMinute,
        minutes: block.minutes,
        source: block.source,
        locked: block.locked,
        title: block.task.title,
        priority: block.task.priority,
        task: block.task,
      });
    }
    for (const task of visible) {
      const date = task.dueDate!.toISOString();
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: viewer.user.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(task.dueDate!);
      (byDate[key] ??= []).push({
        id: task.id,
        title: task.title,
        priority: task.priority,
        dueDate: task.dueDate,
        dueAllDay: task.dueAllDay,
        estimateMinutes: task.estimateMinutes,
        actualMinutes: task.actualMinutes,
        completedAt: task.completedAt,
        focusDate: task.focusDate,
        version: task.version,
        labels: task.labels.map((entry) => entry.label),
        board: task.board,
        column: task.column,
        assignee: task.assignee,
        iso: date,
      });
    }
    const total = visible.length;
    return ok({ month: prefix, byDate, blocksByDate, total, start: start.toISOString(), end: end.toISOString() });
  });
}

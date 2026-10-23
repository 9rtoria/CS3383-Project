import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/authz";
import { addDaysToDateString, dateStringInTimeZone, todayInTimeZone } from "@/lib/time";

/**
 * Read model for the Timeline and Workload views (FR-005).
 *
 * It deliberately returns only fields needed for planning and never includes
 * descriptions, comments, or attachment metadata. Board visibility follows the
 * same rules as the board list; a private board never leaks into another
 * member's workload.
 */
export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const requestedDays = Number(url.searchParams.get("days") ?? 30);
    const days = [14, 30, 60].includes(requestedDays) ? requestedDays : 30;
    const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
    const boards = await prisma.board.findMany({
      where: {
        workspaceId: access.workspace.id,
        deletedAt: null,
        archivedAt: null,
        OR: [
          { visibility: "workspace" },
          ...(access.role === "OWNER" || access.role === "ADMIN"
            ? [{ visibility: "private" }]
            : [{ visibility: "private", createdById: viewer.user.id }]),
        ],
      },
      select: { id: true, name: true, visibility: true },
      orderBy: { updatedAt: "desc" },
    });
    const boardIds = boards.map((board) => board.id);
    const memberships = await prisma.membership.findMany({
      where: { workspaceId: access.workspace.id },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { joinedAt: "asc" },
    });
    const tasks = boardIds.length
      ? await prisma.task.findMany({
          where: { workspaceId: access.workspace.id, boardId: { in: boardIds }, deletedAt: null, archivedAt: null },
          select: {
            id: true,
            title: true,
            boardId: true,
            columnId: true,
            priority: true,
            startDate: true,
            dueDate: true,
            dueAllDay: true,
            estimateMinutes: true,
            completedAt: true,
            assigneeId: true,
            board: { select: { id: true, name: true } },
            column: { select: { id: true, name: true, isDone: true } },
          },
          orderBy: [{ dueDate: "asc" }, { position: "asc" }],
          take: 2000,
        })
      : [];
    const today = todayInTimeZone(viewer.user.timezone);
    const weekEnd = addDaysToDateString(today, 7);
    const windowEnd = addDaysToDateString(today, days);
    const completedSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const byBoard = boards.map((board) => {
      const boardTasks = tasks.filter((task) => task.boardId === board.id);
      return {
        id: board.id,
        name: board.name,
        visibility: board.visibility,
        open: boardTasks.filter((task) => !task.completedAt).length,
        done: boardTasks.filter((task) => task.completedAt).length,
        overdue: boardTasks.filter(
          (task) => !task.completedAt && task.dueDate && dateStringInTimeZone(new Date(task.dueDate), viewer.user.timezone) < today,
        ).length,
        estimateMinutes: boardTasks.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0),
      };
    });

    const byMember = [
      ...memberships.map((membership) => ({
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        avatarUrl: membership.user.avatarUrl,
        role: membership.role,
      })),
      { id: null as string | null, name: "Unassigned", email: null, avatarUrl: null, role: null },
    ].map((member) => {
      const memberTasks = tasks.filter((task) => (member.id ? task.assigneeId === member.id : !task.assigneeId));
      const openTasks = memberTasks.filter((task) => !task.completedAt);
      return {
        ...member,
        open: openTasks.length,
        dueThisWeek: openTasks.filter((task) => {
          if (!task.dueDate) return false;
          const date = dateStringInTimeZone(new Date(task.dueDate), viewer.user.timezone);
          return date >= today && date <= weekEnd;
        }).length,
        overdue: openTasks.filter((task) => task.dueDate && dateStringInTimeZone(new Date(task.dueDate), viewer.user.timezone) < today).length,
        estimateMinutes: openTasks.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0),
      };
    });

    return ok({
      today,
      end: windowEnd,
      days,
      boards: byBoard,
      members: byMember,
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        boardId: task.boardId,
        boardName: task.board.name,
        columnId: task.columnId,
        columnName: task.column.name,
        isDone: task.column.isDone,
        priority: task.priority,
        startDate: task.startDate,
        dueDate: task.dueDate,
        dueAllDay: task.dueAllDay,
        estimateMinutes: task.estimateMinutes,
        completedAt: task.completedAt,
        assignee: memberships.find((membership) => membership.user.id === task.assigneeId)?.user ?? null,
      })),
      totals: {
        open: tasks.filter((task) => !task.completedAt).length,
        overdue: tasks.filter(
          (task) => !task.completedAt && task.dueDate && dateStringInTimeZone(new Date(task.dueDate), viewer.user.timezone) < today,
        ).length,
        dueThisWeek: tasks.filter((task) => {
          if (task.completedAt || !task.dueDate) return false;
          const date = dateStringInTimeZone(new Date(task.dueDate), viewer.user.timezone);
          return date >= today && date <= weekEnd;
        }).length,
        completedLast7: tasks.filter((task) => task.completedAt && new Date(task.completedAt) >= completedSince).length,
        estimateMinutes: tasks.filter((task) => !task.completedAt).reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0),
        unestimated: tasks.filter((task) => !task.completedAt && !task.estimateMinutes).length,
        taskCount: tasks.length,
        truncated: tasks.length >= 2000,
      },
    });
  });
}

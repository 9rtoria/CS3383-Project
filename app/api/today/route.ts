import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordActivity } from "@/lib/authz";
import { canReadBoard } from "@/lib/rbac";
import { rankTodayTasks, capacitySummary } from "@/lib/today";
import { todayInTimeZone } from "@/lib/time";

function taskSummary(task: any) {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    boardId: task.boardId,
    columnId: task.columnId,
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate,
    dueAllDay: task.dueAllDay,
    estimateMinutes: task.estimateMinutes,
    actualMinutes: task.actualMinutes ?? null,
    completedAt: task.completedAt,
    focusDate: task.focusDate,
    version: task.version,
    labels: (task.labels ?? []).map((entry: any) => entry.label ?? entry),
    board: task.board ? { id: task.board.id, name: task.board.name } : undefined,
    column: task.column ? { id: task.column.id, name: task.column.name, isDone: task.column.isDone } : undefined,
    openDependencies: (task.dependencies ?? []).filter((entry: any) => !entry.dependsOnTask?.completedAt).length,
    assignee: task.assignee,
  };
}

async function todayPayload(viewer: any, workspaceId: string) {
  const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
  const settings = await prisma.userSettings.upsert({
    where: { userId: viewer.user.id },
    update: {},
    create: { userId: viewer.user.id },
  });
  const workspace = access.workspace;
  const today = todayInTimeZone(viewer.user.timezone);
  const [tasks, dismissals, planBlocks] = await Promise.all([
    prisma.task.findMany({
      where: {
        workspaceId,
        completedAt: null,
        deletedAt: null,
        archivedAt: null,
        board: { deletedAt: null },
      },
      include: {
        labels: { include: { label: true } },
        board: { select: { id: true, name: true, visibility: true, createdById: true } },
        column: { select: { id: true, name: true, isDone: true } },
        dependencies: { include: { dependsOnTask: { select: { completedAt: true } } } },
        assignee: { select: { id: true, name: true } },
      },
      take: 1000,
    }),
    prisma.todayDismissal.findMany({ where: { userId: viewer.user.id, date: today } }),
    prisma.planBlock.findMany({
      where: {
        userId: viewer.user.id,
        workspaceId,
        date: today,
        task: { completedAt: null, archivedAt: null, deletedAt: null, board: { deletedAt: null } },
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            priority: true,
            estimateMinutes: true,
            dueDate: true,
            dueAllDay: true,
            focusDate: true,
            board: { select: { visibility: true, createdById: true } },
          },
        },
      },
      orderBy: { startMinute: "asc" },
    }),
  ]);
  const dismissed = new Set(dismissals.map((entry) => entry.taskId));
  const visible = tasks.filter((task) => canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id));
  const visiblePlanBlocks = planBlocks.filter((block) =>
    canReadBoard(access.role, block.task.board.visibility, block.task.board.createdById, viewer.user.id),
  );
  const filtered = visible.filter((task) => !dismissed.has(task.id) || task.focusDate === today);
  const ranked = rankTodayTasks(
    filtered.map((task) => ({
      ...taskSummary(task),
      archivedAt: task.archivedAt,
      deletedAt: task.deletedAt,
      openDependencies: task.dependencies.filter((entry) => !entry.dependsOnTask.completedAt).length,
    })),
    { timeZone: viewer.user.timezone, capacityMinutes: settings.capacityMinutes, now: new Date() },
  );
  // A chosen task must count against capacity even when the automatic selection
  // loop could not fit it. Otherwise Today can show an accepted task while the
  // ring claims there is still room.
  const active = ranked.filter((item) => item.selected || item.focusDate === today);
  const activeSummary = capacitySummary(active.map((item) => ({ ...item, selected: true })), settings.capacityMinutes);
  const selectedSet = new Set(active.map((item) => item.id));
  return {
    date: today,
    capacity: {
      totalMinutes: settings.capacityMinutes,
      selectedMinutes: activeSummary.selectedMinutes,
      remainingMinutes: activeSummary.remainingMinutes,
      percent: activeSummary.utilization,
      overbooked: activeSummary.overbooked,
    },
    suggestions: ranked.slice(0, 50).map((item) => ({
      ...taskSummary(filtered.find((task) => task.id === item.id)),
      reason: item.reason,
      score: item.score,
      suggestedMinutes: item.suggestedMinutes,
      selected: item.selected || item.focusDate === today,
      blocked: item.blocked,
      accepted: item.focusDate === today,
    })),
    planBlocks: visiblePlanBlocks.map((block) => ({
      id: block.id,
      userId: block.userId,
      workspaceId: block.workspaceId,
      taskId: block.taskId,
      date: block.date,
      startMinute: block.startMinute,
      minutes: block.minutes,
      source: block.source === "manual" ? "manual" as const : "auto" as const,
      locked: block.locked,
      title: block.task.title,
      priority: block.task.priority,
      task: block.task,
    })),
    counts: {
      open: visible.length,
      selected: selectedSet.size,
      overdue: ranked.filter((item) => item.reason.startsWith("Overdue")).length,
    },
    aiEnabled: workspace.aiEnabled && process.env.AI_KILL_SWITCH !== "true",
    workspace: { id: workspace.id, name: workspace.name, type: workspace.type },
  };
}

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    return ok(await todayPayload(viewer, workspaceId));
  });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), workspaceId: z.string(), taskId: z.string() }),
  z.object({ action: z.literal("dismiss"), workspaceId: z.string(), taskId: z.string() }),
  z.object({ action: z.literal("rebalance"), workspaceId: z.string() }),
  z.object({ action: z.literal("applyPlan"), workspaceId: z.string(), taskIds: z.array(z.string()).max(50) }),
]);

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const input = actionSchema.parse(body);
    const access = await requireWorkspace(viewer, input.workspaceId, "MEMBER", "content:write");
    const today = todayInTimeZone(viewer.user.timezone);
    if (input.action === "accept") {
      const task = await prisma.task.findFirst({
        where: { id: input.taskId, workspaceId: input.workspaceId, deletedAt: null },
        include: { board: { select: { visibility: true, createdById: true } } },
      });
      if (!task || !canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id)) {
        throw new ApiError("TASK_NOT_FOUND");
      }
      if (task.completedAt) throw new ApiError("VALIDATION_ERROR", "A completed task cannot be added to today's plan.");
      await prisma.task.update({ where: { id: task.id }, data: { focusDate: today, version: { increment: 1 } } });
      await prisma.todayDismissal.deleteMany({ where: { userId: viewer.user.id, taskId: input.taskId, date: today } });
      await recordActivity({
        workspaceId: access.workspace.id,
        taskId: input.taskId,
        actorId: viewer.user.id,
        action: "today.accepted",
        entityType: "task",
        entityId: input.taskId,
        requestId,
        metadata: { date: today },
      });
    } else if (input.action === "dismiss") {
      const task = await prisma.task.findFirst({
        where: { id: input.taskId, workspaceId: input.workspaceId, deletedAt: null },
        include: { board: { select: { visibility: true, createdById: true } } },
      });
      if (!task || !canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id)) {
        throw new ApiError("TASK_NOT_FOUND");
      }
      await prisma.todayDismissal.upsert({
        where: { userId_taskId_date: { userId: viewer.user.id, taskId: input.taskId, date: today } },
        update: {},
        create: { userId: viewer.user.id, taskId: input.taskId, date: today },
      });
      await prisma.task.updateMany({
        where: { id: input.taskId, workspaceId: input.workspaceId, focusDate: today },
        data: { focusDate: null, version: { increment: 1 } },
      });
      await prisma.planBlock.deleteMany({
        where: { userId: viewer.user.id, workspaceId: input.workspaceId, taskId: input.taskId, date: today, source: "auto", locked: false },
      });
    } else if (input.action === "applyPlan") {
      const taskIds = [...new Set(input.taskIds)].slice(0, 50);
      const selectedTasks = taskIds.length
        ? await prisma.task.findMany({
            where: { id: { in: taskIds }, workspaceId: input.workspaceId, deletedAt: null, archivedAt: null },
            include: {
              board: { select: { id: true, name: true, visibility: true, createdById: true } },
              dependencies: { include: { dependsOnTask: { select: { completedAt: true } } } },
            },
          })
        : [];
      if (selectedTasks.length !== taskIds.length) throw new ApiError("TASK_NOT_FOUND", "One or more tasks in this plan are no longer available.");
      for (const task of selectedTasks) {
        if (!canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id)) {
          throw new ApiError("TASK_NOT_FOUND");
        }
        if (task.completedAt) throw new ApiError("VALIDATION_ERROR", "A completed task cannot be added to today's plan.");
        if (task.dependencies.some((entry) => !entry.dependsOnTask.completedAt)) {
          throw new ApiError("DEPENDENCY_BLOCKED", `Finish the work before “${task.title}” first.`);
        }
      }
      const focused = await prisma.task.findMany({
        where: { workspaceId: input.workspaceId, focusDate: today, deletedAt: null, board: { deletedAt: null } },
        select: { id: true, board: { select: { visibility: true, createdById: true } } },
      });
      const visibleFocusIds = focused
        .filter((task) => canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id))
        .map((task) => task.id);
      await prisma.$transaction(async (tx) => {
        await tx.planBlock.deleteMany({
          where: {
            userId: viewer.user.id,
            workspaceId: input.workspaceId,
            date: today,
            source: "auto",
            locked: false,
          },
        });
        await tx.task.updateMany({
          where: {
            workspaceId: input.workspaceId,
            focusDate: today,
            id: { in: visibleFocusIds, ...(taskIds.length ? { notIn: taskIds } : {}) },
          },
          data: { focusDate: null, version: { increment: 1 } },
        });
        if (taskIds.length) {
          await tx.task.updateMany({
            where: {
              id: { in: taskIds },
              workspaceId: input.workspaceId,
              OR: [{ focusDate: null }, { focusDate: { not: today } }],
            },
            data: { focusDate: today, version: { increment: 1 } },
          });
        }
      });
      await recordActivity({
        workspaceId: access.workspace.id,
        actorId: viewer.user.id,
        action: "today.plan_applied",
        entityType: "workspace",
        entityId: input.workspaceId,
        requestId,
        metadata: { selected: taskIds.length },
      });
    } else {
      const payload = await todayPayload(viewer, input.workspaceId);
      const selected = payload.suggestions.filter((suggestion) => suggestion.selected && !suggestion.blocked).map((suggestion) => suggestion.id);
      const focused = await prisma.task.findMany({
        where: { workspaceId: input.workspaceId, focusDate: today, deletedAt: null, board: { deletedAt: null } },
        select: { id: true, board: { select: { visibility: true, createdById: true } } },
      });
      const visibleFocusIds = focused
        .filter((task) => canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id))
        .map((task) => task.id);
      await prisma.$transaction([
        prisma.planBlock.deleteMany({
          where: { userId: viewer.user.id, workspaceId: input.workspaceId, date: today, source: "auto", locked: false },
        }),
        prisma.task.updateMany({
          where: { workspaceId: input.workspaceId, focusDate: today, id: { in: visibleFocusIds, notIn: selected } },
          data: { focusDate: null },
        }),
        ...selected.map((taskId) =>
          prisma.task.update({ where: { id: taskId }, data: { focusDate: today, version: { increment: 1 } } }),
        ),
      ]);
      await recordActivity({
        workspaceId: access.workspace.id,
        actorId: viewer.user.id,
        action: "today.rebalanced",
        entityType: "workspace",
        entityId: input.workspaceId,
        requestId,
        metadata: { selected: selected.length },
      });
    }
    return ok(await todayPayload(viewer, input.workspaceId));
  });
}

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
    boardId: task.boardId,
    columnId: task.columnId,
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate,
    dueAllDay: task.dueAllDay,
    estimateMinutes: task.estimateMinutes,
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
  const [tasks, dismissals] = await Promise.all([
    prisma.task.findMany({
      where: {
        workspaceId,
        completedAt: null,
        deletedAt: null,
        archivedAt: null,
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
  ]);
  const dismissed = new Set(dismissals.map((entry) => entry.taskId));
  const visible = tasks.filter((task) => canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id));
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
  const selectedSet = new Set(ranked.filter((item) => item.selected).map((item) => item.id));
  const summary = capacitySummary(ranked, settings.capacityMinutes);
  return {
    date: today,
    capacity: {
      totalMinutes: settings.capacityMinutes,
      selectedMinutes: summary.selectedMinutes,
      remainingMinutes: summary.remainingMinutes,
      percent: summary.utilization,
      overbooked: summary.selectedMinutes > settings.capacityMinutes,
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
]);

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const input = actionSchema.parse(body);
    const access = await requireWorkspace(viewer, input.workspaceId, "MEMBER", "content:write");
    const today = todayInTimeZone(viewer.user.timezone);
    if (input.action === "accept") {
      const task = await prisma.task.findFirst({ where: { id: input.taskId, workspaceId: input.workspaceId, deletedAt: null } });
      if (!task) throw new ApiError("TASK_NOT_FOUND");
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
      await prisma.todayDismissal.upsert({
        where: { userId_taskId_date: { userId: viewer.user.id, taskId: input.taskId, date: today } },
        update: {},
        create: { userId: viewer.user.id, taskId: input.taskId, date: today },
      });
      await prisma.task.updateMany({
        where: { id: input.taskId, workspaceId: input.workspaceId, focusDate: today },
        data: { focusDate: null },
      });
    } else {
      const payload = await todayPayload(viewer, input.workspaceId);
      const selected = payload.suggestions.filter((suggestion) => suggestion.selected && !suggestion.blocked).map((suggestion) => suggestion.id);
      await prisma.$transaction([
        prisma.task.updateMany({
          where: { workspaceId: input.workspaceId, focusDate: today, id: { notIn: selected } },
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

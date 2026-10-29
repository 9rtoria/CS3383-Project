import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordActivity, recordAudit } from "@/lib/authz";
import { canReadBoard } from "@/lib/rbac";
import { normalizePreferences } from "@/lib/preferences";
import {
  buildAutoPlan,
  weekStartOf,
  type AutoPlanBlock,
  type AutoPlanTask,
} from "@/lib/auto-plan";
import { createUndo } from "@/lib/undo";
import type { Viewer } from "@/lib/session";
import { addDaysToDateString, dateStringInTimeZone, endOfLocalDayUtc, startOfLocalDayUtc, todayInTimeZone } from "@/lib/time";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("preview"),
    workspaceId: z.string(),
    horizonDays: z.number().int().min(1).max(31).optional(),
  }),
  z.object({
    action: z.literal("apply"),
    workspaceId: z.string(),
    horizonDays: z.number().int().min(1).max(31).optional(),
    optionId: z.enum(["balanced", "focus", "light"]),
    safe: z.boolean().optional(),
    delegated: z.boolean().optional(),
  }),
]);

function blockShape(block: {
  id: string;
  taskId: string;
  date: string;
  startMinute: number;
  minutes: number;
  source: string;
  locked: boolean;
  task?: { title: string; priority: string };
}): AutoPlanBlock {
  return {
    id: block.id,
    taskId: block.taskId,
    title: block.task?.title,
    priority: block.task?.priority,
    date: block.date,
    startMinute: block.startMinute,
    minutes: block.minutes,
    source: block.source === "manual" ? "manual" : "auto",
    locked: block.locked,
  };
}

async function loadContext(viewer: Viewer, workspaceId: string, horizonDays = 7) {
  const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
  const settings = await prisma.userSettings.upsert({
    where: { userId: viewer.user.id },
    update: {},
    create: { userId: viewer.user.id },
  });
  const preferences = normalizePreferences(settings);
  const startDate = todayInTimeZone(viewer.user.timezone);
  const endDate = addDaysToDateString(startDate, Math.max(1, horizonDays) - 1);
  const weekStart = weekStartOf(startDate);
  const weekRangeStart = startOfLocalDayUtc(weekStart, viewer.user.timezone);
  const weekRangeEnd = endOfLocalDayUtc(endDate, viewer.user.timezone);
  const [tasks, blocks, completed] = await Promise.all([
    prisma.task.findMany({
      where: { workspaceId, completedAt: null, deletedAt: null, archivedAt: null },
      include: {
        board: { select: { visibility: true, createdById: true } },
        dependencies: { include: { dependsOnTask: { select: { completedAt: true } } } },
      },
      take: 1000,
    }),
    prisma.planBlock.findMany({
      where: { userId: viewer.user.id, workspaceId, date: { gte: startDate, lte: endDate } },
      include: { task: { select: { title: true, priority: true } } },
      orderBy: [{ date: "asc" }, { startMinute: "asc" }],
    }),
    prisma.task.findMany({
      where: {
        workspaceId,
        completedAt: { gte: weekRangeStart, lte: weekRangeEnd },
        actualMinutes: { not: null },
        deletedAt: null,
      },
      select: { completedAt: true, actualMinutes: true },
    }),
  ]);
  const visible = tasks.filter((task) => canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id));
  const actualMinutesByWeek: Record<string, number> = {};
  for (const task of completed) {
    if (!task.completedAt || !task.actualMinutes) continue;
    const key = weekStartOf(dateStringInTimeZone(task.completedAt, viewer.user.timezone));
    actualMinutesByWeek[key] = (actualMinutesByWeek[key] ?? 0) + task.actualMinutes;
  }
  const planTasks: AutoPlanTask[] = visible.map((task) => ({
    id: task.id,
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate ? dateStringInTimeZone(task.dueDate, viewer.user.timezone) : null,
    estimateMinutes: task.estimateMinutes,
    actualMinutes: task.actualMinutes,
    focusDate: task.focusDate,
    completedAt: task.completedAt?.toISOString() ?? null,
    openDependencies: task.dependencies.filter((entry) => !entry.dependsOnTask.completedAt).length,
    updatedAt: task.updatedAt.toISOString(),
  }));
  const existingBlocks = blocks.map(blockShape);
  const preview = buildAutoPlan(planTasks, {
    startDate,
    horizonDays,
    timeZone: viewer.user.timezone,
    now: new Date(),
    workdayStart: preferences.workdayStart,
    workdayEnd: preferences.workdayEnd,
    dailyCapacityMinutes: preferences.capacityMinutes,
    weeklyCapacityMinutes: preferences.autoPlan.weeklyMinutes,
    restMinutes: preferences.autoPlan.restMinutes,
    deepWorkMinutes: preferences.autoPlan.deepWorkMinutes,
    splitLongTasks: preferences.autoPlan.splitLongTasks,
    includeWeekends: preferences.autoPlan.includeWeekends,
    defaultEstimateMinutes: preferences.autoPlan.defaultEstimateMinutes,
    capBehavior: preferences.autoPlan.capBehavior,
    lunchEnabled: preferences.autoPlan.lunchEnabled,
    lunchStart: preferences.autoPlan.lunchStart,
    lunchEnd: preferences.autoPlan.lunchEnd,
    existingBlocks,
    actualMinutesByWeek,
  });
  return {
    access,
    preferences,
    startDate,
    endDate,
    weekStart,
    preview,
    existingBlocks,
    blocks,
    today: startDate,
  };
}

function overlaps(a: { date: string; startMinute: number; minutes: number }, b: { date: string; startMinute: number; minutes: number }) {
  return a.date === b.date && a.startMinute < b.startMinute + b.minutes && b.startMinute < a.startMinute + a.minutes;
}

function sameBlockSet(
  left: Array<{ taskId: string; date: string; startMinute: number; minutes: number }>,
  right: Array<{ taskId: string; date: string; startMinute: number; minutes: number }>,
): boolean {
  if (left.length !== right.length) return false;
  const key = (block: { taskId: string; date: string; startMinute: number; minutes: number }) =>
    `${block.taskId}|${block.date}|${block.startMinute}|${block.minutes}`;
  return left.map(key).sort().join("\n") === right.map(key).sort().join("\n");
}

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId, req: request }) => {
    const input = actionSchema.parse(body);
    const workspaceId = input.workspaceId || workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const context = await loadContext(viewer, workspaceId, input.horizonDays);
    if (input.action === "preview") {
      return ok({ preview: context.preview });
    }

    const access = await requireWorkspace(viewer, workspaceId, "MEMBER", "content:write");
    const option = context.preview.options.find((entry) => entry.id === input.optionId);
    if (!option) throw new ApiError("VALIDATION_ERROR", "That plan option no longer exists.");
    const existingAutoTasks = new Set(context.existingBlocks.filter((block) => block.source === "auto" && !block.locked).map((block) => block.taskId));
    const selected = input.safe
      ? option.blocks.filter((block) => !existingAutoTasks.has(block.taskId) && !context.existingBlocks.some((existing) => overlaps(block, existing)))
      : option.blocks;
    const existingAuto = context.existingBlocks.filter((block) => block.source === "auto" && !block.locked);
    if (sameBlockSet(existingAuto, selected)) {
      return ok({ optionId: input.optionId, appliedBlocks: 0, focusedToday: 0, archived: 0, undoId: null, preview: context.preview });
    }
    if (!selected.length && input.safe) {
      throw new ApiError("VALIDATION_ERROR", "The selected plan has no safe changes to apply.");
    }
    const todayBlocks = selected.filter((block) => block.date === context.today);
    const todayTaskIds = [...new Set(todayBlocks.map((block) => block.taskId))];
    const affectedFocus = await prisma.task.findMany({
      where: { workspaceId, focusDate: context.today, deletedAt: null, archivedAt: null },
      select: { id: true, focusDate: true },
    });
    const previousFocus = affectedFocus.map((task) => ({ taskId: task.id, focusDate: task.focusDate }));
    const selectedTaskIds = new Set(selected.map((block) => block.taskId));
    const staleCutoff = new Date(Date.now() - context.preferences.autoPlan.staleDays * 86_400_000);
    const staleTasks = input.delegated && context.preferences.autoPlan.mode === "delegated" && context.preferences.autoPlan.allowStaleArchive
      ? await prisma.task.findMany({
          where: {
            workspaceId,
            completedAt: null,
            archivedAt: null,
            deletedAt: null,
            dueDate: null,
            focusDate: null,
            updatedAt: { lt: staleCutoff },
            ...(selectedTaskIds.size ? { id: { notIn: [...selectedTaskIds] } } : {}),
          },
          select: { id: true, archivedAt: true },
          take: 25,
        })
      : [];
    const previousArchived = staleTasks.map((task) => ({ taskId: task.id, archivedAt: task.archivedAt?.toISOString() ?? null }));
    const previousBlocks = context.blocks
      .filter((block) => block.source === "auto" && !block.locked)
      .map((block) => ({
        taskId: block.taskId,
        date: block.date,
        startMinute: block.startMinute,
        minutes: block.minutes,
        source: "auto" as const,
        locked: false,
      }));
    await prisma.$transaction(async (tx) => {
      await tx.planBlock.deleteMany({
        where: {
          userId: viewer.user.id,
          workspaceId,
          source: "auto",
          locked: false,
          date: { gte: context.startDate, lte: context.endDate },
          ...(input.safe ? { taskId: { in: [...new Set(selected.map((block) => block.taskId))] } } : {}),
        },
      });
      if (selected.length) {
        await tx.planBlock.createMany({
          data: selected.map((block) => ({
            userId: viewer.user.id,
            workspaceId,
            taskId: block.taskId,
            date: block.date,
            startMinute: block.startMinute,
            minutes: block.minutes,
            source: "auto",
            locked: false,
          })),
        });
      }
      if (input.safe) {
        if (todayTaskIds.length) {
          await tx.task.updateMany({
            where: { id: { in: todayTaskIds }, workspaceId, completedAt: null },
            data: { focusDate: context.today, version: { increment: 1 } },
          });
        }
      } else if (todayTaskIds.length) {
        await tx.task.updateMany({
          where: {
            workspaceId,
            focusDate: context.today,
            deletedAt: null,
            id: { notIn: todayTaskIds },
          },
          data: { focusDate: null, version: { increment: 1 } },
        });
        await tx.task.updateMany({
          where: { id: { in: todayTaskIds }, workspaceId, completedAt: null },
          data: { focusDate: context.today, version: { increment: 1 } },
        });
      }
      if (staleTasks.length) {
        await tx.task.updateMany({
          where: { id: { in: staleTasks.map((task) => task.id) }, workspaceId },
          data: { archivedAt: new Date(), version: { increment: 1 } },
        });
      }
    });
    const undo = await createUndo({
      userId: viewer.user.id,
      workspaceId,
      action: "auto_plan.apply",
      entityType: "workspace",
      entityId: workspaceId,
      inverse: {
        startDate: context.startDate,
        endDate: context.endDate,
        previousBlocks,
        previousFocus,
        previousArchived,
        safe: Boolean(input.safe),
      },
      ttlSeconds: 300,
    });
    await recordActivity({
      workspaceId: access.workspace.id,
      actorId: viewer.user.id,
      action: "auto_plan.applied",
      entityType: "workspace",
      entityId: workspaceId,
      requestId,
      metadata: { optionId: input.optionId, blocks: selected.length, safe: Boolean(input.safe) },
    });
    await recordAudit({
      workspaceId: access.workspace.id,
      actorId: viewer.user.id,
      action: "auto_plan.applied",
      entityType: "workspace",
      entityId: workspaceId,
      requestId,
      metadata: { optionId: input.optionId, blocks: selected.length, safe: Boolean(input.safe) },
    });
    return ok({
      optionId: input.optionId,
      appliedBlocks: selected.length,
      focusedToday: todayTaskIds.length,
      archived: staleTasks.length,
      undoId: undo.id,
      preview: context.preview,
    });
  });
}

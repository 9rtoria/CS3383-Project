import { prisma } from "./db";
import { ApiError } from "./errors";
import type { Viewer } from "./session";
import { requireBoard, requireColumn } from "./board-authz";
import { requireWorkspace, recordActivity, recordAudit, findTaskInWorkspace } from "./authz";
import { canReadBoard } from "./rbac";
import { appendAfter, positionBetween, sortByPosition } from "./fractional";
import { nextOccurrence } from "./recurrence";
import { notifyUser } from "./notifications";
import { createUndo } from "./undo";
import { dispatchWebhooksInBackground } from "./webhooks";
import { dateStringInTimeZone } from "./time";
import { runAutomationsForEvent } from "./automations";
import type { z } from "zod";
import type { taskCreateSchema, taskUpdateSchema } from "./validation";

const LABEL_COLORS = ["moss", "blue", "amber", "rose", "violet", "slate"];

export function serializeTask(task: any) {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    boardId: task.boardId,
    columnId: task.columnId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    startDate: task.startDate,
    dueDate: task.dueDate,
    dueAllDay: task.dueAllDay,
    estimateMinutes: task.estimateMinutes,
    position: task.position,
    completedAt: task.completedAt,
    recurrenceRule: task.recurrenceRule,
    recurrenceEndsAt: task.recurrenceEndsAt,
    focusDate: task.focusDate,
    version: task.version,
    archivedAt: task.archivedAt,
    assignee: task.assignee ?? null,
    labels: (task.labels ?? []).map((entry: any) => entry.label ?? entry),
    subtasks: task.subtasks ?? [],
    attachments: task.attachments ?? [],
    comments: (task.comments ?? []).map((comment: any) => ({
      id: comment.id,
      body: comment.body,
      authorId: comment.authorId,
      author: comment.author ?? null,
      createdAt: comment.createdAt,
    })),
    reminders: task.reminders ?? [],
    dependencies: (task.dependencies ?? []).map((entry: any) => ({
      id: entry.dependsOnTask?.id ?? entry.dependsOnTaskId,
      title: entry.dependsOnTask?.title ?? "",
      completed: Boolean(entry.dependsOnTask?.completedAt),
    })),
    openDependencies: (task.dependencies ?? []).filter((entry: any) => !entry.dependsOnTask?.completedAt).length,
    dependencyIds: (task.dependencies ?? []).map((entry: any) => entry.dependsOnTaskId ?? entry.dependsOnTask?.id),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    board: task.board ?? undefined,
    column: task.column ?? undefined,
  };
}

const taskInclude = {
  labels: { include: { label: true } },
  subtasks: { orderBy: { position: "asc" as const } },
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  dependencies: {
    include: { dependsOnTask: { select: { id: true, title: true, completedAt: true } } },
  },
  reminders: { orderBy: { remindAt: "asc" as const } },
  attachments: { where: { deletedAt: null }, orderBy: { createdAt: "desc" as const } },
  comments: {
    where: { deletedAt: null },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: "asc" as const },
  },
  board: { select: { id: true, name: true, visibility: true } },
  column: { select: { id: true, name: true, isDone: true } },
};

async function resolvePosition(
  tx: any,
  columnId: string,
  afterId: string | null | undefined,
  beforeId: string | null | undefined,
  movingTaskId?: string,
) {
  const tasks = await tx.task.findMany({
    where: { columnId, deletedAt: null, archivedAt: null, ...(movingTaskId ? { id: { not: movingTaskId } } : {}) },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, position: true },
  });
  const ordered = sortByPosition(tasks);
  if (beforeId && afterId) {
    const lowerTask = ordered.find((task: any) => task.id === afterId);
    const upperTask = ordered.find((task: any) => task.id === beforeId);
    if (!lowerTask || !upperTask) throw new ApiError("VALIDATION_ERROR", "Those ordering neighbors are no longer in the column.");
    if (lowerTask.position >= upperTask.position) throw new ApiError("CONFLICT", "The destination changed. Refresh and try again.");
    return positionBetween(lowerTask.position, upperTask.position);
  }
  if (afterId) {
    const index = ordered.findIndex((task: any) => task.id === afterId);
    if (index < 0) throw new ApiError("VALIDATION_ERROR", "The insertion target is no longer in this column.");
    return positionBetween(ordered[index]!.position, ordered[index + 1]?.position ?? null);
  }
  if (beforeId) {
    const index = ordered.findIndex((task: any) => task.id === beforeId);
    if (index < 0) throw new ApiError("VALIDATION_ERROR", "The insertion target is no longer in this column.");
    return positionBetween(index > 0 ? ordered[index - 1]!.position : null, ordered[index]!.position);
  }
  return appendAfter(ordered.at(-1)?.position ?? null);
}

async function upsertLabels(tx: any, workspaceId: string, names: string[]): Promise<string[]> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 20);
  const ids: string[] = [];
  for (let index = 0; index < unique.length; index++) {
    const name = unique[index]!;
    const existing = await tx.label.findUnique({ where: { workspaceId_name: { workspaceId, name } } });
    const label =
      existing ??
      (await tx.label.create({
        data: { workspaceId, name, color: LABEL_COLORS[index % LABEL_COLORS.length]! },
      }));
    ids.push(label.id);
  }
  return ids;
}

async function assertAssignee(tx: any, workspaceId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const membership = await tx.membership.findUnique({
    where: { userId_workspaceId: { userId: assigneeId, workspaceId } },
  });
  if (!membership) throw new ApiError("VALIDATION_ERROR", "That assignee is not a member of this workspace.");
}

async function createReminder(tx: any, task: any, userId: string, offset: number | null | undefined) {
  if (!task.dueDate || offset === null || offset === undefined) return;
  const remindAt = new Date(new Date(task.dueDate).getTime() - offset * 60_000);
  if (remindAt < new Date()) return;
  await tx.reminder.create({ data: { taskId: task.id, userId, remindAt, channel: "in_app" } });
}

async function createNextOccurrence(
  tx: any,
  task: any,
  workspaceId: string,
  viewerId: string,
  requestId: string,
  timeZone: string,
) {
  if (!task.recurrenceRule || !task.dueDate || task.completedAt) return null;
  const nextDue = nextOccurrence(task.recurrenceRule, new Date(task.dueDate), timeZone, task.dueAllDay, task.recurrenceEndsAt);
  if (!nextDue) return null;
  const position = await resolvePosition(tx, task.columnId, null, null);
  const next = await tx.task.create({
    data: {
      workspaceId,
      boardId: task.boardId,
      columnId: task.columnId,
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: nextDue,
      dueAllDay: task.dueAllDay,
      estimateMinutes: task.estimateMinutes,
      position,
      recurrenceRule: task.recurrenceRule,
      recurrenceEndsAt: task.recurrenceEndsAt,
      assigneeId: task.assigneeId,
      createdById: viewerId,
      labels: { create: task.labels.map((entry: any) => ({ labelId: entry.labelId })) },
      reminders: {
        create: (task.reminders ?? [])
          .filter((reminder: any) => !reminder.sentAt)
          .map((reminder: any) => {
            const offsetMs = new Date(task.dueDate).getTime() - new Date(reminder.remindAt).getTime();
            return {
              userId: reminder.userId,
              remindAt: new Date(nextDue.getTime() - offsetMs),
              channel: reminder.channel,
            };
          }),
      },
    },
  });
  await tx.activityEvent.create({
    data: {
      workspaceId,
      taskId: task.id,
      actorId: viewerId,
      action: "task.recurred",
      entityType: "task",
      entityId: task.id,
      requestId,
      metadata: JSON.stringify({ nextTaskId: next.id, dueDate: nextDue.toISOString() }),
    },
  });
  return next.id;
}

export async function createTask(
  viewer: Viewer,
  input: z.infer<typeof taskCreateSchema>,
  requestId: string,
): Promise<{ task: ReturnType<typeof serializeTask>; undo?: Awaited<ReturnType<typeof createUndo>> }> {
  const access = await requireWorkspace(viewer, input.workspaceId, "MEMBER", "content:write");
  const boardAccess = await requireBoard(viewer, input.workspaceId, input.boardId, "MEMBER");
  if (!boardAccess.board.columns.some((column) => column.id === input.columnId)) {
    throw new ApiError("VALIDATION_ERROR", "That column is not part of this board.");
  }
  const column = boardAccess.board.columns.find((item) => item.id === input.columnId)!;
  if (column.wipEnforced && column.wipLimit) {
    const count = await prisma.task.count({ where: { columnId: column.id, deletedAt: null, archivedAt: null } });
    if (count >= column.wipLimit) throw new ApiError("WIP_LIMIT", `${column.name} is limited to ${column.wipLimit} open tasks.`);
  }
  await assertAssignee(prisma, access.workspace.id, input.assigneeId);

  const task = await prisma.$transaction(async (tx) => {
    const position = await resolvePosition(tx, input.columnId, input.afterId, null);
    const labelIds = await upsertLabels(tx, access.workspace.id, input.labels);
    const created = await tx.task.create({
      data: {
        workspaceId: access.workspace.id,
        boardId: input.boardId,
        columnId: input.columnId,
        title: input.title,
        description: input.description ?? "",
        priority: input.priority ?? "none",
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        dueAllDay: input.dueAllDay ?? true,
        startDate: input.startDate ? new Date(input.startDate) : null,
        estimateMinutes: input.estimateMinutes ?? null,
        position,
        recurrenceRule: input.recurrenceRule ?? null,
        assigneeId: input.assigneeId ?? null,
        focusDate: input.focusDate ?? null,
        createdById: viewer.user.id,
        labels: labelIds.length ? { create: labelIds.map((labelId) => ({ labelId })) } : undefined,
      },
      include: taskInclude,
    });
    await createReminder(tx, created, viewer.user.id, input.reminderOffsetMinutes);
    await tx.activityEvent.create({
      data: {
        workspaceId: access.workspace.id,
        taskId: created.id,
        actorId: viewer.user.id,
        action: "task.created",
        entityType: "task",
        entityId: created.id,
        requestId,
        metadata: JSON.stringify({ title: created.title, columnId: created.columnId }),
      },
    });
    await tx.auditEvent.create({
      data: {
        workspaceId: access.workspace.id,
        actorId: viewer.user.id,
        action: "task.created",
        entityType: "task",
        entityId: created.id,
        requestId,
        metadata: JSON.stringify({ boardId: input.boardId, columnId: input.columnId }),
      },
    });
    return tx.task.findUniqueOrThrow({ where: { id: created.id }, include: taskInclude });
  });

  if (task.assigneeId && task.assigneeId !== viewer.user.id) {
    await notifyUser({
      userId: task.assigneeId,
      workspaceId: access.workspace.id,
      taskId: task.id,
      type: "task.assigned",
      title: `Assigned: ${task.title}`,
      body: `${viewer.user.name} assigned you a task.`,
      link: `/?task=${task.id}`,
    });
  }
  dispatchWebhooksInBackground(access.workspace.id, "task.created", { title: task.title, taskId: task.id });
  await runAutomationsForEvent({
    workspaceId: access.workspace.id,
    event: "task.created",
    taskId: task.id,
    actorId: viewer.user.id,
    requestId,
  });
  const undo = await createUndo({
    userId: viewer.user.id,
    workspaceId: access.workspace.id,
    action: "task.create",
    entityType: "task",
    entityId: task.id,
    inverse: {},
    ttlSeconds: 10,
  }).catch(() => undefined);
  return { task: serializeTask(task), undo };
}

export async function updateTask(
  viewer: Viewer,
  taskId: string,
  workspaceId: string,
  input: z.infer<typeof taskUpdateSchema>,
  requestId: string,
): Promise<{ task: ReturnType<typeof serializeTask>; undo?: Awaited<ReturnType<typeof createUndo>>; nextTaskId?: string }> {
  const access = await requireWorkspace(viewer, workspaceId, "MEMBER", "content:write");
  const current = await prisma.task.findFirst({
    where: { id: taskId, workspaceId, deletedAt: null },
    include: { labels: true, reminders: true, board: { include: { columns: { where: { deletedAt: null }, orderBy: { position: "asc" } } } } },
  });
  if (!current) throw new ApiError("TASK_NOT_FOUND");
  if (!canReadBoard(access.role, current.board.visibility, current.createdById, viewer.user.id)) throw new ApiError("TASK_NOT_FOUND");
  if (input.version !== current.version) {
    throw new ApiError("VERSION_CONFLICT", "This task changed elsewhere. Review the newer version.", { currentVersion: current.version });
  }
  await assertAssignee(prisma, workspaceId, input.assigneeId);

  if (input.completed === true && !current.completedAt) {
    const blockers = await prisma.taskDependency.findMany({
      where: { taskId, dependsOnTask: { completedAt: null, deletedAt: null } },
      include: { dependsOnTask: { select: { title: true } } },
    });
    if (blockers.length) {
      throw new ApiError("DEPENDENCY_BLOCKED", `Finish ${blockers.map((b) => b.dependsOnTask.title).join(", ")} first.`);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    let nextTaskId: string | undefined;
    const completing = input.completed === true && !current.completedAt;
    const uncompleting = input.completed === false && current.completedAt;
    let targetColumnId = current.columnId;
    let position = current.position;
    if (input.completed === true && !current.board.columns.find((column) => column.id === current.columnId)?.isDone) {
      const doneColumn = current.board.columns.find((column) => column.isDone);
      if (doneColumn) {
        targetColumnId = doneColumn.id;
        position = await resolvePosition(tx, doneColumn.id, null, null, current.id);
      }
    }

    if (input.labels !== undefined) {
      const labelIds = await upsertLabels(tx, workspaceId, input.labels);
      await tx.taskLabel.deleteMany({ where: { taskId } });
      if (labelIds.length) await tx.taskLabel.createMany({ data: labelIds.map((labelId) => ({ taskId, labelId })) });
    }

    if (input.dependencyIds !== undefined) {
      const ids = [...new Set(input.dependencyIds)].filter((id) => id !== taskId);
      const valid = await tx.task.findMany({ where: { id: { in: ids }, workspaceId, deletedAt: null }, select: { id: true } });
      if (valid.length !== ids.length) throw new ApiError("VALIDATION_ERROR", "One or more dependencies do not exist.");
      // Reject a direct cycle; transitively checking every chain is handled by the bounded query below.
      const reverse = await tx.taskDependency.findMany({ where: { dependsOnTaskId: taskId }, select: { taskId: true } });
      if (reverse.some((entry) => ids.includes(entry.taskId))) throw new ApiError("VALIDATION_ERROR", "A direct dependency cycle is not allowed.");
      await tx.taskDependency.deleteMany({ where: { taskId } });
      if (ids.length) await tx.taskDependency.createMany({ data: ids.map((id) => ({ taskId, dependsOnTaskId: id })) });
    }

    if (input.reminderOffsetMinutes !== undefined) {
      await tx.reminder.deleteMany({ where: { taskId, sentAt: null } });
    }

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(input.dueDate) : null } : {}),
        ...(input.dueAllDay !== undefined ? { dueAllDay: input.dueAllDay } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate ? new Date(input.startDate) : null } : {}),
        ...(input.estimateMinutes !== undefined ? { estimateMinutes: input.estimateMinutes } : {}),
        ...(input.recurrenceRule !== undefined ? { recurrenceRule: input.recurrenceRule } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.focusDate !== undefined ? { focusDate: input.focusDate } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
        ...(targetColumnId !== current.columnId ? { columnId: targetColumnId, position } : {}),
        ...(input.completed !== undefined ? { completedAt: input.completed ? new Date() : null } : {}),
        version: { increment: 1 },
      },
      include: taskInclude,
    });

    if (input.reminderOffsetMinutes !== undefined) {
      await createReminder(tx, updated, viewer.user.id, input.reminderOffsetMinutes);
    }

    if (completing) {
      nextTaskId = (await createNextOccurrence(tx, updated, workspaceId, viewer.user.id, requestId, viewer.user.timezone)) ?? undefined;
    }

    await tx.activityEvent.create({
      data: {
        workspaceId,
        taskId,
        actorId: viewer.user.id,
        action: uncompleting ? "task.reopened" : completing ? "task.completed" : "task.updated",
        entityType: "task",
        entityId: taskId,
        requestId,
        metadata: JSON.stringify({ fields: Object.keys(input).filter((key) => key !== "version"), ...(nextTaskId ? { nextTaskId } : {}) }),
      },
    });
    await tx.auditEvent.create({
      data: {
        workspaceId,
        actorId: viewer.user.id,
        action: uncompleting ? "task.reopened" : completing ? "task.completed" : "task.updated",
        entityType: "task",
        entityId: taskId,
        requestId,
        metadata: JSON.stringify({ fields: Object.keys(input).filter((key) => key !== "version") }),
      },
    });
    return { updated, nextTaskId };
  });

  if (result.updated.assigneeId && result.updated.assigneeId !== viewer.user.id) {
    await notifyUser({
      userId: result.updated.assigneeId,
      workspaceId,
      taskId,
      type: "task.assigned",
      title: `Assigned: ${result.updated.title}`,
      body: `${viewer.user.name} updated your task.`,
      link: `/?task=${taskId}`,
    });
  }
  if (input.completed === true) {
    dispatchWebhooksInBackground(workspaceId, "task.completed", { title: result.updated.title, taskId });
    await runAutomationsForEvent({ workspaceId, event: "task.completed", taskId, actorId: viewer.user.id, requestId });
  }
  let undo;
  if (input.completed === true || input.archived === true) {
    undo = await createUndo({
      userId: viewer.user.id,
      workspaceId,
      action: input.completed === true ? "task.complete" : "task.archive",
      entityType: "task",
      entityId: taskId,
      inverse: {
        completedAt: input.completed === true ? null : current.completedAt,
        columnId: current.columnId,
        position: current.position,
        archivedAt: current.archivedAt,
        version: result.updated.version,
        removeNextTaskId: result.nextTaskId,
      },
      ttlSeconds: 10,
    });
  }
  const fresh = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
  return { task: serializeTask(fresh), undo, nextTaskId: result.nextTaskId };
}

export async function moveTask(
  viewer: Viewer,
  taskId: string,
  workspaceId: string,
  input: { columnId: string; beforeId?: string | null; afterId?: string | null; version?: number },
  requestId: string,
) {
  const access = await requireWorkspace(viewer, workspaceId, "MEMBER", "content:write");
  const current = await prisma.task.findFirst({
    where: { id: taskId, workspaceId, deletedAt: null },
    include: { board: { include: { columns: { where: { deletedAt: null }, orderBy: { position: "asc" } } } } },
  });
  if (!current) throw new ApiError("TASK_NOT_FOUND");
  if (!canReadBoard(access.role, current.board.visibility, current.createdById, viewer.user.id)) throw new ApiError("TASK_NOT_FOUND");
  const target = current.board.columns.find((column) => column.id === input.columnId);
  if (!target) throw new ApiError("VALIDATION_ERROR", "Target column is not on this board.");
  if (input.version && input.version !== current.version) {
    throw new ApiError("VERSION_CONFLICT", "This task changed elsewhere.", { currentVersion: current.version });
  }
  if (target.wipEnforced && target.wipLimit && target.id !== current.columnId) {
    const count = await prisma.task.count({ where: { columnId: target.id, deletedAt: null, archivedAt: null } });
    if (count >= target.wipLimit) throw new ApiError("WIP_LIMIT", `${target.name} is at its WIP limit of ${target.wipLimit}.`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const position = await resolvePosition(tx, target.id, input.afterId, input.beforeId, current.id);
    const completing = target.isDone && !current.completedAt;
    let nextTaskId: string | undefined;
    const updated = await tx.task.update({
      where: { id: current.id },
      data: {
        columnId: target.id,
        position,
        completedAt: target.isDone ? current.completedAt ?? new Date() : null,
        version: { increment: 1 },
      },
      include: taskInclude,
    });
    if (completing) {
      nextTaskId = (await createNextOccurrence(tx, updated, workspaceId, viewer.user.id, requestId, viewer.user.timezone)) ?? undefined;
    }
    await tx.activityEvent.create({
      data: {
        workspaceId,
        taskId,
        actorId: viewer.user.id,
        action: target.isDone ? "task.completed" : "task.moved",
        entityType: "task",
        entityId: taskId,
        requestId,
        metadata: JSON.stringify({ fromColumnId: current.columnId, toColumnId: target.id, ...(nextTaskId ? { nextTaskId } : {}) }),
      },
    });
    await tx.auditEvent.create({
      data: {
        workspaceId,
        actorId: viewer.user.id,
        action: "task.moved",
        entityType: "task",
        entityId: taskId,
        requestId,
        metadata: JSON.stringify({ fromColumnId: current.columnId, toColumnId: target.id }),
      },
    });
    return { updated, nextTaskId };
  });

  dispatchWebhooksInBackground(workspaceId, target.isDone ? "task.completed" : "task.moved", {
    title: result.updated.title,
    taskId,
  });
  await runAutomationsForEvent({
    workspaceId,
    event: target.isDone ? "task.completed" : "task.moved",
    taskId,
    actorId: viewer.user.id,
    requestId,
  });
  const undo = await createUndo({
    userId: viewer.user.id,
    workspaceId,
    action: "task.move",
    entityType: "task",
    entityId: taskId,
    inverse: {
      columnId: current.columnId,
      position: current.position,
      completedAt: current.completedAt,
      version: result.updated.version,
      removeNextTaskId: result.nextTaskId,
    },
    ttlSeconds: 60,
  });
  const fresh = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
  return { task: serializeTask(fresh), undo, nextTaskId: result.nextTaskId };
}

export async function deleteTask(viewer: Viewer, taskId: string, workspaceId: string, requestId: string) {
  const access = await requireWorkspace(viewer, workspaceId, "MEMBER", "content:delete");
  const current = await prisma.task.findFirst({
    where: { id: taskId, workspaceId, deletedAt: null },
    include: { board: true },
  });
  if (!current) throw new ApiError("TASK_NOT_FOUND");
  if (!canReadBoard(access.role, current.board.visibility, current.createdById, viewer.user.id)) throw new ApiError("TASK_NOT_FOUND");
  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date(), version: { increment: 1 } } }),
    prisma.activityEvent.create({
      data: {
        workspaceId, taskId, actorId: viewer.user.id, action: "task.deleted", entityType: "task", entityId: taskId, requestId,
      },
    }),
    prisma.auditEvent.create({
      data: {
        workspaceId, actorId: viewer.user.id, action: "task.deleted", entityType: "task", entityId: taskId, requestId,
        metadata: JSON.stringify({ title: current.title }),
      },
    }),
  ]);
  const undo = await createUndo({
    userId: viewer.user.id,
    workspaceId,
    action: "task.delete",
    entityType: "task",
    entityId: taskId,
    inverse: { columnId: current.columnId, position: current.position, version: current.version },
  });
  dispatchWebhooksInBackground(workspaceId, "task.deleted", { title: current.title, taskId });
  return { deleted: true, undo };
}

export async function bulkTaskAction(
  viewer: Viewer,
  input: { workspaceId: string; taskIds: string[]; action: "complete" | "delete" | "archive" | "move"; columnId?: string },
  requestId: string,
) {
  const access = await requireWorkspace(viewer, input.workspaceId, "MEMBER", "content:write");
  const tasks = await prisma.task.findMany({
    where: { id: { in: input.taskIds }, workspaceId: input.workspaceId, deletedAt: null },
    include: { board: true },
  });
  if (tasks.length !== input.taskIds.length) throw new ApiError("TASK_NOT_FOUND", "One or more tasks are missing.");
  for (const task of tasks) {
    if (!canReadBoard(access.role, task.board.visibility, task.createdById, viewer.user.id)) throw new ApiError("TASK_NOT_FOUND");
  }
  const now = new Date();
  if (input.action === "delete") {
    await prisma.task.updateMany({ where: { id: { in: input.taskIds } }, data: { deletedAt: now, version: { increment: 1 } } });
  } else if (input.action === "archive") {
    await prisma.task.updateMany({ where: { id: { in: input.taskIds } }, data: { archivedAt: now, version: { increment: 1 } } });
  } else if (input.action === "complete") {
    await prisma.task.updateMany({ where: { id: { in: input.taskIds } }, data: { completedAt: now, version: { increment: 1 } } });
  } else if (input.action === "move") {
    if (!input.columnId) throw new ApiError("VALIDATION_ERROR", "Choose a destination column.");
    const column = await prisma.column.findFirst({ where: { id: input.columnId, boardId: tasks[0]!.boardId, deletedAt: null } });
    if (!column) throw new ApiError("VALIDATION_ERROR", "That column is not on this board.");
    let last = await prisma.task.findFirst({ where: { columnId: input.columnId, deletedAt: null }, orderBy: { position: "desc" }, select: { position: true } });
    for (const task of tasks) {
      const position = appendAfter(last?.position ?? null);
      await prisma.task.update({ where: { id: task.id }, data: { columnId: input.columnId, position, version: { increment: 1 } } });
      last = { position };
    }
  }
  await recordAudit({
    workspaceId: input.workspaceId,
    actorId: viewer.user.id,
    action: `task.bulk_${input.action}`,
    entityType: "task",
    entityId: input.taskIds.join(","),
    requestId,
    metadata: { count: input.taskIds.length },
  });
  await recordActivity({
    workspaceId: input.workspaceId,
    actorId: viewer.user.id,
    action: `task.bulk_${input.action}`,
    entityType: "task",
    entityId: input.taskIds.join(","),
    requestId,
    metadata: { count: input.taskIds.length },
  });
  const undo = await createUndo({
    userId: viewer.user.id,
    workspaceId: input.workspaceId,
    action: `task.bulk_${input.action}`,
    entityType: "task",
    entityId: input.taskIds.join(","),
    inverse: { taskIds: input.taskIds, action: input.action },
    ttlSeconds: input.action === "delete" ? 10 : 60,
  });
  return { affected: input.taskIds.length, undo };
}

export async function getTaskDetail(viewer: Viewer, taskId: string, workspaceId: string) {
  const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
  const task = await findTaskInWorkspace(taskId, access.workspace.id);
  if (!canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id)) {
    throw new ApiError("TASK_NOT_FOUND");
  }
  const activity = await prisma.activityEvent.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { actor: { select: { id: true, name: true } } },
  });
  const automationRunIds = activity
    .filter((entry) => entry.action === "automation.applied" && entry.entityId)
    .map((entry) => entry.entityId!);
  const undoActions = automationRunIds.length
    ? await prisma.undoAction.findMany({
        where: {
          userId: viewer.user.id,
          workspaceId: access.workspace.id,
          entityId: { in: automationRunIds },
          expiresAt: { gt: new Date() },
        },
        select: { id: true, entityId: true },
      })
    : [];
  const undoByRun = new Map(undoActions.map((undo) => [undo.entityId, undo.id]));
  return {
    task: serializeTask(task),
    activity: activity.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actor: entry.actor,
      createdAt: entry.createdAt,
      metadata: entry.metadata ? safeJson(entry.metadata) : null,
      undoId: entry.action === "automation.applied" ? undoByRun.get(entry.entityId ?? "") ?? null : null,
    })),
    permissions: { canEdit: access.role !== "GUEST" },
    labels: await prisma.label.findMany({ where: { workspaceId: access.workspace.id }, orderBy: { name: "asc" } }),
    members: await prisma.membership.findMany({
      where: { workspaceId: access.workspace.id },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    }),
  };
}

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function taskTimelineSummary(tasks: any[], timeZone: string) {
  const grouped = new Map<string, number>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const date = dateStringInTimeZone(new Date(task.dueDate), timeZone);
    grouped.set(date, (grouped.get(date) ?? 0) + 1);
  }
  return Object.fromEntries(grouped);
}

import { prisma } from "./db";
import { ApiError } from "./errors";
import type { Viewer } from "./session";
import { requireBoard } from "./board-authz";
import { requireWorkspace } from "./authz";
import { canReadBoard } from "./rbac";
import { BOARD_TEMPLATES, findTemplate } from "./templates";
import { positionsBetween } from "./fractional";
import { createUndo } from "./undo";
import { recordActivity, recordAudit } from "./authz";
import { randomToken } from "./crypto";

export async function listVisibleBoards(viewer: Viewer, workspaceId: string) {
  const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
  const boards = await prisma.board.findMany({
    where: {
      workspaceId: access.workspace.id,
      deletedAt: null,
      OR: [
        { visibility: "workspace" },
        ...(access.role === "OWNER" || access.role === "ADMIN"
          ? [{ visibility: "private" }]
          : [{ visibility: "private", createdById: viewer.user.id }]),
      ],
    },
    include: {
      columns: { where: { deletedAt: null }, orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true, wipLimit: true } },
    },
    orderBy: [{ archivedAt: "asc" }, { updatedAt: "desc" }],
  });
  return { role: access.role, boards };
}

export async function createBoard(
  viewer: Viewer,
  workspaceId: string,
  input: { name: string; description?: string; template?: string; visibility?: "workspace" | "private" },
) {
  const access = await requireWorkspace(viewer, workspaceId, "MEMBER", "board:create");
  const template = findTemplate(input.template ?? "blank");
  const positions = positionsBetween(null, null, template.columns.length);
  const board = await prisma.$transaction(async (tx) => {
    const created = await tx.board.create({
      data: {
        workspaceId,
        name: input.name,
        description: input.description ?? template.description,
        visibility: input.visibility ?? "workspace",
        createdById: viewer.user.id,
        columns: {
          create: template.columns.map((column, index) => ({
            name: column.name,
            position: positions[index]!,
            isDone: column.isDone ?? false,
            wipLimit: column.wipLimit ?? null,
            wipEnforced: Boolean(column.wipLimit),
            createdById: viewer.user.id,
          })),
        },
      },
      include: { columns: { orderBy: { position: "asc" } } },
    });
    await tx.activityEvent.create({
      data: {
        workspaceId,
        actorId: viewer.user.id,
        action: "board.created",
        entityType: "board",
        entityId: created.id,
        requestId: "service",
        metadata: JSON.stringify({ name: created.name, template: template.id }),
      },
    });
    return created;
  });
  await recordAudit({
    workspaceId,
    actorId: viewer.user.id,
    action: "board.created",
    entityType: "board",
    entityId: board.id,
    requestId: "service",
    metadata: { template: template.id },
  });
  return { board, role: access.role };
}

export async function getBoardPayload(viewer: Viewer, workspaceId: string, boardId: string) {
  const access = await requireBoard(viewer, workspaceId, boardId, "GUEST");
  const board = access.board;
  const taskCount = await prisma.task.count({ where: { boardId, deletedAt: null } });
  const tasks = await prisma.task.findMany({
    where: { boardId, deletedAt: null, archivedAt: null },
    include: {
      labels: { include: { label: true } },
      subtasks: { orderBy: { position: "asc" } },
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
      dependencies: { include: { dependsOnTask: { select: { id: true, title: true, completedAt: true } } } },
      reminders: { orderBy: { remindAt: "asc" } },
      attachments: { where: { deletedAt: null }, select: { id: true, name: true, mimeType: true, size: true } },
      _count: { select: { comments: true, attachments: true } },
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 1000,
  });
  const [members, labels, views, activeRules] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.label.findMany({ where: { workspaceId }, orderBy: { name: "asc" } }),
    prisma.view.findMany({ where: { userId: viewer.user.id, workspaceId } }),
    prisma.automationRule.findMany({ where: { workspaceId, enabled: true, OR: [{ boardId }, { boardId: null }] } }),
  ]);
  return {
    board: {
      id: board.id,
      workspaceId: board.workspaceId,
      name: board.name,
      description: board.description,
      color: board.color,
      visibility: board.visibility,
      version: board.version,
      shareEnabled: board.shareEnabled,
      archivedAt: board.archivedAt,
      createdById: board.createdById,
      columns: board.columns,
    },
    tasks: tasks.map((task) => ({
      ...task,
      labels: task.labels.map((entry) => entry.label),
      openDependencies: task.dependencies.filter((entry) => !entry.dependsOnTask.completedAt).length,
      commentCount: task._count.comments,
      attachmentCount: task._count.attachments,
    })),
    taskCount,
    truncated: taskCount > 1000,
    members: members.map((member) => ({ ...member.user, role: member.role, membershipId: member.id })),
    labels,
    views,
    automationCount: activeRules.length,
    role: access.role,
    permissions: {
      canEdit: access.role !== "GUEST",
      canManage: access.role === "OWNER" || access.role === "ADMIN",
      canShare: canReadBoard(access.role, board.visibility, board.createdById, viewer.user.id) && access.role !== "GUEST",
    },
  };
}

export async function updateBoard(
  viewer: Viewer,
  workspaceId: string,
  boardId: string,
  input: { name?: string; description?: string; visibility?: string; archived?: boolean; version: number },
) {
  const access = await requireBoard(viewer, workspaceId, boardId, "MEMBER");
  if (access.board.version !== input.version) throw new ApiError("VERSION_CONFLICT", "This board changed elsewhere.", { currentVersion: access.board.version });
  if (access.board.createdById !== viewer.user.id && access.role === "MEMBER" && input.visibility) {
    throw new ApiError("FORBIDDEN", "Only the creator or an admin can change board permissions.");
  }
  const board = await prisma.board.update({
    where: { id: boardId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
      version: { increment: 1 },
    },
  });
  await recordAudit({
    workspaceId,
    actorId: viewer.user.id,
    action: input.archived ? "board.archived" : "board.updated",
    entityType: "board",
    entityId: boardId,
    requestId: "service",
    metadata: { fields: Object.keys(input).filter((key) => key !== "version") },
  });
  return board;
}

export async function duplicateBoard(viewer: Viewer, workspaceId: string, boardId: string) {
  const access = await requireBoard(viewer, workspaceId, boardId, "MEMBER");
  const source = await prisma.board.findUniqueOrThrow({
    where: { id: boardId },
    include: {
      columns: { where: { deletedAt: null }, orderBy: { position: "asc" } },
      tasks: {
        where: { deletedAt: null, archivedAt: null },
        include: { labels: true, subtasks: { orderBy: { position: "asc" } } },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!canReadBoard(access.role, source.visibility, source.createdById, viewer.user.id)) throw new ApiError("BOARD_NOT_FOUND");
  const columnPositions = positionsBetween(null, null, source.columns.length);
  const taskPositionsByColumn = new Map<string, string[]>();
  for (const column of source.columns) {
    const count = source.tasks.filter((task) => task.columnId === column.id).length;
    taskPositionsByColumn.set(column.id, positionsBetween(null, null, Math.max(1, count)));
  }
  const taskOrderIndex = new Map<string, number>();
  const copy = await prisma.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: {
        workspaceId,
        name: `${source.name} copy`,
        description: source.description,
        color: source.color,
        visibility: source.visibility,
        createdById: viewer.user.id,
      },
    });
    const columnMap = new Map<string, string>();
    for (let index = 0; index < source.columns.length; index++) {
      const column = source.columns[index]!;
      const created = await tx.column.create({
        data: {
          boardId: board.id,
          name: column.name,
          position: columnPositions[index]!,
          wipLimit: column.wipLimit,
          wipEnforced: column.wipEnforced,
          isDone: column.isDone,
          createdById: viewer.user.id,
        },
      });
      columnMap.set(column.id, created.id);
    }
    for (const task of source.tasks) {
      const index = taskOrderIndex.get(task.columnId) ?? 0;
      taskOrderIndex.set(task.columnId, index + 1);
      const taskPositions = taskPositionsByColumn.get(task.columnId)!;
      await tx.task.create({
        data: {
          workspaceId,
          boardId: board.id,
          columnId: columnMap.get(task.columnId)!,
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate,
          dueAllDay: task.dueAllDay,
          estimateMinutes: task.estimateMinutes,
          position: taskPositions[index]!,
          recurrenceRule: task.recurrenceRule,
          completedAt: task.completedAt,
          createdById: viewer.user.id,
          labels: { create: task.labels.map((entry) => ({ labelId: entry.labelId })) },
          subtasks: {
            create: task.subtasks.map((subtask) => ({ title: subtask.title, completed: subtask.completed, position: subtask.position })),
          },
        },
      });
    }
    return board;
  });
  await recordAudit({
    workspaceId,
    actorId: viewer.user.id,
    action: "board.duplicated",
    entityType: "board",
    entityId: copy.id,
    requestId: "service",
    metadata: { sourceBoardId: boardId },
  });
  return copy;
}

export async function deleteBoard(viewer: Viewer, workspaceId: string, boardId: string) {
  const access = await requireBoard(viewer, workspaceId, boardId, "ADMIN");
  if (access.board.deletedAt) throw new ApiError("BOARD_NOT_FOUND");
  const count = await prisma.board.count({ where: { workspaceId, deletedAt: null, archivedAt: null } });
  if (count <= 1) throw new ApiError("CONFLICT", "Keep at least one active board in the workspace.");
  await prisma.board.update({ where: { id: boardId }, data: { deletedAt: new Date(), version: { increment: 1 } } });
  await recordAudit({
    workspaceId,
    actorId: viewer.user.id,
    action: "board.deleted",
    entityType: "board",
    entityId: boardId,
    requestId: "service",
    metadata: { name: access.board.name },
  });
  const undo = await createUndo({
    userId: viewer.user.id,
    workspaceId,
    action: "board.delete",
    entityType: "board",
    entityId: boardId,
    inverse: { version: access.board.version },
    ttlSeconds: 10,
  });
  return { deleted: true, undo };
}

export async function toggleBoardShare(viewer: Viewer, workspaceId: string, boardId: string, enabled: boolean) {
  const access = await requireBoard(viewer, workspaceId, boardId, "MEMBER");
  if (!access.workspace.publicSharingEnabled) throw new ApiError("FEATURE_DISABLED", "Public sharing is disabled for this workspace.");
  if (access.role === "GUEST") throw new ApiError("FORBIDDEN");
  const token = enabled ? access.board.shareToken ?? randomToken(24) : null;
  const board = await prisma.board.update({
    where: { id: boardId },
    data: { shareEnabled: enabled, shareToken: token, version: { increment: 1 } },
  });
  await recordAudit({
    workspaceId,
    actorId: viewer.user.id,
    action: enabled ? "board.share_enabled" : "board.share_disabled",
    entityType: "board",
    entityId: boardId,
    requestId: "service",
  });
  return { enabled: board.shareEnabled, token: board.shareToken };
}

export async function createColumn(
  viewer: Viewer,
  workspaceId: string,
  input: { boardId: string; name: string; afterId?: string | null },
) {
  const access = await requireBoard(viewer, workspaceId, input.boardId, "MEMBER");
  if (access.board.columns.length >= 100) throw new ApiError("CONFLICT", "Boards support up to 100 columns.");
  const after = input.afterId ? access.board.columns.find((column) => column.id === input.afterId) : null;
  const index = after ? access.board.columns.findIndex((column) => column.id === after.id) : access.board.columns.length - 1;
  const positions = positionsBetween(
    index >= 0 ? access.board.columns[index]!.position : null,
    access.board.columns[index + 1]?.position ?? null,
    1,
  );
  const column = await prisma.column.create({
    data: {
      boardId: input.boardId,
      name: input.name,
      position: positions[0]!,
      createdById: viewer.user.id,
    },
  });
  await recordActivity({
    workspaceId,
    actorId: viewer.user.id,
    action: "column.created",
    entityType: "column",
    entityId: column.id,
    requestId: "service",
    metadata: { boardId: input.boardId },
  });
  return column;
}

export async function updateColumn(
  viewer: Viewer,
  workspaceId: string,
  boardId: string,
  columnId: string,
  input: { name?: string; wipLimit?: number | null; wipEnforced?: boolean; isDone?: boolean; position?: string },
) {
  const access = await requireBoard(viewer, workspaceId, boardId, "MEMBER");
  const column = access.board.columns.find((item) => item.id === columnId);
  if (!column) throw new ApiError("NOT_FOUND", "Column not found.");
  if (input.isDone === false && column.isDone) {
    const doneColumns = access.board.columns.filter((item) => item.isDone);
    if (doneColumns.length <= 1) throw new ApiError("CONFLICT", "At least one column must remain a done column.");
  }
  return prisma.column.update({
    where: { id: columnId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.wipLimit !== undefined ? { wipLimit: input.wipLimit } : {}),
      ...(input.wipEnforced !== undefined ? { wipEnforced: input.wipEnforced } : {}),
      ...(input.isDone !== undefined ? { isDone: input.isDone } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    },
  });
}

export async function deleteColumn(viewer: Viewer, workspaceId: string, boardId: string, columnId: string) {
  const access = await requireBoard(viewer, workspaceId, boardId, "MEMBER");
  if (access.board.columns.length <= 1) throw new ApiError("CONFLICT", "A board needs at least one column.");
  const count = await prisma.task.count({ where: { columnId, deletedAt: null } });
  if (count > 0) throw new ApiError("CONFLICT", `Move or delete the ${count} task${count === 1 ? "" : "s"} in this column first.`);
  await prisma.column.update({ where: { id: columnId }, data: { deletedAt: new Date() } });
  await recordActivity({
    workspaceId,
    actorId: viewer.user.id,
    action: "column.deleted",
    entityType: "column",
    entityId: columnId,
    requestId: "service",
    metadata: { boardId },
  });
  return { deleted: true };
}

export async function reorderColumns(viewer: Viewer, workspaceId: string, boardId: string, orderedIds: string[]) {
  const access = await requireBoard(viewer, workspaceId, boardId, "MEMBER");
  if (orderedIds.length !== access.board.columns.length) throw new ApiError("VALIDATION_ERROR", "Include every column exactly once.");
  const existing = new Set(access.board.columns.map((column) => column.id));
  if (orderedIds.some((id) => !existing.has(id))) throw new ApiError("VALIDATION_ERROR", "Unknown column in order.");
  const positions = positionsBetween(null, null, orderedIds.length);
  await prisma.$transaction(orderedIds.map((id, index) => prisma.column.update({ where: { id }, data: { position: positions[index]! } })));
  return { reordered: true };
}

export async function boardTemplateCatalog() {
  return BOARD_TEMPLATES;
}

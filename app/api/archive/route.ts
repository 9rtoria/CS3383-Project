import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace } from "@/lib/authz";
import { canReadBoard } from "@/lib/rbac";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
    const [tasks, boards] = await Promise.all([
      prisma.task.findMany({
        where: { workspaceId, deletedAt: null, OR: [{ archivedAt: { not: null } }, { completedAt: { not: null } }] },
        include: {
          labels: { include: { label: true } },
          board: { select: { id: true, name: true, visibility: true, createdById: true } },
          column: { select: { id: true, name: true, isDone: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 500,
      }),
      prisma.board.findMany({
        where: { workspaceId, deletedAt: null, archivedAt: { not: null } },
        include: { _count: { select: { tasks: { where: { deletedAt: null } } } } },
      }),
    ]);
    return ok({
      archivedBoards: boards
        .filter((board) => canReadBoard(access.role, board.visibility, board.createdById, viewer.user.id))
        .map((board) => ({ id: board.id, name: board.name, archivedAt: board.archivedAt, taskCount: board._count.tasks, version: board.version })),
      archivedTasks: tasks
        .filter((task) => canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id))
        .map((task) => ({
          id: task.id,
          title: task.title,
          board: { id: task.board.id, name: task.board.name },
          column: task.column,
          priority: task.priority,
          dueDate: task.dueDate,
          completedAt: task.completedAt,
          archivedAt: task.archivedAt,
          updatedAt: task.updatedAt,
          version: task.version,
          labels: task.labels.map((entry) => entry.label),
        })),
    });
  });
}

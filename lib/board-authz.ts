import { prisma } from "./db";
import { ApiError } from "./errors";
import type { Viewer } from "./session";
import { requireWorkspace, type WorkspaceAccess } from "./authz";
import { canReadBoard, type Role } from "./rbac";

export type BoardAccess = WorkspaceAccess & {
  board: NonNullable<Awaited<ReturnType<typeof loadBoard>>>;
};

async function loadBoard(boardId: string, workspaceId: string) {
  return prisma.board.findFirst({
    where: { id: boardId, workspaceId, deletedAt: null },
    include: { columns: { where: { deletedAt: null }, orderBy: { position: "asc" } } },
  });
}

export async function requireBoard(
  viewer: Viewer,
  workspaceId: string | null,
  boardId: string,
  minimum: Role = "GUEST",
): Promise<BoardAccess> {
  const access = await requireWorkspace(viewer, workspaceId, minimum);
  const board = await loadBoard(boardId, access.workspace.id);
  if (!board) throw new ApiError("BOARD_NOT_FOUND");
  if (!canReadBoard(access.role, board.visibility, board.createdById, viewer.user.id)) {
    throw new ApiError("BOARD_NOT_FOUND");
  }
  return { ...access, board };
}

export async function requireColumn(viewer: Viewer, workspaceId: string | null, boardId: string, columnId: string, minimum: Role = "GUEST") {
  const access = await requireBoard(viewer, workspaceId, boardId, minimum);
  const column = access.board.columns.find((item) => item.id === columnId);
  if (!column) throw new ApiError("NOT_FOUND", "Column not found.");
  return { ...access, column };
}

export async function countOpenTasksInColumn(columnId: string): Promise<number> {
  return prisma.task.count({ where: { columnId, deletedAt: null, archivedAt: null } });
}

import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";

type Params = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handleApi(req, async () => {
    const { token } = await params;
    const board = await prisma.board.findFirst({
      where: {
        shareToken: token,
        shareEnabled: true,
        deletedAt: null,
        workspace: { deletedAt: null, publicSharingEnabled: true },
      },
      include: {
        columns: { where: { deletedAt: null }, orderBy: { position: "asc" } },
        tasks: {
          where: { deletedAt: null, archivedAt: null },
          include: {
            labels: { include: { label: true } },
            subtasks: { orderBy: { position: "asc" }, select: { id: true, title: true, completed: true } },
            assignee: { select: { name: true, avatarUrl: true } },
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        },
        workspace: { select: { name: true } },
      },
    });
    if (!board) throw new ApiError("NOT_FOUND", "This shared board is no longer available.");
    return ok({
      board: {
        name: board.name,
        description: board.description,
        workspaceName: board.workspace.name,
        updatedAt: board.updatedAt,
        columns: board.columns.map((column) => ({
          id: column.id,
          name: column.name,
          wipLimit: column.wipLimit,
          isDone: column.isDone,
        })),
        tasks: board.tasks.map((task) => ({
          id: task.id,
          columnId: task.columnId,
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate,
          completedAt: task.completedAt,
          assignee: task.assignee,
          labels: task.labels.map((entry) => entry.label),
          subtasks: task.subtasks,
        })),
      },
    });
  }, { public: true, rateLimit: 240 });
}

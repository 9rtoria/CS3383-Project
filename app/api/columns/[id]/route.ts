import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { columnUpdateSchema } from "@/lib/validation";
import { deleteColumn, updateColumn } from "@/lib/board-service";
import { ApiError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

async function boardIdFor(viewer: any, workspaceId: string, columnId: string) {
  await requireWorkspace(viewer, workspaceId, "MEMBER", "content:write");
  const column = await prisma.column.findFirst({ where: { id: columnId, deletedAt: null, board: { workspaceId, deletedAt: null } }, select: { boardId: true } });
  if (!column) throw new ApiError("NOT_FOUND", "Column not found.");
  return column.boardId;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, body, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const boardId = await boardIdFor(viewer, workspaceId, id);
    const input = columnUpdateSchema.parse(body);
    const column = await updateColumn(viewer, workspaceId, boardId, id, input);
    return ok({ column });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const boardId = await boardIdFor(viewer, workspaceId, id);
    return ok(await deleteColumn(viewer, workspaceId, boardId, id));
  });
}

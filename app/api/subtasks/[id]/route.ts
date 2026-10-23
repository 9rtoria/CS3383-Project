import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace } from "@/lib/authz";
import { subtaskUpdateSchema } from "@/lib/validation";

async function getSubtask(id: string, workspaceId: string) {
  const subtask = await prisma.subtask.findFirst({
    where: { id, task: { workspaceId, deletedAt: null } },
    include: { task: { select: { id: true } } },
  });
  if (!subtask) throw new ApiError("NOT_FOUND", "Checklist item not found.");
  return subtask;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(req, async ({ viewer, body, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    await requireWorkspace(viewer, workspaceId, "MEMBER", "content:write");
    await getSubtask(id, workspaceId);
    const input = subtaskUpdateSchema.parse(body);
    const subtask = await prisma.subtask.update({
      where: { id },
      data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.completed !== undefined ? { completed: input.completed } : {}) },
    });
    return ok({ subtask });
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    await requireWorkspace(viewer, workspaceId, "MEMBER", "content:delete");
    await getSubtask(id, workspaceId);
    await prisma.subtask.delete({ where: { id } });
    return ok({ deleted: true });
  });
}

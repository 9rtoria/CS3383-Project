import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordActivity, findTaskInWorkspace } from "@/lib/authz";
import { appendAfter } from "@/lib/fractional";
import { subtaskSchema } from "@/lib/validation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(req, async ({ viewer, body, requestId, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const access = await requireWorkspace(viewer, workspaceId, "MEMBER", "content:write");
    const task = await findTaskInWorkspace(id, access.workspace.id);
    const input = subtaskSchema.parse(body);
    const last = await prisma.subtask.findFirst({ where: { taskId: id }, orderBy: { position: "desc" }, select: { position: true } });
    const subtask = await prisma.subtask.create({
      data: { taskId: task.id, title: input.title, position: appendAfter(last?.position ?? null) },
    });
    await recordActivity({
      workspaceId: access.workspace.id,
      taskId: id,
      actorId: viewer.user.id,
      action: "subtask.created",
      entityType: "subtask",
      entityId: subtask.id,
      requestId,
      metadata: { title: subtask.title },
    });
    return ok({ subtask }, 201);
  });
}

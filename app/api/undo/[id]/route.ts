import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace } from "@/lib/authz";
import { undoPayload } from "@/lib/undo";
import { recordAudit, recordActivity } from "@/lib/authz";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(req, async ({ viewer, requestId, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    await requireWorkspace(viewer, workspaceId, "MEMBER", "content:write");
    const undo = await prisma.undoAction.findFirst({
      where: { id, userId: viewer.user.id, workspaceId, expiresAt: { gt: new Date() } },
    });
    if (!undo) throw new ApiError("NOT_FOUND", "Undo window expired. The audit trail is still available.");
    const payload = undoPayload(undo);

    if (undo.action === "task.delete") {
      await prisma.task.update({
        where: { id: undo.entityId },
        data: { deletedAt: null, version: { increment: 1 } },
      });
    } else if (undo.action === "task.create") {
      await prisma.task.update({ where: { id: undo.entityId }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    } else if (undo.action === "task.move" || undo.action === "task.complete" || undo.action === "task.archive") {
      if (payload.removeNextTaskId) {
        await prisma.task.update({ where: { id: payload.removeNextTaskId }, data: { deletedAt: new Date() } }).catch(() => undefined);
      }
      await prisma.task.update({
        where: { id: undo.entityId },
        data: {
          ...(payload.columnId ? { columnId: payload.columnId } : {}),
          ...(payload.position ? { position: payload.position } : {}),
          ...(payload.completedAt !== undefined ? { completedAt: payload.completedAt ? new Date(payload.completedAt) : null } : {}),
          ...(payload.archivedAt !== undefined ? { archivedAt: payload.archivedAt ? new Date(payload.archivedAt) : null } : {}),
          version: { increment: 1 },
        },
      });
    } else if (undo.action.startsWith("task.bulk_")) {
      const ids = (payload.taskIds ?? []) as string[];
      if (payload.action === "delete") {
        await prisma.task.updateMany({ where: { id: { in: ids }, workspaceId }, data: { deletedAt: null, version: { increment: 1 } } });
      } else if (payload.action === "archive") {
        await prisma.task.updateMany({ where: { id: { in: ids }, workspaceId }, data: { archivedAt: null, version: { increment: 1 } } });
      } else if (payload.action === "complete") {
        await prisma.task.updateMany({ where: { id: { in: ids }, workspaceId }, data: { completedAt: null, version: { increment: 1 } } });
      } else {
        throw new ApiError("CONFLICT", "Bulk moves cannot be undone automatically. Move the tasks back from their current columns.");
      }
    } else if (undo.action === "board.delete") {
      await prisma.board.update({ where: { id: undo.entityId }, data: { deletedAt: null, version: { increment: 1 } } });
    } else if (undo.action === "automation.run") {
      const before = payload.before as Record<string, any>;
      if (before.priority) await prisma.task.update({ where: { id: payload.taskId }, data: { priority: before.priority, version: { increment: 1 } } });
      if (before.columnId) await prisma.task.update({ where: { id: payload.taskId }, data: { columnId: before.columnId, version: { increment: 1 } } });
      if (payload.after?.labelId) {
        await prisma.taskLabel.deleteMany({ where: { taskId: payload.taskId, labelId: payload.after.labelId } });
      }
      await prisma.automationRun.update({ where: { id: undo.entityId }, data: { undoneAt: new Date() } });
    } else {
      throw new ApiError("CONFLICT", "This action cannot be undone automatically.");
    }

    await prisma.undoAction.delete({ where: { id } });
    await recordActivity({
      workspaceId,
      taskId: undo.entityType === "task" ? undo.entityId : null,
      actorId: viewer.user.id,
      action: "action.undone",
      entityType: undo.entityType,
      entityId: undo.entityId,
      requestId,
      metadata: { originalAction: undo.action },
    });
    await recordAudit({
      workspaceId,
      actorId: viewer.user.id,
      action: "action.undone",
      entityType: undo.entityType,
      entityId: undo.entityId,
      requestId,
      metadata: { originalAction: undo.action },
    });
    return ok({ undone: true, action: undo.action });
  });
}

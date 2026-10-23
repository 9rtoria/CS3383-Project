import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordActivity } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

async function attachmentAccess(id: string, workspaceId: string, userId: string, role: string) {
  const attachment = await prisma.attachment.findFirst({
    where: {
      id,
      deletedAt: null,
      task: { workspaceId, deletedAt: null, board: { deletedAt: null } },
    },
    include: { task: { include: { board: { select: { visibility: true, createdById: true } } } } },
  });
  if (!attachment) throw new ApiError("NOT_FOUND", "Attachment not found.");
  if (attachment.task.board.visibility === "private" && attachment.task.board.createdById !== userId && role !== "OWNER" && role !== "ADMIN") {
    throw new ApiError("NOT_FOUND", "Attachment not found.");
  }
  return attachment;
}

export async function GET(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
    const attachment = await attachmentAccess(id, workspaceId, viewer.user.id, access.role);
    const filePath = path.join(process.cwd(), "data", "attachments", attachment.storageName);
    let data: Buffer;
    try {
      data = await fs.readFile(filePath);
    } catch {
      throw new ApiError("NOT_FOUND", "The stored file is missing.");
    }
    const safeName = attachment.name.replace(/["\r\n]/g, "_");
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(data.byteLength),
        "content-disposition": `attachment; filename="${safeName}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, req: request, requestId }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const access = await requireWorkspace(viewer, workspaceId, "MEMBER", "content:write");
    const attachment = await attachmentAccess(id, workspaceId, viewer.user.id, access.role);
    await prisma.attachment.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordActivity({
      workspaceId,
      taskId: attachment.taskId,
      actorId: viewer.user.id,
      action: "attachment.deleted",
      entityType: "attachment",
      entityId: id,
      requestId,
    });
    return ok({ deleted: true });
  });
}

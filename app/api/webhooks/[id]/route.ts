import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordAudit } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, req: request, requestId }) => {
    const { id } = await params;
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    await requireWorkspace(viewer, workspaceId, "ADMIN", "integration:manage");
    const hook = await prisma.webhook.findFirst({ where: { id, workspaceId: workspaceId! } });
    if (!hook) throw new ApiError("NOT_FOUND", "Webhook not found.");
    await prisma.webhook.delete({ where: { id } });
    await recordAudit({
      workspaceId: workspaceId!,
      actorId: viewer.user.id,
      action: "webhook.deleted",
      entityType: "webhook",
      entityId: id,
      requestId,
    });
    return ok({ deleted: true });
  });
}

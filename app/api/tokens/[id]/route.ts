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
    const token = await prisma.apiToken.findFirst({ where: { id, workspaceId: workspaceId!, userId: viewer.user.id } });
    if (!token) throw new ApiError("NOT_FOUND", "Token not found.");
    await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await recordAudit({
      workspaceId: workspaceId!,
      actorId: viewer.user.id,
      action: "api_token.revoked",
      entityType: "api_token",
      entityId: id,
      requestId,
    });
    return ok({ revoked: true });
  });
}

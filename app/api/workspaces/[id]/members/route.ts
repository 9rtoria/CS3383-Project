import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordAudit, recordActivity } from "@/lib/authz";
import { notifyUser } from "@/lib/notifications";

type Params = { params: Promise<{ id: string }> };

const roleSchema = z.object({ userId: z.string(), role: z.enum(["ADMIN", "MEMBER", "GUEST"]) });

export async function GET(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer }) => {
    const { id } = await params;
    const access = await requireWorkspace(viewer, id, "GUEST", "membership:read");
    const members = await prisma.membership.findMany({
      where: { workspaceId: id },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, mfaEnabled: true, lastSeenAt: true } } },
      orderBy: { joinedAt: "asc" },
    });
    return ok({ role: access.role, members: members.map((member) => ({ ...member.user, role: member.role, joinedAt: member.joinedAt })) });
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const { id } = await params;
    const access = await requireWorkspace(viewer, id, "ADMIN", "membership:manage");
    const input = roleSchema.parse(body);
    if (input.userId === viewer.user.id) throw new ApiError("CONFLICT", "You cannot change your own role.");
    const target = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: input.userId, workspaceId: id } } });
    if (!target) throw new ApiError("NOT_FOUND", "That person is not a member.");
    if (target.role === "OWNER" && access.role !== "OWNER") throw new ApiError("FORBIDDEN", "Only an owner can change another owner.");
    const membership = await prisma.membership.update({
      where: { id: target.id },
      data: { role: input.role },
    });
    await recordAudit({
      workspaceId: id,
      actorId: viewer.user.id,
      action: "membership.role_changed",
      entityType: "membership",
      entityId: membership.id,
      requestId,
      metadata: { userId: input.userId, from: target.role, to: input.role },
    });
    return ok({ membership });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, req: request, requestId }) => {
    const { id } = await params;
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (!userId) throw new ApiError("VALIDATION_ERROR", "Choose a member.");
    const access = await requireWorkspace(viewer, id, "GUEST");
    const target = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId: id } } });
    if (!target) throw new ApiError("NOT_FOUND", "That person is not a member.");
    const leaving = userId === viewer.user.id;
    if (!leaving && access.role !== "OWNER" && access.role !== "ADMIN") throw new ApiError("FORBIDDEN");
    if (!leaving && target.role === "OWNER" && access.role !== "OWNER") throw new ApiError("FORBIDDEN", "Only an owner can remove another owner.");
    const owners = await prisma.membership.count({ where: { workspaceId: id, role: "OWNER" } });
    if (target.role === "OWNER" && owners <= 1) throw new ApiError("CONFLICT", "Transfer ownership before removing the last owner.");
    await prisma.membership.delete({ where: { id: target.id } });
    await recordAudit({
      workspaceId: id,
      actorId: viewer.user.id,
      action: leaving ? "membership.left" : "membership.removed",
      entityType: "membership",
      entityId: target.id,
      requestId,
      metadata: { userId },
    });
    if (!leaving) {
      await notifyUser({
        userId,
        workspaceId: id,
        type: "membership.removed",
        title: "You no longer have access to a workspace",
        body: `${viewer.user.name} removed you from ${access.workspace.name}.`,
      }).catch(() => undefined);
    } else {
      await recordActivity({
        workspaceId: id,
        actorId: viewer.user.id,
        action: "membership.left",
        entityType: "membership",
        entityId: target.id,
        requestId,
      });
    }
    return ok({ removed: true });
  });
}

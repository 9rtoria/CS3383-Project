import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordAudit } from "@/lib/authz";
import { workspacePolicySchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer }) => {
    const { id } = await params;
    const access = await requireWorkspace(viewer, id, "GUEST", "workspace:read");
    const [members, invites, boards] = await Promise.all([
      prisma.membership.findMany({
        where: { workspaceId: id },
        include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, mfaEnabled: true } } },
        orderBy: { joinedAt: "asc" },
      }),
      prisma.invite.findMany({ where: { workspaceId: id, acceptedAt: null }, orderBy: { createdAt: "desc" } }),
      prisma.board.count({ where: { workspaceId: id, deletedAt: null } }),
    ]);
    return ok({
      workspace: access.workspace,
      role: access.role,
      boards,
      members: members.map((member) => ({ ...member.user, role: member.role, joinedAt: member.joinedAt })),
      invites: invites.map((invite) => ({ id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt, createdAt: invite.createdAt })),
    });
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const { id } = await params;
    const access = await requireWorkspace(viewer, id, "ADMIN", "workspace:update");
    const input = workspacePolicySchema.parse(body);
    if (access.workspace.type === "personal" && (input.requireMfa !== undefined || input.retentionDays !== undefined || input.auditRetentionDays !== undefined)) {
      throw new ApiError("VALIDATION_ERROR", "Enterprise policies apply to team or organization workspaces.");
    }
    if (access.workspace.version !== input.version) throw new ApiError("VERSION_CONFLICT", "These settings changed elsewhere.", { currentVersion: access.workspace.version });
    const { version: _version, ...changes } = input;
    const workspace = await prisma.workspace.update({
      where: { id },
      data: { ...changes, version: { increment: 1 } },
    });
    await recordAudit({
      workspaceId: id,
      actorId: viewer.user.id,
      action: "workspace.policies_updated",
      entityType: "workspace",
      entityId: id,
      requestId,
      metadata: { fields: Object.keys(changes) },
    });
    return ok({ workspace });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, requestId }) => {
    const { id } = await params;
    const access = await requireWorkspace(viewer, id, "OWNER", "workspace:delete");
    const active = await prisma.membership.count({
      where: { userId: viewer.user.id, workspaceId: { not: id }, workspace: { deletedAt: null } },
    });
    if (active === 0) throw new ApiError("CONFLICT", "Create another workspace before deleting your only one.");
    await prisma.workspace.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    await recordAudit({
      workspaceId: id,
      actorId: viewer.user.id,
      action: "workspace.deleted",
      entityType: "workspace",
      entityId: id,
      requestId,
    });
    return ok({ deleted: true });
  });
}

import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { clearSessionCookie, revokeAllSessions } from "@/lib/session";
import { recordAudit } from "@/lib/authz";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().max(80).optional(),
});

export async function PATCH(req: NextRequest) {
  return handleApi(req, async ({ viewer, body }) => {
    const input = updateSchema.parse(body);
    const user = await prisma.user.update({
      where: { id: viewer.user.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
      },
      select: { id: true, name: true, email: true, timezone: true, isGuest: true, mfaEnabled: true },
    });
    return ok({ user });
  });
}

export async function DELETE(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const input = z.object({ confirm: z.literal("DELETE") }).parse(body);
    void input;
    const memberships = await prisma.membership.findMany({
      where: { userId: viewer.user.id },
      include: {
        workspace: {
          include: { _count: { select: { memberships: true } } },
        },
      },
    });
    const sharedOwner = memberships.find((membership) => membership.role === "OWNER" && membership.workspace.type !== "personal" && membership.workspace._count.memberships > 1);
    if (sharedOwner) {
      throw new ApiError("CONFLICT", "Transfer ownership of your team workspaces before deleting your account.");
    }
    const personalIds = memberships.filter((membership) => membership.workspace.type === "personal").map((membership) => membership.workspaceId);
    await prisma.$transaction([
      prisma.workspace.updateMany({ where: { id: { in: personalIds } }, data: { deletedAt: new Date() } }),
      prisma.user.update({ where: { id: viewer.user.id }, data: { deletedAt: new Date(), email: null, passwordHash: null, mfaSecretEnc: null, mfaBackupCodesJson: null } }),
      prisma.session.updateMany({ where: { userId: viewer.user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await Promise.all(
      memberships
        .filter((membership) => membership.workspace.type !== "personal")
        .map((membership) =>
          recordAudit({
            workspaceId: membership.workspaceId,
            actorId: viewer.user.id,
            action: "account.deleted",
            entityType: "user",
            entityId: viewer.user.id,
            requestId,
          }).catch(() => undefined),
        ),
    );
    const response = ok({ deleted: true });
    response.cookies.set(clearSessionCookie());
    return response;
  });
}

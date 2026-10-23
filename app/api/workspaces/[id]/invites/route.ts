import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordAudit } from "@/lib/authz";
import { inviteSchema } from "@/lib/validation";
import { randomToken, sha256 } from "@/lib/crypto";
import { queueEmail, inviteEmail } from "@/lib/email";
import { appUrl, featureFlags } from "@/lib/env";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer }) => {
    const { id } = await params;
    await requireWorkspace(viewer, id, "ADMIN", "membership:manage");
    const invites = await prisma.invite.findMany({ where: { workspaceId: id, acceptedAt: null }, orderBy: { createdAt: "desc" } });
    return ok({ invites });
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const { id } = await params;
    const access = await requireWorkspace(viewer, id, "ADMIN", "user:invite");
    const input = inviteSchema.parse({ ...(body as object), workspaceId: id });
    const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
    if (existingUser) {
      const existingMembership = await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: existingUser.id, workspaceId: id } },
      });
      if (existingMembership) throw new ApiError("CONFLICT", "That person is already a member.");
    }
    const token = randomToken(32);
    const invite = await prisma.invite.create({
      data: {
        workspaceId: id,
        email: input.email,
        role: input.role,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdById: viewer.user.id,
      },
    });
    const mail = inviteEmail(input.email, access.workspace.name, input.role, token);
    await queueEmail(mail);
    await recordAudit({
      workspaceId: id,
      actorId: viewer.user.id,
      action: "invite.created",
      entityType: "invite",
      entityId: invite.id,
      requestId,
      metadata: { email: input.email, role: input.role },
    });
    return ok({
      invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt },
      devUrl: featureFlags.devEmailPreview ? `${appUrl()}/invite/${encodeURIComponent(token)}` : undefined,
    }, 201);
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, req: request, requestId }) => {
    const { id } = await params;
    await requireWorkspace(viewer, id, "ADMIN", "membership:manage");
    const inviteId = new URL(request.url).searchParams.get("inviteId");
    if (!inviteId) throw new ApiError("VALIDATION_ERROR", "Choose an invite.");
    await prisma.invite.deleteMany({ where: { id: inviteId, workspaceId: id, acceptedAt: null } });
    await recordAudit({
      workspaceId: id,
      actorId: viewer.user.id,
      action: "invite.revoked",
      entityType: "invite",
      entityId: inviteId,
      requestId,
    });
    return ok({ revoked: true });
  });
}

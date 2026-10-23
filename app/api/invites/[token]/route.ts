import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";
import { recordAudit } from "@/lib/authz";

type Params = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer }) => {
    const { token } = await params;
    const invite = await prisma.invite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { workspace: { select: { id: true, name: true, type: true } } },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new ApiError("INVALID_TOKEN", "This invitation is invalid or has expired.");
    return ok({
      invite: { email: invite.email, role: invite.role, workspace: invite.workspace, expiresAt: invite.expiresAt },
      canAccept: viewer.user.email?.toLowerCase() === invite.email.toLowerCase(),
    });
  }, { public: true });
}

export async function POST(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, requestId }) => {
    const { token } = await params;
    const invite = await prisma.invite.findUnique({ where: { tokenHash: sha256(token) } });
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw new ApiError("INVALID_TOKEN", "This invitation is invalid or has expired.");
    if (!viewer.user.email || viewer.user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ApiError("FORBIDDEN", `Sign in as ${invite.email} to accept this invitation.`);
    }
    const workspace = await prisma.workspace.findFirst({ where: { id: invite.workspaceId, deletedAt: null } });
    if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND");
    await prisma.$transaction([
      prisma.membership.upsert({
        where: { userId_workspaceId: { userId: viewer.user.id, workspaceId: invite.workspaceId } },
        update: { role: invite.role },
        create: { userId: viewer.user.id, workspaceId: invite.workspaceId, role: invite.role },
      }),
      prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
    ]);
    await recordAudit({
      workspaceId: invite.workspaceId,
      actorId: viewer.user.id,
      action: "invite.accepted",
      entityType: "invite",
      entityId: invite.id,
      requestId,
      metadata: { role: invite.role },
    });
    return ok({ accepted: true, workspaceId: invite.workspaceId, workspaceName: workspace.name });
  });
}

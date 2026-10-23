import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireWorkspace, recordAudit } from "@/lib/authz";
import { apiTokenSchema } from "@/lib/validation";
import { randomToken, sha256 } from "@/lib/crypto";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    await requireWorkspace(viewer, workspaceId, "ADMIN", "integration:manage");
    const tokens = await prisma.apiToken.findMany({
      where: { userId: viewer.user.id, workspaceId: workspaceId!, revokedAt: null },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return ok({ tokens });
  });
}

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const input = apiTokenSchema.parse(body);
    await requireWorkspace(viewer, input.workspaceId, "ADMIN", "integration:manage");
    const raw = `drift_pat_${randomToken(32)}`;
    const token = await prisma.apiToken.create({
      data: {
        userId: viewer.user.id,
        workspaceId: input.workspaceId,
        name: input.name,
        tokenHash: sha256(raw),
        prefix: raw.slice(0, 18),
        expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
      },
    });
    await recordAudit({
      workspaceId: input.workspaceId,
      actorId: viewer.user.id,
      action: "api_token.created",
      entityType: "api_token",
      entityId: token.id,
      requestId,
      metadata: { name: token.name },
    });
    return ok({ token: raw, record: { id: token.id, name: token.name, prefix: token.prefix, expiresAt: token.expiresAt } }, 201);
  });
}

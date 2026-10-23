import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prepareMfa, enableMfa, disableMfa } from "@/lib/auth-service";
import { mfaEnableSchema, mfaVerifySchema } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/authz";
import { workspaceIdFrom } from "@/lib/authz";
import { z } from "zod";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer }) => {
    const status = await prisma.user.findUnique({
      where: { id: viewer.user.id },
      select: { mfaEnabled: true },
    });
    const sessions = await prisma.session.findMany({
      where: { userId: viewer.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
      select: { id: true, createdAt: true, lastUsedAt: true, userAgent: true, ipHash: true },
    });
    return ok({
      mfaEnabled: status?.mfaEnabled ?? false,
      sessions: sessions.map((session) => ({
        ...session,
        current: session.id === viewer.sessionId,
        device: session.userAgent ?? "Unknown device",
      })),
    });
  });
}

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body }) => {
    const action = z.object({ action: z.enum(["setup", "enable", "disable"]), secret: z.string().optional(), code: z.string().optional() }).parse(body);
    if (action.action === "setup") {
      const setup = await prepareMfa(viewer.user.id);
      return ok(setup);
    }
    if (action.action === "enable") {
      const input = mfaEnableSchema.parse({ secret: action.secret, code: action.code });
      const result = await enableMfa(viewer.user.id, viewer.sessionId, input.secret, input.code);
      // MFA is account-level, so it is only attributable to a workspace when one
      // was explicitly selected. Never manufacture an empty tenant identifier.
      const workspaceId = workspaceIdFrom(req);
      if (workspaceId) {
        await recordAudit({
          workspaceId,
          actorId: viewer.user.id,
          action: "security.mfa.enabled",
          entityType: "user",
          entityId: viewer.user.id,
          requestId: crypto.randomUUID(),
        }).catch(() => undefined);
      }
      return ok(result);
    }
    const input = mfaVerifySchema.parse({ code: action.code });
    await disableMfa(viewer.user.id, input.code);
    return ok({ mfaEnabled: false });
  });
}

export async function DELETE(req: NextRequest) {
  return handleApi(req, async ({ viewer, body }) => {
    const { sessionId } = z.object({ sessionId: z.string() }).parse(body);
    if (sessionId === viewer.sessionId) return ok({ revoked: false, reason: "Use sign out for the current session." });
    await prisma.session.updateMany({ where: { id: sessionId, userId: viewer.user.id }, data: { revokedAt: new Date() } });
    return ok({ revoked: true });
  });
}


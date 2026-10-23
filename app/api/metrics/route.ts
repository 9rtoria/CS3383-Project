import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/authz";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    let scope: { workspaceId?: string } = {};
    if (workspaceId) {
      await requireWorkspace(viewer, workspaceId, "ADMIN", "audit:read");
      scope = { workspaceId };
    }
    const [tasks, boards, members, notifications, emails] = await Promise.all([
      prisma.task.count({ where: { ...scope, deletedAt: null } }),
      prisma.board.count({ where: { ...scope, deletedAt: null } }),
      scope.workspaceId ? prisma.membership.count({ where: { workspaceId: scope.workspaceId } }) : Promise.resolve(0),
      prisma.notification.count({ where: { userId: viewer.user.id, readAt: null } }),
      scope.workspaceId ? prisma.emailMessage.count({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } } }) : Promise.resolve(0),
    ]);
    return ok({
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      tenant: { tasks, boards, members, emailsLast24h: emails },
      unreadNotifications: notifications,
    });
  });
}

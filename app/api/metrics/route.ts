import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/authz";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    const unreadNotifications = await prisma.notification.count({ where: { userId: viewer.user.id, readAt: null } });
    if (!workspaceId) {
      // Never expose aggregate counts from other tenants. Process metrics are
      // safe; tenant counters require an explicit workspace plus ADMIN access.
      return ok({
        process: {
          uptimeSeconds: Math.round(process.uptime()),
          node: process.version,
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
        tenant: { tasks: 0, boards: 0, members: 0, emailsLast24h: 0 },
        unreadNotifications,
      });
    }
    await requireWorkspace(viewer, workspaceId, "ADMIN", "audit:read");
    const [tasks, boards, members, emails] = await Promise.all([
      prisma.task.count({ where: { workspaceId, deletedAt: null } }),
      prisma.board.count({ where: { workspaceId, deletedAt: null } }),
      prisma.membership.count({ where: { workspaceId } }),
      prisma.emailMessage.count({ where: { userId: viewer.user.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);
    return ok({
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      tenant: { tasks, boards, members, emailsLast24h: emails },
      unreadNotifications,
    });
  });
}

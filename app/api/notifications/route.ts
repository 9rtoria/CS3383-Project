import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notificationUpdateSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer }) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: viewer.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return ok({
      notifications,
      unreadCount: notifications.filter((notification) => !notification.readAt).length,
    });
  });
}

export async function PATCH(req: NextRequest) {
  return handleApi(req, async ({ viewer, body }) => {
    const input = notificationUpdateSchema.extend({ id: z.string().optional() }).parse(body);
    if (!input.read) return ok({ updated: 0 });
    if (input.all) {
      const result = await prisma.notification.updateMany({
        where: { userId: viewer.user.id, readAt: null },
        data: { readAt: new Date() },
      });
      return ok({ updated: result.count });
    }
    if (!input.id) return ok({ updated: 0 });
    const result = await prisma.notification.updateMany({
      where: { id: input.id, userId: viewer.user.id },
      data: { readAt: new Date() },
    });
    return ok({ updated: result.count });
  });
}

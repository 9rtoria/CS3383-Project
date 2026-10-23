import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { settingsSchema } from "@/lib/validation";
import { safeTimeZone } from "@/lib/time";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer }) => {
    const [settings, user] = await Promise.all([
      prisma.userSettings.upsert({
        where: { userId: viewer.user.id },
        update: {},
        create: { userId: viewer.user.id, capacityMinutes: 300 },
      }),
      prisma.user.findUniqueOrThrow({
        where: { id: viewer.user.id },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          timezone: true,
          isGuest: true,
          mfaEnabled: true,
          emailVerified: true,
        },
      }),
    ]);
    return ok({ settings, user });
  });
}

export async function PATCH(req: NextRequest) {
  return handleApi(req, async ({ viewer, body }) => {
    const input = settingsSchema.parse(body);
    const { timezone, ...preferences } = input;
    const [settings, user] = await prisma.$transaction([
      prisma.userSettings.upsert({
        where: { userId: viewer.user.id },
        update: preferences,
        create: { userId: viewer.user.id, capacityMinutes: preferences.capacityMinutes ?? 300, ...preferences },
      }),
      prisma.user.update({
        where: { id: viewer.user.id },
        data: {
          ...(timezone ? { timezone: safeTimeZone(timezone, viewer.user.timezone) } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          timezone: true,
          isGuest: true,
          mfaEnabled: true,
          emailVerified: true,
        },
      }),
    ]);
    return ok({ settings, user });
  });
}

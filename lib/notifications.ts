import { prisma } from "./db";

export async function notifyUser(input: {
  userId: string;
  workspaceId?: string | null;
  taskId?: string | null;
  type: string;
  title: string;
  body?: string;
  link?: string;
}) {
  const settings = await prisma.userSettings.findUnique({ where: { userId: input.userId } });
  let preferences: Record<string, boolean> = { inApp: true, email: true, mentions: true };
  try {
    if (settings?.notificationsJson) preferences = { ...preferences, ...JSON.parse(settings.notificationsJson) };
  } catch {
    // Invalid legacy preference JSON falls back to safe defaults.
  }
  if ((input.type.includes("mention") || input.type.includes("assign")) && preferences.mentions === false) return null;
  if (!preferences.inApp) return null;
  return prisma.notification.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      taskId: input.taskId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? "",
      link: input.link ?? null,
    },
  });
}

export async function notifyWorkspaceAdmins(workspaceId: string, input: OmittingInput, excludeUserId?: string) {
  const admins = await prisma.membership.findMany({
    where: { workspaceId, role: { in: ["OWNER", "ADMIN"] }, ...(excludeUserId ? { userId: { not: excludeUserId } } : {}) },
    select: { userId: true },
  });
  await Promise.all(
    admins.map((admin) =>
      notifyUser({
        userId: admin.userId,
        workspaceId,
        ...input,
      }),
    ),
  );
}

type OmittingInput = {
  type: string;
  title: string;
  body?: string;
  link?: string;
  taskId?: string | null;
};

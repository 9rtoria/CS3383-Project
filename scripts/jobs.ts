import "dotenv/config";
import { prisma } from "../lib/db";
import { attemptSend, digestEmail, queueEmail, reminderEmail } from "../lib/email";
import { formatDate } from "../lib/format";
import { notifyUser } from "../lib/notifications";
import { appUrl } from "../lib/env";
import { attemptWebhookDelivery } from "../lib/webhooks";

type Result = Record<string, number>;

async function job(name: string, run: () => Promise<Result>) {
  const record = await prisma.jobRun.create({ data: { name } });
  const started = Date.now();
  try {
    const details = await run();
    await prisma.jobRun.update({
      where: { id: record.id },
      data: { finishedAt: new Date(), status: "ok", details: JSON.stringify(details) },
    });
    console.log(`✓ ${name} (${Date.now() - started}ms) ${JSON.stringify(details)}`);
  } catch (error) {
    await prisma.jobRun.update({
      where: { id: record.id },
      data: { finishedAt: new Date(), status: "failed", details: String(error).slice(0, 2000) },
    });
    console.error(`✗ ${name}:`, error);
    process.exitCode = 1;
  }
}

async function housekeeping(): Promise<Result> {
  const now = new Date();
  const day = 86_400_000;
  const [sessions, magic, idempotency, deliveries, emails, errors, undo] = await Promise.all([
    prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 30 * day) } }, { revokedAt: { lt: new Date(now.getTime() - 30 * day) } }] } }),
    prisma.magicLinkToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - day) } } }),
    prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * day) } } }),
    prisma.emailMessage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * day) }, status: { in: ["sent", "failed", "preview"] } } }),
    prisma.clientError.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * day) } } }),
    prisma.undoAction.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return {
    sessions: sessions.count,
    magicLinks: magic.count,
    idempotencyKeys: idempotency.count,
    webhookDeliveries: deliveries.count,
    emailMessages: emails.count,
    clientErrors: errors.count,
    undoActions: undo.count,
  };
}

async function retryEmail(): Promise<Result> {
  if (!process.env.SMTP_URL) return { skipped: 1, sent: 0 };
  const messages = await prisma.emailMessage.findMany({
    where: { status: { in: ["queued", "failed"] }, createdAt: { lt: new Date(Date.now() - 60_000) } },
    orderBy: { createdAt: "asc" },
    take: 25,
  });
  let sent = 0;
  for (const message of messages) if (await attemptSend(message.id)) sent += 1;
  return { attempted: messages.length, sent };
}

async function dailyDigests(): Promise<Result> {
  const users = await prisma.user.findMany({
    where: { email: { not: null }, isGuest: false, deletedAt: null, settings: { emailDigest: true } },
    include: { settings: true, memberships: { where: { workspace: { deletedAt: null } }, include: { workspace: true } } },
    take: 500,
  });
  let queued = 0;
  for (const user of users) {
    if (!user.email || !user.settings) continue;
    let localHour = new Date().getUTCHours();
    try {
      localHour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: user.timezone }).format(new Date()));
    } catch {
      localHour = new Date().getUTCHours();
    }
    if (localHour !== user.settings.digestHour) continue;
    if (isQuietHour(localHour, user.settings.quietStart, user.settings.quietEnd)) continue;
    const already = await prisma.emailMessage.findFirst({
      where: { userId: user.id, kind: "digest", createdAt: { gte: new Date(Date.now() - 20 * 3_600_000) } },
      select: { id: true },
    });
    if (already) continue;
    const workspaceIds = user.memberships.map((membership) => membership.workspaceId);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const tasks = await prisma.task.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        deletedAt: null,
        archivedAt: null,
        completedAt: null,
        OR: [{ focusDate: today }, { dueDate: { lte: new Date(Date.now() + 86_400_000) } }],
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
      take: 12,
    });
    if (!tasks.length) continue;
    const sections = [
      { title: "Today", lines: tasks.slice(0, 6).map((task) => `${task.title}${task.dueDate ? ` — due ${formatDate(task.dueDate, { month: "short", day: "numeric" })}` : ""}`) },
      { title: "Also on the horizon", lines: tasks.slice(6).map((task) => task.title) },
    ].filter((section) => section.lines.length);
    await queueEmail({ ...digestEmail(user.email, user.name, sections), userId: user.id, sendNow: true });
    queued += 1;
  }
  return { users: users.length, digestsQueued: queued };
}

function localHour(timezone: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: timezone }).format(new Date()));
  } catch {
    return new Date().getUTCHours();
  }
}

function isQuietHour(hour: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

async function dueReminders(): Promise<Result> {
  const now = new Date();
  const reminders = await prisma.reminder.findMany({
    where: { sentAt: null, remindAt: { lte: now } },
    include: {
      task: { include: { board: { select: { id: true, name: true } } } },
      user: { include: { settings: true } },
    },
    orderBy: { remindAt: "asc" },
    take: 200,
  });
  let delivered = 0;
  let emailed = 0;
  let skipped = 0;
  let deferred = 0;
  for (const reminder of reminders) {
    const task = reminder.task;
    if (!task || task.deletedAt || task.archivedAt || task.completedAt) {
      await prisma.reminder.update({ where: { id: reminder.id }, data: { sentAt: now } });
      skipped += 1;
      continue;
    }
    const settings = reminder.user.settings;
    const hour = localHour(reminder.user.timezone);
    if (isQuietHour(hour, settings?.quietStart ?? null, settings?.quietEnd ?? null)) {
      deferred += 1;
      continue;
    }
    let preferences: Record<string, boolean> = { inApp: true, email: true };
    try {
      if (settings?.notificationsJson) preferences = { ...preferences, ...JSON.parse(settings.notificationsJson) };
    } catch {
      // Keep safe defaults when legacy preference JSON is invalid.
    }
    const link = `/?view=board&board=${encodeURIComponent(task.boardId)}&task=${encodeURIComponent(task.id)}`;
    const notification = await notifyUser({
      userId: reminder.userId,
      workspaceId: task.workspaceId,
      taskId: task.id,
      type: "reminder",
      title: task.title,
      body: `Reminder from ${task.board.name}`,
      link,
    });
    if (notification) delivered += 1;
    if (reminder.channel !== "in_app" && reminder.user.email && preferences.email !== false) {
      await queueEmail({
        ...reminderEmail(reminder.user.email, task.title, task.board.name, `${appUrl().replace(/\/$/, "")}${link}`),
        userId: reminder.userId,
      });
      emailed += 1;
    }
    await prisma.reminder.update({ where: { id: reminder.id }, data: { sentAt: now } });
  }
  return { due: reminders.length, delivered, emailed, skipped, deferred };
}

async function webhookRetry(): Promise<Result> {
  const due = await prisma.webhookDelivery.findMany({
    where: {
      attempts: { lt: 3 },
      nextAttemptAt: { lte: new Date() },
      OR: [{ status: null }, { status: { gte: 400 } }],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: 25,
    select: { id: true },
  });
  let sent = 0;
  for (const delivery of due) if (await attemptWebhookDelivery(delivery.id)) sent += 1;
  return { due: due.length, sent };
}

async function retention(): Promise<Result> {
  const workspaces = await prisma.workspace.findMany({ where: { deletedAt: null }, select: { id: true, retentionDays: true, auditRetentionDays: true } });
  let archivedTasks = 0;
  let auditEvents = 0;
  for (const workspace of workspaces) {
    const taskCutoff = new Date(Date.now() - Math.max(1, workspace.retentionDays) * 86_400_000);
    const auditCutoff = new Date(Date.now() - Math.max(30, workspace.auditRetentionDays) * 86_400_000);
    const [tasks, audits] = await Promise.all([
      prisma.task.updateMany({
        where: { workspaceId: workspace.id, archivedAt: { lt: taskCutoff }, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
      prisma.auditEvent.deleteMany({ where: { workspaceId: workspace.id, createdAt: { lt: auditCutoff } } }),
    ]);
    archivedTasks += tasks.count;
    auditEvents += audits.count;
  }
  return { archivedTasksSoftDeleted: archivedTasks, auditEventsPurged: auditEvents };
}

async function main() {
  const command = process.argv[2] ?? "all";
  if (command === "all" || command === "housekeeping") await job("housekeeping", housekeeping);
  if (command === "all" || command === "email") await job("email-retry", retryEmail);
  if (command === "all" || command === "reminders") await job("due-reminders", dueReminders);
  if (command === "all" || command === "webhooks") await job("webhook-retry", webhookRetry);
  if (command === "all" || command === "digest") await job("daily-digests", dailyDigests);
  if (command === "all" || command === "retention") await job("retention", retention);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

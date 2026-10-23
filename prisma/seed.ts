import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";
import { hashPassword } from "../lib/crypto";
import { positionsBetween } from "../lib/fractional";

const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

const DEMO_EMAIL = "demo@drift.local";
const DEMO_PASSWORD = "DriftDemo123!";

function at(daysFromNow: number, hour = 17, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function ymd(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    const owned = await prisma.membership.findMany({ where: { userId: existing.id, role: "OWNER" }, select: { workspaceId: true } });
    await prisma.workspace.deleteMany({ where: { id: { in: owned.map((item) => item.workspaceId) } } });
    await prisma.user.delete({ where: { id: existing.id } });
    console.log("• Removed the previous demo account.");
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      emailVerified: new Date(),
      passwordHash,
      name: "Maya Chen",
      isGuest: false,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      settings: { create: { capacityMinutes: 300, emailDigest: true, digestHour: 8, weekStartsOn: 1 } },
    },
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: "Northstar Studio",
      type: "team",
      icon: "compass",
      memberships: { create: { userId: user.id, role: "OWNER" } },
      labels: {
        create: [
          { name: "Strategy", color: "violet" },
          { name: "Writing", color: "blue" },
          { name: "Web", color: "moss" },
          { name: "Research", color: "amber" },
          { name: "Ops", color: "slate" },
          { name: "Video", color: "rose" },
        ],
      },
    },
    include: { labels: true },
  });

  const label = (name: string) => workspace.labels.find((item) => item.name === name)!.id;

  const launch = await prisma.board.create({
    data: {
      workspaceId: workspace.id,
      name: "Launch runway",
      description: "Everything between the first draft and a confident launch.",
      createdById: user.id,
      visibility: "workspace",
    },
  });
  const columnSpecs = [
    { name: "Backlog", isDone: false, wipLimit: null },
    { name: "Next up", isDone: false, wipLimit: 5 },
    { name: "In progress", isDone: false, wipLimit: 3 },
    { name: "Review", isDone: false, wipLimit: 4 },
    { name: "Done", isDone: true, wipLimit: null },
  ];
  const launchPositions = positionsBetween(null, null, columnSpecs.length);
  const launchColumns: Record<string, string> = {};
  for (let index = 0; index < columnSpecs.length; index += 1) {
    const spec = columnSpecs[index]!;
    const column = await prisma.column.create({
      data: {
        boardId: launch.id,
        name: spec.name,
        isDone: spec.isDone,
        wipLimit: spec.wipLimit,
        position: launchPositions[index]!,
        createdById: user.id,
      },
    });
    launchColumns[spec.name] = column.id;
  }

  type TaskSpec = {
    title: string;
    column: string;
    description?: string;
    priority?: string;
    due?: Date | null;
    dueAllDay?: boolean;
    estimate?: number | null;
    labels?: string[];
    focus?: string | null;
    completedAt?: Date | null;
    subtasks?: string[];
    comment?: string;
  };

  const tasks: TaskSpec[] = [
    {
      title: "Shape the launch story",
      column: "Next up",
      description: "One sentence for the homepage, three proof points, and the demo path. Keep the promise concrete.",
      priority: "high",
      due: at(1, 14),
      dueAllDay: false,
      estimate: 45,
      labels: ["Strategy", "Writing"],
      focus: ymd(0),
      subtasks: ["Write the one-liner", "Choose three proof points", "Read it aloud"],
      comment: "Start from the customer's words, not our feature list.",
    },
    {
      title: "Draft the announcement",
      column: "In progress",
      description: "Short, warm, and specific. Link the demo instead of explaining every feature.",
      priority: "medium",
      due: at(2, 16),
      dueAllDay: false,
      estimate: 60,
      labels: ["Writing"],
      focus: ymd(1),
      subtasks: ["Opening paragraph", "What changed", "Call to action"],
    },
    {
      title: "Review onboarding copy",
      column: "Review",
      description: "Check the first-run screen, empty states, and the guest claim path.",
      priority: "high",
      due: at(0, 15),
      dueAllDay: false,
      estimate: 30,
      labels: ["Writing"],
      focus: ymd(0),
    },
    {
      title: "Ship the pricing page",
      column: "In progress",
      description: "Two plans, no fake urgency, and a clear explanation of what stays free.",
      priority: "urgent",
      due: at(0, 18),
      dueAllDay: false,
      estimate: 120,
      labels: ["Web", "Strategy"],
      focus: ymd(0),
      subtasks: ["Plan comparison", "FAQ", "Mobile pass"],
    },
    {
      title: "Collect five customer quotes",
      column: "Backlog",
      priority: "low",
      due: at(5),
      estimate: 40,
      labels: ["Research"],
    },
    {
      title: "QA mobile quick capture",
      column: "Backlog",
      description: "Test keyboard, offline capture, and the bottom navigation on a small screen.",
      priority: "medium",
      due: at(3),
      estimate: 35,
      labels: ["Web"],
      focus: ymd(2),
    },
    {
      title: "Publish the changelog",
      column: "Done",
      description: "The launch notes are live.",
      priority: "medium",
      completedAt: at(-1, 11),
      labels: ["Writing"],
    },
    {
      title: "Plan the launch retro",
      column: "Backlog",
      priority: "none",
      due: at(7),
      estimate: 30,
      labels: ["Ops"],
    },
    {
      title: "Record a 60-second demo",
      column: "Next up",
      description: "Guest start to first task, then a board move. No voiceover perfection needed.",
      priority: "medium",
      due: at(4, 10),
      dueAllDay: false,
      estimate: 90,
      labels: ["Video"],
    },
    {
      title: "Update support macros",
      column: "Backlog",
      priority: "low",
      estimate: 25,
      labels: ["Ops"],
    },
  ];

  const byColumn = new Map<string, TaskSpec[]>();
  for (const task of tasks) {
    const list = byColumn.get(task.column) ?? [];
    list.push(task);
    byColumn.set(task.column, list);
  }

  for (const [columnName, specs] of byColumn) {
    const positions = positionsBetween(null, null, specs.length);
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index]!;
      await prisma.task.create({
        data: {
          workspaceId: workspace.id,
          boardId: launch.id,
          columnId: launchColumns[columnName]!,
          title: spec.title,
          description: spec.description ?? "",
          priority: spec.priority ?? "none",
          dueDate: spec.due ?? null,
          dueAllDay: spec.dueAllDay ?? true,
          estimateMinutes: spec.estimate ?? null,
          focusDate: spec.focus ?? null,
          completedAt: spec.completedAt ?? null,
          position: positions[index]!,
          createdById: user.id,
          assigneeId: index % 3 === 0 ? user.id : null,
          labels: spec.labels ? { create: spec.labels.map((name) => ({ labelId: label(name) })) } : undefined,
          subtasks: spec.subtasks
            ? {
                create: spec.subtasks.map((title, subtaskIndex) => ({
                  title,
                  completed: subtaskIndex === 0,
                  position: positionsBetween(null, null, spec.subtasks!.length)[subtaskIndex]!,
                })),
              }
            : undefined,
          comments: spec.comment
            ? { create: { authorId: user.id, body: spec.comment } }
            : undefined,
        },
      });
    }
  }

  const personal = await prisma.board.create({
    data: {
      workspaceId: workspace.id,
      name: "Personal rhythm",
      description: "A gentle weekly rhythm for life outside the launch.",
      createdById: user.id,
      visibility: "private",
    },
  });
  const personalSpecs = [
    { name: "This week", isDone: false, wipLimit: 7 },
    { name: "Today", isDone: false, wipLimit: 3 },
    { name: "Waiting", isDone: false, wipLimit: null },
    { name: "Done", isDone: true, wipLimit: null },
  ];
  const personalPositions = positionsBetween(null, null, personalSpecs.length);
  const personalColumns: Record<string, string> = {};
  for (let index = 0; index < personalSpecs.length; index += 1) {
    const spec = personalSpecs[index]!;
    const column = await prisma.column.create({
      data: { boardId: personal.id, name: spec.name, isDone: spec.isDone, wipLimit: spec.wipLimit, position: personalPositions[index]!, createdById: user.id },
    });
    personalColumns[spec.name] = column.id;
  }
  const personalTasks = [
    { title: "Book the dentist", column: "Today", due: at(0), focus: ymd(0), priority: "medium" },
    { title: "Long walk without headphones", column: "This week", due: at(2), priority: "low" },
    { title: "Renew the library card", column: "Waiting", priority: "none" },
    { title: "Call Mum", column: "Done", completedAt: at(-2, 19), priority: "high" },
  ];
  const personalByColumn = new Map<string, typeof personalTasks>();
  for (const task of personalTasks) {
    const list = personalByColumn.get(task.column) ?? [];
    list.push(task);
    personalByColumn.set(task.column, list);
  }
  for (const [columnName, specs] of personalByColumn) {
    const positions = positionsBetween(null, null, specs.length);
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index]!;
      await prisma.task.create({
        data: {
          workspaceId: workspace.id,
          boardId: personal.id,
          columnId: personalColumns[columnName]!,
          title: spec.title,
          priority: spec.priority,
          dueDate: spec.due ?? null,
          focusDate: "focus" in spec ? spec.focus : null,
          completedAt: "completedAt" in spec ? spec.completedAt : null,
          position: positions[index]!,
          createdById: user.id,
        },
      });
    }
  }

  await prisma.view.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      name: "High priority launch work",
      type: "board",
      filtersJson: JSON.stringify({ boardId: launch.id, priority: "high" }),
      isFavorite: true,
    },
  });

  await prisma.automationRule.create({
    data: {
      workspaceId: workspace.id,
      boardId: launch.id,
      name: "Flag urgent work for review",
      trigger: "task.created",
      conditionsJson: JSON.stringify({ priority: "urgent" }),
      actionType: "add_label",
      actionValue: "Strategy",
      enabled: true,
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: user.id,
        workspaceId: workspace.id,
        type: "assignment",
        title: "You own “Ship the pricing page”",
        body: "Due today at 6:00 PM.",
        link: "/?view=board",
      },
      {
        userId: user.id,
        workspaceId: workspace.id,
        type: "mention",
        title: "A comment needs your reply",
        body: "“Start from the customer's words, not our feature list.”",
        link: "/?view=today",
      },
    ],
  });

  console.log(`• Seeded ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`• Workspace “${workspace.name}” with 2 boards and ${tasks.length + personalTasks.length} tasks.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

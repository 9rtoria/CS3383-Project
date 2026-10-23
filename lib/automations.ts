import { prisma } from "./db";
import { appendAfter } from "./fractional";
import { notifyUser } from "./notifications";
import { createUndo } from "./undo";

type AutomationContext = {
  workspaceId: string;
  event: "task.created" | "task.moved" | "task.completed";
  taskId: string;
  actorId: string;
  requestId: string;
};

type Rule = {
  id: string;
  name: string;
  boardId: string | null;
  trigger: string;
  conditionsJson: string;
  actionType: string;
  actionValue: string;
};

export type AutomationPreview = {
  ruleId: string;
  ruleName: string;
  taskId: string;
  title: string;
  change: string;
};

function matchesConditions(task: any, rule: Rule): boolean {
  let conditions: Record<string, unknown> = {};
  try {
    conditions = JSON.parse(rule.conditionsJson);
  } catch {
    return false;
  }
  if (conditions.priority && task.priority !== conditions.priority) return false;
  if (conditions.columnId && task.columnId !== conditions.columnId) return false;
  if (conditions.label) {
    const labels = (task.labels ?? []).map((entry: any) => (entry.label?.name ?? entry.name ?? "").toLowerCase());
    if (!labels.includes(String(conditions.label).toLowerCase())) return false;
  }
  if (conditions.estimateLessThan && (task.estimateMinutes ?? Infinity) >= Number(conditions.estimateLessThan)) return false;
  if (conditions.hasDueDate === true && !task.dueDate) return false;
  if (conditions.hasDueDate === false && task.dueDate) return false;
  return true;
}

export function describeAction(rule: Pick<Rule, "actionType" | "actionValue">): string {
  switch (rule.actionType) {
    case "set_priority":
      return `Set priority to ${rule.actionValue}`;
    case "add_label":
      return `Add label “${rule.actionValue}”`;
    case "move_to_column":
      return "Move to the configured column";
    case "notify":
      return "Notify the assignee";
    default:
      return "Apply rule";
  }
}

async function taskForAutomation(taskId: string) {
  return prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    include: {
      labels: { include: { label: true } },
      board: { include: { columns: { where: { deletedAt: null }, orderBy: { position: "asc" } } } },
    },
  });
}

export async function previewAutomations(workspaceId: string, boardId?: string | null, trigger?: string): Promise<AutomationPreview[]> {
  const rules = await prisma.automationRule.findMany({
    where: {
      workspaceId,
      enabled: true,
      ...(boardId ? { OR: [{ boardId }, { boardId: null }] } : {}),
      ...(trigger ? { trigger } : {}),
    },
  });
  const previews: AutomationPreview[] = [];
  for (const rule of rules) {
    const tasks = await prisma.task.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        ...(rule.boardId ? { boardId: rule.boardId } : {}),
        ...(rule.trigger === "task.completed" ? { completedAt: { not: null } } : {}),
      },
      include: { labels: { include: { label: true } } },
      take: 100,
    });
    for (const task of tasks) {
      if (!matchesConditions(task, rule)) continue;
      previews.push({
        ruleId: rule.id,
        ruleName: rule.name,
        taskId: task.id,
        title: task.title,
        change: describeAction(rule),
      });
    }
  }
  return previews;
}

export type AutomationDraftDiff = {
  taskId: string;
  title: string;
  boardName: string;
  before: string;
  after: string;
};

export type AutomationDraftPreview = {
  total: number;
  truncated: boolean;
  matches: AutomationDraftDiff[];
  skipped: string[];
};

type DraftRule = Pick<Rule, "boardId" | "trigger" | "conditionsJson" | "actionType" | "actionValue">;

/**
 * AC-008 / SX-4: a side-effect-free dry run for a rule that has not been saved
 * yet. The settings dialog shows this diff before the user chooses Apply.
 */
export async function previewDraftAutomation(
  workspaceId: string,
  draft: DraftRule,
  limit = 20,
): Promise<AutomationDraftPreview> {
  const tasks = await prisma.task.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      ...(draft.boardId ? { boardId: draft.boardId } : {}),
      ...(draft.trigger === "task.completed" ? { completedAt: { not: null } } : {}),
    },
    include: {
      labels: { include: { label: true } },
      board: {
        select: {
          name: true,
          columns: { where: { deletedAt: null }, orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true } },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { position: "asc" }],
    take: 500,
  });
  const matches: AutomationDraftDiff[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const task of tasks) {
    if (!matchesConditions(task, draft as Rule)) continue;
    let before = "";
    let after = "";
    if (draft.actionType === "set_priority") {
      if (!["none", "low", "medium", "high", "urgent"].includes(draft.actionValue)) {
        if (!skipped.includes("Unknown priority value")) skipped.push("Unknown priority value");
        continue;
      }
      before = `Priority: ${task.priority}`;
      after = `Priority: ${draft.actionValue}`;
      if (task.priority === draft.actionValue) continue;
    } else if (draft.actionType === "add_label") {
      const labels = task.labels.map((entry) => entry.label.name);
      if (labels.some((name) => name.toLowerCase() === draft.actionValue.toLowerCase())) continue;
      before = labels.length ? `Labels: ${labels.join(", ")}` : "Labels: none";
      after = `Labels: ${[...labels, draft.actionValue].join(", ")}`;
    } else if (draft.actionType === "move_to_column") {
      const target = task.board.columns.find((column) => column.id === draft.actionValue);
      if (!target) {
        if (!skipped.includes("The chosen column no longer exists")) skipped.push("The chosen column no longer exists");
        continue;
      }
      if (target.id === task.columnId) continue;
      const current = task.board.columns.find((column) => column.id === task.columnId);
      before = `Column: ${current?.name ?? "Unknown"}`;
      after = `Column: ${target.name}`;
    } else if (draft.actionType === "notify") {
      before = "No notification";
      after = task.assigneeId ? "Notify the assignee" : "Notify the task creator";
    } else {
      continue;
    }
    total++;
    if (matches.length < limit) {
      matches.push({ taskId: task.id, title: task.title, boardName: task.board.name, before, after });
    }
  }
  return { total, truncated: total > matches.length, matches, skipped };
}

export async function runAutomationsForEvent(context: AutomationContext) {
  const workspace = await prisma.workspace.findUnique({ where: { id: context.workspaceId } });
  if (!workspace?.automationsEnabled) return;
  const task = await taskForAutomation(context.taskId);
  if (!task || task.workspaceId !== context.workspaceId) return;
  const rules = await prisma.automationRule.findMany({
    where: {
      workspaceId: context.workspaceId,
      enabled: true,
      trigger: context.event,
      OR: [{ boardId: null }, { boardId: task.boardId }],
    },
  });
  for (const rule of rules) {
    if (!matchesConditions(task, rule)) continue;
    const before = {
      priority: task.priority,
      columnId: task.columnId,
      labels: task.labels.map((entry) => entry.label.name),
      completedAt: task.completedAt?.toISOString() ?? null,
    };
    try {
      let after: Record<string, unknown> = {};
      if (rule.actionType === "set_priority") {
        if (!["none", "low", "medium", "high", "urgent"].includes(rule.actionValue)) continue;
        after = { priority: rule.actionValue };
        await prisma.task.update({ where: { id: task.id }, data: { priority: rule.actionValue, version: { increment: 1 } } });
      } else if (rule.actionType === "add_label") {
        const label = await prisma.label.upsert({
          where: { workspaceId_name: { workspaceId: context.workspaceId, name: rule.actionValue } },
          update: {},
          create: { workspaceId: context.workspaceId, name: rule.actionValue, color: "violet" },
        });
        const exists = await prisma.taskLabel.findUnique({ where: { taskId_labelId: { taskId: task.id, labelId: label.id } } });
        if (exists) continue;
        await prisma.taskLabel.create({ data: { taskId: task.id, labelId: label.id } });
        await prisma.task.update({ where: { id: task.id }, data: { version: { increment: 1 } } });
        after = { labelId: label.id, labelName: label.name };
      } else if (rule.actionType === "move_to_column") {
        const target = task.board.columns.find((column) => column.id === rule.actionValue);
        if (!target || target.id === task.columnId) continue;
        const last = await prisma.task.findFirst({
          where: { columnId: target.id, deletedAt: null, archivedAt: null },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        await prisma.task.update({
          where: { id: task.id },
          data: {
            columnId: target.id,
            position: appendAfter(last?.position ?? null),
            completedAt: target.isDone ? new Date() : null,
            version: { increment: 1 },
          },
        });
        after = { columnId: target.id, columnName: target.name };
      } else if (rule.actionType === "notify") {
        const recipient = task.assigneeId ?? task.createdById;
        if (!recipient) continue;
        await notifyUser({
          userId: recipient,
          workspaceId: context.workspaceId,
          taskId: task.id,
          type: "automation",
          title: rule.actionValue,
          body: `Rule “${rule.name}” matched “${task.title}”.`,
          link: `/?task=${task.id}`,
        });
        after = { notifiedUserId: recipient };
      } else continue;

      const run = await prisma.automationRun.create({
        data: {
          ruleId: rule.id,
          taskId: task.id,
          actorId: context.actorId,
          beforeJson: JSON.stringify(before),
          afterJson: JSON.stringify(after),
          requestId: context.requestId,
        },
      });
      await prisma.automationRule.update({ where: { id: rule.id }, data: { lastRunAt: new Date() } });
      await prisma.activityEvent.create({
        data: {
          workspaceId: context.workspaceId,
          taskId: task.id,
          actorId: context.actorId,
          action: "automation.applied",
          entityType: "automation_run",
          entityId: run.id,
          requestId: context.requestId,
          metadata: JSON.stringify({ ruleId: rule.id, ruleName: rule.name, after }),
        },
      });
      await prisma.auditEvent.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "automation.applied",
          entityType: "automation_run",
          entityId: run.id,
          requestId: context.requestId,
          metadata: JSON.stringify({ ruleId: rule.id, ruleName: rule.name, before, after }),
        },
      });
      await createUndo({
        userId: context.actorId,
        workspaceId: context.workspaceId,
        action: "automation.run",
        entityType: "automation_run",
        entityId: run.id,
        inverse: { taskId: task.id, before, after, ruleId: rule.id },
        ttlSeconds: 60,
      });
    } catch (error) {
      console.error(JSON.stringify({ level: "warn", message: "automation failed", ruleId: rule.id, error: String(error) }));
    }
  }
}

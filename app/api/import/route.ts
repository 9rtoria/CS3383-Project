import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireBoard } from "@/lib/board-authz";
import { requireWorkspace, recordAudit } from "@/lib/authz";
import { importSchema } from "@/lib/validation";
import { appendAfter } from "@/lib/fractional";

type ImportTask = {
  title?: unknown;
  description?: unknown;
  priority?: unknown;
  column?: unknown;
  columnId?: unknown;
  dueDate?: unknown;
  estimateMinutes?: unknown;
  labels?: unknown;
  completedAt?: unknown;
  assignee?: unknown;
};

const PRIORITIES = new Set(["none", "low", "medium", "high", "urgent"]);

function parseCsv(content: string): ImportTask[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = content.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0]!.map((header) => header.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const entry: Record<string, unknown> = {};
    headers.forEach((header, index) => { entry[header] = cells[index] ?? ""; });
    return {
      title: entry.title,
      description: entry.description,
      priority: entry.priority,
      column: entry.column,
      dueDate: entry.duedate || entry.due_date,
      estimateMinutes: entry.estimateMinutes || entry.estimate,
      labels: entry.labels,
      completedAt: entry.completedat || entry.completed_at,
      assignee: entry.assignee,
    };
  });
}

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const input = importSchema.parse(body);
    const access = await requireWorkspace(viewer, input.workspaceId, "MEMBER", "content:write");
    const boardAccess = await requireBoard(viewer, input.workspaceId, input.boardId, "MEMBER");
    if (!access.workspace) throw new ApiError("WORKSPACE_NOT_FOUND");
    let parsed: { boards?: { name?: string; columns?: { name?: string; isDone?: boolean }[]; tasks?: ImportTask[] }[]; tasks?: ImportTask[] };
    if (input.format === "json") {
      try {
        parsed = JSON.parse(input.content);
      } catch {
        throw new ApiError("VALIDATION_ERROR", "The JSON file could not be parsed.");
      }
    } else {
      parsed = { tasks: parseCsv(input.content) };
    }
    const candidates = parsed.tasks ?? parsed.boards?.flatMap((board) => board.tasks ?? []) ?? [];
    if (!candidates.length) throw new ApiError("VALIDATION_ERROR", "No tasks were found in that file.");
    if (candidates.length > 1000) throw new ApiError("PAYLOAD_TOO_LARGE", "Import at most 1,000 tasks at a time.");
    const columns = boardAccess.board.columns;
    let imported = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const title = typeof candidate.title === "string" ? candidate.title.trim().slice(0, 500) : "";
      if (!title) { skipped++; continue; }
      const requestedColumnName = typeof candidate.column === "string" ? candidate.column.toLowerCase() : null;
      const requestedColumn = typeof candidate.columnId === "string"
        ? candidate.columnId
        : requestedColumnName
          ? columns.find((column) => column.name.toLowerCase() === requestedColumnName)?.id
          : undefined;
      const column = columns.find((item) => item.id === requestedColumn) ?? columns[0]!;
      const last = await prisma.task.findFirst({
        where: { columnId: column.id, deletedAt: null },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const labels = typeof candidate.labels === "string"
        ? candidate.labels.split(/[|,]/).map((label) => label.trim()).filter(Boolean)
        : Array.isArray(candidate.labels)
          ? candidate.labels.map(String)
          : [];
      const priority = typeof candidate.priority === "string" && PRIORITIES.has(candidate.priority.toLowerCase()) ? candidate.priority.toLowerCase() : "none";
      const due = typeof candidate.dueDate === "string" ? new Date(candidate.dueDate) : null;
      const completed = typeof candidate.completedAt === "string" ? new Date(candidate.completedAt) : null;
      const assigneeEmail = typeof candidate.assignee === "string" ? candidate.assignee.trim().toLowerCase() : "";
      let assigneeId: string | null = null;
      if (assigneeEmail) {
        const membership = await prisma.membership.findFirst({
          where: { workspaceId: input.workspaceId, user: { email: assigneeEmail } },
        });
        assigneeId = membership?.userId ?? null;
      }
      await prisma.task.create({
        data: {
          workspaceId: input.workspaceId,
          boardId: input.boardId,
          columnId: column.id,
          title,
          description: typeof candidate.description === "string" ? candidate.description.slice(0, 50_000) : "",
          priority,
          dueDate: due && !Number.isNaN(due.getTime()) ? due : null,
          estimateMinutes: Number.isFinite(Number(candidate.estimateMinutes)) && Number(candidate.estimateMinutes) > 0 ? Math.min(1440, Number(candidate.estimateMinutes)) : null,
          position: appendAfter(last?.position ?? null),
          completedAt: completed && !Number.isNaN(completed.getTime()) ? completed : null,
          assigneeId,
          labels: {
            create: await Promise.all(labels.slice(0, 20).map(async (name) => {
              const label = await prisma.label.upsert({
                where: { workspaceId_name: { workspaceId: input.workspaceId, name } },
                update: {},
                create: { workspaceId: input.workspaceId, name },
              });
              return { labelId: label.id };
            })),
          },
        },
      }).catch(() => {
        skipped++;
        throw new ApiError("CONFLICT", "Import stopped because a task could not be written.");
      });
      imported++;
    }
    await recordAudit({
      workspaceId: input.workspaceId,
      actorId: viewer.user.id,
      action: "workspace.imported",
      entityType: "board",
      entityId: input.boardId,
      requestId,
      metadata: { format: input.format, imported, skipped },
    });
    return ok({ imported, skipped });
  });
}

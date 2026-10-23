import type { NextRequest } from "next/server";
import { handleApi } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/authz";
import { canReadBoard } from "@/lib/rbac";
import { recordAudit } from "@/lib/authz";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
    const access = await requireWorkspace(viewer, workspaceId, "GUEST", "data:export");
    const boards = await prisma.board.findMany({
      where: { workspaceId: workspaceId!, deletedAt: null },
      include: {
        columns: { where: { deletedAt: null }, orderBy: { position: "asc" } },
        tasks: {
          where: { deletedAt: null },
          include: {
            labels: { include: { label: true } },
            subtasks: true,
            comments: { where: { deletedAt: null }, include: { author: { select: { name: true, email: true } } } },
            assignee: { select: { name: true, email: true } },
          },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        },
      },
      orderBy: { createdAt: "asc" },
    });
    const visible = boards.filter((board) => canReadBoard(access.role, board.visibility, board.createdById, viewer.user.id));
    await recordAudit({
      workspaceId: workspaceId!,
      actorId: viewer.user.id,
      action: "workspace.exported",
      entityType: "workspace",
      entityId: workspaceId!,
      requestId: crypto.randomUUID(),
      metadata: { format, boards: visible.length },
    });
    if (format === "csv") {
      const header = ["board", "column", "title", "description", "priority", "dueDate", "completedAt", "assignee", "labels", "estimateMinutes", "archivedAt", "createdAt"];
      const rows = visible.flatMap((board) =>
        board.tasks.map((task) => [
          board.name,
          board.columns.find((column) => column.id === task.columnId)?.name ?? "",
          task.title,
          task.description,
          task.priority,
          task.dueDate?.toISOString() ?? "",
          task.completedAt?.toISOString() ?? "",
          task.assignee?.email ?? task.assignee?.name ?? "",
          task.labels.map((entry) => entry.label.name).join("|"),
          task.estimateMinutes ?? "",
          task.archivedAt?.toISOString() ?? "",
          task.createdAt.toISOString(),
        ].map(csvCell).join(",")),
      );
      const body = `\uFEFF${header.join(",")}\r\n${rows.join("\r\n")}`;
      return new Response(body, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="drift-${new Date().toISOString().slice(0, 10)}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      workspace: { id: access.workspace.id, name: access.workspace.name, type: access.workspace.type },
      boards: visible.map((board) => ({
        id: board.id,
        name: board.name,
        description: board.description,
        visibility: board.visibility,
        archivedAt: board.archivedAt,
        columns: board.columns.map((column) => ({ id: column.id, name: column.name, position: column.position, isDone: column.isDone, wipLimit: column.wipLimit })),
        tasks: board.tasks.map((task) => ({
          id: task.id,
          columnId: task.columnId,
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate,
          dueAllDay: task.dueAllDay,
          estimateMinutes: task.estimateMinutes,
          completedAt: task.completedAt,
          archivedAt: task.archivedAt,
          recurrenceRule: task.recurrenceRule,
          assignee: task.assignee,
          labels: task.labels.map((entry) => entry.label.name),
          subtasks: task.subtasks.map((subtask) => ({ title: subtask.title, completed: subtask.completed })),
          comments: task.comments.map((comment) => ({ author: comment.author?.name ?? null, body: comment.body, createdAt: comment.createdAt })),
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        })),
      })),
    };
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="drift-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  });
}

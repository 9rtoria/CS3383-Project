import type { NextRequest } from "next/server";
import { handleApi } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/authz";
import { canReadBoard } from "@/lib/rbac";

function ics(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    const access = await requireWorkspace(viewer, workspaceId, "GUEST", "data:export");
    const tasks = await prisma.task.findMany({
      where: {
        workspaceId: workspaceId!,
        deletedAt: null,
        archivedAt: null,
        dueDate: { not: null },
        board: { deletedAt: null },
      },
      include: {
        board: { select: { name: true, visibility: true, createdById: true } },
        assignee: { select: { name: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 2000,
    });
    const visible = tasks.filter((task) => task.dueDate && canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id));
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Drift//Drift Tasks//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${ics(access.workspace.name)} - Drift`,
    ];
    for (const task of visible) {
      const due = task.dueDate!;
      const end = new Date(due.getTime() + (task.estimateMinutes ?? 30) * 60_000);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${task.id}@drift`,
        `DTSTAMP:${stamp(new Date())}`,
        `DTSTART:${stamp(due)}`,
        `DTEND:${stamp(end)}`,
        `SUMMARY:${ics(task.title)}`,
        `DESCRIPTION:${ics(`${task.description || "Drift task"}${task.assignee ? `\nAssignee: ${task.assignee.name}` : ""}\nBoard: ${task.board.name}`)}`,
        `CATEGORIES:${ics(task.priority === "none" ? "Drift" : task.priority)}`,
        "STATUS:CONFIRMED",
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");
    return new Response(lines.join("\r\n"), {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'attachment; filename="drift-calendar.ics"',
        "cache-control": "no-store",
      },
    });
  });
}

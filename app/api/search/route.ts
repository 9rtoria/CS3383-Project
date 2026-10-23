import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace } from "@/lib/authz";
import { canReadBoard } from "@/lib/rbac";
import { todayInTimeZone, startOfLocalDayUtc, endOfLocalDayUtc } from "@/lib/time";

function cursorOffset(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: number };
    return Math.max(0, Number(decoded.offset) || 0);
  } catch {
    return 0;
  }
}

function makeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

async function searchIds(query: string, workspaceId: string): Promise<string[]> {
  const tokens = query
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["']/g, "").replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean)
    .slice(0, 12);
  if (!tokens.length) return [];
  const fts = tokens.map((token) => `"${token}"*`).join(" AND ");
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT t."id" AS id
      FROM "TaskFts"
      JOIN "Task" t ON t.rowid = "TaskFts".rowid
      WHERE "TaskFts" MATCH ${fts}
        AND t."workspaceId" = ${workspaceId}
        AND t."deletedAt" IS NULL
      LIMIT 500
    `;
    return rows.map((row) => row.id);
  } catch {
    const fallback = await prisma.task.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        OR: tokens.flatMap((token) => [
          { title: { contains: token } },
          { description: { contains: token } },
        ]),
      },
      select: { id: true },
      take: 200,
    });
    return fallback.map((task) => task.id);
  }
}

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    const status = url.searchParams.get("status") ?? "all";
    const priority = url.searchParams.get("priority");
    const label = url.searchParams.get("label");
    const boardId = url.searchParams.get("boardId");
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    const offset = cursorOffset(url.searchParams.get("cursor"));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 30)));
    const today = todayInTimeZone(viewer.user.timezone);

    const ids = query ? await searchIds(query, workspaceId) : null;
    if (ids && ids.length === 0) return ok({ results: [], total: 0, nextCursor: null, query });
    const where: any = {
      workspaceId,
      deletedAt: null,
      ...(ids ? { id: { in: ids } } : {}),
      ...(boardId ? { boardId } : {}),
      ...(priority ? { priority } : {}),
      ...(label ? { labels: { some: { label: { name: label } } } } : {}),
      ...(status === "done" ? { completedAt: { not: null } } : status === "open" ? { completedAt: null } : {}),
      ...(status === "archived" ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(dateFrom ? { dueDate: { gte: startOfLocalDayUtc(dateFrom, viewer.user.timezone) } } : {}),
      ...(dateTo ? { dueDate: { lte: endOfLocalDayUtc(dateTo, viewer.user.timezone) } } : {}),
    };
    if (dateFrom && dateTo) {
      where.dueDate = {
        gte: startOfLocalDayUtc(dateFrom, viewer.user.timezone),
        lte: endOfLocalDayUtc(dateTo, viewer.user.timezone),
      };
    }
    if (status === "overdue") {
      where.completedAt = null;
      where.dueDate = { lt: startOfLocalDayUtc(today, viewer.user.timezone) };
    }
    const raw = await prisma.task.findMany({
      where,
      include: {
        labels: { include: { label: true } },
        board: { select: { id: true, name: true, visibility: true, createdById: true } },
        column: { select: { id: true, name: true, isDone: true } },
        assignee: { select: { id: true, name: true } },
        subtasks: { orderBy: { position: "asc" }, select: { id: true, completed: true } },
      },
      orderBy: query ? undefined : { updatedAt: "desc" },
      take: ids ? 500 : limit + offset + 100,
    });
    const visible = raw.filter((task) => canReadBoard(access.role, task.board.visibility, task.board.createdById, viewer.user.id));
    const sorted = ids
      ? [...visible].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      : visible;
    const results = sorted.slice(offset, offset + limit).map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description.slice(0, 220),
      priority: task.priority,
      dueDate: task.dueDate,
      dueAllDay: task.dueAllDay,
      completedAt: task.completedAt,
      archivedAt: task.archivedAt,
      version: task.version,
      labels: task.labels.map((entry) => entry.label),
      board: task.board,
      column: task.column,
      assignee: task.assignee,
      checklist: {
        total: task.subtasks.length,
        done: task.subtasks.filter((subtask) => subtask.completed).length,
      },
    }));
    const total = sorted.length;
    return ok({
      results,
      total,
      nextCursor: offset + limit < total ? makeCursor(offset + limit) : null,
      query,
      tookMs: 0,
    });
  });
}

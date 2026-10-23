import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace } from "@/lib/authz";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    await requireWorkspace(viewer, workspaceId, "ADMIN", "audit:read");
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
    const cursor = url.searchParams.get("cursor");
    const events = await prisma.auditEvent.findMany({
      where: { workspaceId: workspaceId! },
      include: { actor: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    const nextCursor = events.length > limit ? events.pop()?.id ?? null : null;
    return ok({
      events: events.map((event) => ({
        ...event,
        metadata: event.metadata ? safeJson(event.metadata) : null,
      })),
      nextCursor,
    });
  });
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

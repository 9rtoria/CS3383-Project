import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace } from "@/lib/authz";
import { labelSchema } from "@/lib/validation";
import { z } from "zod";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const access = await requireWorkspace(viewer, workspaceId, "GUEST", "board:read");
    return ok({
      labels: await prisma.label.findMany({
        where: { workspaceId: access.workspace.id },
        include: { _count: { select: { tasks: true } } },
        orderBy: { name: "asc" },
      }),
    });
  });
}

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body }) => {
    const input = labelSchema.parse(body);
    await requireWorkspace(viewer, input.workspaceId, "MEMBER", "content:write");
    const label = await prisma.label.upsert({
      where: { workspaceId_name: { workspaceId: input.workspaceId, name: input.name } },
      update: { color: input.color },
      create: { workspaceId: input.workspaceId, name: input.name, color: input.color },
    });
    return ok({ label }, 201);
  });
}

export async function DELETE(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    await requireWorkspace(viewer, workspaceId, "MEMBER", "content:write");
    const { labelId } = z.object({ labelId: z.string() }).parse(body);
    await prisma.label.deleteMany({ where: { id: labelId, workspaceId } });
    return ok({ deleted: true });
  });
}

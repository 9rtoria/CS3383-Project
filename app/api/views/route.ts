import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace } from "@/lib/authz";
import { viewSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    await requireWorkspace(viewer, workspaceId, "GUEST");
    const views = await prisma.view.findMany({ where: { userId: viewer.user.id, workspaceId }, orderBy: { createdAt: "asc" } });
    return ok({ views });
  });
}

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body }) => {
    const input = viewSchema.parse(body);
    await requireWorkspace(viewer, input.workspaceId, "GUEST");
    const view = await prisma.view.create({
      data: {
        userId: viewer.user.id,
        workspaceId: input.workspaceId,
        name: input.name,
        type: input.type,
        filtersJson: input.filtersJson,
      },
    });
    return ok({ view }, 201);
  });
}

export async function DELETE(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    await requireWorkspace(viewer, workspaceId, "GUEST");
    const { id } = z.object({ id: z.string() }).parse(body);
    await prisma.view.deleteMany({ where: { id, userId: viewer.user.id, workspaceId } });
    return ok({ deleted: true });
  });
}

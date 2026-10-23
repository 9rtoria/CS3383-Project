import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordAudit } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };
const updateSchema = z.object({
  workspaceId: z.string(),
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  trigger: z.enum(["task.created", "task.moved", "task.completed"]).optional(),
  conditionsJson: z.string().max(2000).optional(),
  actionType: z.enum(["set_priority", "add_label", "move_to_column", "notify"]).optional(),
  actionValue: z.string().trim().min(1).max(200).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const { id } = await params;
    const input = updateSchema.parse(body);
    await requireWorkspace(viewer, input.workspaceId, "ADMIN", "automation:manage");
    const existing = await prisma.automationRule.findFirst({ where: { id, workspaceId: input.workspaceId } });
    if (!existing) throw new ApiError("NOT_FOUND", "Automation not found.");
    const { workspaceId: _workspaceId, ...changes } = input;
    const rule = await prisma.automationRule.update({ where: { id }, data: changes });
    await recordAudit({
      workspaceId: input.workspaceId,
      actorId: viewer.user.id,
      action: "automation.updated",
      entityType: "automation",
      entityId: id,
      requestId,
      metadata: { fields: Object.keys(changes) },
    });
    return ok({ rule });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, req: request, requestId }) => {
    const { id } = await params;
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    await requireWorkspace(viewer, workspaceId, "ADMIN", "automation:manage");
    const existing = await prisma.automationRule.findFirst({ where: { id, workspaceId: workspaceId! } });
    if (!existing) throw new ApiError("NOT_FOUND", "Automation not found.");
    await prisma.automationRule.delete({ where: { id } });
    await recordAudit({
      workspaceId: workspaceId!,
      actorId: viewer.user.id,
      action: "automation.deleted",
      entityType: "automation",
      entityId: id,
      requestId,
    });
    return ok({ deleted: true });
  });
}

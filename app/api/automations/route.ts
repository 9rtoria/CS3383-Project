import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordAudit } from "@/lib/authz";
import { automationSchema } from "@/lib/validation";
import { previewAutomations } from "@/lib/automations";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    await requireWorkspace(viewer, workspaceId, "GUEST", "workspace:read");
    const [rules, preview] = await Promise.all([
      prisma.automationRule.findMany({
        where: { workspaceId: workspaceId! },
        orderBy: { createdAt: "desc" },
        include: { runs: { orderBy: { createdAt: "desc" }, take: 5 } },
      }),
      previewAutomations(workspaceId!).catch(() => []),
    ]);
    return ok({ rules, preview: preview.slice(0, 25) });
  });
}

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const input = automationSchema.parse(body);
    const access = await requireWorkspace(viewer, input.workspaceId, "ADMIN", "automation:manage");
    if (!access.workspace.automationsEnabled) throw new ApiError("FEATURE_DISABLED", "Automations are disabled for this workspace.");
    if (input.boardId) {
      const board = await prisma.board.findFirst({ where: { id: input.boardId, workspaceId: input.workspaceId, deletedAt: null } });
      if (!board) throw new ApiError("BOARD_NOT_FOUND");
    }
    const rule = await prisma.automationRule.create({
      data: {
        workspaceId: input.workspaceId,
        boardId: input.boardId ?? null,
        name: input.name,
        trigger: input.trigger,
        conditionsJson: input.conditionsJson,
        actionType: input.actionType,
        actionValue: input.actionValue,
        enabled: input.enabled,
      },
    });
    await recordAudit({
      workspaceId: input.workspaceId,
      actorId: viewer.user.id,
      action: "automation.created",
      entityType: "automation",
      entityId: rule.id,
      requestId,
      metadata: { trigger: rule.trigger, actionType: rule.actionType },
    });
    return ok({ rule }, 201);
  });
}

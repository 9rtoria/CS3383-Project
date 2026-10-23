import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { requireWorkspace } from "@/lib/authz";
import { previewDraftAutomation } from "@/lib/automations";
import { automationPreviewSchema } from "@/lib/validation";

/**
 * Dry-run a draft rule without saving it. AC-008: the diff is shown before
 * Apply, so a user never discovers an automation's blast radius afterwards.
 */
export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body }) => {
    const input = automationPreviewSchema.parse(body);
    await requireWorkspace(viewer, input.workspaceId, "GUEST", "board:read");
    const preview = await previewDraftAutomation(input.workspaceId, {
      boardId: input.boardId ?? null,
      trigger: input.trigger,
      conditionsJson: input.conditionsJson,
      actionType: input.actionType,
      actionValue: input.actionValue,
    });
    return ok(preview);
  });
}

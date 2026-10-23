import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { moveTaskSchema } from "@/lib/validation";
import { moveTask } from "@/lib/task-service";
import { ApiError } from "@/lib/errors";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(req, async ({ viewer, body, requestId, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const input = moveTaskSchema.parse(body);
    return ok(await moveTask(viewer, id, workspaceId, input, requestId));
  });
}

import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { reorderColumns } from "@/lib/board-service";
import { ApiError } from "@/lib/errors";

const schema = z.object({ boardId: z.string().min(1), orderedIds: z.array(z.string()).min(1) });

export async function PUT(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const input = schema.parse(body);
    return ok(await reorderColumns(viewer, workspaceId, input.boardId, input.orderedIds));
  });
}

import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { columnCreateSchema } from "@/lib/validation";
import { createColumn } from "@/lib/board-service";
import { ApiError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const input = columnCreateSchema.parse(body);
    const column = await createColumn(viewer, workspaceId, input);
    return ok({ column }, 201);
  });
}

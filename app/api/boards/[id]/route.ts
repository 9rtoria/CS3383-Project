import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { boardUpdateSchema } from "@/lib/validation";
import { deleteBoard, getBoardPayload, updateBoard } from "@/lib/board-service";
import { ApiError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    return ok(await getBoardPayload(viewer, workspaceId, id));
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, body, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const input = boardUpdateSchema.parse(body);
    const board = await updateBoard(viewer, workspaceId, id, input);
    return ok({ board });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    return ok(await deleteBoard(viewer, workspaceId, id));
  });
}

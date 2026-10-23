import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { boardCreateSchema } from "@/lib/validation";
import { createBoard, listVisibleBoards } from "@/lib/board-service";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) return ok({ boards: [] });
    const result = await listVisibleBoards(viewer, workspaceId);
    return ok(result);
  });
}

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body }) => {
    const input = boardCreateSchema.parse(body);
    const result = await createBoard(viewer, input.workspaceId, input);
    return ok({ board: result.board }, 201);
  });
}

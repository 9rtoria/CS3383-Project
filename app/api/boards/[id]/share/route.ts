import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { shareSchema } from "@/lib/validation";
import { toggleBoardShare } from "@/lib/board-service";
import { ApiError } from "@/lib/errors";
import { appUrl } from "@/lib/env";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(req, async ({ viewer, body, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const input = shareSchema.parse(body);
    const result = await toggleBoardShare(viewer, workspaceId, id, input.enabled);
    return ok({
      ...result,
      url: result.token ? `${appUrl()}/share/${result.token}` : null,
    });
  });
}

import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { bulkTaskSchema } from "@/lib/validation";
import { bulkTaskAction } from "@/lib/task-service";

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const input = bulkTaskSchema.parse(body);
    return ok(await bulkTaskAction(viewer, input, requestId));
  });
}

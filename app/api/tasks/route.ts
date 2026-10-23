import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { taskCreateSchema } from "@/lib/validation";
import { createTask } from "@/lib/task-service";

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const input = taskCreateSchema.parse(body);
    const result = await createTask(viewer, input, requestId);
    return ok(result, 201);
  });
}

import type { NextRequest } from "next/server";
import { handleApi, ok, workspaceHeader } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { requireWorkspace, recordActivity, findTaskInWorkspace } from "@/lib/authz";
import { commentSchema } from "@/lib/validation";
import { notifyUser } from "@/lib/notifications";
import { dispatchWebhooksInBackground } from "@/lib/webhooks";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(req, async ({ viewer, body, requestId, req: request }) => {
    const { id } = await params;
    const workspaceId = workspaceHeader(request);
    if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace.");
    const access = await requireWorkspace(viewer, workspaceId, "MEMBER", "comment:write");
    const task = await findTaskInWorkspace(id, access.workspace.id);
    const input = commentSchema.parse(body);
    const comment = await prisma.comment.create({
      data: { taskId: id, authorId: viewer.user.id, body: input.body },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    await recordActivity({
      workspaceId: access.workspace.id,
      taskId: id,
      actorId: viewer.user.id,
      action: "comment.created",
      entityType: "comment",
      entityId: comment.id,
      requestId,
      metadata: { preview: input.body.slice(0, 160) },
    });
    const recipients = new Set<string>();
    if (task.assigneeId) recipients.add(task.assigneeId);
    if (task.createdById) recipients.add(task.createdById);
    recipients.delete(viewer.user.id);
    await Promise.all(
      [...recipients].map((userId) =>
        notifyUser({
          userId,
          workspaceId: access.workspace.id,
          taskId: id,
          type: "comment.mention",
          title: `New comment on ${task.title}`,
          body: `${viewer.user.name}: ${input.body.slice(0, 140)}`,
          link: `/?task=${id}`,
        }),
      ),
    );
    dispatchWebhooksInBackground(access.workspace.id, "comment.created", { title: task.title, taskId: id });
    return ok({ comment }, 201);
  });
}

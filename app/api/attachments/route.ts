import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { featureFlags } from "@/lib/env";
import { requireWorkspace, findTaskInWorkspace, recordActivity } from "@/lib/authz";
import { randomToken } from "@/lib/crypto";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function storageRoot() {
  return path.join(process.cwd(), "data", "attachments");
}

export async function POST(req: NextRequest) {
  return handleApi(
    req,
    async ({ viewer, requestId }) => {
      if (featureFlags.attachmentsDisabled) throw new ApiError("FEATURE_DISABLED", "Attachments are disabled.");
      const form = await req.formData();
      const taskId = String(form.get("taskId") ?? "");
      const workspaceId = String(form.get("workspaceId") ?? "");
      const file = form.get("file");
      if (!taskId || !workspaceId || !(file instanceof File)) {
        throw new ApiError("VALIDATION_ERROR", "Choose a task and a file.");
      }
      if (file.size <= 0 || file.size > MAX_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE", "Files must be between 1 byte and 10 MB.");
      const mimeType = file.type || "application/octet-stream";
      if (!ALLOWED.has(mimeType)) throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "That file type is not allowed. Use an image, PDF, text, CSV, Office document, or ZIP.");
      const access = await requireWorkspace(viewer, workspaceId, "MEMBER", "content:write");
      if (!access.workspace.attachmentsEnabled) throw new ApiError("FEATURE_DISABLED", "Attachments are disabled for this workspace.");
      await findTaskInWorkspace(taskId, workspaceId);

      const extension = path.extname(file.name).replace(/[^.a-zA-Z0-9]/g, "").slice(0, 12);
      const storageName = `${randomToken(18)}${extension}`;
      await fs.mkdir(storageRoot(), { recursive: true });
      const bytes = new Uint8Array(await file.arrayBuffer());
      await fs.writeFile(path.join(storageRoot(), storageName), bytes, { flag: "wx" });
      const attachment = await prisma.attachment.create({
        data: {
          taskId,
          uploaderId: viewer.user.id,
          name: file.name.slice(0, 200) || "Attachment",
          storageName,
          mimeType,
          size: bytes.byteLength,
        },
        select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
      });
      await recordActivity({
        workspaceId,
        taskId,
        actorId: viewer.user.id,
        action: "attachment.created",
        entityType: "attachment",
        entityId: attachment.id,
        requestId,
        metadata: { name: attachment.name, size: attachment.size },
      });
      return ok({ attachment }, 201);
    },
    { raw: true },
  );
}

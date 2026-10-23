import { prisma } from "./db";
import { ApiError } from "./errors";
import type { Action, Role } from "./rbac";
import { can, isRole } from "./rbac";
import type { Viewer } from "./session";

export type WorkspaceAccess = {
  workspace: NonNullable<Awaited<ReturnType<typeof getWorkspaceRaw>>>["workspace"];
  membershipId: string;
  role: Role;
};

async function getWorkspaceRaw(workspaceId: string, userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { workspaceId, userId, workspace: { deletedAt: null } },
    include: { workspace: true },
  });
  return membership;
}

export async function requireWorkspace(
  viewer: Viewer,
  workspaceId: string | null | undefined,
  minimum: Role = "GUEST",
  action?: Action,
): Promise<WorkspaceAccess> {
  if (!workspaceId) throw new ApiError("VALIDATION_ERROR", "Choose a workspace first.", { field: "workspaceId" });
  if (viewer.viaApiToken && viewer.apiWorkspaceId !== workspaceId) {
    throw new ApiError("FORBIDDEN", "This API token belongs to another workspace.");
  }
  const membership = await getWorkspaceRaw(workspaceId, viewer.user.id);
  if (!membership) throw new ApiError("WORKSPACE_NOT_FOUND");
  const role: Role = isRole(membership.role) ? membership.role : "GUEST";
  if (action && !can(role, action)) throw new ApiError("FORBIDDEN");
  const rank = { GUEST: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 } as const;
  if (rank[role] < rank[minimum]) throw new ApiError("FORBIDDEN");
  if (membership.workspace.requireMfa && !viewer.mfaVerified) {
    throw new ApiError("MFA_REQUIRED", "Enable two-factor authentication to access this workspace.", {
      settingsUrl: "/settings?section=security",
    });
  }
  return { workspace: membership.workspace, membershipId: membership.id, role };
}

export function workspaceIdFrom(req: Request): string | null {
  const header = req.headers.get("x-workspace-id");
  if (header) return header;
  const url = new URL(req.url);
  return url.searchParams.get("workspaceId");
}

export function requireText(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("VALIDATION_ERROR", `${field} is required.`, { field });
  }
  if (value.length > max) throw new ApiError("VALIDATION_ERROR", `${field} is too long.`, { field, max });
  return value.trim();
}

export type AuditInput = {
  workspaceId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId: input.requestId,
      ipHash: input.ipHash ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata).slice(0, 4000) : null,
    },
  });
}

export async function recordActivity(input: {
  workspaceId: string;
  taskId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.activityEvent.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId: input.requestId,
      metadata: input.metadata ? JSON.stringify(input.metadata).slice(0, 4000) : null,
    },
  });
}

/** Narrow selectors used for tenant-safe reads. */
export async function findTaskInWorkspace(taskId: string, workspaceId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, workspaceId, deletedAt: null, board: { deletedAt: null } },
    include: {
      subtasks: { orderBy: { position: "asc" } },
      labels: { include: { label: true } },
      comments: {
        where: { deletedAt: null },
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: "asc" },
      },
      attachments: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
      dependencies: { include: { dependsOnTask: { select: { id: true, title: true, completedAt: true } } } },
      reminders: { orderBy: { remindAt: "asc" } },
      board: { select: { id: true, name: true, workspaceId: true, visibility: true, createdById: true } },
      column: { select: { id: true, name: true, isDone: true } },
    },
  });
  if (!task) throw new ApiError("TASK_NOT_FOUND");
  return task;
}

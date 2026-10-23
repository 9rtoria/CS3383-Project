import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { featureFlags, appUrl } from "@/lib/env";
import { BOARD_TEMPLATES } from "@/lib/templates";
import { isRole } from "@/lib/rbac";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer }) => {
    const [memberships, settings, notifications, views] = await Promise.all([
      prisma.membership.findMany({
        where: { userId: viewer.user.id, workspace: { deletedAt: null } },
        include: { workspace: true },
        orderBy: [{ joinedAt: "asc" }],
      }),
      prisma.userSettings.upsert({
        where: { userId: viewer.user.id },
        update: {},
        create: { userId: viewer.user.id, capacityMinutes: 300 },
      }),
      prisma.notification.findMany({
        where: { userId: viewer.user.id },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.view.findMany({ where: { userId: viewer.user.id }, orderBy: { createdAt: "asc" } }),
    ]);

    const workspaces = [];
    for (const membership of memberships) {
      const workspace = membership.workspace;
      const role = isRole(membership.role) ? membership.role : "GUEST";
      const mfaLocked = workspace.requireMfa && !viewer.mfaVerified;
      const boards = mfaLocked
        ? []
        : await prisma.board.findMany({
            where: {
              workspaceId: workspace.id,
              deletedAt: null,
              archivedAt: null,
              OR: [
                { visibility: "workspace" },
                ...(role === "OWNER" || role === "ADMIN"
                  ? [{ visibility: "private" }]
                  : [{ visibility: "private", createdById: viewer.user.id }]),
              ],
            },
            include: {
              columns: { where: { deletedAt: null }, orderBy: { position: "asc" }, select: { id: true, name: true, isDone: true } },
              _count: { select: { tasks: { where: { deletedAt: null, archivedAt: null } } } },
            },
            orderBy: { updatedAt: "desc" },
          });
      const memberCount = await prisma.membership.count({ where: { workspaceId: workspace.id } });
      const assignableMembers = mfaLocked
        ? []
        : await prisma.membership.findMany({
            where: { workspaceId: workspace.id },
            include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
          });
      workspaces.push({
        id: workspace.id,
        name: workspace.name,
        type: workspace.type,
        icon: workspace.icon,
        role,
        mfaLocked,
        mfaRequired: workspace.requireMfa,
        memberCount,
        boards: boards.map((board) => ({
          id: board.id,
          name: board.name,
          description: board.description,
          visibility: board.visibility,
          firstColumnId: board.columns.find((column) => !column.isDone)?.id ?? board.columns[0]?.id ?? null,
          defaultDoneColumnId: board.columns.find((column) => column.isDone)?.id ?? null,
          taskCount: board._count.tasks,
          columns: board.columns,
          shareEnabled: board.shareEnabled,
          createdById: board.createdById,
        })),
        members: assignableMembers.map((member) => ({
          id: member.user.id,
          name: member.user.name,
          email: member.user.email,
          avatarUrl: member.user.avatarUrl,
          role: member.role,
        })),
        policies: {
          retentionDays: workspace.retentionDays,
          auditRetentionDays: workspace.auditRetentionDays,
          requireMfa: workspace.requireMfa,
          aiEnabled: workspace.aiEnabled,
          automationsEnabled: workspace.automationsEnabled,
          attachmentsEnabled: workspace.attachmentsEnabled,
          publicSharingEnabled: workspace.publicSharingEnabled,
          version: workspace.version,
        },
      });
    }

    return ok({
      user: {
        ...viewer.user,
        mfaEnabled: viewer.user.mfaEnabled,
        mfaVerified: viewer.mfaVerified,
        isGuest: viewer.user.isGuest,
      },
      workspaces,
      settings,
      notifications: notifications.map((notification) => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        link: notification.link,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
        workspaceId: notification.workspaceId,
      })),
      unreadCount: notifications.filter((notification) => !notification.readAt).length,
      views,
      templates: BOARD_TEMPLATES,
      features: {
        ...featureFlags,
        apiDocs: "/api/openapi",
        emailDelivery: featureFlags.emailConfigured ? "smtp" : "development-outbox",
      },
      oauthProviders: [
        { id: "github", label: "GitHub", enabled: featureFlags.githubOAuth },
        { id: "google", label: "Google", enabled: featureFlags.googleOAuth },
        { id: "apple", label: "Apple", enabled: featureFlags.appleOAuth },
      ],
      serverNow: new Date().toISOString(),
      appUrl: appUrl(),
    });
  });
}

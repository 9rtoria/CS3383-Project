import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { workspaceCreateSchema } from "@/lib/validation";
import { positionsBetween } from "@/lib/fractional";
import { recordAudit } from "@/lib/authz";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer }) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: viewer.user.id, workspace: { deletedAt: null } },
      include: { workspace: true },
      orderBy: { joinedAt: "asc" },
    });
    return ok({
      workspaces: memberships.map((membership) => ({
        ...membership.workspace,
        role: membership.role,
      })),
    });
  });
}

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const input = workspaceCreateSchema.parse(body);
    const workspace = await prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          name: input.name,
          type: input.type,
          publicSharingEnabled: input.type === "team",
          memberships: { create: { userId: viewer.user.id, role: "OWNER" } },
          labels: {
            create: [
              { name: "Personal", color: "moss" },
              { name: "Work", color: "blue" },
              { name: "Blocked", color: "rose" },
            ],
          },
        },
      });
      if (input.seedTemplate) {
        const board = await tx.board.create({
          data: {
            workspaceId: created.id,
            name: "Team home",
            description: "A shared place to see what is moving.",
            createdById: viewer.user.id,
            visibility: "workspace",
          },
        });
        const columns = [
          { name: "Backlog", isDone: false },
          { name: "In progress", isDone: false, wipLimit: 5 },
          { name: "Review", isDone: false },
          { name: "Done", isDone: true },
        ];
        const positions = positionsBetween(null, null, columns.length);
        await tx.column.createMany({
          data: columns.map((column, index) => ({
            boardId: board.id,
            name: column.name,
            position: positions[index]!,
            isDone: column.isDone,
            wipLimit: column.wipLimit ?? null,
            wipEnforced: Boolean(column.wipLimit),
            createdById: viewer.user.id,
          })),
        });
      }
      return created;
    });
    await recordAudit({
      workspaceId: workspace.id,
      actorId: viewer.user.id,
      action: "workspace.created",
      entityType: "workspace",
      entityId: workspace.id,
      requestId,
      metadata: { type: workspace.type },
    });
    return ok({ workspace: { ...workspace, role: "OWNER" } }, 201);
  });
}

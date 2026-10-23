import { prisma } from "./db";

type UndoInput = {
  userId: string;
  workspaceId: string;
  action: string;
  entityType: string;
  entityId: string;
  inverse: Record<string, unknown>;
  ttlSeconds?: number;
};

export async function createUndo(input: UndoInput) {
  const undo = await prisma.undoAction.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      inverseJson: JSON.stringify(input.inverse),
      expiresAt: new Date(Date.now() + (input.ttlSeconds ?? 10) * 1000),
    },
  });
  return { id: undo.id, expiresAt: undo.expiresAt, action: input.action };
}

export function undoPayload(undo: { inverseJson: string }): Record<string, any> {
  try {
    return JSON.parse(undo.inverseJson) as Record<string, any>;
  } catch {
    return {};
  }
}

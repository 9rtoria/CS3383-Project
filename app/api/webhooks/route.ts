import type { NextRequest } from "next/server";
import { handleApi, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireWorkspace, recordAudit } from "@/lib/authz";
import { webhookSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  return handleApi(req, async ({ viewer, req: request }) => {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    await requireWorkspace(viewer, workspaceId, "ADMIN", "integration:manage");
    const webhooks = await prisma.webhook.findMany({
      where: { workspaceId: workspaceId! },
      orderBy: { createdAt: "desc" },
    });
    const deliveryCounts = webhooks.length
      ? await prisma.webhookDelivery.groupBy({
          by: ["webhookId"],
          where: { webhookId: { in: webhooks.map((hook) => hook.id) } },
          _count: { _all: true },
        })
      : [];
    const countByWebhook = new Map(deliveryCounts.map((row) => [row.webhookId, row._count._all]));
    return ok({
      webhooks: webhooks.map((hook) => ({
        ...hook,
        events: safeEvents(hook.eventsJson),
        deliveries: countByWebhook.get(hook.id) ?? 0,
      })),
    });
  });
}

export async function POST(req: NextRequest) {
  return handleApi(req, async ({ viewer, body, requestId }) => {
    const input = webhookSchema.parse(body);
    await requireWorkspace(viewer, input.workspaceId, "ADMIN", "integration:manage");
    const webhook = await prisma.webhook.create({
      data: {
        workspaceId: input.workspaceId,
        kind: input.kind,
        url: input.url,
        eventsJson: JSON.stringify(input.events),
        createdById: viewer.user.id,
      },
    });
    await recordAudit({
      workspaceId: input.workspaceId,
      actorId: viewer.user.id,
      action: "webhook.created",
      entityType: "webhook",
      entityId: webhook.id,
      requestId,
      metadata: { kind: input.kind },
    });
    return ok({ webhook: { ...webhook, events: input.events } }, 201);
  });
}

function safeEvents(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

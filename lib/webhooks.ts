import { prisma } from "./db";

export type WebhookEvent = "task.created" | "task.moved" | "task.completed" | "task.deleted" | "comment.created";

function payloadFor(kind: string, event: WebhookEvent, data: Record<string, unknown>) {
  if (kind === "teams") {
    return {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              { type: "TextBlock", weight: "Bolder", text: `Drift · ${event.replace(".", " ")}` },
              { type: "TextBlock", text: String(data.title ?? "Task activity"), wrap: true },
            ],
          },
        },
      ],
    };
  }
  if (kind === "generic") return { event, data, source: "drift" };
  return {
    text: `*Drift · ${event.replace(".", " ")}*\n${String(data.title ?? "Task activity")}`,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*Drift · ${event.replace(".", " ")}*\n${String(data.title ?? "Task activity")}` } },
    ],
  };
}

async function postPayload(url: string, body: string): Promise<{ status: number | null; response: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const result = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Drift-Webhook/1.0" },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { status: result.status, response: (await result.text()).slice(0, 1000) };
  } catch (error) {
    return { status: null, response: error instanceof Error ? error.message.slice(0, 500) : "Delivery failed" };
  }
}

function retryDelayMinutes(attempts: number): number {
  return [5, 15, 45][Math.min(attempts, 2)] ?? 45;
}

/**
 * Attempts one persisted delivery. Jobs call this with bounded exponential
 * backoff; the in-app action never waits for an external service.
 */
export async function attemptWebhookDelivery(deliveryId: string): Promise<boolean> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });
  if (!delivery) return false;
  if (!delivery.webhook) {
    // A deleted webhook should cascade, but older databases and interrupted
    // deletes can leave a delivery behind. Stop retrying it instead of
    // crashing the whole job on every tick.
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        response: "Webhook no longer exists",
        attempts: 3,
        nextAttemptAt: null,
      },
    });
    return false;
  }
  if (!delivery.webhook.enabled) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { response: "Webhook disabled before delivery", nextAttemptAt: null },
    });
    return false;
  }
  const { status, response } = await postPayload(delivery.webhook.url, delivery.payloadJson);
  const success = status !== null && status >= 200 && status < 300;
  const attempts = delivery.attempts + 1;
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status,
      response,
      attempts,
      nextAttemptAt: success || attempts >= 3 ? null : new Date(Date.now() + retryDelayMinutes(attempts) * 60_000),
    },
  });
  await prisma.webhook.update({
    where: { id: delivery.webhookId },
    data: { lastStatus: status, lastDeliveryAt: new Date() },
  });
  return success;
}

/**
 * Best-effort first delivery. The in-app action never waits for an external
 * service; failures are persisted for the retry job and admin diagnosis.
 */
export async function dispatchWebhooks(workspaceId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const hooks = await prisma.webhook.findMany({ where: { workspaceId, enabled: true } });
  await Promise.all(
    hooks
      .filter((hook) => {
        try {
          return (JSON.parse(hook.eventsJson) as string[]).includes(event);
        } catch {
          return false;
        }
      })
      .map(async (hook) => {
        const body = JSON.stringify(payloadFor(hook.kind, event, data));
        const delivery = await prisma.webhookDelivery.create({
          data: { webhookId: hook.id, eventType: event, payloadJson: body.slice(0, 5000) },
        });
        await attemptWebhookDelivery(delivery.id);
      }),
  );
}

export function dispatchWebhooksInBackground(workspaceId: string, event: WebhookEvent, data: Record<string, unknown>) {
  void dispatchWebhooks(workspaceId, event, data).catch(() => undefined);
}

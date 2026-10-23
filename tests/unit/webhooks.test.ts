import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateDelivery: vi.fn(),
  updateWebhook: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    webhookDelivery: { findUnique: mocks.findUnique, update: mocks.updateDelivery },
    webhook: { update: mocks.updateWebhook },
  },
}));

import { attemptWebhookDelivery } from "@/lib/webhooks";

describe("webhook delivery retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDelivery.mockResolvedValue({});
  });

  it("stops retrying an orphaned delivery when its webhook no longer exists", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "delivery-1",
      webhookId: "webhook-1",
      payloadJson: "{}",
      attempts: 0,
      webhook: null,
    });

    await expect(attemptWebhookDelivery("delivery-1")).resolves.toBe(false);

    expect(mocks.updateDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.updateDelivery).toHaveBeenCalledWith({
      where: { id: "delivery-1" },
      data: { response: "Webhook no longer exists", attempts: 3, nextAttemptAt: null },
    });
    expect(mocks.updateWebhook).not.toHaveBeenCalled();
  });
});

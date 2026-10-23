-- Bounded webhook retry metadata.
ALTER TABLE "WebhookDelivery" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WebhookDelivery" ADD COLUMN "nextAttemptAt" DATETIME;

CREATE INDEX "WebhookDelivery_nextAttemptAt_idx" ON "WebhookDelivery"("nextAttemptAt");

ALTER TABLE webhook ADD COLUMN kind TEXT NOT NULL DEFAULT 'slack';
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_next ON webhook_delivery(next_attempt_at);

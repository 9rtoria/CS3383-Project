ALTER TABLE workspace ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE workspace ADD COLUMN audit_retention_days INTEGER NOT NULL DEFAULT 365;
ALTER TABLE workspace ADD COLUMN require_mfa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspace ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspace ADD COLUMN automations_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspace ADD COLUMN attachments_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspace ADD COLUMN public_sharing_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspace ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspace ADD COLUMN deleted_at TEXT;

UPDATE workspace SET public_sharing_enabled = 0 WHERE type = 'personal';

CREATE INDEX IF NOT EXISTS idx_workspace_deleted ON workspace(deleted_at);
CREATE INDEX IF NOT EXISTS idx_api_token_user_workspace ON api_token(user_id, workspace_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_audit_event_workspace_created ON audit_event(workspace_id, created_at);

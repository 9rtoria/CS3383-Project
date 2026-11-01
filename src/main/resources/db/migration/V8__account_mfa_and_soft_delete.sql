ALTER TABLE app_user ADD COLUMN deleted_at TEXT;
ALTER TABLE app_user ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_user ADD COLUMN mfa_secret_enc TEXT;
ALTER TABLE app_user ADD COLUMN mfa_backup_codes_json TEXT;

CREATE INDEX IF NOT EXISTS idx_app_user_deleted ON app_user(deleted_at);

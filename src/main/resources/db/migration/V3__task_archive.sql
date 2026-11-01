ALTER TABLE task ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_task_workspace_archived
    ON task(workspace_id, archived_at);

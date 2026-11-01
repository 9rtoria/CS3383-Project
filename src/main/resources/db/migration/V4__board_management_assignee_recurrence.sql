ALTER TABLE board ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE board ADD COLUMN color TEXT NOT NULL DEFAULT 'moss';
ALTER TABLE board ADD COLUMN archived_at TEXT;
ALTER TABLE board ADD COLUMN deleted_at TEXT;
ALTER TABLE board ADD COLUMN visibility TEXT NOT NULL DEFAULT 'workspace';
ALTER TABLE board ADD COLUMN share_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE board ADD COLUMN share_token TEXT;
ALTER TABLE board ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE board ADD COLUMN created_by TEXT;

CREATE INDEX IF NOT EXISTS idx_board_workspace_active
    ON board(workspace_id, archived_at, deleted_at);

ALTER TABLE task ADD COLUMN assignee_id TEXT;
ALTER TABLE task ADD COLUMN recurrence_rule TEXT;
ALTER TABLE task ADD COLUMN recurrence_ends_at TEXT;

CREATE INDEX IF NOT EXISTS idx_task_assignee ON task(assignee_id);

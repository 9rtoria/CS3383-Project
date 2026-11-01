ALTER TABLE board_column ADD COLUMN wip_limit INTEGER;
ALTER TABLE board_column ADD COLUMN wip_enforced INTEGER NOT NULL DEFAULT 0;
ALTER TABLE board_column ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_column_board_active
    ON board_column(board_id, deleted_at, position);

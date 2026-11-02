ALTER TABLE task ADD COLUMN completed_at TEXT;
UPDATE task SET completed_at = updated_at
WHERE deleted_at IS NULL
  AND column_id IN (SELECT id FROM board_column WHERE is_done = 1);

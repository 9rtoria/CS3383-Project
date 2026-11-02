UPDATE app_user SET display_name = 'You'
WHERE is_guest = 1 AND display_name = 'Guest' AND deleted_at IS NULL;

UPDATE workspace SET name = 'Personal'
WHERE type = 'personal' AND name = 'My workspace' AND deleted_at IS NULL
  AND created_by IN (SELECT id FROM app_user WHERE is_guest = 1 AND deleted_at IS NULL);

UPDATE board SET description = 'A calm place for everything on your plate.'
WHERE name = 'My tasks' AND (description IS NULL OR trim(description) = '')
  AND workspace_id IN (
    SELECT w.id FROM workspace w JOIN app_user u ON u.id = w.created_by
    WHERE w.type = 'personal' AND w.name = 'Personal'
      AND u.is_guest = 1 AND w.deleted_at IS NULL AND u.deleted_at IS NULL
  );

INSERT OR IGNORE INTO label (id, workspace_id, name, color, created_at)
SELECT lower(hex(randomblob(16))), w.id, 'Personal', 'moss', datetime('now')
FROM workspace w JOIN app_user u ON u.id = w.created_by
WHERE w.type = 'personal' AND u.is_guest = 1
  AND w.deleted_at IS NULL AND u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM label l WHERE l.workspace_id = w.id AND l.name = 'Personal');

INSERT OR IGNORE INTO label (id, workspace_id, name, color, created_at)
SELECT lower(hex(randomblob(16))), w.id, 'Work', 'blue', datetime('now')
FROM workspace w JOIN app_user u ON u.id = w.created_by
WHERE w.type = 'personal' AND u.is_guest = 1
  AND w.deleted_at IS NULL AND u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM label l WHERE l.workspace_id = w.id AND l.name = 'Work');

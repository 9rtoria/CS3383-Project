CREATE TABLE IF NOT EXISTS app_user (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    is_guest INTEGER NOT NULL DEFAULT 1,
    timezone TEXT NOT NULL DEFAULT 'Asia/Hong_Kong',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'personal',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    retention_days INTEGER NOT NULL DEFAULT 30,
    audit_retention_days INTEGER NOT NULL DEFAULT 365,
    require_mfa INTEGER NOT NULL DEFAULT 0,
    ai_enabled INTEGER NOT NULL DEFAULT 1,
    automations_enabled INTEGER NOT NULL DEFAULT 1,
    attachments_enabled INTEGER NOT NULL DEFAULT 1,
    public_sharing_enabled INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS membership (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'OWNER',
    joined_at TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id),
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'moss',
    position INTEGER NOT NULL DEFAULT 0,
    visibility TEXT NOT NULL DEFAULT 'workspace',
    share_enabled INTEGER NOT NULL DEFAULT 0,
    share_token TEXT,
    archived_at TEXT,
    deleted_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board_column (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    is_done INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (board_id) REFERENCES board(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    board_id TEXT NOT NULL,
    column_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'none',
    start_date TEXT,
    due_date TEXT,
    due_all_day INTEGER NOT NULL DEFAULT 1,
    estimate_minutes INTEGER,
    actual_minutes INTEGER,
    focus_date TEXT,
    assignee_id TEXT,
    recurrence_rule TEXT,
    recurrence_ends_at TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    archived_at TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
    FOREIGN KEY (board_id) REFERENCES board(id) ON DELETE CASCADE,
    FOREIGN KEY (column_id) REFERENCES board_column(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES app_user(id)
);

CREATE TABLE IF NOT EXISTS invite (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'MEMBER',
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES app_user(id)
);

CREATE INDEX IF NOT EXISTS idx_invite_workspace ON invite(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_invite_hash ON invite(token_hash);

CREATE TABLE IF NOT EXISTS label (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'slate',
    created_at TEXT NOT NULL,
    UNIQUE (workspace_id, name),
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_label (
    task_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (task_id, label_id),
    FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES label(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plan_block (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    date TEXT NOT NULL,
    start_minute INTEGER NOT NULL,
    minutes INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto',
    locked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_block_user_date ON plan_block(user_id, date, start_minute);

CREATE TABLE IF NOT EXISTS reminder (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    remind_at TEXT NOT NULL,
    sent_at TEXT,
    channel TEXT NOT NULL DEFAULT 'in_app',
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reminder_due ON reminder(sent_at, remind_at);
CREATE INDEX IF NOT EXISTS idx_reminder_task ON reminder(task_id, user_id);

CREATE TABLE IF NOT EXISTS notification (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    task_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_user ON notification(user_id, read_at, created_at);

CREATE TABLE IF NOT EXISTS attachment (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    uploader_id TEXT NOT NULL,
    name TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE,
    FOREIGN KEY (uploader_id) REFERENCES app_user(id)
);

CREATE INDEX IF NOT EXISTS idx_attachment_task ON attachment(task_id, deleted_at);

CREATE TABLE IF NOT EXISTS task_dependency (
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, depends_on_task_id),
    FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_task_id) REFERENCES task(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_comment (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES app_user(id)
);

CREATE TABLE IF NOT EXISTS subtask (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comment_task ON task_comment(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subtask_task ON subtask(task_id, position);

CREATE TABLE IF NOT EXISTS today_dismissal (
    user_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    date TEXT NOT NULL,
    PRIMARY KEY (user_id, task_id, date),
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS today_selection (
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, date, task_id),
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_today_selection_user_date
    ON today_selection(user_id, date);

CREATE INDEX IF NOT EXISTS idx_task_board_position ON task(board_id, deleted_at, position);
CREATE INDEX IF NOT EXISTS idx_task_workspace_due ON task(workspace_id, deleted_at, due_date);
CREATE INDEX IF NOT EXISTS idx_board_workspace ON board(workspace_id);
CREATE INDEX IF NOT EXISTS idx_column_board ON board_column(board_id, position);

-- Phase 1 schema inventory: the remaining models are present even when their
-- service/UI parity work is scheduled for a later phase.
CREATE TABLE IF NOT EXISTS auth_session (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    ip_hash TEXT,
    user_agent TEXT,
    mfa_verified_at TEXT,
    last_used_at TEXT,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    theme TEXT NOT NULL DEFAULT 'system',
    density TEXT NOT NULL DEFAULT 'comfortable',
    locale TEXT NOT NULL DEFAULT 'en',
    time_format TEXT NOT NULL DEFAULT 'auto',
    reading_size TEXT NOT NULL DEFAULT 'default',
    display_font TEXT NOT NULL DEFAULT 'editorial',
    accent TEXT NOT NULL DEFAULT 'moss',
    motion TEXT NOT NULL DEFAULT 'system',
    start_view TEXT NOT NULL DEFAULT 'today',
    capacity_minutes INTEGER NOT NULL DEFAULT 300,
    plan_buffer_percent INTEGER NOT NULL DEFAULT 0,
    workday_start INTEGER NOT NULL DEFAULT 9,
    workday_end INTEGER NOT NULL DEFAULT 18,
    block_buffer_minutes INTEGER NOT NULL DEFAULT 0,
    focus_minutes INTEGER NOT NULL DEFAULT 25,
    focus_auto_start INTEGER NOT NULL DEFAULT 0,
    capture_close_after_add INTEGER NOT NULL DEFAULT 1,
    auto_plan_enabled INTEGER NOT NULL DEFAULT 1,
    auto_plan_mode TEXT NOT NULL DEFAULT 'suggest',
    auto_plan_rest_minutes INTEGER NOT NULL DEFAULT 10,
    auto_plan_weekly_minutes INTEGER NOT NULL DEFAULT 1500,
    auto_plan_refresh_minutes INTEGER NOT NULL DEFAULT 30,
    auto_plan_deep_work_minutes INTEGER NOT NULL DEFAULT 90,
    auto_plan_split_long_tasks INTEGER NOT NULL DEFAULT 1,
    auto_plan_include_weekends INTEGER NOT NULL DEFAULT 0,
    auto_plan_default_estimate_minutes INTEGER NOT NULL DEFAULT 30,
    auto_plan_cap_behavior TEXT NOT NULL DEFAULT 'stop',
    auto_plan_lunch_enabled INTEGER NOT NULL DEFAULT 1,
    auto_plan_lunch_start INTEGER NOT NULL DEFAULT 12,
    auto_plan_lunch_end INTEGER NOT NULL DEFAULT 13,
    auto_plan_allow_stale_archive INTEGER NOT NULL DEFAULT 0,
    auto_plan_stale_days INTEGER NOT NULL DEFAULT 30,
    features_json TEXT NOT NULL DEFAULT '{"dayFlow":true,"smartPlan":true,"voice":true}',
    email_digest INTEGER NOT NULL DEFAULT 1,
    digest_hour INTEGER NOT NULL DEFAULT 8,
    quiet_start INTEGER,
    quiet_end INTEGER,
    week_starts_on INTEGER NOT NULL DEFAULT 1,
    notifications_json TEXT NOT NULL DEFAULT '{"inApp":true,"email":true,"mentions":true,"browser":true}',
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS view (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    filters_json TEXT NOT NULL DEFAULT '{}',
    is_favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, workspace_id, name),
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_event (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    request_id TEXT,
    ip_hash TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_event (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    task_id TEXT,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    request_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_rule (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    board_id TEXT,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    trigger TEXT NOT NULL,
    conditions_json TEXT NOT NULL DEFAULT '{}',
    action_type TEXT NOT NULL,
    action_value TEXT NOT NULL,
    last_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS automation_run (
    id TEXT PRIMARY KEY,
    rule_id TEXT NOT NULL,
    task_id TEXT,
    actor_id TEXT,
    before_json TEXT NOT NULL DEFAULT '{}',
    after_json TEXT NOT NULL DEFAULT '{}',
    request_id TEXT,
    undone_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (rule_id) REFERENCES automation_rule(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS magic_link_token (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'login',
    expires_at TEXT NOT NULL,
    used_at TEXT,
    ip_hash TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oidc_config (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL UNIQUE,
    issuer TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_enc TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    allowed_domains TEXT NOT NULL DEFAULT '',
    enforce_sso INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_token (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    last_used_at TEXT,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    url TEXT NOT NULL,
    secret_enc TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    events_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL,
    last_status INTEGER,
    last_delivery_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_delivery (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status INTEGER,
    response TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (webhook_id) REFERENCES webhook(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS idempotency_key (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    key TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER,
    response_json TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    UNIQUE (user_id, key),
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS undo_action (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    inverse_json TEXT NOT NULL DEFAULT '{}',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_message (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'generic',
    status TEXT NOT NULL DEFAULT 'queued',
    sent_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_run (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    details TEXT
);

CREATE TABLE IF NOT EXISTS client_error (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    message TEXT NOT NULL,
    stack TEXT,
    url TEXT,
    user_agent TEXT,
    request_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_account (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (provider, provider_account_id),
    FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS backup_run (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    size_bytes INTEGER,
    location TEXT,
    checksum TEXT
);

CREATE TABLE IF NOT EXISTS feature_flag (
    key TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

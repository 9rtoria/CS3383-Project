CREATE UNIQUE INDEX IF NOT EXISTS idx_board_share_token
    ON board(share_token) WHERE share_token IS NOT NULL;

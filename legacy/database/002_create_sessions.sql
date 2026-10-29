
CREATE TABLE IF NOT EXISTS participant_sessions (
    sid VARCHAR(255) PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS participant_sessions_expire_idx
    ON participant_sessions (expire);

CREATE INDEX IF NOT EXISTS participant_sessions_expire_cleanup_idx
    ON participant_sessions (expire);

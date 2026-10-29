
CREATE TABLE IF NOT EXISTS login_attempts (
    username_normalized VARCHAR(20) PRIMARY KEY,
    failed_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (failed_attempts >= 0),
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

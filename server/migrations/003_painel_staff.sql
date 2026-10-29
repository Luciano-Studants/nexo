-- Painel de staff: sessões com inatividade de 30 min e bloqueio por tentativas de senha.
ALTER TABLE admin_accounts
    ADD COLUMN failed_count INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN locked_until TIMESTAMPTZ;

CREATE TABLE admin_sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id     UUID        NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
    token_hash   CHAR(64)    NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX admin_sessions_admin_idx ON admin_sessions (admin_id);

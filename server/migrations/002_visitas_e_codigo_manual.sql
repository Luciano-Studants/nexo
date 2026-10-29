-- Bloqueio do código manual: 5 erros consecutivos bloqueiam a pessoa por 5 minutos.
CREATE TABLE manual_code_attempts (
    participant_id UUID PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
    failed_count   INTEGER     NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    locked_until   TIMESTAMPTZ,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Visitas passam a lembrar se vieram do QR ou do código manual (útil para relatórios).
ALTER TABLE visits
    ADD COLUMN method VARCHAR(10) NOT NULL DEFAULT 'qr' CHECK (method IN ('qr', 'manual'));

-- Busca do código manual por sala + hash.
CREATE INDEX room_qr_manual_idx ON room_qr_versions (room_id, manual_code_hash);

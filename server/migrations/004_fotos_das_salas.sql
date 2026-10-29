-- Foto do interior de cada ambiente, enviada pela equipe. Guardada já reduzida (WebP, até 1280 px,
-- sem metadados/GPS) no próprio banco: sobrevive à troca de hospedagem e entra nos backups.
CREATE TABLE room_photos (
    room_id      UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
    data         BYTEA       NOT NULL,
    content_type VARCHAR(40) NOT NULL DEFAULT 'image/webp',
    width        INTEGER     NOT NULL,
    height       INTEGER     NOT NULL,
    bytes        INTEGER     NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   UUID REFERENCES admin_accounts(id) ON DELETE SET NULL
);

-- NEXO · esquema base (versão 2, entrada só com nome completo, sem senha).
-- Substitui os esquemas antigos guardados em /legacy. Executar com `npm run db:migrate`.
-- Não use BEGIN/COMMIT aqui: o executor já roda cada arquivo em uma transação.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Edição do evento (PROCIDADANIA CEUMAP). O nome é editável pelo staff.
CREATE TABLE events (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                 VARCHAR(100) NOT NULL UNIQUE,
    name                 VARCHAR(160) NOT NULL,
    edition_label        VARCHAR(160),
    timezone             VARCHAR(64)  NOT NULL DEFAULT 'America/Sao_Paulo',
    starts_at            TIMESTAMPTZ,
    ends_at              TIMESTAMPTZ,
    -- draft/scheduled: antes da abertura; active: aberto; paused: interrompido; ended: encerrado.
    status               VARCHAR(20)  NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'ended')),
    -- Modo de teste: permite registrar visitas antes do evento (treino da equipe).
    test_mode            BOOLEAN      NOT NULL DEFAULT FALSE,
    collection_image_url TEXT,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE floors (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id   UUID         NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    name       VARCHAR(100) NOT NULL,
    sort_order INTEGER      NOT NULL,
    active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (event_id, sort_order),
    UNIQUE (event_id, name)
);

-- Ambientes visitáveis. Banheiros, escadas e elevador são só desenho do mapa e não entram aqui.
-- Todas as salas ficam cadastradas; o staff liga/desliga (active) e define quais contam (is_required).
CREATE TABLE rooms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    floor_id    UUID         NOT NULL REFERENCES floors(id) ON DELETE RESTRICT,
    slug        VARCHAR(80)  NOT NULL,
    name        VARCHAR(160) NOT NULL,
    room_number VARCHAR(40),
    description TEXT         NOT NULL DEFAULT '',
    is_required BOOLEAN      NOT NULL DEFAULT FALSE,
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (floor_id, slug)
);

CREATE TABLE room_qr_versions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id          UUID    NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    version_number   INTEGER NOT NULL CHECK (version_number > 0),
    token_hash       TEXT    NOT NULL UNIQUE,
    manual_code_hash TEXT    UNIQUE,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'replaced', 'cancelled')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    activated_at     TIMESTAMPTZ,
    replaced_at      TIMESTAMPTZ,
    UNIQUE (room_id, version_number)
);

CREATE UNIQUE INDEX one_active_qr_per_room
    ON room_qr_versions (room_id) WHERE status = 'active';

-- Visitante: só nome completo, ID interno e avatar. O acesso é um token guardado no
-- localStorage do aparelho; o banco guarda apenas o hash do token e um hash do IP.
CREATE TABLE participants (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id             UUID         NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
    full_name            VARCHAR(160) NOT NULL,
    full_name_normalized VARCHAR(160) NOT NULL,
    avatar_key           VARCHAR(40)  NOT NULL,
    token_hash           TEXT         NOT NULL UNIQUE,
    ip_hash              TEXT,
    status               VARCHAR(20)  NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'blocked')),
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_seen_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CHECK (char_length(btrim(full_name)) >= 5)
);

-- Retomada (nome + IP em janela de tempo) e teto de criação de perfis por IP/hora.
CREATE INDEX participants_resume_idx
    ON participants (event_id, full_name_normalized, ip_hash, last_seen_at DESC);
CREATE INDEX participants_ip_created_idx
    ON participants (ip_hash, created_at DESC);

CREATE TABLE visits (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
    room_id        UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    qr_version_id  UUID REFERENCES room_qr_versions(id) ON DELETE RESTRICT,
    visited_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (participant_id, room_id)
);

CREATE INDEX visits_room_idx ON visits (room_id, visited_at DESC);

-- Acesso do STAFF permanece separado do visitante (conta compartilhada, sem cadastro público).
CREATE TABLE admin_accounts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(80) NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    active        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_type  VARCHAR(20) NOT NULL CHECK (actor_type IN ('staff', 'system', 'visitor')),
    actor_id    UUID,
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80)  NOT NULL,
    entity_id   TEXT,
    outcome     VARCHAR(20)  NOT NULL DEFAULT 'success',
    details     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

-- Não há exclusão automática: a retenção de 30 dias aguarda aprovação institucional (LGPD/backups).
-- A limpeza é feita por `npm run db:purge` (simulação por padrão).

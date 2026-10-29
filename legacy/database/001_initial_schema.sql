
BEGIN;

CREATE TABLE events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    edition_label VARCHAR(160),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'active', 'ended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE participants (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name VARCHAR(160) NOT NULL
        CHECK (char_length(trim(full_name)) >= 3),
    username VARCHAR(20) NOT NULL,
    username_normalized VARCHAR(20) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_key VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (char_length(username) BETWEEN 3 AND 20),
    CHECK (username_normalized ~ '^[a-zA-Z0-9]+$')
);

CREATE TABLE floors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id),
    name VARCHAR(100) NOT NULL,
    floor_order INTEGER NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (event_id, floor_order)
);

CREATE TABLE rooms (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id),
    floor_id BIGINT NOT NULL REFERENCES floors(id),
    name VARCHAR(120) NOT NULL,
    room_number VARCHAR(30) NOT NULL,
    description TEXT,
    required_for_completion BOOLEAN NOT NULL DEFAULT TRUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, floor_id, room_number)
);

CREATE TABLE room_qr_versions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id BIGINT NOT NULL REFERENCES rooms(id),
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    token_hash TEXT NOT NULL UNIQUE,
    manual_code_hash TEXT NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'replaced', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    UNIQUE (room_id, version_number)
);

CREATE UNIQUE INDEX one_active_qr_per_room
    ON room_qr_versions(room_id)
    WHERE status = 'active';

CREATE TABLE visits (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id),
    participant_id BIGINT NOT NULL REFERENCES participants(id),
    room_id BIGINT NOT NULL REFERENCES rooms(id),
    qr_version_id BIGINT REFERENCES room_qr_versions(id),
    visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (participant_id, room_id)
);

CREATE TABLE admin_accounts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT REFERENCES events(id),
    actor_type VARCHAR(20) NOT NULL
        CHECK (actor_type IN ('admin', 'system')),
    actor_id BIGINT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(80),
    entity_id BIGINT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX visits_event_participant_idx
    ON visits(event_id, participant_id);

CREATE INDEX visits_event_room_idx
    ON visits(event_id, room_id);

CREATE INDEX rooms_event_active_idx
    ON rooms(event_id, active);

CREATE INDEX audit_logs_created_at_idx
    ON audit_logs(created_at DESC);

COMMIT;

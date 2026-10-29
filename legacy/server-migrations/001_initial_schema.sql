-- NEXO: estrutura inicial. Aplicar somente em banco de desenvolvimento/revisado.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(160) NOT NULL CHECK (char_length(trim(full_name)) >= 3),
  username VARCHAR(20) NOT NULL,
  username_normalized VARCHAR(20) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_key VARCHAR(40),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','disabled')),
  failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (username ~ '^[A-Za-z0-9]{3,20}$'),
  CHECK (username_normalized = lower(username))
);
CREATE TABLE IF NOT EXISTS event_editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','active','paused','ended')),
  collection_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS floors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES event_editions(id) ON DELETE RESTRICT,
  name VARCHAR(100) NOT NULL,
  sort_order INTEGER NOT NULL,
  map_asset_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, sort_order), UNIQUE(event_id, name)
);
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_id UUID NOT NULL REFERENCES floors(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  room_number VARCHAR(40) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_required BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  map_x NUMERIC(7,4), map_y NUMERIC(7,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(floor_id, room_number)
);
CREATE TABLE IF NOT EXISTS room_qr_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  token_hash TEXT NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','replaced','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), activated_at TIMESTAMPTZ, replaced_at TIMESTAMPTZ,
  UNIQUE(room_id, version_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_qr_per_room ON room_qr_versions(room_id) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  qr_version_id UUID REFERENCES room_qr_versions(id) ON DELETE RESTRICT,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, room_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('staff','system','visitor')),
  actor_id UUID,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id TEXT,
  outcome VARCHAR(20) NOT NULL DEFAULT 'success',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visits_user_idx ON visits(user_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS visits_room_idx ON visits(room_id, visited_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);
-- Não existe exclusão automática de dados nesta migração. Política de retenção e LGPD precisam de aprovação institucional.

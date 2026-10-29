import type { PoolClient } from 'pg';

import { db } from '../db.js';
import { deriveManualCode, deriveToken, hashManualCode, hashToken } from './qr.js';

export type RoomSelector = { all?: boolean; required?: boolean; slugs?: string[] };

export type TargetRoom = { id: string; slug: string; name: string; number: string | null; floorName: string };

// Ambientes do evento ativo escolhidos por --all, --required ou --slugs.
export async function selectRooms(eventSlug: string, sel: RoomSelector): Promise<TargetRoom[]> {
  if (!sel.all && !sel.required && !(sel.slugs && sel.slugs.length)) {
    throw new Error('Informe --all, --required ou --slugs a,b,c.');
  }
  const { rows } = await db.query<{ id: string; slug: string; name: string; room_number: string | null; floor_name: string }>(
    `SELECT r.id, r.slug, r.name, r.room_number, f.name AS floor_name
       FROM rooms r
       JOIN floors f ON f.id = r.floor_id
       JOIN events e ON e.id = f.event_id
      WHERE e.slug = $1
        AND ($2::boolean OR ($3::boolean AND r.is_required AND r.active) OR r.slug = ANY($4::text[]))
      ORDER BY f.sort_order, r.room_number NULLS LAST, r.name`,
    [eventSlug, Boolean(sel.all), Boolean(sel.required), sel.slugs ?? []],
  );
  const found = rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, number: r.room_number, floorName: r.floor_name,
  }));
  const missing = (sel.slugs ?? []).filter((s) => !found.some((r) => r.slug === s));
  if (missing.length) throw new Error(`Ambientes não encontrados: ${missing.join(', ')}`);
  return found;
}

// Ambientes do evento ativo a partir de ids (painel). Ids de outro evento ou inexistentes dão erro.
export async function selectRoomsByIds(eventSlug: string, ids: string[]): Promise<TargetRoom[]> {
  const { rows } = await db.query<{ id: string; slug: string; name: string; room_number: string | null; floor_name: string }>(
    `SELECT r.id, r.slug, r.name, r.room_number, f.name AS floor_name
       FROM rooms r JOIN floors f ON f.id = r.floor_id JOIN events e ON e.id = f.event_id
      WHERE e.slug = $1 AND r.id = ANY($2::uuid[])
      ORDER BY f.sort_order, r.room_number NULLS LAST, r.name`,
    [eventSlug, ids],
  );
  if (rows.length !== new Set(ids).size) throw new Error('Ambiente não encontrado.');
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, number: r.room_number, floorName: r.floor_name }));
}

async function inTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Cria uma versão PENDENTE (ainda não vale) para cada ambiente que não tenha uma pendente.
// A versão só passa a valer em activatePending, depois de impressa e conferida no local.
export async function prepareVersions(secret: string, roomIds: string[]): Promise<Array<{ roomId: string; version: number; created: boolean }>> {
  return inTransaction(async (c) => {
    const out: Array<{ roomId: string; version: number; created: boolean }> = [];
    for (const roomId of roomIds) {
      await c.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
      const pending = await c.query<{ version_number: number }>(
        "SELECT version_number FROM room_qr_versions WHERE room_id = $1 AND status = 'pending'",
        [roomId],
      );
      if (pending.rows[0]) {
        out.push({ roomId, version: pending.rows[0].version_number, created: false });
        continue;
      }
      const next = await c.query<{ n: number }>(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM room_qr_versions WHERE room_id = $1',
        [roomId],
      );
      const version = next.rows[0]!.n;
      await c.query(
        `INSERT INTO room_qr_versions (room_id, version_number, token_hash, manual_code_hash, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [
          roomId,
          version,
          hashToken(deriveToken(secret, roomId, version)),
          hashManualCode(secret, roomId, deriveManualCode(secret, roomId, version)),
        ],
      );
      out.push({ roomId, version, created: true });
    }
    return out;
  });
}

// Ativa a versão pendente e substitui a ativa anterior, tudo na mesma transação:
// nunca existem dois QR ativos na sala, e o antigo deixa de valer no mesmo instante.
export async function activatePending(roomIds: string[]): Promise<Array<{ roomId: string; version: number; replaced: number | null }>> {
  return inTransaction(async (c) => {
    const out: Array<{ roomId: string; version: number; replaced: number | null }> = [];
    for (const roomId of roomIds) {
      await c.query('SELECT id FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
      const pending = await c.query<{ id: string; version_number: number }>(
        `SELECT id, version_number FROM room_qr_versions
          WHERE room_id = $1 AND status = 'pending' ORDER BY version_number DESC`,
        [roomId],
      );
      const chosen = pending.rows[0];
      if (!chosen) continue;

      // Versões pendentes mais antigas nunca chegaram a valer.
      await c.query(
        `UPDATE room_qr_versions SET status = 'cancelled'
          WHERE room_id = $1 AND status = 'pending' AND id <> $2`,
        [roomId, chosen.id],
      );
      const old = await c.query<{ version_number: number }>(
        `UPDATE room_qr_versions SET status = 'replaced', replaced_at = now()
          WHERE room_id = $1 AND status = 'active' RETURNING version_number`,
        [roomId],
      );
      await c.query(
        "UPDATE room_qr_versions SET status = 'active', activated_at = now() WHERE id = $1",
        [chosen.id],
      );
      await c.query(
        `INSERT INTO audit_log (actor_type, action, entity_type, entity_id, details)
         VALUES ('system', 'qr.activate', 'room', $1, $2::jsonb)`,
        [roomId, JSON.stringify({ version: chosen.version_number, replaced: old.rows[0]?.version_number ?? null })],
      );
      out.push({ roomId, version: chosen.version_number, replaced: old.rows[0]?.version_number ?? null });
    }
    return out;
  });
}

export type PrintItem = TargetRoom & { version: number; status: string };

// Versões a imprimir (pendentes ou ativas) dos ambientes escolhidos.
export async function versionsToPrint(rooms: TargetRoom[], status: 'pending' | 'active'): Promise<PrintItem[]> {
  const { rows } = await db.query<{ room_id: string; version_number: number }>(
    `SELECT room_id, version_number FROM room_qr_versions
      WHERE status = $1 AND room_id = ANY($2::uuid[])`,
    [status, rooms.map((r) => r.id)],
  );
  const byRoom = new Map(rows.map((r) => [r.room_id, r.version_number]));
  return rooms
    .filter((r) => byRoom.has(r.id))
    .map((r) => ({ ...r, version: byRoom.get(r.id)!, status }));
}

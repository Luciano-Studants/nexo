import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import { db } from '../db.js';
import { loadActiveEvent, type ActiveEvent } from '../services/event.js';
import { computeEventState, type EventPhase } from '../services/eventState.js';
import { hashToken as hashAccessToken } from '../services/identity.js';
import {
  extractToken,
  hashManualCode,
  hashToken as hashQrToken,
  normalizeManualCode,
} from '../services/qr.js';
import { getProgress } from '../services/progress.js';

const MAX_MANUAL_FAILURES = 5;
const LOCK_MINUTES = 5;

export const MSG = {
  outdated: 'Este QR Code está desatualizado. Procure a identificação atualizada da sala para registrar sua visita.',
  unknown: 'QR Code não reconhecido. Confira se ele é do NEXO.',
  notActive: 'Este QR Code ainda não foi ativado.',
  unavailable: 'Este ambiente não está disponível no evento agora.',
} as const;

const NOT_OPEN: Record<Exclude<EventPhase, 'open'>, string> = {
  before_open: 'As visitas ainda não foram liberadas. Volte quando o evento abrir.',
  paused: 'O evento está temporariamente interrompido. As visitas voltam quando a organização retomar.',
  ended: 'O evento foi encerrado. Não é possível registrar novas visitas.',
};

type Who = { id: string; event_id: string };
type RoomInfo = {
  id: string; slug: string; name: string; room_number: string | null; is_required: boolean;
  active: boolean; floor_active: boolean; floor_name: string; floor_order: number;
};

const ROOM_COLUMNS = `r.id, r.slug, r.name, r.room_number, r.is_required, r.active,
       f.active AS floor_active, f.name AS floor_name, f.sort_order AS floor_order`;

async function authenticate(req: Request): Promise<Who | null> {
  const m = /^Bearer (nx_[A-Za-z0-9_-]{20,100})$/.exec(req.header('authorization') ?? '');
  if (!m) return null;
  const { rows } = await db.query<Who>(
    `UPDATE participants SET last_seen_at = now()
      WHERE token_hash = $1 AND status = 'active' RETURNING id, event_id`,
    [hashAccessToken(m[1]!)],
  );
  return rows[0] ?? null;
}

async function registerVisit(who: Who, room: RoomInfo, qrVersionId: string, method: 'qr' | 'manual', res: Response) {
  const inserted = await db.query(
    `INSERT INTO visits (participant_id, room_id, qr_version_id, method)
     VALUES ($1, $2, $3, $4) ON CONFLICT (participant_id, room_id) DO NOTHING RETURNING id`,
    [who.id, room.id, qrVersionId, method],
  );
  const isNew = (inserted.rowCount ?? 0) > 0;
  const counted = room.is_required && room.active && room.floor_active;

  return res.status(isNew ? 201 : 200).json({
    status: isNew ? 'registered' : 'already_visited',
    room: {
      id: room.id, slug: room.slug, name: room.name, number: room.room_number,
      floorName: room.floor_name, floorOrder: room.floor_order, required: counted,
    },
    // Peça liberada: só visitas novas a ambientes obrigatórios ativos.
    fragmentUnlocked: isNew && counted,
    progress: await getProgress(who.event_id, who.id),
  });
}

// Valida quem é a pessoa e se o evento aceita visitas. Responde e devolve null se não puder seguir.
async function gate(req: Request, res: Response, config: AppConfig): Promise<{ who: Who; event: ActiveEvent } | null> {
  const who = await authenticate(req);
  if (!who) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Perfil não identificado. Entre novamente.' });
    return null;
  }
  const event = await loadActiveEvent(config.eventSlug);
  if (!event) {
    res.status(503).json({ message: 'Evento não configurado.' });
    return null;
  }
  const state = computeEventState(event);
  if (!state.visitsAllowed) {
    const phase = state.phase === 'open' ? 'before_open' : state.phase;
    res.status(403).json({ code: 'VISITS_NOT_OPEN', phase, message: NOT_OPEN[phase as Exclude<EventPhase, 'open'>] });
    return null;
  }
  return { who, event };
}

const tokenBody = z.object({ code: z.string().min(1).max(300) });
const manualBody = z.object({ roomId: z.string().uuid(), code: z.string().min(1).max(40) });

export function visitsRouter(config: AppConfig): Router {
  const router = Router();

  // Visita por QR Code (conteúdo lido: URL /q/<token> ou o próprio token).
  router.post('/visits', async (req: Request, res: Response) => {
    const body = tokenBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ code: 'BAD_REQUEST', message: 'Dados inválidos.' });

    try {
      const ctx = await gate(req, res, config);
      if (!ctx) return;

      const token = extractToken(body.data.code);
      if (!token) return res.status(404).json({ code: 'QR_UNKNOWN', message: MSG.unknown });

      const { rows } = await db.query<RoomInfo & { version_id: string; status: string; event_id: string }>(
        `SELECT v.id AS version_id, v.status, f.event_id, ${ROOM_COLUMNS}
           FROM room_qr_versions v
           JOIN rooms r ON r.id = v.room_id
           JOIN floors f ON f.id = r.floor_id
          WHERE v.token_hash = $1`,
        [hashQrToken(token)],
      );
      const found = rows[0];
      if (!found || found.event_id !== ctx.event.id) {
        return res.status(404).json({ code: 'QR_UNKNOWN', message: MSG.unknown });
      }
      if (found.status === 'replaced' || found.status === 'cancelled') {
        return res.status(410).json({ code: 'QR_OUTDATED', message: MSG.outdated });
      }
      if (found.status === 'pending') {
        return res.status(409).json({ code: 'QR_NOT_ACTIVE', message: MSG.notActive });
      }
      if (!found.active || !found.floor_active) {
        return res.status(409).json({ code: 'ROOM_UNAVAILABLE', message: MSG.unavailable });
      }
      return await registerVisit(ctx.who, found, found.version_id, 'qr', res);
    } catch (error) {
      console.error('Erro ao registrar visita:', error instanceof Error ? error.message : error);
      return res.status(500).json({ message: 'Não foi possível registrar a visita.' });
    }
  });

  // Alternativa quando a câmera falha: ambiente + código curto impresso na etiqueta.
  router.post('/visits/manual', async (req: Request, res: Response) => {
    const body = manualBody.safeParse(req.body);
    if (!body.success) return res.status(400).json({ code: 'BAD_REQUEST', message: 'Informe o ambiente e o código.' });

    try {
      const ctx = await gate(req, res, config);
      if (!ctx) return;
      const { who, event } = ctx;

      const lock = await db.query<{ left: number }>(
        `SELECT CEIL(EXTRACT(EPOCH FROM (locked_until - now())))::int AS left
           FROM manual_code_attempts WHERE participant_id = $1 AND locked_until > now()`,
        [who.id],
      );
      if (lock.rows[0]) {
        res.setHeader('Retry-After', String(lock.rows[0].left));
        return res.status(429).json({
          code: 'MANUAL_LOCKED',
          retryAfterSeconds: lock.rows[0].left,
          message: 'Muitas tentativas de código. Tente novamente em alguns minutos ou leia o QR Code.',
        });
      }

      const roomRes = await db.query<RoomInfo>(
        `SELECT ${ROOM_COLUMNS} FROM rooms r JOIN floors f ON f.id = r.floor_id
          WHERE r.id = $1 AND f.event_id = $2`,
        [body.data.roomId, event.id],
      );
      const room = roomRes.rows[0];
      if (!room) return res.status(404).json({ code: 'ROOM_UNKNOWN', message: 'Ambiente não encontrado.' });
      if (!room.active || !room.floor_active) {
        return res.status(409).json({ code: 'ROOM_UNAVAILABLE', message: MSG.unavailable });
      }

      const normalized = normalizeManualCode(body.data.code);
      let version: { id: string; status: string } | undefined;
      if (normalized) {
        const v = await db.query<{ id: string; status: string }>(
          'SELECT id, status FROM room_qr_versions WHERE room_id = $1 AND manual_code_hash = $2',
          [room.id, hashManualCode(config.qrSecret, room.id, normalized)],
        );
        version = v.rows[0];
      }

      if (version?.status === 'active') {
        await db.query('DELETE FROM manual_code_attempts WHERE participant_id = $1', [who.id]);
        return await registerVisit(who, room, version.id, 'manual', res);
      }
      if (version && (version.status === 'replaced' || version.status === 'cancelled')) {
        return res.status(410).json({ code: 'QR_OUTDATED', message: MSG.outdated });
      }
      if (version?.status === 'pending') {
        return res.status(409).json({ code: 'QR_NOT_ACTIVE', message: MSG.notActive });
      }

      // Código errado: 5 erros consecutivos bloqueiam por 5 minutos.
      const fail = await db.query<{ failed_count: number; locked_until: Date | null }>(
        `INSERT INTO manual_code_attempts (participant_id, failed_count, locked_until, updated_at)
         VALUES ($1, 1, NULL, now())
         ON CONFLICT (participant_id) DO UPDATE SET
           failed_count = CASE WHEN manual_code_attempts.locked_until IS NOT NULL
                                AND manual_code_attempts.locked_until <= now()
                               THEN 1 ELSE manual_code_attempts.failed_count + 1 END,
           locked_until = CASE WHEN (CASE WHEN manual_code_attempts.locked_until IS NOT NULL
                                           AND manual_code_attempts.locked_until <= now()
                                          THEN 1 ELSE manual_code_attempts.failed_count + 1 END) >= $2
                               THEN now() + make_interval(mins => $3) ELSE NULL END,
           updated_at = now()
         RETURNING failed_count, locked_until`,
        [who.id, MAX_MANUAL_FAILURES, LOCK_MINUTES],
      );
      const f = fail.rows[0]!;
      if (f.locked_until) {
        return res.status(429).json({
          code: 'MANUAL_LOCKED',
          retryAfterSeconds: LOCK_MINUTES * 60,
          message: `Muitas tentativas de código. Tente novamente em ${LOCK_MINUTES} minutos ou leia o QR Code.`,
        });
      }
      return res.status(422).json({
        code: 'MANUAL_CODE_INVALID',
        attemptsLeft: MAX_MANUAL_FAILURES - f.failed_count,
        message: 'Código incorreto. Confira o código impresso na etiqueta desta sala.',
      });
    } catch (error) {
      console.error('Erro no código manual:', error instanceof Error ? error.message : error);
      return res.status(500).json({ message: 'Não foi possível validar o código.' });
    }
  });

  return router;
}

import express, { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import type { AppConfig } from '../config.js';
import { db } from '../db.js';
import { login, logout, purgeExpiredSessions, touchSession, type AdminSession } from '../services/adminAuth.js';
import { audit } from '../services/audit.js';
import { loadActiveEvent } from '../services/event.js';
import { normalizeName } from '../services/identity.js';
import { MAX_UPLOAD_BYTES, PhotoError, processPhoto } from '../services/photos.js';
import { computeEventState } from '../services/eventState.js';
import { buildReport } from '../services/reports.js';
import { renderPdf, renderXlsx } from '../services/reportFiles.js';
import { entryQrPng, entryUrl, renderEntryPoster, renderLabels } from '../services/labels.js';
import { activatePending, prepareVersions, selectRoomsByIds, versionsToPrint } from '../services/qrAdmin.js';

const fail = (res: Response, status: number, code: string, message: string, extra: object = {}) =>
  res.status(status).json({ code, message, ...extra });

function admin(res: Response): AdminSession {
  return res.locals.admin as AdminSession;
}

const bearer = (req: Request) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await touchSession(bearer(req));
    if (!session) return fail(res, 401, 'ADMIN_UNAUTHENTICATED', 'Sessão expirada ou inválida. Entre novamente.');
    res.locals.admin = session;
    res.setHeader('Cache-Control', 'no-store');
    return next();
  } catch (error) {
    return next(error);
  }
}

// Escapa para CSV e neutraliza fórmulas (=, +, -, @) que planilhas executariam ao abrir.
function csvCell(value: unknown): string {
  let s = value instanceof Date ? value.toISOString() : String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (header: string[], rows: unknown[][]) =>
  '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const uuid = z.string().uuid();
const isoOrNull = z.union([z.string().datetime({ offset: true }), z.null()]);

export function adminRouter(config: AppConfig): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: Number(process.env.ADMIN_LOGIN_LIMIT_PER_15MIN) || 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { code: 'ADMIN_RATE_LIMITED', message: 'Muitas tentativas. Aguarde alguns minutos.' },
  });

  async function eventOrFail(res: Response) {
    const event = await loadActiveEvent(config.eventSlug);
    if (!event) fail(res, 503, 'EVENT_MISSING', 'Evento não configurado.');
    return event;
  }

  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };

  // ---------- Sessão ----------
  router.post('/admin/login', loginLimiter, wrap(async (req, res) => {
    const parsed = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Informe usuário e senha.');
    const r = await login(parsed.data.username, parsed.data.password);
    if (!r.ok) {
      // Não grava o texto digitado: é comum colar a senha no campo de usuário.
      await audit(r.adminId ?? null, 'admin.login', 'admin', r.adminId ?? null, r.adminId ? { reason: r.reason } : { reason: 'unknown_user' }, 'failure');
      if (r.reason === 'locked') {
        return fail(res, 429, 'ADMIN_LOCKED', `Conta bloqueada por tentativas erradas. Tente de novo em ${Math.ceil((r.retryAfterSeconds ?? 0) / 60)} min.`, { retryAfterSeconds: r.retryAfterSeconds });
      }
      return fail(res, 401, 'ADMIN_INVALID', 'Usuário ou senha incorretos.');
    }
    await audit(r.adminId, 'admin.login', 'admin', r.adminId);
    void purgeExpiredSessions().catch(() => undefined);
    return res.json({ token: r.token, username: r.username });
  }));

  router.post('/admin/logout', requireAdmin, wrap(async (req, res) => {
    await logout(bearer(req));
    res.json({ ok: true });
  }));

  router.get('/admin/me', requireAdmin, (_req, res) => {
    res.json({ username: admin(res).username });
  });

  // ---------- Visão geral ----------
  router.get('/admin/overview', requireAdmin, wrap(async (_req, res) => {
    const event = await eventOrFail(res);
    if (!event) return;
    const state = computeEventState(event);

    const [stats, rooms] = await Promise.all([
      db.query<{ participants: number; visits: number; required_active: number; active_rooms: number; rooms_total: number; completed: number }>(
        `WITH req AS (
           SELECT r.id FROM rooms r JOIN floors f ON f.id = r.floor_id
            WHERE f.event_id = $1 AND f.active AND r.active AND r.is_required),
         done AS (
           SELECT v.participant_id FROM visits v JOIN req ON req.id = v.room_id
            GROUP BY v.participant_id HAVING COUNT(*) >= (SELECT COUNT(*) FROM req))
         SELECT
           (SELECT COUNT(*)::int FROM participants WHERE event_id = $1) AS participants,
           (SELECT COUNT(*)::int FROM visits v JOIN participants p ON p.id = v.participant_id WHERE p.event_id = $1) AS visits,
           (SELECT COUNT(*)::int FROM req) AS required_active,
           (SELECT COUNT(*)::int FROM rooms r JOIN floors f ON f.id = r.floor_id WHERE f.event_id = $1 AND f.active AND r.active) AS active_rooms,
           (SELECT COUNT(*)::int FROM rooms r JOIN floors f ON f.id = r.floor_id WHERE f.event_id = $1) AS rooms_total,
           (SELECT CASE WHEN (SELECT COUNT(*) FROM req) = 0 THEN 0 ELSE COUNT(*)::int END FROM done) AS completed`,
        [event.id],
      ),
      db.query(
        `SELECT f.id AS floor_id, f.name AS floor_name, f.sort_order, f.active AS floor_active,
                r.id, r.slug, r.name, r.room_number, r.description, r.active, r.is_required,
                (SELECT COUNT(*)::int FROM visits v WHERE v.room_id = r.id) AS visits,
                (SELECT version_number FROM room_qr_versions q WHERE q.room_id = r.id AND q.status = 'active') AS qr_active,
                (SELECT version_number FROM room_qr_versions q WHERE q.room_id = r.id AND q.status = 'pending') AS qr_pending,
                (SELECT (extract(epoch FROM p.updated_at) * 1000)::bigint FROM room_photos p WHERE p.room_id = r.id) AS photo_version
           FROM rooms r JOIN floors f ON f.id = r.floor_id
          WHERE f.event_id = $1
          ORDER BY f.sort_order, r.room_number NULLS LAST, r.name`,
        [event.id],
      ),
    ]);
    const s = stats.rows[0]!;

    const floors: Array<{ id: string; name: string; order: number; active: boolean; rooms: unknown[] }> = [];
    for (const r of rooms.rows) {
      let floor = floors.find((f) => f.id === r.floor_id);
      if (!floor) {
        floor = { id: r.floor_id, name: r.floor_name, order: r.sort_order, active: r.floor_active, rooms: [] };
        floors.push(floor);
      }
      floor.rooms.push({
        id: r.id, slug: r.slug, name: r.name, number: r.room_number, description: r.description,
        active: r.active, required: r.is_required, visits: r.visits,
        qrActive: r.qr_active, qrPending: r.qr_pending,
        photoVersion: r.photo_version === null ? null : Number(r.photo_version),
      });
    }

    res.json({
      event: {
        name: event.name, editionLabel: event.edition_label, status: event.status, testMode: event.test_mode,
        startsAt: event.starts_at, endsAt: event.ends_at, timezone: event.timezone, ...state,
        // Ambientes ativos/obrigatórios só mudam fora do período do evento.
        roomsLocked: state.phase !== 'before_open',
      },
      stats: {
        participants: s.participants, visits: s.visits, completed: s.completed,
        requiredActive: s.required_active, activeRooms: s.active_rooms, roomsTotal: s.rooms_total,
      },
      floors,
      publicAppUrlConfigured: Boolean(config.publicAppUrl),
      entryUrl: config.publicAppUrl ? entryUrl(config.publicAppUrl) : null,
    });
  }));

  // ---------- Evento ----------
  router.patch('/admin/event', requireAdmin, wrap(async (req, res) => {
    const parsed = z.object({
      name: z.string().trim().min(3).max(160).optional(),
      editionLabel: z.union([z.string().trim().max(160), z.null()]).optional(),
      startsAt: isoOrNull.optional(),
      endsAt: isoOrNull.optional(),
      testMode: z.boolean().optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Dados do evento inválidos.');
    const event = await eventOrFail(res);
    if (!event) return;

    const d = parsed.data;
    const startsAt = d.startsAt === undefined ? event.starts_at : d.startsAt === null ? null : new Date(d.startsAt);
    const endsAt = d.endsAt === undefined ? event.ends_at : d.endsAt === null ? null : new Date(d.endsAt);
    if (startsAt && endsAt && endsAt <= startsAt) return fail(res, 400, 'VALIDATION', 'O término precisa ser depois do início.');

    await db.query(
      `UPDATE events SET name = $2, edition_label = $3, starts_at = $4, ends_at = $5, test_mode = $6, updated_at = now()
        WHERE id = $1`,
      [
        event.id, d.name ?? event.name,
        d.editionLabel === undefined ? event.edition_label : d.editionLabel || null,
        startsAt, endsAt, d.testMode ?? event.test_mode,
      ],
    );
    await audit(admin(res).adminId, 'event.update', 'event', event.id, { changed: Object.keys(d) });
    res.json({ ok: true });
  }));

  // Controle do evento: antecipar/abrir, pausar, retomar, encerrar, voltar a "agendado" (adiar).
  router.post('/admin/event/action', requireAdmin, wrap(async (req, res) => {
    const parsed = z.object({
      action: z.enum(['open', 'pause', 'resume', 'end', 'schedule', 'reopen']),
      confirm: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Ação inválida.');
    const event = await eventOrFail(res);
    if (!event) return;
    const { phase } = computeEventState(event);
    const { action } = parsed.data;

    const allowed: Record<string, string[]> = {
      open: ['before_open'], pause: ['open'], resume: ['paused'], end: ['before_open', 'open', 'paused'], schedule: ['before_open', 'open', 'paused'], reopen: ['ended'],
    };
    if (!allowed[action]!.includes(phase)) {
      return fail(res, 409, 'EVENT_ACTION_INVALID', 'Essa ação não é possível na situação atual do evento.', { phase });
    }
    if ((action === 'end' || action === 'schedule' || action === 'reopen') && parsed.data.confirm !== true) {
      return fail(res, 400, 'CONFIRM_REQUIRED', 'Confirme a ação para continuar.');
    }
    // "Adiar" não faz sentido se o horário de início já passou: o evento reabriria sozinho.
    if (action === 'schedule' && event.starts_at && event.starts_at.getTime() <= Date.now()) {
      return fail(res, 409, 'START_IN_PAST', 'Defina um novo horário de início futuro antes de adiar.');
    }

    // Reabrir um evento encerrado por engano: só se o término já programado ainda não passou.
    if (action === 'reopen' && event.ends_at && event.ends_at.getTime() <= Date.now()) {
      return fail(res, 409, 'END_IN_PAST', 'O horário de término já passou. Defina um novo término futuro antes de reabrir.');
    }
    // Se o início programado ainda está no futuro, reabrir volta para "antes da abertura" (não abre antes da hora).
    const reopenTo = event.starts_at && event.starts_at.getTime() > Date.now() ? 'scheduled' : 'active';
    const next = { open: 'active', resume: 'active', pause: 'paused', end: 'ended', schedule: 'scheduled', reopen: reopenTo }[action]!;
    await db.query('UPDATE events SET status = $2, updated_at = now() WHERE id = $1', [event.id, next]);
    await audit(admin(res).adminId, `event.${action}`, 'event', event.id, { from: event.status, to: next });
    res.json({ ok: true, status: next });
  }));

  // ---------- Ambientes ----------
  router.patch('/admin/rooms/:id', requireAdmin, wrap(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'Ambiente não encontrado.');
    const parsed = z.object({
      name: z.string().trim().min(1).max(160).optional(),
      number: z.union([z.string().trim().max(40), z.null()]).optional(),
      description: z.string().trim().max(2000).optional(),
      active: z.boolean().optional(),
      required: z.boolean().optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Dados do ambiente inválidos.');
    const event = await eventOrFail(res);
    if (!event) return;

    const d = parsed.data;
    if ((d.active !== undefined || d.required !== undefined) && computeEventState(event).phase !== 'before_open') {
      return fail(res, 409, 'EVENT_LOCKED', 'Ativar, desativar ou marcar ambientes como obrigatórios só é possível antes da abertura do evento.');
    }

    const cur = await db.query(
      `SELECT r.id, r.name, r.room_number, r.description, r.active, r.is_required
         FROM rooms r JOIN floors f ON f.id = r.floor_id WHERE r.id = $1 AND f.event_id = $2`,
      [req.params.id, event.id],
    );
    const before = cur.rows[0];
    if (!before) return fail(res, 404, 'NOT_FOUND', 'Ambiente não encontrado.');

    const after = {
      name: d.name ?? before.name,
      number: d.number === undefined ? before.room_number : d.number || null,
      description: d.description ?? before.description,
      active: d.active ?? before.active,
      required: d.required ?? before.is_required,
    };
    await db.query(
      'UPDATE rooms SET name = $2, room_number = $3, description = $4, active = $5, is_required = $6, updated_at = now() WHERE id = $1',
      [before.id, after.name, after.number, after.description, after.active, after.required],
    );
    // Nome ou número impressos na etiqueta mudaram: a etiqueta atual ficou desatualizada. Já deixa uma
    // versão nova PENDENTE (não vale ainda) para a equipe reimprimir e ativar depois de conferir.
    let qrReprintNeeded = false;
    if (after.name !== before.name || after.number !== before.room_number) {
      const q = await db.query("SELECT 1 FROM room_qr_versions WHERE room_id = $1 AND status = 'active'", [before.id]);
      if (q.rowCount) {
        await prepareVersions(config.qrSecret, [before.id]);
        qrReprintNeeded = true;
      }
    }
    await audit(admin(res).adminId, 'room.update', 'room', before.id, {
      from: { name: before.name, number: before.room_number, active: before.active, required: before.is_required },
      to: { name: after.name, number: after.number, active: after.active, required: after.required },
      qrReprintNeeded,
    });
    res.json({ ok: true, qrReprintNeeded });
  }));

  // ---------- Fotos do interior ----------
  // Corpo binário da imagem (não multipart). Reduzida e sem metadados antes de ir para o banco.
  const rawImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_UPLOAD_BYTES });

  router.put('/admin/rooms/:id/photo', requireAdmin, rawImage, wrap(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'Ambiente não encontrado.');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return fail(res, 415, 'PHOTO_FORMAT', 'Envie uma foto JPEG, PNG ou WebP.');
    }
    const event = await eventOrFail(res);
    if (!event) return;
    const room = await db.query(
      'SELECT r.id, r.name FROM rooms r JOIN floors f ON f.id = r.floor_id WHERE r.id = $1 AND f.event_id = $2',
      [req.params.id, event.id],
    );
    if (!room.rows[0]) return fail(res, 404, 'NOT_FOUND', 'Ambiente não encontrado.');

    let photo;
    try {
      photo = await processPhoto(req.body);
    } catch (e) {
      if (e instanceof PhotoError) return fail(res, e.status, 'PHOTO_INVALID', e.message);
      throw e;
    }
    const saved = await db.query<{ v: string }>(
      `INSERT INTO room_photos (room_id, data, content_type, width, height, bytes, updated_by)
       VALUES ($1, $2, 'image/webp', $3, $4, $5, $6)
       ON CONFLICT (room_id) DO UPDATE
         SET data = EXCLUDED.data, width = EXCLUDED.width, height = EXCLUDED.height, bytes = EXCLUDED.bytes,
             updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING (extract(epoch FROM updated_at) * 1000)::bigint AS v`,
      [req.params.id, photo.data, photo.width, photo.height, photo.bytes, admin(res).adminId],
    );
    await audit(admin(res).adminId, 'room.photo.set', 'room', String(req.params.id), { bytes: photo.bytes, width: photo.width, height: photo.height });
    res.json({ ok: true, photoVersion: Number(saved.rows[0]!.v), width: photo.width, height: photo.height, bytes: photo.bytes });
  }));

  router.delete('/admin/rooms/:id/photo', requireAdmin, wrap(async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return fail(res, 404, 'NOT_FOUND', 'Ambiente não encontrado.');
    const event = await eventOrFail(res);
    if (!event) return;
    const r = await db.query(
      `DELETE FROM room_photos WHERE room_id = $1
         AND room_id IN (SELECT r.id FROM rooms r JOIN floors f ON f.id = r.floor_id WHERE f.event_id = $2)`,
      [req.params.id, event.id],
    );
    if (r.rowCount) await audit(admin(res).adminId, 'room.photo.delete', 'room', String(req.params.id));
    res.json({ ok: true, removed: Boolean(r.rowCount) });
  }));

  // ---------- QR Codes ----------
  const roomIds = z.object({ roomIds: z.array(uuid).min(1).max(100) });

  router.post('/admin/qr/prepare', requireAdmin, wrap(async (req, res) => {
    const parsed = roomIds.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Escolha ao menos um ambiente.');
    let rooms;
    try { rooms = await selectRoomsByIds(config.eventSlug, parsed.data.roomIds); } catch { return fail(res, 404, 'NOT_FOUND', 'Ambiente não encontrado.'); }
    const out = await prepareVersions(config.qrSecret, rooms.map((r) => r.id));
    await audit(admin(res).adminId, 'qr.prepare', 'room', null, { rooms: rooms.length, created: out.filter((o) => o.created).length });
    res.json({ results: out });
  }));

  router.post('/admin/qr/activate', requireAdmin, wrap(async (req, res) => {
    const parsed = roomIds.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Escolha ao menos um ambiente.');
    let rooms;
    try { rooms = await selectRoomsByIds(config.eventSlug, parsed.data.roomIds); } catch { return fail(res, 404, 'NOT_FOUND', 'Ambiente não encontrado.'); }
    const out = await activatePending(rooms.map((r) => r.id));
    await audit(admin(res).adminId, 'qr.activate', 'room', null, { rooms: out.length });
    res.json({ results: out });
  }));

  // PDF de etiquetas (material sensível: contém QR e códigos válidos).
  router.post('/admin/qr/labels', requireAdmin, wrap(async (req, res) => {
    const parsed = z.object({
      roomIds: z.array(uuid).min(1).max(100),
      status: z.enum(['pending', 'active']),
      format: z.enum(['a4', 'a6']).default('a4'),
    }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'VALIDATION', 'Escolha ambientes, versão e formato.');
    if (!config.publicAppUrl) return fail(res, 409, 'PUBLIC_APP_URL_MISSING', 'Defina PUBLIC_APP_URL no servidor para gerar as etiquetas.');
    const event = await eventOrFail(res);
    if (!event) return;
    let rooms;
    try { rooms = await selectRoomsByIds(config.eventSlug, parsed.data.roomIds); } catch { return fail(res, 404, 'NOT_FOUND', 'Ambiente não encontrado.'); }
    const items = await versionsToPrint(rooms, parsed.data.status);
    if (items.length === 0) {
      return fail(res, 409, 'NO_VERSIONS', `Nenhuma versão ${parsed.data.status === 'pending' ? 'pendente' : 'ativa'} nos ambientes escolhidos.`);
    }
    const pdf = await renderLabels(items, {
      format: parsed.data.format, secret: config.qrSecret, appUrl: config.publicAppUrl, eventName: event.name,
    });
    await audit(admin(res).adminId, 'qr.labels', 'room', null, { count: items.length, status: parsed.data.status, format: parsed.data.format });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="nexo-qr-${parsed.data.status}-${parsed.data.format}.pdf"`);
    res.send(pdf);
  }));

  // QR de entrada: o endereço do app, lido pelo visitante para abrir o NEXO (não é segredo, mas depende de PUBLIC_APP_URL).
  router.get('/admin/entry-qr', requireAdmin, wrap(async (req, res) => {
    if (!config.publicAppUrl) return fail(res, 409, 'PUBLIC_APP_URL_MISSING', 'Defina PUBLIC_APP_URL no servidor para gerar o QR de entrada.');
    const format = req.query.format === 'pdf' ? 'pdf' : 'png';
    const event = await eventOrFail(res);
    if (!event) return;
    await audit(admin(res).adminId, 'entry_qr.download', 'event', event.id, { format });
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="nexo-qr-entrada-cartaz.pdf"');
      return res.send(await renderEntryPoster({ appUrl: config.publicAppUrl, eventName: event.name }));
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="nexo-qr-entrada.png"');
    return res.send(await entryQrPng(config.publicAppUrl));
  }));

  // ---------- Participantes e relatórios ----------
  router.get('/admin/participants', requireAdmin, wrap(async (req, res) => {
    const event = await eventOrFail(res);
    if (!event) return;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = 50;
    // Busca sem diferenciar caixa nem acento (mesma normalização do cadastro).
    const like = `%${normalizeName(q).replace(/[\\%_]/g, '\\$&')}%`;

    const { rows } = await db.query(
      `WITH req AS (SELECT r.id FROM rooms r JOIN floors f ON f.id = r.floor_id
                     WHERE f.event_id = $1 AND f.active AND r.active AND r.is_required),
            base AS (
              SELECT p.id, p.full_name, p.avatar_key, p.created_at, p.last_seen_at,
                     (SELECT COUNT(*)::int FROM visits v WHERE v.participant_id = p.id) AS visits,
                     (SELECT COUNT(*)::int FROM visits v JOIN req ON req.id = v.room_id WHERE v.participant_id = p.id) AS required_visited
                FROM participants p WHERE p.event_id = $1 AND ($2 = '%%' OR p.full_name_normalized LIKE $2))
       SELECT *, COUNT(*) OVER()::int AS total,
              (SELECT COUNT(*)::int FROM req) AS required_total
         FROM base ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [event.id, like, size, (page - 1) * size],
    );
    res.json({
      total: rows[0]?.total ?? 0, page, pageSize: size,
      items: rows.map((r) => ({
        id: r.id, fullName: r.full_name, avatarKey: r.avatar_key, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
        visits: r.visits, requiredVisited: r.required_visited,
        completed: r.required_total > 0 && r.required_visited >= r.required_total,
      })),
    });
  }));

  router.get('/admin/export/participants.csv', requireAdmin, wrap(async (_req, res) => {
    const event = await eventOrFail(res);
    if (!event) return;
    const { rows } = await db.query(
      `WITH req AS (SELECT r.id FROM rooms r JOIN floors f ON f.id = r.floor_id
                     WHERE f.event_id = $1 AND f.active AND r.active AND r.is_required)
       SELECT p.id, p.full_name, p.created_at, p.last_seen_at,
              (SELECT COUNT(*)::int FROM visits v WHERE v.participant_id = p.id) AS visits,
              (SELECT COUNT(*)::int FROM visits v JOIN req ON req.id = v.room_id WHERE v.participant_id = p.id) AS required_visited,
              (SELECT COUNT(*)::int FROM req) AS required_total
         FROM participants p WHERE p.event_id = $1 ORDER BY p.created_at`,
      [event.id],
    );
    await audit(admin(res).adminId, 'export.participants', 'participant', null, { rows: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="nexo-participantes.csv"');
    res.send(csv(
      ['id', 'nome', 'cadastro_em', 'ultimo_acesso', 'visitas', 'obrigatorios_visitados', 'obrigatorios_total', 'completou'],
      rows.map((r) => [r.id, r.full_name, r.created_at, r.last_seen_at, r.visits, r.required_visited, r.required_total, r.required_total > 0 && r.required_visited >= r.required_total ? 'sim' : 'nao']),
    ));
  }));

  router.get('/admin/export/visits.csv', requireAdmin, wrap(async (_req, res) => {
    const event = await eventOrFail(res);
    if (!event) return;
    const { rows } = await db.query(
      `SELECT v.visited_at, p.id AS participant_id, p.full_name, f.name AS floor, r.name AS room, r.is_required
         FROM visits v JOIN participants p ON p.id = v.participant_id
         JOIN rooms r ON r.id = v.room_id JOIN floors f ON f.id = r.floor_id
        WHERE p.event_id = $1 ORDER BY v.visited_at`,
      [event.id],
    );
    await audit(admin(res).adminId, 'export.visits', 'visit', null, { rows: rows.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="nexo-visitas.csv"');
    res.send(csv(
      ['visita_em', 'participante_id', 'nome', 'piso', 'ambiente', 'obrigatorio'],
      rows.map((r) => [r.visited_at, r.participant_id, r.full_name, r.floor, r.room, r.is_required ? 'sim' : 'nao']),
    ));
  }));

  router.get('/admin/reports', requireAdmin, wrap(async (_req, res) => {
    const event = await eventOrFail(res);
    if (!event) return;
    const r = await buildReport(event.id);
    // A tela mostra o resumo; listas completas ficam nos arquivos exportados.
    res.json({ ...r, participants: undefined, visits: undefined, participantCount: r.participants.length });
  }));

  router.get('/admin/reports/export.:fmt(xlsx|pdf)', requireAdmin, wrap(async (req, res) => {
    const event = await eventOrFail(res);
    if (!event) return;
    const r = await buildReport(event.id);
    const stamp = new Date().toISOString().slice(0, 10);
    const xlsx = req.params.fmt === 'xlsx';
    await audit(admin(res).adminId, `export.report.${req.params.fmt}`, 'report', null, { participants: r.participants.length, visits: r.visits.length });
    res.setHeader('Content-Type', xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="nexo-relatorio-${stamp}.${req.params.fmt}"`);
    res.send(xlsx ? await renderXlsx(r) : await renderPdf(r));
  }));

  router.get('/admin/audit', requireAdmin, wrap(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT l.id, l.created_at, l.action, l.entity_type, l.entity_id, l.outcome, l.details, a.username
         FROM audit_log l LEFT JOIN admin_accounts a ON a.id = l.actor_id
        WHERE l.actor_type = 'staff' ORDER BY l.id DESC LIMIT 100`,
    );
    res.json({
      items: rows.map((r) => ({
        id: r.id, at: r.created_at, action: r.action, entity: r.entity_type, entityId: r.entity_id,
        outcome: r.outcome, details: r.details, username: r.username,
      })),
    });
  }));

  return router;
}

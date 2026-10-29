import { Router, type Request, type Response } from 'express';

import type { AppConfig } from '../config.js';
import { db } from '../db.js';
import { loadActiveEvent } from '../services/event.js';
import { hashToken } from '../services/identity.js';

type RoomRow = {
  floor_id: string;
  floor_name: string;
  sort_order: number;
  floor_active: boolean;
  id: string;
  slug: string;
  name: string;
  room_number: string | null;
  description: string;
  active: boolean;
  is_required: boolean;
  visited: boolean;
  photo_version: string | null;
};

export function mapRouter(config: AppConfig): Router {
  const router = Router();

  // Pisos e ambientes para o mapa. Se houver um token válido, marca o que a pessoa já visitou.
  router.get('/map', async (req: Request, res: Response) => {
    try {
      const event = await loadActiveEvent(config.eventSlug);
      if (!event) {
        return res.status(503).json({ message: 'Evento não configurado.' });
      }

      let participantId: string | null = null;
      const bearer = /^Bearer (nx_[A-Za-z0-9_-]{20,100})$/.exec(req.header('authorization') ?? '');
      if (bearer) {
        const p = await db.query<{ id: string }>(
          `SELECT id FROM participants
            WHERE token_hash = $1 AND event_id = $2 AND status = 'active'`,
          [hashToken(bearer[1]!), event.id],
        );
        participantId = p.rows[0]?.id ?? null;
      }

      const { rows } = await db.query<RoomRow>(
        `SELECT f.id AS floor_id, f.name AS floor_name, f.sort_order, f.active AS floor_active,
                r.id, r.slug, r.name, r.room_number, r.description, r.active, r.is_required,
                EXISTS (SELECT 1 FROM visits v
                         WHERE v.room_id = r.id AND v.participant_id = $2) AS visited,
                (SELECT (extract(epoch FROM p.updated_at) * 1000)::bigint FROM room_photos p WHERE p.room_id = r.id) AS photo_version
           FROM floors f
           JOIN rooms r ON r.floor_id = f.id
          WHERE f.event_id = $1
          ORDER BY f.sort_order, r.room_number NULLS LAST, r.name`,
        [event.id, participantId],
      );

      const floors: Array<{
        id: string; name: string; order: number; active: boolean;
        rooms: Array<{
          id: string; slug: string; name: string; number: string | null; description: string;
          // Ambiente disponível no evento: ativo e piso ativo.
          available: boolean; required: boolean; visited: boolean; photoVersion: number | null;
        }>;
      }> = [];

      for (const r of rows) {
        let floor = floors.find((f) => f.id === r.floor_id);
        if (!floor) {
          floor = { id: r.floor_id, name: r.floor_name, order: r.sort_order, active: r.floor_active, rooms: [] };
          floors.push(floor);
        }
        floor.rooms.push({
          id: r.id,
          slug: r.slug,
          name: r.name,
          number: r.room_number,
          description: r.description,
          available: r.active && r.floor_active,
          required: r.is_required && r.active && r.floor_active,
          visited: participantId ? r.visited : false,
          photoVersion: r.photo_version === null ? null : Number(r.photo_version),
        });
      }

      return res.json({ floors });
    } catch (error) {
      console.error('Erro ao consultar o mapa:', error instanceof Error ? error.message : error);
      return res.status(500).json({ message: 'Não foi possível consultar o mapa.' });
    }
  });

  // Foto do interior (pública, como o mapa). O parâmetro ?v=<versão> só serve para furar o cache do navegador.
  router.get('/rooms/:id/photo', async (req: Request, res: Response) => {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id ?? ''))) return res.status(404).end();
      const event = await loadActiveEvent(config.eventSlug);
      if (!event) return res.status(404).end();
      const { rows } = await db.query<{ data: Buffer; content_type: string; v: string; bytes: number }>(
        `SELECT p.data, p.content_type, p.bytes, (extract(epoch FROM p.updated_at) * 1000)::bigint AS v
           FROM room_photos p JOIN rooms r ON r.id = p.room_id JOIN floors f ON f.id = r.floor_id
          WHERE p.room_id = $1 AND f.event_id = $2`,
        [req.params.id, event.id],
      );
      const photo = rows[0];
      if (!photo) return res.status(404).end();
      const etag = `"${photo.v}-${photo.bytes}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', req.query.v ? 'public, max-age=86400' : 'public, max-age=300, must-revalidate');
      if (req.header('if-none-match') === etag) return res.status(304).end();
      res.setHeader('Content-Type', photo.content_type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(photo.data);
    } catch (error) {
      console.error('Erro ao servir foto:', error instanceof Error ? error.message : error);
      return res.status(500).end();
    }
  });

  return router;
}

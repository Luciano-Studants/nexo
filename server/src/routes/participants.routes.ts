import { Router, type Request, type Response } from 'express';

import type { AppConfig } from '../config.js';
import { db } from '../db.js';
import { loadActiveEvent } from '../services/event.js';
import { computeEventState } from '../services/eventState.js';
import {
  hashIp,
  hashToken,
  newAccessToken,
  normalizeName,
  randomAvatarKey,
} from '../services/identity.js';
import { getProgress } from '../services/progress.js';
import { enterSchema } from '../validators/participant.validators.js';

type ParticipantRow = {
  id: string;
  full_name: string;
  avatar_key: string;
  created_at: Date;
};

const publicParticipant = (p: ParticipantRow) => ({
  id: p.id,
  fullName: p.full_name,
  avatarKey: p.avatar_key,
});

export function participantsRouter(config: AppConfig): Router {
  const router = Router();

  // Entrada. Cria o perfil (nome completo + ID + avatar aleatório) ou, se existir um perfil
  // recente com o mesmo nome e o mesmo IP, pergunta se é a mesma pessoa.
  router.post('/participants', async (req: Request, res: Response) => {
    const parsed = enterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Confira os dados informados.',
        errors: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const { fullName, decision } = parsed.data;

    try {
      const event = await loadActiveEvent(config.eventSlug);
      if (!event) {
        return res.status(503).json({ message: 'Evento não configurado.' });
      }

      const state = computeEventState(event);
      if (!state.registrationAllowed) {
        return res.status(403).json({
          code: 'EVENT_ENDED',
          message: 'O evento foi encerrado. Não é possível criar novos perfis.',
        });
      }

      const ipHash = hashIp(req.ip ?? 'desconhecido', config.ipHashSecret);
      const normalized = normalizeName(fullName);

      // Perfil recente: mesmo evento, mesmo nome normalizado, mesmo IP, dentro da janela.
      const matches = await db.query<ParticipantRow & { visited: number }>(
        `SELECT p.id, p.full_name, p.avatar_key, p.created_at,
                (SELECT COUNT(*)::int FROM visits v WHERE v.participant_id = p.id) AS visited
           FROM participants p
          WHERE p.event_id = $1
            AND p.full_name_normalized = $2
            AND p.ip_hash = $3
            AND p.status = 'active'
            AND p.last_seen_at > now() - make_interval(hours => $4)
          ORDER BY p.last_seen_at DESC
          LIMIT 1`,
        [event.id, normalized, ipHash, config.resumeWindowHours],
      );
      const existing = matches.rows[0];

      if (existing && decision === undefined) {
        return res.status(200).json({
          status: 'resume_available',
          message: 'Encontramos um perfil recente com esse nome. É você?',
          candidate: {
            fullName: existing.full_name,
            avatarKey: existing.avatar_key,
            visitedCount: existing.visited,
          },
        });
      }

      if (existing && decision === 'resume') {
        const { token, hash } = newAccessToken();
        await db.query(
          'UPDATE participants SET token_hash = $1, last_seen_at = now() WHERE id = $2',
          [hash, existing.id],
        );
        return res.status(200).json({
          status: 'resumed',
          participant: publicParticipant(existing),
          token,
        });
      }

      // Novo perfil (sem perfil recente, ou a pessoa escolheu "new").
      const recent = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM participants
          WHERE ip_hash = $1 AND created_at > now() - interval '1 hour'`,
        [ipHash],
      );
      if (recent.rows[0]!.n >= config.profilesPerIpPerHour) {
        res.setHeader('Retry-After', '600');
        return res.status(429).json({
          code: 'TOO_MANY_PROFILES',
          message: 'Muitos acessos criados neste período. Tente novamente em alguns minutos.',
        });
      }

      const { token, hash } = newAccessToken();
      const created = await db.query<ParticipantRow>(
        `INSERT INTO participants
           (event_id, full_name, full_name_normalized, avatar_key, token_hash, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, full_name, avatar_key, created_at`,
        [event.id, fullName, normalized, randomAvatarKey(), hash, ipHash],
      );

      return res.status(201).json({
        status: 'created',
        participant: publicParticipant(created.rows[0]!),
        token,
      });
    } catch (error) {
      console.error('Erro ao criar perfil:', error instanceof Error ? error.message : error);
      return res.status(500).json({ message: 'Não foi possível concluir a entrada.' });
    }
  });

  // Perfil do aparelho atual, identificado pelo token (Authorization: Bearer nx_...).
  router.get('/me', async (req: Request, res: Response) => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer (nx_[A-Za-z0-9_-]{20,100})$/.exec(header);
    if (!match) {
      return res.status(401).json({ message: 'Perfil não identificado.' });
    }

    try {
      const found = await db.query<ParticipantRow & { event_id: string }>(
        `UPDATE participants SET last_seen_at = now()
          WHERE token_hash = $1 AND status = 'active'
          RETURNING id, event_id, full_name, avatar_key, created_at`,
        [hashToken(match[1]!)],
      );
      const participant = found.rows[0];
      if (!participant) {
        return res.status(401).json({ message: 'Perfil não encontrado ou expirado.' });
      }

      const progress = await getProgress(participant.event_id, participant.id);

      return res.json({
        participant: publicParticipant(participant),
        progress,
      });
    } catch (error) {
      console.error('Erro ao consultar perfil:', error instanceof Error ? error.message : error);
      return res.status(500).json({ message: 'Não foi possível consultar o perfil.' });
    }
  });

  return router;
}

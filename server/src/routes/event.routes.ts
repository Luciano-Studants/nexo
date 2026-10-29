import { Router } from 'express';

import type { AppConfig } from '../config.js';
import { loadActiveEvent } from '../services/event.js';
import { computeEventState } from '../services/eventState.js';

export function eventRouter(config: AppConfig): Router {
  const router = Router();

  // Estado público do evento (nome, fase, o que está liberado). Sempre calculado no servidor.
  router.get('/event', async (_req, res) => {
    try {
      const event = await loadActiveEvent(config.eventSlug);
      if (!event) {
        return res.status(503).json({ message: 'Evento não configurado.' });
      }
      const state = computeEventState(event);

      return res.json({
        name: event.name,
        editionLabel: event.edition_label,
        timezone: event.timezone,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        testMode: event.test_mode,
        ...state,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Erro ao consultar evento:', error instanceof Error ? error.message : error);
      return res.status(500).json({ message: 'Não foi possível consultar o evento.' });
    }
  });

  return router;
}

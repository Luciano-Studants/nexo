import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import type { AppConfig } from './config.js';
import { db } from './db.js';
import { adminRouter } from './routes/admin.routes.js';
import { eventRouter } from './routes/event.routes.js';
import { mapRouter } from './routes/map.routes.js';
import { participantsRouter } from './routes/participants.routes.js';
import { visitsRouter } from './routes/visits.routes.js';

function trustProxySetting(): boolean | number {
  const raw = process.env.TRUST_PROXY;
  if (!raw) return false;
  if (raw === 'true') return true;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 ? hops : false;
}

export function createApp(config: AppConfig): Express {
  const app = express();

  app.disable('x-powered-by');
  // Atrás de proxy/HTTPS em produção, informe TRUST_PROXY (ex.: 1) para que req.ip seja o do visitante.
  app.set('trust proxy', trustProxySetting());

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // O leitor de QR usa um worker e a câmera usa blob:; as fotos vêm do próprio domínio.
          'img-src': ["'self'", 'data:', 'blob:'],
          'worker-src': ["'self'", 'blob:'],
          'media-src': ["'self'", 'blob:'],
        },
      },
    }),
  );
  app.use(
    cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  // Limite geral generoso: na internet móvel muitos aparelhos compartilham o mesmo IP.
  app.use(
    '/api/',
    rateLimit({
      windowMs: 60_000,
      limit: Number(process.env.API_RATE_LIMIT_PER_MIN) || 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      // O painel tem sessão e limite próprio de login: não pode ser barrado quando os visitantes
      // (que podem dividir o mesmo IP no Wi-Fi do local) esgotam o limite geral.
      skip: (req) => req.path.startsWith('/admin'),
      message: { code: 'RATE_LIMITED', message: 'Muitas requisições em pouco tempo. Aguarde alguns segundos e tente de novo.' },
    }),
  );

  // Sem banco: serve para um monitor externo manter a hospedagem acordada sem acordar o banco.
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/health', async (_req, res) => {
    let database: 'ok' | 'error' = 'ok';
    try {
      await db.query('SELECT 1');
    } catch {
      database = 'error';
    }
    res.status(database === 'error' ? 503 : 200).json({
      status: database === 'error' ? 'degraded' : 'ok',
      application: 'NEXO API',
      database,
    });
  });

  app.use('/api', eventRouter(config));
  app.use('/api', mapRouter(config));
  app.use('/api', participantsRouter(config));
  app.use('/api', visitsRouter(config));
  app.use('/api', adminRouter(config));

  app.use('/api', (_req, res) => {
    res.status(404).json({ message: 'Rota não encontrada.' });
  });

  // Em produção o mesmo servidor entrega o site já compilado (npm run build na raiz): um único endereço,
  // sem CORS. Rotas do app (/admin, /q/...) caem no index.html.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = process.env.STATIC_DIR || path.resolve(here, '..', '..', 'dist');
  if (existsSync(path.join(staticDir, 'index.html'))) {
    app.use(
      express.static(staticDir, {
        index: false,
        setHeaders: (res, file) => {
          res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      }),
    );
    app.get(/^\/(?!api(\/|$))(?!.*\.[a-z0-9]+$).*/i, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // Erro inesperado: nunca vaza detalhes ao cliente.
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = error as { type?: string; status?: number };
    if (e?.type === 'entity.too.large') return res.status(413).json({ code: 'TOO_LARGE', message: 'O arquivo é grande demais. Envie uma foto de até 12 MB.' });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ message: 'Requisição inválida.' });
    console.error('Erro não tratado:', error instanceof Error ? error.message : error);
    return res.status(500).json({ message: 'Erro interno.' });
  });

  return app;
}

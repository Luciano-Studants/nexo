import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

const url = process.env.DATABASE_URL ?? '';
if (!/\/[^/?]*test[^/?]*(\?|$)/i.test(url)) {
  throw new Error('Defina DATABASE_URL apontando para um banco de TESTE (nome com "test").');
}
process.env.TRUST_PROXY = '1';

const { createApp } = await import('../app.js');
const { db } = await import('../db.js');
const { loadConfig } = await import('../config.js');
const { activatePending, prepareVersions } = await import('../services/qrAdmin.js');
const { deriveManualCode, deriveToken, formatManualCode } = await import('../services/qr.js');
const { renderLabels } = await import('../services/labels.js');

const config = loadConfig();
let server: Server;
let api = '';

async function call(method: string, path: string, opts: { body?: unknown; token?: string; ip?: string } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': opts.ip ?? '10.1.0.1',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const room = async (slug: string) =>
  (await db.query('SELECT id FROM rooms WHERE slug = $1', [slug])).rows[0].id as string;

// Prepara e ativa uma versão de QR para a sala e devolve token e código manual.
async function qrFor(slug: string) {
  const id = await room(slug);
  const [p] = await prepareVersions(config.qrSecret, [id]);
  await activatePending([id]);
  return {
    id, version: p!.version,
    token: deriveToken(config.qrSecret, id, p!.version),
    manual: formatManualCode(deriveManualCode(config.qrSecret, id, p!.version)),
  };
}

async function reset(opts: { open?: boolean } = { open: true }) {
  await db.query('DELETE FROM visits');
  await db.query('DELETE FROM manual_code_attempts');
  await db.query('DELETE FROM participants');
  await db.query('DELETE FROM room_qr_versions');
  await db.query('UPDATE rooms SET is_required = false, active = true');
  await db.query(
    "UPDATE events SET status = $1, test_mode = false, starts_at = NULL, ends_at = NULL",
    [opts.open === false ? 'draft' : 'active'],
  );
}

async function visitor(name = 'Visitante Teste Um') {
  const r = await call('POST', '/participants', { body: { fullName: name }, ip: `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  assert.equal(r.status, 201);
  return r.json.token as string;
}

before(async () => {
  assert.equal((await db.query("SELECT 1 FROM events WHERE slug = 'procidadania-ceumap'")).rowCount, 1, 'Rode `npm run db:seed` no banco de teste.');
  const app = createApp(config);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      resolve();
    });
  });
});

after(async () => {
  await reset({ open: false });
  server.close();
  await db.end();
});

test('exige perfil identificado', async () => {
  await reset();
  const q = await qrFor('biblioteca');
  assert.equal((await call('POST', '/visits', { body: { code: q.token } })).status, 401);
  assert.equal((await call('POST', '/visits', { body: { code: q.token }, token: 'nx_' + 'z'.repeat(43) })).status, 401);
});

test('antes da abertura as visitas ficam bloqueadas; modo de teste libera', async () => {
  await reset({ open: false });
  const q = await qrFor('biblioteca');
  const t = await visitor();
  const blocked = await call('POST', '/visits', { body: { code: q.token }, token: t });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'VISITS_NOT_OPEN');
  assert.equal(blocked.json.phase, 'before_open');

  await db.query('UPDATE events SET test_mode = true');
  assert.equal((await call('POST', '/visits', { body: { code: q.token }, token: t })).status, 201);
});

test('pausado e encerrado bloqueiam visitas', async () => {
  await reset();
  const q = await qrFor('biblioteca');
  const t = await visitor();
  await db.query("UPDATE events SET status = 'paused'");
  assert.equal((await call('POST', '/visits', { body: { code: q.token }, token: t })).json.phase, 'paused');
  await db.query("UPDATE events SET status = 'ended'");
  const r = await call('POST', '/visits', { body: { code: q.token }, token: t });
  assert.equal(r.status, 403);
  assert.equal(r.json.phase, 'ended');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM visits')).rows[0].n, 0);
});

test('registra a visita, libera peça só em obrigatório, e repetir não conta de novo', async () => {
  await reset();
  await db.query("UPDATE rooms SET is_required = true WHERE slug IN ('biblioteca', 'auditorio')");
  const lib = await qrFor('biblioteca');
  const opt = await qrFor('direcao');
  const t = await visitor();

  const first = await call('POST', '/visits', { body: { code: `https://nexo.exemplo.com/q/${lib.token}` }, token: t });
  assert.equal(first.status, 201);
  assert.equal(first.json.status, 'registered');
  assert.equal(first.json.room.name, 'Biblioteca');
  assert.equal(first.json.room.floorOrder, 1);
  assert.equal(first.json.fragmentUnlocked, true);
  assert.deepEqual(
    [first.json.progress.visitedCount, first.json.progress.requiredCount, first.json.progress.completed],
    [1, 2, false],
  );

  const again = await call('POST', '/visits', { body: { code: lib.token }, token: t });
  assert.equal(again.status, 200);
  assert.equal(again.json.status, 'already_visited');
  assert.equal(again.json.fragmentUnlocked, false);
  assert.equal(again.json.progress.visitedCount, 1);

  const optional = await call('POST', '/visits', { body: { code: opt.token }, token: t });
  assert.equal(optional.status, 201);
  assert.equal(optional.json.fragmentUnlocked, false);
  assert.equal(optional.json.progress.visitedCount, 1);

  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM visits')).rows[0].n, 2);
});

test('completar todos os obrigatórios marca a conclusão', async () => {
  await reset();
  await db.query("UPDATE rooms SET is_required = true WHERE slug IN ('biblioteca', 'auditorio')");
  const a = await qrFor('biblioteca');
  const b = await qrFor('auditorio');
  const t = await visitor();
  await call('POST', '/visits', { body: { code: a.token }, token: t });
  const last = await call('POST', '/visits', { body: { code: b.token }, token: t });
  assert.equal(last.json.progress.completed, true);
});

test('QR desconhecido, malformado ou de outra pessoa não registra nada', async () => {
  await reset();
  const t = await visitor();
  for (const code of ['lixo', 'https://exemplo.com/x', 'A'.repeat(32)]) {
    const r = await call('POST', '/visits', { body: { code }, token: t });
    assert.equal(r.status, 404, code);
    assert.equal(r.json.code, 'QR_UNKNOWN');
  }
  assert.equal((await call('POST', '/visits', { body: {}, token: t })).status, 400);
});

test('QR substituído (desatualizado) é recusado com a mensagem definida', async () => {
  await reset();
  const old = await qrFor('biblioteca');
  const t = await visitor();

  // Nova versão: enquanto pendente, a antiga ainda vale; ao ativar, a antiga morre.
  const id = old.id;
  const [p2] = await prepareVersions(config.qrSecret, [id]);
  assert.equal(p2!.version, old.version + 1);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM room_qr_versions WHERE room_id = $1 AND status = 'active'", [id])).rows[0].n, 1);

  const pendingToken = deriveToken(config.qrSecret, id, p2!.version);
  const early = await call('POST', '/visits', { body: { code: pendingToken }, token: t });
  assert.equal(early.status, 409);
  assert.equal(early.json.code, 'QR_NOT_ACTIVE');

  await activatePending([id]);
  const r = await call('POST', '/visits', { body: { code: old.token }, token: t });
  assert.equal(r.status, 410);
  assert.equal(r.json.code, 'QR_OUTDATED');
  assert.equal(r.json.message, 'Este QR Code está desatualizado. Procure a identificação atualizada da sala para registrar sua visita.');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM visits')).rows[0].n, 0);

  assert.equal((await call('POST', '/visits', { body: { code: pendingToken }, token: t })).status, 201);
  // Sempre no máximo um QR ativo por sala.
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM room_qr_versions WHERE room_id = $1 AND status = 'active'", [id])).rows[0].n, 1);
});

test('ambiente desativado não registra visita', async () => {
  await reset();
  const q = await qrFor('biblioteca');
  const t = await visitor();
  await db.query("UPDATE rooms SET active = false WHERE slug = 'biblioteca'");
  const r = await call('POST', '/visits', { body: { code: q.token }, token: t });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'ROOM_UNAVAILABLE');
});

test('código manual: aceita variações de escrita e registra', async () => {
  await reset();
  const q = await qrFor('biblioteca');
  const t = await visitor();
  const r = await call('POST', '/visits/manual', { body: { roomId: q.id, code: q.manual.toLowerCase().replace('-', ' ') }, token: t });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'registered');
  assert.equal((await db.query("SELECT method FROM visits")).rows[0].method, 'manual');
});

test('código manual de OUTRA sala não vale', async () => {
  await reset();
  const lib = await qrFor('biblioteca');
  const dir = await qrFor('direcao');
  const t = await visitor();
  const r = await call('POST', '/visits/manual', { body: { roomId: lib.id, code: dir.manual }, token: t });
  assert.equal(r.status, 422);
  assert.equal(r.json.code, 'MANUAL_CODE_INVALID');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM visits')).rows[0].n, 0);
});

test('5 códigos inválidos seguidos bloqueiam por 5 minutos, até com o código certo', async () => {
  await reset();
  const q = await qrFor('biblioteca');
  const t = await visitor();
  for (let i = 1; i <= 4; i++) {
    const r = await call('POST', '/visits/manual', { body: { roomId: q.id, code: 'AAAA-BBBB' }, token: t });
    assert.equal(r.status, 422);
    assert.equal(r.json.attemptsLeft, 5 - i);
  }
  const fifth = await call('POST', '/visits/manual', { body: { roomId: q.id, code: 'AAAA-BBBB' }, token: t });
  assert.equal(fifth.status, 429);
  assert.equal(fifth.json.retryAfterSeconds, 300);

  const locked = await call('POST', '/visits/manual', { body: { roomId: q.id, code: q.manual }, token: t });
  assert.equal(locked.status, 429);
  assert.ok(locked.json.retryAfterSeconds > 290 && locked.json.retryAfterSeconds <= 300);

  // O bloqueio é da pessoa: outra pessoa não é afetada, e o QR continua funcionando para quem bloqueou.
  const other = await visitor('Outra Pessoa Teste');
  assert.equal((await call('POST', '/visits/manual', { body: { roomId: q.id, code: q.manual }, token: other })).status, 201);
  assert.equal((await call('POST', '/visits', { body: { code: q.token }, token: t })).status, 201);

  // Passados os 5 minutos o bloqueio expira e o contador reinicia.
  await db.query("UPDATE manual_code_attempts SET locked_until = now() - interval '1 second'");
  const d = await qrFor('direcao');
  const again = await call('POST', '/visits/manual', { body: { roomId: d.id, code: 'CCCC-DDDD' }, token: t });
  assert.equal(again.status, 422);
  assert.equal(again.json.attemptsLeft, 4);
});

test('acerto zera a contagem de erros', async () => {
  await reset();
  const q = await qrFor('biblioteca');
  const t = await visitor();
  for (let i = 0; i < 3; i++) await call('POST', '/visits/manual', { body: { roomId: q.id, code: 'AAAA-BBBB' }, token: t });
  assert.equal((await call('POST', '/visits/manual', { body: { roomId: q.id, code: q.manual }, token: t })).status, 201);
  const next = await call('POST', '/visits/manual', { body: { roomId: q.id, code: 'AAAA-BBBB' }, token: t });
  assert.equal(next.json.attemptsLeft, 4);
});

test('código manual antigo (versão substituída) também é recusado como desatualizado', async () => {
  await reset();
  const old = await qrFor('biblioteca');
  const t = await visitor();
  await prepareVersions(config.qrSecret, [old.id]);
  await activatePending([old.id]);
  const r = await call('POST', '/visits/manual', { body: { roomId: old.id, code: old.manual }, token: t });
  assert.equal(r.status, 410);
  assert.equal(r.json.code, 'QR_OUTDATED');
});

test('/me e /map refletem as visitas', async () => {
  await reset();
  await db.query("UPDATE rooms SET is_required = true WHERE slug IN ('biblioteca', 'auditorio')");
  const q = await qrFor('biblioteca');
  const t = await visitor();
  await call('POST', '/visits', { body: { code: q.token }, token: t });
  const me = await call('GET', '/me', { token: t });
  assert.equal(me.json.progress.visitedCount, 1);
  const map = await call('GET', '/map', { token: t });
  const all = map.json.floors.flatMap((f: any) => f.rooms);
  assert.equal(all.find((r: any) => r.slug === 'biblioteca').visited, true);
});

test('prepare não duplica pendente; ativar sem pendente não faz nada; auditoria registra', async () => {
  await reset();
  const id = await room('biblioteca');
  const a = await prepareVersions(config.qrSecret, [id]);
  const b = await prepareVersions(config.qrSecret, [id]);
  assert.deepEqual([a[0]!.created, b[0]!.created, a[0]!.version === b[0]!.version], [true, false, true]);
  assert.equal((await activatePending([id])).length, 1);
  assert.equal((await activatePending([id])).length, 0);
  assert.ok(((await db.query("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'qr.activate'")).rows[0].n) >= 1);
});

test('etiquetas: PDF A6 (1 por página) e A4 (4 por folha)', async () => {
  await reset();
  const items = [];
  for (const slug of ['biblioteca', 'direcao', 'auditorio', 'sala-300', 'imagem']) {
    const q = await qrFor(slug);
    const r = (await db.query('SELECT name, room_number FROM rooms WHERE id = $1', [q.id])).rows[0];
    items.push({ id: q.id, slug, name: r.name, number: r.room_number, floorName: '1º piso', version: q.version, status: 'active' });
  }
  const opts = { secret: config.qrSecret, appUrl: 'https://nexo.exemplo.com', eventName: 'PROCIDADANIA CEUMAP' };
  const a4 = await renderLabels(items, { ...opts, format: 'a4' });
  const a6 = await renderLabels(items, { ...opts, format: 'a6' });
  assert.equal(a4.subarray(0, 5).toString(), '%PDF-');
  const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
  assert.equal(pages(a4), 2); // 5 etiquetas = 4 + 1
  assert.equal(pages(a6), 5);
});

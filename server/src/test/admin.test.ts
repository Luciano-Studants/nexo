import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

const url = process.env.DATABASE_URL ?? '';
if (!/\/[^/?]*test[^/?]*(\?|$)/i.test(url)) {
  throw new Error('Defina DATABASE_URL apontando para um banco de TESTE (nome com "test").');
}
process.env.TRUST_PROXY = '1';
process.env.ADMIN_LOGIN_LIMIT_PER_15MIN = '1000';

const { createApp } = await import('../app.js');
const { db } = await import('../db.js');
const { loadConfig } = await import('../config.js');
const { hashPassword, verifyPassword } = await import('../services/adminAuth.js');

const baseConfig = loadConfig();
const servers: Server[] = [];

function start(overrides: Partial<typeof baseConfig> = {}): Promise<string> {
  const app = createApp({ ...baseConfig, ...overrides, publicAppUrl: 'publicAppUrl' in overrides ? overrides.publicAppUrl! : 'https://nexo.teste' });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`);
    });
  });
}

async function raw(base: string, method: string, path: string, opts: { body?: unknown; token?: string; ip?: string } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': opts.ip ?? '10.1.0.1',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}
async function call(base: string, method: string, path: string, opts: { body?: unknown; token?: string; ip?: string } = {}) {
  const res = await raw(base, method, path, opts);
  return { status: res.status, json: (await res.json()) as any };
}

const PASS = 'senha-forte-de-teste-1';
let api = '';
let token = '';

async function resetEvent() {
  await db.query('DELETE FROM visits');
  await db.query('DELETE FROM participants');
  await db.query("UPDATE events SET status = 'draft', test_mode = false, starts_at = NULL, ends_at = NULL, name = 'PROCIDADANIA CEUMAP', edition_label = NULL");
  await db.query('UPDATE rooms SET is_required = false, active = true');
}

async function loginOk(): Promise<string> {
  const r = await call(api, 'POST', '/admin/login', { body: { username: 'staff-teste', password: PASS } });
  assert.equal(r.status, 200);
  return r.json.token as string;
}

before(async () => {
  await db.query("DELETE FROM admin_accounts WHERE username LIKE 'staff-%'");
  await db.query('INSERT INTO admin_accounts (username, password_hash) VALUES ($1, $2)', ['staff-teste', await hashPassword(PASS)]);
  api = await start();
  await resetEvent();
  token = await loginOk();
});

after(async () => {
  await resetEvent();
  await db.query('DELETE FROM room_qr_versions');
  await db.query("DELETE FROM audit_log WHERE actor_type = 'staff'");
  await db.query("DELETE FROM admin_accounts WHERE username LIKE 'staff-%'");
  for (const s of servers) s.close();
  await db.end();
});

test('hash de senha: verifica certo, rejeita errado, não guarda texto puro', async () => {
  const h = await hashPassword('outra-senha-longa-1');
  assert.ok(h.startsWith('scrypt$'));
  assert.ok(!h.includes('outra-senha'));
  assert.equal(await verifyPassword('outra-senha-longa-1', h), true);
  assert.equal(await verifyPassword('outra-senha-longa-2', h), false);
  assert.equal(await verifyPassword('x', 'lixo'), false);
});

test('rotas do painel exigem sessão', async () => {
  for (const [m, p] of [['GET', '/admin/overview'], ['GET', '/admin/me'], ['PATCH', '/admin/event'], ['GET', '/admin/export/visits.csv'], ['POST', '/admin/qr/labels']] as const) {
    const r = await call(api, m, p);
    assert.equal(r.status, 401, `${m} ${p}`);
    assert.equal(r.json.code, 'ADMIN_UNAUTHENTICATED');
  }
  assert.equal((await call(api, 'GET', '/admin/me', { token: 'ns_' + 'a'.repeat(43) })).status, 401);
  // Token de visitante não vale como staff.
  assert.equal((await call(api, 'GET', '/admin/me', { token: 'nx_' + 'a'.repeat(43) })).status, 401);
});

test('login: senha errada não revela se o usuário existe; token não é guardado em texto', async () => {
  const wrong = await call(api, 'POST', '/admin/login', { body: { username: 'staff-teste', password: 'errada' } });
  const ghost = await call(api, 'POST', '/admin/login', { body: { username: 'ninguem', password: 'errada' } });
  assert.equal(wrong.status, 401);
  assert.equal(ghost.status, 401);
  assert.equal(wrong.json.message, ghost.json.message);
  assert.equal((await call(api, 'POST', '/admin/login', { body: {} })).status, 400);

  const row = (await db.query('SELECT token_hash FROM admin_sessions ORDER BY created_at DESC LIMIT 1')).rows[0];
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash.length, 64);
  const me = await call(api, 'GET', '/admin/me', { token });
  assert.equal(me.json.username, 'staff-teste');
});

test('5 senhas erradas bloqueiam a conta, mesmo com a senha certa depois', async () => {
  await db.query("INSERT INTO admin_accounts (username, password_hash) VALUES ('staff-bloqueio', $1)", [await hashPassword(PASS)]);
  for (let i = 0; i < 5; i++) {
    const r = await call(api, 'POST', '/admin/login', { body: { username: 'staff-bloqueio', password: 'errada' } });
    assert.equal(r.status, 401);
  }
  const locked = await call(api, 'POST', '/admin/login', { body: { username: 'staff-bloqueio', password: PASS } });
  assert.equal(locked.status, 429);
  assert.equal(locked.json.code, 'ADMIN_LOCKED');
  await db.query("UPDATE admin_accounts SET locked_until = now() - interval '1 minute' WHERE username = 'staff-bloqueio'");
  const ok = await call(api, 'POST', '/admin/login', { body: { username: 'staff-bloqueio', password: PASS } });
  assert.equal(ok.status, 200);
});

test('limite de tentativas de login por IP', async () => {
  const prev = process.env.ADMIN_LOGIN_LIMIT_PER_15MIN;
  process.env.ADMIN_LOGIN_LIMIT_PER_15MIN = '3';
  const limited = await start();
  process.env.ADMIN_LOGIN_LIMIT_PER_15MIN = prev;
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) {
    codes.push((await call(limited, 'POST', '/admin/login', { body: { username: 'ninguem', password: 'x' }, ip: '10.9.9.9' })).status);
  }
  assert.deepEqual(codes, [401, 401, 401, 429, 429]);
});

test('sessão expira após 30 min sem uso e cada uso renova o prazo', async () => {
  const t = await loginOk();
  await db.query("UPDATE admin_sessions SET last_seen_at = now() - interval '29 minutes' WHERE token_hash = encode(sha256($1::bytea), 'hex')", [t]);
  assert.equal((await call(api, 'GET', '/admin/me', { token: t })).status, 200);
  await db.query("UPDATE admin_sessions SET last_seen_at = now() - interval '31 minutes' WHERE token_hash = encode(sha256($1::bytea), 'hex')", [t]);
  assert.equal((await call(api, 'GET', '/admin/me', { token: t })).status, 401);

  const t2 = await loginOk();
  await db.query("UPDATE admin_sessions SET created_at = now() - interval '13 hours' WHERE token_hash = encode(sha256($1::bytea), 'hex')", [t2]);
  assert.equal((await call(api, 'GET', '/admin/me', { token: t2 })).status, 401);
});

test('logout invalida a sessão', async () => {
  const t = await loginOk();
  assert.equal((await call(api, 'POST', '/admin/logout', { token: t })).status, 200);
  assert.equal((await call(api, 'GET', '/admin/me', { token: t })).status, 401);
});

test('visão geral traz evento, números e ambientes por piso', async () => {
  await resetEvent();
  const r = await call(api, 'GET', '/admin/overview', { token });
  assert.equal(r.status, 200);
  assert.equal(r.json.event.phase, 'before_open');
  assert.equal(r.json.event.roomsLocked, false);
  assert.equal(r.json.floors.length, 3);
  assert.equal(r.json.stats.roomsTotal, 29);
  assert.equal(r.json.stats.requiredActive, 0);
  assert.equal(r.json.stats.completed, 0);
  assert.equal(r.json.publicAppUrlConfigured, true);
  const room = r.json.floors[0].rooms[0];
  assert.ok(room.id && 'qrActive' in room && 'visits' in room);
});

test('ambientes: edita nome e, antes da abertura, ativo/obrigatório; valida e audita', async () => {
  await resetEvent();
  const ov = await call(api, 'GET', '/admin/overview', { token });
  const room = ov.json.floors[0].rooms[0];

  const ok = await call(api, 'PATCH', `/admin/rooms/${room.id}`, { token, body: { name: 'Novo Nome', number: '101', required: true } });
  assert.equal(ok.status, 200);
  const after = (await call(api, 'GET', '/admin/overview', { token })).json.floors[0].rooms.find((r: any) => r.id === room.id);
  assert.equal(after.name, 'Novo Nome');
  assert.equal(after.number, '101');
  assert.equal(after.required, true);
  assert.equal((await call(api, 'GET', '/admin/overview', { token })).json.stats.requiredActive, 1);

  assert.equal((await call(api, 'PATCH', `/admin/rooms/${room.id}`, { token, body: { name: '' } })).status, 400);
  assert.equal((await call(api, 'PATCH', `/admin/rooms/${room.id}`, { token, body: { slug: 'x' } })).status, 400);
  assert.equal((await call(api, 'PATCH', '/admin/rooms/nao-uuid', { token, body: { name: 'a' } })).status, 404);
  assert.equal((await call(api, 'PATCH', '/admin/rooms/11111111-1111-1111-1111-111111111111', { token, body: { name: 'a' } })).status, 404);

  const log = await call(api, 'GET', '/admin/audit', { token });
  assert.ok(log.json.items.some((i: any) => i.action === 'room.update' && i.username === 'staff-teste'));
  await db.query('UPDATE rooms SET name = $2, room_number = NULL WHERE id = $1', [room.id, room.name]);
});

test('com o evento aberto, ativo/obrigatório ficam travados; nome continua editável', async () => {
  await resetEvent();
  const room = (await call(api, 'GET', '/admin/overview', { token })).json.floors[0].rooms[0];
  assert.equal((await call(api, 'POST', '/admin/event/action', { token, body: { action: 'open' } })).status, 200);
  const locked = await call(api, 'PATCH', `/admin/rooms/${room.id}`, { token, body: { required: true } });
  assert.equal(locked.status, 409);
  assert.equal(locked.json.code, 'EVENT_LOCKED');
  assert.equal((await call(api, 'PATCH', `/admin/rooms/${room.id}`, { token, body: { active: false } })).status, 409);
  assert.equal((await call(api, 'PATCH', `/admin/rooms/${room.id}`, { token, body: { description: 'Texto novo' } })).status, 200);
  assert.equal((await call(api, 'GET', '/admin/overview', { token })).json.event.roomsLocked, true);
  await db.query('UPDATE rooms SET description = $2 WHERE id = $1', [room.id, room.description]);
});

test('evento: edição, validação de datas e ações de controle', async () => {
  await resetEvent();
  const bad = await call(api, 'PATCH', '/admin/event', { token, body: { startsAt: '2026-11-07T12:00:00Z', endsAt: '2026-11-07T10:00:00Z' } });
  assert.equal(bad.status, 400);
  assert.equal((await call(api, 'PATCH', '/admin/event', { token, body: { startsAt: 'ontem' } })).status, 400);
  assert.equal((await call(api, 'PATCH', '/admin/event', { token, body: { nome: 'x' } })).status, 400);

  const ok = await call(api, 'PATCH', '/admin/event', {
    token, body: { name: 'PROCIDADAM', editionLabel: '2026', startsAt: '2030-11-07T11:00:00Z', endsAt: '2030-11-07T22:00:00Z', testMode: true },
  });
  assert.equal(ok.status, 200);
  const ev = (await call(api, 'GET', '/event')).json;
  assert.equal(ev.name, 'PROCIDADAM');
  assert.equal(ev.testMode, true);
  assert.equal(ev.visitsAllowed, true); // modo de teste antes da abertura

  const act = (action: string, confirm?: boolean) => call(api, 'POST', '/admin/event/action', { token, body: { action, confirm } });
  assert.equal((await act('pause')).status, 409); // não está aberto
  assert.equal((await act('resume')).status, 409);
  assert.equal((await act('open')).status, 200);
  assert.equal((await call(api, 'GET', '/event')).json.phase, 'open');
  assert.equal((await act('open')).status, 409);
  assert.equal((await act('pause')).status, 200);
  assert.equal((await call(api, 'GET', '/event')).json.visitsAllowed, false);
  assert.equal((await act('resume')).status, 200);
  assert.equal((await act('schedule')).status, 400); // exige confirmação
  assert.equal((await act('schedule', true)).status, 200); // início no futuro: volta a "antes da abertura"
  assert.equal((await call(api, 'GET', '/event')).json.phase, 'before_open');
  assert.equal((await act('end')).status, 400);
  assert.equal((await act('end', true)).status, 200);
  assert.equal((await call(api, 'GET', '/event')).json.phase, 'ended');
  assert.equal((await act('open')).status, 409);
  assert.equal((await act('end', true)).status, 409);
});

test('adiar com horário de início já no passado é recusado', async () => {
  await resetEvent();
  await db.query("UPDATE events SET status = 'active', starts_at = now() - interval '1 hour'");
  const r = await call(api, 'POST', '/admin/event/action', { token, body: { action: 'schedule', confirm: true } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'START_IN_PAST');
});

test('QR pelo painel: preparar, imprimir pendente, ativar, imprimir ativa; ids inválidos', async () => {
  await resetEvent();
  await db.query('DELETE FROM room_qr_versions');
  const rooms = (await call(api, 'GET', '/admin/overview', { token })).json.floors[0].rooms.slice(0, 2);
  const ids = rooms.map((r: any) => r.id);

  const prep = await call(api, 'POST', '/admin/qr/prepare', { token, body: { roomIds: ids } });
  assert.equal(prep.status, 200);
  assert.equal(prep.json.results.every((x: any) => x.created && x.version === 1), true);
  const again = await call(api, 'POST', '/admin/qr/prepare', { token, body: { roomIds: ids } });
  assert.equal(again.json.results.every((x: any) => !x.created), true);

  const pdf = await raw(api, 'POST', '/admin/qr/labels', { token, body: { roomIds: ids, status: 'pending', format: 'a4' } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.headers.get('cache-control'), 'no-store');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');

  const noActive = await call(api, 'POST', '/admin/qr/labels', { token, body: { roomIds: ids, status: 'active' } });
  assert.equal(noActive.status, 409);
  assert.equal(noActive.json.code, 'NO_VERSIONS');

  const act = await call(api, 'POST', '/admin/qr/activate', { token, body: { roomIds: ids } });
  assert.equal(act.status, 200);
  const ov = (await call(api, 'GET', '/admin/overview', { token })).json.floors[0].rooms;
  assert.equal(ov.find((r: any) => r.id === ids[0]).qrActive, 1);
  assert.equal(ov.find((r: any) => r.id === ids[0]).qrPending, null);
  const pdf2 = await raw(api, 'POST', '/admin/qr/labels', { token, body: { roomIds: ids, status: 'active', format: 'a6' } });
  assert.equal(pdf2.status, 200);

  assert.equal((await call(api, 'POST', '/admin/qr/prepare', { token, body: { roomIds: [] } })).status, 400);
  assert.equal((await call(api, 'POST', '/admin/qr/prepare', { token, body: { roomIds: ['22222222-2222-2222-2222-222222222222'] } })).status, 404);
});

test('etiquetas exigem PUBLIC_APP_URL configurado', async () => {
  const bare = await start({ publicAppUrl: '' });
  const rooms = (await call(api, 'GET', '/admin/overview', { token })).json.floors[0].rooms.slice(0, 1);
  const r = await call(bare, 'POST', '/admin/qr/labels', { token, body: { roomIds: [rooms[0].id], status: 'pending' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'PUBLIC_APP_URL_MISSING');
});

test('participantes, busca e CSV (com proteção contra fórmulas)', async () => {
  await resetEvent();
  const ev = (await db.query("SELECT id FROM events WHERE slug = 'procidadania-ceumap'")).rows[0].id;
  await db.query("UPDATE rooms SET is_required = true WHERE slug IN ('biblioteca', 'sala-201')");
  const mk = async (name: string, i: number) =>
    (await db.query(
      `INSERT INTO participants (event_id, full_name, full_name_normalized, avatar_key, token_hash) VALUES ($1, $2::text, lower($2::text), 'avatar-01', $3) RETURNING id`,
      [ev, name, `hash-${i}`.padEnd(64, '0')],
    )).rows[0].id as string;
  const a = await mk('Maria da Silva', 1);
  const b = await mk('=HYPERLINK("http://x")', 2);
  const rooms = (await db.query("SELECT id, slug FROM rooms WHERE slug IN ('biblioteca', 'sala-201')")).rows;
  for (const r of rooms) await db.query('INSERT INTO visits (participant_id, room_id) VALUES ($1, $2)', [a, r.id]);
  await db.query('INSERT INTO visits (participant_id, room_id) VALUES ($1, $2)', [b, rooms[0].id]);

  const list = await call(api, 'GET', '/admin/participants', { token });
  assert.equal(list.json.total, 2);
  const maria = list.json.items.find((i: any) => i.fullName === 'Maria da Silva');
  assert.equal(maria.completed, true);
  assert.equal(maria.requiredVisited, 2);
  assert.equal(list.json.items.find((i: any) => i.id === b).completed, false);

  const q = await call(api, 'GET', '/admin/participants?q=mar%25', { token });
  assert.equal(q.json.total, 0); // % é literal na busca, não curinga
  assert.equal((await call(api, 'GET', '/admin/participants?q=maria', { token })).json.total, 1);

  const stats = (await call(api, 'GET', '/admin/overview', { token })).json.stats;
  assert.deepEqual([stats.participants, stats.visits, stats.completed, stats.requiredActive], [2, 3, 1, 2]);

  const p = await raw(api, 'GET', '/admin/export/participants.csv', { token });
  assert.match(p.headers.get('content-type')!, /text\/csv/);
  const bytes = Buffer.from(await p.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM para o Excel abrir em UTF-8');
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  assert.ok(text.startsWith('id,nome'));
  assert.ok(text.includes(`'=HYPERLINK`), 'fórmula precisa ser neutralizada');
  assert.ok(!/(^|,)=HYPERLINK/m.test(text));
  const v = await (await raw(api, 'GET', '/admin/export/visits.csv', { token })).text();
  assert.equal(v.trim().split('\r\n').length, 4);

  const log = (await call(api, 'GET', '/admin/audit', { token })).json.items;
  assert.ok(log.some((i: any) => i.action === 'export.participants'));
});

test('login falho não grava no histórico o texto digitado como usuário', async () => {
  const typed = 'senha-colada-no-campo-errado-9';
  await call(api, 'POST', '/admin/login', { body: { username: typed, password: 'x' } });
  await call(api, 'POST', '/admin/login', { body: { username: 'staff-teste', password: 'errada' } });
  const rows = (await db.query("SELECT details::text AS d, actor_id FROM audit_log WHERE action = 'admin.login' AND outcome = 'failure' ORDER BY id DESC LIMIT 2")).rows;
  assert.ok(rows.every((r) => !r.d.includes(typed)), 'o usuário digitado não pode ir para o histórico');
  assert.ok(rows.some((r) => r.d.includes('unknown_user')));
  await db.query("UPDATE admin_accounts SET failed_count = 0, locked_until = NULL WHERE username = 'staff-teste'");
});

test('busca de participantes ignora caixa e acento', async () => {
  await resetEvent();
  const ev = (await db.query("SELECT id FROM events WHERE slug = 'procidadania-ceumap'")).rows[0].id;
  await db.query(
    `INSERT INTO participants (event_id, full_name, full_name_normalized, avatar_key, token_hash) VALUES ($1, 'João Álvares Neto', 'joao alvares neto', 'avatar-01', $2)`,
    [ev, 'h-busca'.padEnd(64, '0')],
  );
  for (const q of ['joao', 'JOÃO', 'alvares', 'Álvares neto']) {
    assert.equal((await call(api, 'GET', `/admin/participants?q=${encodeURIComponent(q)}`, { token })).json.total, 1, q);
  }
  assert.equal((await call(api, 'GET', '/admin/participants?q=carlos', { token })).json.total, 0);
});

test('renomear ambiente com QR ativo deixa uma versão pendente para reimpressão', async () => {
  await resetEvent();
  await db.query('DELETE FROM room_qr_versions');
  const room = (await call(api, 'GET', '/admin/overview', { token })).json.floors[0].rooms[0];
  await call(api, 'POST', '/admin/qr/prepare', { token, body: { roomIds: [room.id] } });
  await call(api, 'POST', '/admin/qr/activate', { token, body: { roomIds: [room.id] } });

  // Mudar só a descrição não afeta a etiqueta.
  const desc = await call(api, 'PATCH', `/admin/rooms/${room.id}`, { token, body: { description: 'Outra descrição' } });
  assert.equal(desc.json.qrReprintNeeded, false);
  let r = (await call(api, 'GET', '/admin/overview', { token })).json.floors[0].rooms.find((x: any) => x.id === room.id);
  assert.equal(r.qrPending, null);

  const ren = await call(api, 'PATCH', `/admin/rooms/${room.id}`, { token, body: { name: 'Nome Novo' } });
  assert.equal(ren.json.qrReprintNeeded, true);
  r = (await call(api, 'GET', '/admin/overview', { token })).json.floors[0].rooms.find((x: any) => x.id === room.id);
  assert.equal(r.qrActive, 1, 'a etiqueta antiga continua valendo até a ativação');
  assert.equal(r.qrPending, 2);

  // Renomear de novo não cria outra pendente.
  await call(api, 'PATCH', `/admin/rooms/${room.id}`, { token, body: { name: 'Nome Novo 2' } });
  const versions = (await db.query('SELECT COUNT(*)::int AS n FROM room_qr_versions WHERE room_id = $1', [room.id])).rows[0].n;
  assert.equal(versions, 2);
  await db.query('UPDATE rooms SET name = $2, description = $3 WHERE id = $1', [room.id, room.name, room.description]);
});

test('o painel não é barrado pelo limite geral da API (IP compartilhado com visitantes)', async () => {
  const prev = process.env.API_RATE_LIMIT_PER_MIN;
  process.env.API_RATE_LIMIT_PER_MIN = '3';
  const tight = await start();
  process.env.API_RATE_LIMIT_PER_MIN = prev;
  const visitor: number[] = [];
  for (let i = 0; i < 5; i++) visitor.push((await call(tight, 'GET', '/event', { ip: '10.7.7.7' })).status);
  assert.ok(visitor.includes(429), 'o visitante é limitado');
  for (let i = 0; i < 8; i++) {
    assert.equal((await call(tight, 'GET', '/admin/me', { token, ip: '10.7.7.7' })).status, 200);
  }
});

test('QR de entrada: PNG e cartaz PDF a partir de PUBLIC_APP_URL; exige configuração e sessão', async () => {
  assert.equal((await call(api, 'GET', '/admin/entry-qr')).status, 401);
  const png = await raw(api, 'GET', '/admin/entry-qr?format=png', { token });
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  assert.deepEqual([...Buffer.from(await png.arrayBuffer()).subarray(1, 4)], [0x50, 0x4e, 0x47]);
  const pdf = await raw(api, 'GET', '/admin/entry-qr?format=pdf', { token });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const bare = await start({ publicAppUrl: '' });
  const r = await call(bare, 'GET', '/admin/entry-qr', { token });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'PUBLIC_APP_URL_MISSING');
  const ov = (await call(api, 'GET', '/admin/overview', { token })).json;
  assert.equal(ov.entryUrl, 'https://nexo.teste/');
});

test('reabrir evento encerrado: confirma, respeita término e início programados', async () => {
  await resetEvent();
  const act = (action: string, confirm?: boolean) => call(api, 'POST', '/admin/event/action', { token, body: { action, confirm } });
  assert.equal((await act('reopen', true)).status, 409, 'só reabre se estiver encerrado');

  // Encerrado na mão durante o evento -> reabre como aberto.
  await db.query("UPDATE events SET status = 'active', starts_at = now() - interval '1 hour', ends_at = now() + interval '5 hours'");
  assert.equal((await act('end', true)).status, 200);
  assert.equal((await call(api, 'GET', '/event')).json.phase, 'ended');
  assert.equal((await act('reopen')).status, 400, 'exige confirmação');
  assert.equal((await act('reopen', true)).status, 200);
  assert.equal((await call(api, 'GET', '/event')).json.phase, 'open');

  // Término programado já passou: não reabre sem novo término.
  await db.query("UPDATE events SET status = 'ended', ends_at = now() - interval '1 minute'");
  const late = await act('reopen', true);
  assert.equal(late.status, 409);
  assert.equal(late.json.code, 'END_IN_PAST');
  const extend = await call(api, 'PATCH', '/admin/event', { token, body: { endsAt: new Date(Date.now() + 3600_000).toISOString() } });
  assert.equal(extend.status, 200);
  assert.equal((await act('reopen', true)).status, 200);

  // Encerrado antes da abertura (início no futuro): reabrir NÃO abre antes da hora.
  await db.query("UPDATE events SET status = 'ended', starts_at = now() + interval '2 days', ends_at = now() + interval '3 days'");
  assert.equal((await act('reopen', true)).status, 200);
  assert.equal((await call(api, 'GET', '/event')).json.phase, 'before_open');
});

test('horário programado: abre e encerra sozinho, mesmo sem apertar nada', async () => {
  await resetEvent();
  const phase = async () => (await call(api, 'GET', '/event')).json.phase;
  await db.query("UPDATE events SET status = 'scheduled', starts_at = now() + interval '1 hour', ends_at = now() + interval '5 hours'");
  assert.equal(await phase(), 'before_open');
  await db.query("UPDATE events SET starts_at = now() - interval '1 minute'");
  assert.equal(await phase(), 'open', 'abre no horário de início');
  await db.query("UPDATE events SET ends_at = now() - interval '1 second'");
  assert.equal(await phase(), 'ended', 'encerra no horário de término');
  // Aberto manualmente antes da hora: o término programado continua valendo.
  await db.query("UPDATE events SET status = 'active', starts_at = now() + interval '1 day', ends_at = now() + interval '2 days'");
  assert.equal(await phase(), 'open');
  await db.query("UPDATE events SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 second'");
  assert.equal(await phase(), 'ended');
});

test('relatórios: números corretos e exportação em XLSX e PDF', async () => {
  await resetEvent();
  const ev = (await db.query('SELECT id FROM events LIMIT 1')).rows[0].id as string;
  const rooms = (await db.query(
    `SELECT r.id FROM rooms r JOIN floors f ON f.id = r.floor_id WHERE f.event_id = $1 ORDER BY f.sort_order, r.name LIMIT 3`, [ev])).rows.map((r) => r.id as string);
  await db.query('UPDATE rooms SET is_required = true WHERE id = ANY($1)', [rooms.slice(0, 2)]);
  const mk = async (name: string) => (await db.query(
    `INSERT INTO participants (event_id, full_name, full_name_normalized, avatar_key, token_hash)
     VALUES ($1, $2::varchar, lower($2::varchar), 'a1', md5(random()::text)) RETURNING id`, [ev, name])).rows[0].id as string;
  const [ana, bia, caio] = [await mk('Ana Souza'), await mk('Bia =Lima'), await mk('Caio Nunes')];
  const visit = (p: string, r: string) => db.query('INSERT INTO visits (participant_id, room_id) VALUES ($1, $2)', [p, r]);
  await visit(ana, rooms[0]!); await visit(ana, rooms[1]!); await visit(ana, rooms[2]!); // concluiu
  await visit(bia, rooms[0]!);                                                           // 50%
  // caio: nenhuma visita

  const rep = await call(api, 'GET', '/admin/reports', { token });
  assert.equal(rep.status, 200);
  const s = rep.json.summary;
  assert.equal(s.participants, 3);
  assert.equal(s.withVisit, 2);
  assert.equal(s.withoutVisit, 1);
  assert.equal(s.completed, 1);
  assert.equal(s.completionPct, 33.3);
  assert.equal(s.visits, 4);
  assert.equal(s.requiredRooms, 2);
  assert.equal(rep.json.rooms[0].visits, 2, 'sala mais visitada vem primeiro');
  assert.equal(rep.json.distribution.reduce((a: number, d: any) => a + d.count, 0), 3);
  assert.equal(rep.json.floors.reduce((a: number, f: any) => a + f.visits, 0), 4);

  const noAuth = await raw(api, 'GET', '/admin/reports/export.xlsx');
  assert.equal(noAuth.status, 401);

  const x = await raw(api, 'GET', '/admin/reports/export.xlsx', { token });
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-type') ?? '', /spreadsheetml/);
  const xb = Buffer.from(await x.arrayBuffer());
  assert.equal(xb.subarray(0, 2).toString(), 'PK');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xb as any);
  assert.deepEqual(wb.worksheets.map((w) => w.name),
    ['Resumo', 'Por piso', 'Por ambiente', 'Ranking', 'Conclusão', 'Visitas por hora', 'Participantes', 'Visitas (detalhe)']);
  assert.equal(wb.getWorksheet('Participantes')!.rowCount, 4);
  assert.equal(wb.getWorksheet('Visitas (detalhe)')!.rowCount, 5);
  const bea = wb.getWorksheet('Participantes')!.getRow(3).getCell(1).value;
  assert.equal(typeof bea, 'string', 'nome com "=" fica como texto, nunca fórmula');

  const p = await raw(api, 'GET', '/admin/reports/export.pdf', { token });
  assert.equal(p.status, 200);
  assert.equal(p.headers.get('content-type'), 'application/pdf');
  const pb = Buffer.from(await p.arrayBuffer());
  assert.equal(pb.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pb.length > 3000);

  const log = await db.query("SELECT 1 FROM audit_log WHERE action IN ('export.report.xlsx','export.report.pdf')");
  assert.equal(log.rowCount, 2);
  await resetEvent();
});

test('relatórios: evento vazio exporta sem erro', async () => {
  await resetEvent();
  for (const f of ['xlsx', 'pdf']) {
    const r = await raw(api, 'GET', `/admin/reports/export.${f}`, { token });
    assert.equal(r.status, 200, f);
  }
  const rep = await call(api, 'GET', '/admin/reports', { token });
  assert.equal(rep.json.summary.completionPct, 0);
});

test('/api/ping responde sem tocar no banco e /api/health confere o banco', async () => {
  const ping = await call(api, 'GET', '/ping');
  assert.equal(ping.status, 200);
  assert.equal(ping.json.ok, true);
  const health = await call(api, 'GET', '/health');
  assert.equal(health.json.database, 'ok');
});

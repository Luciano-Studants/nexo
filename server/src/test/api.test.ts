import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';

// Os testes apagam participantes. Só rodam em um banco cujo nome contenha "test".
const url = process.env.DATABASE_URL ?? '';
if (!/\/[^/?]*test[^/?]*(\?|$)/i.test(url)) {
  throw new Error('Defina DATABASE_URL apontando para um banco de TESTE (nome com "test").');
}
process.env.TRUST_PROXY = '1';

const { createApp } = await import('../app.js');
const { db } = await import('../db.js');
const { loadConfig } = await import('../config.js');

const baseConfig = loadConfig();
const servers: Server[] = [];

function start(overrides: Partial<typeof baseConfig> = {}): Promise<string> {
  const app = createApp({ ...baseConfig, ...overrides });
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`);
    });
  });
}

async function call(base: string, method: string, path: string, opts: {
  body?: unknown; token?: string; ip?: string;
} = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': opts.ip ?? '10.0.0.1',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

let api = '';

before(async () => {
  const ev = await db.query("SELECT 1 FROM events WHERE slug = 'procidadania-ceumap'");
  assert.equal(ev.rowCount, 1, 'Rode `npm run db:seed` no banco de teste antes.');
  api = await start();
});

after(async () => {
  await db.query("UPDATE events SET status = 'draft', test_mode = false, starts_at = NULL, ends_at = NULL");
  await db.query('UPDATE rooms SET is_required = false');
  for (const s of servers) s.close();
  await db.end();
});

async function reset() {
  await db.query('DELETE FROM visits');
  await db.query('DELETE FROM participants');
  await db.query("UPDATE events SET status = 'draft', test_mode = false, starts_at = NULL, ends_at = NULL");
  await db.query('UPDATE rooms SET is_required = false');
}

test('GET /event informa fase e permissões', async () => {
  await reset();
  const r = await call(api, 'GET', '/event');
  assert.equal(r.status, 200);
  assert.equal(r.json.name, 'PROCIDADANIA CEUMAP');
  assert.equal(r.json.phase, 'before_open');
  assert.equal(r.json.registrationAllowed, true);
  assert.equal(r.json.visitsAllowed, false);
});

test('rejeita nome sem sobrenome ou com caracteres inválidos', async () => {
  await reset();
  for (const fullName of ['Maria', '  Ma  ', 'J K', '12345 6789', '']) {
    const r = await call(api, 'POST', '/participants', { body: { fullName } });
    assert.equal(r.status, 400, `esperava 400 para "${fullName}"`);
  }
  const none = await call(api, 'POST', '/participants', { body: {} });
  assert.equal(none.status, 400);
});

test('cria perfil: ID, avatar aleatório e token; /me identifica o aparelho', async () => {
  await reset();
  const r = await call(api, 'POST', '/participants', { body: { fullName: '  Maria   da Silva ' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'created');
  assert.equal(r.json.participant.fullName, 'Maria da Silva');
  assert.match(r.json.participant.avatarKey, /^avatar-(0[1-9]|1[0-2])$/);
  assert.match(r.json.participant.id, /^[0-9a-f-]{36}$/);
  assert.match(r.json.token, /^nx_/);

  const me = await call(api, 'GET', '/me', { token: r.json.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.participant.id, r.json.participant.id);
  // Sem ambientes obrigatórios: erro de configuração, nunca "concluído".
  assert.equal(me.json.progress.configurationError, true);
  assert.equal(me.json.progress.completed, false);

  // O banco não guarda token nem IP em texto.
  const row = (await db.query('SELECT token_hash, ip_hash FROM participants')).rows[0];
  assert.notEqual(row.token_hash, r.json.token);
  assert.ok(!String(row.ip_hash).includes('10.0.0.1'));
  assert.equal(row.token_hash.length, 64);
});

test('/me sem token ou com token inválido retorna 401', async () => {
  assert.equal((await call(api, 'GET', '/me')).status, 401);
  assert.equal((await call(api, 'GET', '/me', { token: 'nx_' + 'a'.repeat(43) })).status, 401);
  assert.equal((await call(api, 'GET', '/me', { token: 'qualquer-coisa' })).status, 401);
});

test('mesmo nome + mesmo IP: pergunta, retoma e invalida o token antigo', async () => {
  await reset();
  const first = await call(api, 'POST', '/participants', { body: { fullName: 'João Álvares Neto' } });
  const oldToken = first.json.token as string;

  // Variações de caixa e acento reconhecem a mesma pessoa.
  const ask = await call(api, 'POST', '/participants', { body: { fullName: 'joao alvares NETO' } });
  assert.equal(ask.status, 200);
  assert.equal(ask.json.status, 'resume_available');
  assert.equal(ask.json.candidate.visitedCount, 0);
  assert.equal(ask.json.token, undefined);

  const resumed = await call(api, 'POST', '/participants', {
    body: { fullName: 'joao alvares NETO', decision: 'resume' },
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.json.status, 'resumed');
  assert.equal(resumed.json.participant.id, first.json.participant.id);
  assert.notEqual(resumed.json.token, oldToken);
  assert.equal((await call(api, 'GET', '/me', { token: oldToken })).status, 401);
  assert.equal((await call(api, 'GET', '/me', { token: resumed.json.token })).status, 200);

  const count = await db.query('SELECT COUNT(*)::int AS n FROM participants');
  assert.equal(count.rows[0].n, 1);
});

test('"new" cria outro perfil; nomes duplicados são permitidos', async () => {
  await reset();
  await call(api, 'POST', '/participants', { body: { fullName: 'Ana Souza Lima' } });
  const again = await call(api, 'POST', '/participants', {
    body: { fullName: 'Ana Souza Lima', decision: 'new' },
  });
  assert.equal(again.status, 201);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM participants')).rows[0].n, 2);
});

test('IP diferente ou fora da janela: não reconhece, cria perfil novo', async () => {
  await reset();
  await call(api, 'POST', '/participants', { body: { fullName: 'Carlos Pereira Dias' }, ip: '10.0.0.1' });

  const otherIp = await call(api, 'POST', '/participants', {
    body: { fullName: 'Carlos Pereira Dias' }, ip: '10.0.0.2',
  });
  assert.equal(otherIp.status, 201);

  await db.query("UPDATE participants SET last_seen_at = now() - interval '7 hours'");
  const late = await call(api, 'POST', '/participants', {
    body: { fullName: 'Carlos Pereira Dias' }, ip: '10.0.0.1',
  });
  assert.equal(late.status, 201);
});

test('decision "resume" sem perfil recente cria um novo (não vaza perfis)', async () => {
  await reset();
  const r = await call(api, 'POST', '/participants', {
    body: { fullName: 'Paula Rocha Matos', decision: 'resume' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'created');
});

test('teto de perfis novos por IP por hora', async () => {
  await reset();
  const small = await start({ profilesPerIpPerHour: 3 });
  for (let i = 1; i <= 3; i++) {
    const r = await call(small, 'POST', '/participants', {
      body: { fullName: `Pessoa Numero${'abc'[i - 1]}` }, ip: '10.9.9.9',
    });
    assert.equal(r.status, 201);
  }
  const blocked = await call(small, 'POST', '/participants', {
    body: { fullName: 'Pessoa Excedente' }, ip: '10.9.9.9',
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.code, 'TOO_MANY_PROFILES');

  const other = await call(small, 'POST', '/participants', {
    body: { fullName: 'Pessoa Outra' }, ip: '10.9.9.8',
  });
  assert.equal(other.status, 201);
});

test('evento encerrado bloqueia novos perfis; antes da abertura permite', async () => {
  await reset();
  const before = await call(api, 'POST', '/participants', { body: { fullName: 'Teste Antes Abertura' } });
  assert.equal(before.status, 201);

  await db.query("UPDATE events SET status = 'ended'");
  const ended = await call(api, 'POST', '/participants', { body: { fullName: 'Teste Depois Fim' } });
  assert.equal(ended.status, 403);
  assert.equal(ended.json.code, 'EVENT_ENDED');
  assert.equal((await call(api, 'GET', '/event')).json.phase, 'ended');

  // Quem já tem perfil ainda consulta o próprio progresso.
  assert.equal((await call(api, 'GET', '/me', { token: before.json.token })).status, 200);
});

test('progresso conta só ambientes obrigatórios ativos', async () => {
  await reset();
  const r = await call(api, 'POST', '/participants', { body: { fullName: 'Rita Campos Neves' } });
  const rooms = (await db.query('SELECT id FROM rooms ORDER BY slug LIMIT 3')).rows;
  await db.query('UPDATE rooms SET is_required = true WHERE id = ANY($1)', [[rooms[0].id, rooms[1].id]]);

  const pid = r.json.participant.id;
  await db.query('INSERT INTO visits (participant_id, room_id) VALUES ($1, $2)', [pid, rooms[0].id]);
  let me = await call(api, 'GET', '/me', { token: r.json.token });
  assert.deepEqual(
    [me.json.progress.requiredCount, me.json.progress.visitedCount, me.json.progress.completed],
    [2, 1, false],
  );

  // Visita em sala não obrigatória não conta.
  await db.query('INSERT INTO visits (participant_id, room_id) VALUES ($1, $2)', [pid, rooms[2].id]);
  me = await call(api, 'GET', '/me', { token: r.json.token });
  assert.equal(me.json.progress.visitedCount, 1);

  await db.query('INSERT INTO visits (participant_id, room_id) VALUES ($1, $2)', [pid, rooms[1].id]);
  me = await call(api, 'GET', '/me', { token: r.json.token });
  assert.equal(me.json.progress.completed, true);

  // Desativar um ambiente obrigatório deixa de exigi-lo.
  await db.query('UPDATE rooms SET active = false WHERE id = $1', [rooms[1].id]);
  me = await call(api, 'GET', '/me', { token: r.json.token });
  assert.equal(me.json.progress.requiredCount, 1);
  await db.query('UPDATE rooms SET active = true');

  // Mesma pessoa não pode ter duas visitas na mesma sala.
  await assert.rejects(
    db.query('INSERT INTO visits (participant_id, room_id) VALUES ($1, $2)', [pid, rooms[0].id]),
    /duplicate key/,
  );
});

test('GET /map lista 3 pisos e marca visitados só com token válido', async () => {
  await reset();
  const anon = await call(api, 'GET', '/map');
  assert.equal(anon.status, 200);
  assert.equal(anon.json.floors.length, 3);
  assert.deepEqual(anon.json.floors.map((f: any) => f.rooms.length), [7, 10, 12]);
  assert.ok(anon.json.floors.every((f: any) => f.rooms.every((r: any) => r.visited === false)));

  const p = await call(api, 'POST', '/participants', { body: { fullName: 'Lia Moura Prado' } });
  const room = (await db.query("SELECT id FROM rooms WHERE slug = 'biblioteca'")).rows[0];
  await db.query('INSERT INTO visits (participant_id, room_id) VALUES ($1, $2)', [p.json.participant.id, room.id]);
  await db.query("UPDATE rooms SET active = false WHERE slug = 'auditorio'");

  const mine = await call(api, 'GET', '/map', { token: p.json.token });
  const all = mine.json.floors.flatMap((f: any) => f.rooms);
  assert.equal(all.find((r: any) => r.slug === 'biblioteca').visited, true);
  assert.equal(all.find((r: any) => r.slug === 'auditorio').available, false);
  assert.equal(all.filter((r: any) => r.visited).length, 1);

  const bad = await call(api, 'GET', '/map', { token: 'nx_' + 'b'.repeat(43) });
  assert.ok(bad.json.floors.every((f: any) => f.rooms.every((r: any) => r.visited === false)));
  await db.query('UPDATE rooms SET active = true');
});

test('o seed trouxe 3 pisos e 29 ambientes, todos não obrigatórios', async () => {
  await reset();
  const f = await db.query('SELECT COUNT(*)::int AS n FROM floors');
  const r = await db.query('SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE is_required)::int AS req FROM rooms');
  assert.equal(f.rows[0].n, 3);
  assert.equal(r.rows[0].n, 29);
  assert.equal(r.rows[0].req, 0);
});

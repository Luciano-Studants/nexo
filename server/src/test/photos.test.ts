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
const { hashPassword } = await import('../services/adminAuth.js');
const sharp = (await import('sharp')).default;

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
  const r = await call(api, 'POST', '/admin/login', { body: { username: 'staff-fotos', password: PASS } });
  assert.equal(r.status, 200);
  return r.json.token as string;
}

before(async () => {
  await db.query("DELETE FROM admin_accounts WHERE username LIKE 'staff-%'");
  await db.query('INSERT INTO admin_accounts (username, password_hash) VALUES ($1, $2)', ['staff-fotos', await hashPassword(PASS)]);
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


async function put(path: string, body: Buffer | string, type: string, tok = token) {
  const res = await fetch(`${api}${path}`, {
    method: 'PUT',
    headers: { 'content-type': type, 'x-forwarded-for': '10.1.0.1', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: typeof body === 'string' ? body : new Uint8Array(body),
  });
  let json: any = null;
  try { json = await res.clone().json(); } catch { /* sem json */ }
  return { status: res.status, json, res };
}

async function jpeg(w: number, h: number, extra: (s: import('sharp').Sharp) => import('sharp').Sharp = (s) => s) {
  return extra(sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg()).toBuffer();
}

let rooms: any[] = [];
test('prepara', async () => {
  await resetEvent();
  await db.query('DELETE FROM room_photos');
  rooms = (await call(api, 'GET', '/admin/overview', { token })).json.floors[0].rooms;
  assert.ok(rooms.length >= 2);
});

test('envio exige sessão; sem foto a rota pública dá 404', async () => {
  const img = await jpeg(200, 100);
  assert.equal((await put(`/admin/rooms/${rooms[0].id}/photo`, img, 'image/jpeg', '')).status, 401);
  assert.equal((await fetch(`${api}/rooms/${rooms[0].id}/photo`)).status, 404);
  assert.equal((await fetch(`${api}/rooms/nao-uuid/photo`)).status, 404);
});

test('foto grande com GPS: reduzida a 1280 px, WebP, sem metadados; servida com cache e 304', async () => {
  const big = await jpeg(3000, 2000, (s) => s.withExif({ IFD0: { Make: 'CameraXYZ' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '1/1 2/1 3/1' } }));
  assert.ok((await sharp(big).metadata()).exif, 'a imagem de teste tem EXIF');
  const up = await put(`/admin/rooms/${rooms[0].id}/photo`, big, 'image/jpeg');
  assert.equal(up.status, 200);
  assert.equal(up.json.width, 1280);
  assert.equal(up.json.height, 853);
  assert.ok(up.json.bytes < big.length);

  const pub = await fetch(`${api}/rooms/${rooms[0].id}/photo?v=${up.json.photoVersion}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('content-type'), 'image/webp');
  assert.equal(pub.headers.get('x-content-type-options'), 'nosniff');
  assert.match(pub.headers.get('cache-control')!, /max-age=86400/);
  const bytes = Buffer.from(await pub.arrayBuffer());
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 1280);
  assert.equal(meta.exif, undefined, 'metadados (GPS, câmera) removidos');

  const again = await fetch(`${api}/rooms/${rooms[0].id}/photo`, { headers: { 'if-none-match': pub.headers.get('etag')! } });
  assert.equal(again.status, 304);
});

test('respeita a orientação do EXIF (foto de celular em pé)', async () => {
  const portrait = await jpeg(400, 200, (s) => s.withMetadata({ orientation: 6 }));
  const up = await put(`/admin/rooms/${rooms[1].id}/photo`, portrait, 'image/jpeg');
  assert.equal(up.status, 200);
  assert.equal(up.json.width, 200);
  assert.equal(up.json.height, 400);
});

test('mapa público e visão geral informam quais ambientes têm foto', async () => {
  const map = (await call(api, 'GET', '/map')).json.floors[0].rooms;
  assert.equal(typeof map.find((r: any) => r.id === rooms[0].id).photoVersion, 'number');
  assert.equal(map.find((r: any) => r.id === rooms[2].id).photoVersion, null);
  const ov = (await call(api, 'GET', '/admin/overview', { token })).json.floors[0].rooms;
  assert.equal(typeof ov.find((r: any) => r.id === rooms[1].id).photoVersion, 'number');

  const before = map.find((r: any) => r.id === rooms[0].id).photoVersion;
  await new Promise((r) => setTimeout(r, 15));
  await put(`/admin/rooms/${rooms[0].id}/photo`, await jpeg(300, 300), 'image/jpeg');
  const after = (await call(api, 'GET', '/map')).json.floors[0].rooms.find((r: any) => r.id === rooms[0].id).photoVersion;
  assert.ok(after > before, 'trocar a foto muda a versão (quebra o cache)');
});

test('arquivos inválidos são recusados', async () => {
  const id = rooms[2].id;
  const text = await put(`/admin/rooms/${id}/photo`, 'isto não é uma imagem', 'image/jpeg');
  assert.equal(text.status, 415);
  assert.equal(text.json.code, 'PHOTO_INVALID');
  const svg = await put(`/admin/rooms/${id}/photo`, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml');
  assert.equal(svg.status, 415);
  const svgAsPng = await put(`/admin/rooms/${id}/photo`, '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/png');
  assert.equal(svgAsPng.status, 415);
  const gif = await put(`/admin/rooms/${id}/photo`, await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).gif().toBuffer(), 'image/png');
  assert.equal(gif.status, 415, 'GIF com cabeçalho de PNG é recusado pelo conteúdo');
  const empty = await put(`/admin/rooms/${id}/photo`, Buffer.alloc(0), 'image/jpeg');
  assert.equal(empty.status, 415);
  const huge = await put(`/admin/rooms/${id}/photo`, Buffer.alloc(13 * 1024 * 1024, 1), 'image/jpeg');
  assert.equal(huge.status, 413);
  assert.equal(huge.json.code, 'TOO_LARGE');
  assert.equal((await put('/admin/rooms/11111111-1111-1111-1111-111111111111/photo', await jpeg(50, 50), 'image/jpeg')).status, 404);
  assert.equal((await put('/admin/rooms/xyz/photo', await jpeg(50, 50), 'image/jpeg')).status, 404);
  assert.equal((await fetch(`${api}/rooms/${id}/photo`)).status, 404, 'nada foi gravado');
});

test('remover foto: some do mapa e da rota pública; remover de novo é inofensivo; histórico registra', async () => {
  const del = await call(api, 'DELETE', `/admin/rooms/${rooms[0].id}/photo`, { token });
  assert.equal(del.json.removed, true);
  assert.equal((await fetch(`${api}/rooms/${rooms[0].id}/photo`)).status, 404);
  assert.equal((await call(api, 'GET', '/map')).json.floors[0].rooms.find((r: any) => r.id === rooms[0].id).photoVersion, null);
  assert.equal((await call(api, 'DELETE', `/admin/rooms/${rooms[0].id}/photo`, { token })).json.removed, false);
  assert.equal((await fetch(`${api}/rooms/${rooms[1].id}/photo`)).status, 200, 'a foto de outro ambiente continua');
  assert.equal((await call(api, 'DELETE', `/admin/rooms/${rooms[0].id}/photo`, { token: '' })).status, 401);
  const log = (await call(api, 'GET', '/admin/audit', { token })).json.items.map((i: any) => i.action);
  assert.ok(log.includes('room.photo.set') && log.includes('room.photo.delete'));
});

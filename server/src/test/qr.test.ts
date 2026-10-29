import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveManualCode, deriveToken, extractToken, formatManualCode, hashManualCode, hashToken,
  normalizeManualCode,
} from '../services/qr.js';

const S = 'segredo-qr-de-teste-123456';
const ROOM = '11111111-1111-1111-1111-111111111111';

test('token e código manual são determinísticos e dependem de sala, versão e segredo', () => {
  assert.equal(deriveToken(S, ROOM, 1), deriveToken(S, ROOM, 1));
  assert.notEqual(deriveToken(S, ROOM, 1), deriveToken(S, ROOM, 2));
  assert.notEqual(deriveToken(S, ROOM, 1), deriveToken('outro-segredo-1234567', ROOM, 1));
  assert.notEqual(deriveToken(S, ROOM, 1), deriveToken(S, '22222222-2222-2222-2222-222222222222', 1));
  assert.match(deriveToken(S, ROOM, 1), /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(deriveManualCode(S, ROOM, 1), deriveManualCode(S, ROOM, 2));
});

test('código manual: 8 caracteres sem símbolos ambíguos, com hífen na exibição', () => {
  for (let v = 1; v <= 200; v++) {
    const code = deriveManualCode(S, ROOM, v);
    assert.match(code, /^[2-9A-HJKMNP-Z]{8}$/);
    assert.ok(!/[01OIL]/.test(code));
  }
  const code = deriveManualCode(S, ROOM, 1);
  assert.match(formatManualCode(code), /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test('normalização do código digitado', () => {
  const code = deriveManualCode(S, ROOM, 1);
  const shown = formatManualCode(code);
  assert.equal(normalizeManualCode(shown), code);
  assert.equal(normalizeManualCode(shown.toLowerCase().replace('-', '  ')), code);
  assert.equal(normalizeManualCode('ABC'), null);
  assert.equal(normalizeManualCode('0000-0000'), null);
});

test('extrai o token da URL do QR ou do texto puro', () => {
  const t = deriveToken(S, ROOM, 1);
  assert.equal(extractToken(`https://nexo.exemplo.com/q/${t}`), t);
  assert.equal(extractToken(`http://127.0.0.1:5173/q/${t}?x=1`), t);
  assert.equal(extractToken(`  ${t}  `), t);
  assert.equal(extractToken('https://exemplo.com/outra-coisa'), null);
  assert.equal(extractToken('curto'), null);
  assert.equal(extractToken(`https://x/q/${t}extra-longo-demais`), null);
});

test('hashes são estáveis e distintos', () => {
  const t = deriveToken(S, ROOM, 1);
  assert.equal(hashToken(t), hashToken(t));
  assert.equal(hashToken(t).length, 64);
  const code = deriveManualCode(S, ROOM, 1);
  assert.notEqual(hashManualCode(S, ROOM, code), hashManualCode(S, ROOM, deriveManualCode(S, ROOM, 2)));
});

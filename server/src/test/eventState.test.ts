import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeEventState, type EventRow } from '../services/eventState.js';

const base: EventRow = { status: 'draft', test_mode: false, starts_at: null, ends_at: null };
const at = (iso: string) => new Date(iso);

test('rascunho sem datas: cadastro liberado, visitas bloqueadas', () => {
  const s = computeEventState(base);
  assert.deepEqual(s, { phase: 'before_open', registrationAllowed: true, visitsAllowed: false });
});

test('modo de teste libera visitas antes da abertura', () => {
  const s = computeEventState({ ...base, test_mode: true });
  assert.equal(s.phase, 'before_open');
  assert.equal(s.visitsAllowed, true);
});

test('status active abre o evento (antecipar)', () => {
  const s = computeEventState({ ...base, status: 'active' });
  assert.equal(s.phase, 'open');
  assert.equal(s.visitsAllowed, true);
});

test('abre sozinho ao passar starts_at e encerra ao passar ends_at', () => {
  const ev: EventRow = {
    ...base,
    status: 'scheduled',
    starts_at: at('2026-11-07T11:00:00Z'),
    ends_at: at('2026-11-07T21:00:00Z'),
  };
  assert.equal(computeEventState(ev, at('2026-11-07T10:59:59Z')).phase, 'before_open');
  assert.equal(computeEventState(ev, at('2026-11-07T11:00:00Z')).phase, 'open');
  const end = computeEventState(ev, at('2026-11-07T21:00:00Z'));
  assert.deepEqual(end, { phase: 'ended', registrationAllowed: false, visitsAllowed: false });
});

test('interrompido bloqueia visitas, mas mantém o cadastro', () => {
  const s = computeEventState({ ...base, status: 'paused', test_mode: true });
  assert.deepEqual(s, { phase: 'paused', registrationAllowed: true, visitsAllowed: false });
});

test('encerrado manualmente bloqueia tudo, mesmo em modo de teste', () => {
  const s = computeEventState({ ...base, status: 'ended', test_mode: true });
  assert.deepEqual(s, { phase: 'ended', registrationAllowed: false, visitsAllowed: false });
});

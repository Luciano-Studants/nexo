import { describe, expect, it } from 'vitest';

import { FLOOR_PLANS, doorPath } from '../floorplans';
import { validateFullName } from '../components/Entry';

// Mesmos ids da semente do banco (server/seeds), por piso.
const SEED: Record<number, string[]> = {
  1: ['tecnicas-radiologicas', 'laboratorio-anatomia', 'laboratorio-enfermagem', 'direcao', 'laboratorio-multidisciplinar', 'biblioteca', 'a-nomear-topo-direita'],
  2: ['sala-201', 'sala-202', 'circuitos', 'laboratorio-desenvolvimento', 'programacao-1', 'sala-de-jogos', 'imagem', 'laboratorio-desenvolvimento-internet', 'infraestrutura', 'programacao-2'],
  3: ['sala-301', 'sala-302', 'sala-303', 'sala-304', 'sala-305', 'sala-306', 'sala-300', 'nde-e-cpa', 'sala-de-ti', 'auditorio', 'laboratorio-fisica', 'sala-dos-professores'],
};

describe('plantas', () => {
  it.each(FLOOR_PLANS)('$title: ambientes batem com o banco', (plan) => {
    const slugs = plan.cells.filter((c) => c.kind === 'room').map((c) => c.slug).sort();
    expect(slugs).toEqual([...SEED[plan.order]!].sort());
  });

  it.each(FLOOR_PLANS)('$title: nada fora dos limites nem sobreposto', (plan) => {
    for (const c of plan.cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(plan.width);
      expect(c.y + c.h).toBeLessThanOrEqual(plan.height);
    }
    for (let i = 0; i < plan.cells.length; i++) {
      for (let j = i + 1; j < plan.cells.length; j++) {
        const a = plan.cells[i]!, b = plan.cells[j]!;
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapX > 0 && overlapY > 0, `${a.id} x ${b.id}`).toBe(false);
      }
    }
  });

  it('ids de células são únicos e são 29 ambientes no total', () => {
    const ids = FLOOR_PLANS.flatMap((p) => p.cells.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(FLOOR_PLANS.flatMap((p) => p.cells.filter((c) => c.kind === 'room')).length).toBe(29);
  });

  it('caminho de porta é válido', () => {
    expect(doorPath({ x: 10, y: 20, s: 1, v: 'down' }, 5)).toBe('M 10 20 L 15 20 A 5 5 0 0 1 10 25');
    expect(doorPath({ x: 10, y: 20, s: -1, v: 'down' }, 5)).toBe('M 10 20 L 5 20 A 5 5 0 0 0 10 25');
  });
});

describe('nome completo', () => {
  it.each(['', 'Maria', ' Ma ', 'J K', '12345 6789', 'Maria 123'])('rejeita "%s"', (v) => {
    expect(validateFullName(v)).not.toBeNull();
  });
  it.each(['Maria da Silva', 'João Álvares', "Ana D'Ávila", 'José-Carlos Souza Jr.'])('aceita "%s"', (v) => {
    expect(validateFullName(v)).toBeNull();
  });
});

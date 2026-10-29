import { describe, expect, it } from 'vitest';

import { puzzleTiles, revealOrder } from '../puzzle';

describe('puzzleTiles', () => {
  it('devolve exatamente N peças que cobrem o quadro sem sobras nem sobreposição', () => {
    for (let n = 1; n <= 40; n++) {
      const tiles = puzzleTiles(n);
      expect(tiles).toHaveLength(n);
      const area = tiles.reduce((a, t) => a + t.w * t.h, 0);
      expect(area).toBeCloseTo(1, 9);
      for (const t of tiles) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x + t.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(t.y + t.h).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
  it('N inválido não gera peças', () => {
    expect(puzzleTiles(0)).toEqual([]);
    expect(puzzleTiles(-3)).toEqual([]);
    expect(puzzleTiles(2.5)).toEqual([]);
  });
});

describe('revealOrder', () => {
  it('é uma permutação estável', () => {
    for (const n of [1, 2, 7, 14, 29]) {
      const a = revealOrder(n);
      expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(revealOrder(n)).toEqual(a);
    }
  });
});

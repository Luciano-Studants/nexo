// Divisão da ilustração em N peças retangulares (N = ambientes obrigatórios ativos).
// As peças ocupam o quadro inteiro, sem sobras, para qualquer N ≥ 1: as linhas recebem
// quantidades de peças que diferem em no máximo 1, e cada linha reparte a largura igualmente.

export type Tile = { x: number; y: number; w: number; h: number };

export function puzzleTiles(n: number, aspect = 4 / 3): Tile[] {
  if (!Number.isInteger(n) || n < 1) return [];
  const cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const base = Math.floor(n / rows);
  const extra = n % rows;
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    const count = base + (r < extra ? 1 : 0);
    for (let c = 0; c < count; c++) {
      tiles.push({ x: c / count, y: r / rows, w: 1 / count, h: 1 / rows });
    }
  }
  return tiles;
}

// Ordem de revelação: a k-ésima sala obrigatória libera a peça perm[k]. Fixa para um mesmo N,
// então a imagem não "pula" entre aparelhos ou recargas.
export function revealOrder(n: number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  let s = (n * 2654435761) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

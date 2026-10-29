import { Lock } from 'lucide-react';

import { puzzleTiles, revealOrder } from '../puzzle';

// Ilustração padrão; para trocar, substitua public/puzzle.svg (mantenha a proporção 4:3).
export const PUZZLE_SRC = `${import.meta.env.BASE_URL}puzzle.svg`;
const VW = 800;
const VH = 600;

type Props = {
  // Um item por ambiente obrigatório, na ordem do servidor (piso, número, nome).
  visited: boolean[];
  completed: boolean;
};

export function Collection({ visited, completed }: Props) {
  const n = visited.length;
  const tiles = puzzleTiles(n, VW / VH);
  const order = revealOrder(n);
  // tileUnlocked[i] = a peça i já foi liberada pela sala cuja posição é k, com order[k] = i.
  const unlocked = new Array<boolean>(n).fill(false);
  visited.forEach((v, k) => {
    if (v) unlocked[order[k]] = true;
  });
  const count = unlocked.filter(Boolean).length;

  return (
    <svg
      className={`collection${completed ? ' is-complete' : ''}`}
      viewBox={`0 0 ${VW} ${VH}`}
      role="img"
      aria-label={
        completed
          ? 'Ilustração completa revelada'
          : `Ilustração com ${count} de ${n} peças reveladas`
      }
    >
      <defs>
        {tiles.map((t, i) => (
          <clipPath id={`tile-${i}`} key={i}>
            <rect x={t.x * VW} y={t.y * VH} width={t.w * VW} height={t.h * VH} />
          </clipPath>
        ))}
      </defs>
      <rect width={VW} height={VH} className="col-bg" />
      {completed && <image href={PUZZLE_SRC} width={VW} height={VH} preserveAspectRatio="none" />}
      {!completed && tiles.map((t, i) => {
        const x = t.x * VW;
        const y = t.y * VH;
        const w = t.w * VW;
        const h = t.h * VH;
        const on = unlocked[i];
        return (
          <g key={i}>
            {on ? (
              <image href={PUZZLE_SRC} width={VW} height={VH} clipPath={`url(#tile-${i})`} preserveAspectRatio="none" />
            ) : (
              <>
                <rect x={x} y={y} width={w} height={h} className="col-locked" />
                <g transform={`translate(${x + w / 2 - 11} ${y + h / 2 - 11})`} className="col-lock">
                  <Lock size={22} aria-hidden="true" />
                </g>
              </>
            )}
            <rect x={x} y={y} width={w} height={h} className="col-edge" />
          </g>
        );
      })}
      {completed && <rect x="2" y="2" width={VW - 4} height={VH - 4} className="col-frame" />}
    </svg>
  );
}

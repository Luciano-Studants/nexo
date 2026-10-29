import type { KeyboardEvent } from 'react';

import { doorPath, type FloorPlan } from '../floorplans';
import type { AdminRoom } from './adminApi';

type Props = {
  plan: FloorPlan;
  rooms: Map<string, AdminRoom>;
  selectedId: string | null;
  onSelect: (room: AdminRoom) => void;
};

// Planta 2D para a equipe: cada ambiente mostra se já tem foto (verde + câmera) ou se falta (branco).
export function PhotoMap({ plan, rooms, selectedId, onSelect }: Props) {
  const size = plan.fontSize;
  return (
    <svg
      className="ad-photomap"
      viewBox={`-6 -6 ${plan.width + 12} ${plan.height + (plan.entrance ? 40 : 12)}`}
      role="group"
      aria-label={`Planta do ${plan.title}`}
    >
      {plan.cells.map((cell) => {
        const lineH = size * 1.25;
        const cx = cell.x + cell.w / 2;
        const startY = cell.y + cell.h / 2 - ((cell.label.length - 1) * lineH) / 2;
        const text = (
          <text x={cx} y={startY} textAnchor="middle" dominantBaseline="central" fontSize={cell.kind === 'structure' ? size * 0.8 : size}>
            {cell.label.map((line, i) => (
              <tspan key={i} x={cx} dy={i === 0 ? 0 : lineH}>{line}</tspan>
            ))}
          </text>
        );
        if (cell.kind === 'structure') {
          return (
            <g key={cell.id} aria-hidden="true" className="pm-cell pm-structure">
              <rect x={cell.x} y={cell.y} width={cell.w} height={cell.h} />
              {text}
            </g>
          );
        }
        const room = cell.slug ? rooms.get(cell.slug) : undefined;
        const has = room?.photoVersion != null;
        const pick = () => room && onSelect(room);
        const onKey = (e: KeyboardEvent<SVGGElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        };
        const cls = `pm-cell pm-room ${has ? 'has-photo' : 'no-photo'}${room && !room.active ? ' is-off' : ''}${room?.id === selectedId ? ' is-selected' : ''}`;
        return (
          <g
            key={cell.id}
            className={cls}
            role={room ? 'button' : undefined}
            tabIndex={room ? 0 : undefined}
            aria-pressed={room ? room.id === selectedId : undefined}
            aria-label={room ? `${room.name}, ${has ? 'com foto' : 'sem foto'}` : undefined}
            onClick={pick}
            onKeyDown={onKey}
          >
            <rect x={cell.x} y={cell.y} width={cell.w} height={cell.h} />
            {text}
            <g transform={`translate(${cell.x + cell.w / 2 - 11} ${cell.y + 6})`} aria-hidden="true" className="pm-badge">
              <circle cx="11" cy="11" r="12" />
              {has ? (
                <path d="M5.5 11.5 9.5 15.5 17 7" className="pm-check" />
              ) : (
                <g className="pm-cam">
                  <path d="M5 9h2l1.2-2h5.6L15 9h2v8H5z" />
                  <circle cx="11" cy="12.6" r="2.2" />
                </g>
              )}
            </g>
          </g>
        );
      })}
      <g aria-hidden="true" className="pm-doors">
        {plan.doors.map((d, i) => (
          <path key={i} d={doorPath(d, plan.doorRadius)} />
        ))}
      </g>
    </svg>
  );
}

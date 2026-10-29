import type { KeyboardEvent } from 'react';

import type { MapRoom } from '../api';
import { doorPath, type Cell, type FloorPlan } from '../floorplans';
import { STATE_TEXT, stateOf } from '../roomState';

type Props = {
  plan: FloorPlan;
  rooms: Map<string, MapRoom>;
  onSelect: (room: MapRoom) => void;
};

function Label({ cell, size }: { cell: Cell; size: number }) {
  const lineH = size * 1.25;
  const cx = cell.x + cell.w / 2;
  const startY = cell.y + cell.h / 2 - ((cell.label.length - 1) * lineH) / 2;
  return (
    <text x={cx} y={startY} textAnchor="middle" dominantBaseline="central" fontSize={size}>
      {cell.label.map((line, i) => (
        <tspan key={i} x={cx} dy={i === 0 ? 0 : lineH}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

export function FloorMap({ plan, rooms, onSelect }: Props) {
  const size = plan.fontSize;

  return (
    <svg
      className="floormap"
      viewBox={`-6 -6 ${plan.width + 12} ${plan.height + (plan.entrance ? 40 : 12)}`}
      role="group"
      aria-label={`Mapa do ${plan.title}`}
    >
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#E4E2D8" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#B9B6A6" strokeWidth="3" />
        </pattern>
      </defs>

      {plan.cells.map((cell) => {
        if (cell.kind === 'structure') {
          return (
            <g key={cell.id} aria-hidden="true" className="cell cell-structure">
              <rect x={cell.x} y={cell.y} width={cell.w} height={cell.h} />
              <Label cell={cell} size={size * 0.8} />
            </g>
          );
        }

        const room = cell.slug ? rooms.get(cell.slug) : undefined;
        const state = stateOf(room);
        const name = room?.name ?? cell.label.join(' ');
        const selectable = Boolean(room);

        const activate = () => room && onSelect(room);
        const onKey = (e: KeyboardEvent<SVGGElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        };

        return (
          <g
            key={cell.id}
            className={`cell cell-room is-${state}`}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
            aria-label={`${name}, ${STATE_TEXT[state]}`}
            onClick={activate}
            onKeyDown={onKey}
          >
            <rect x={cell.x} y={cell.y} width={cell.w} height={cell.h} />
            <Label cell={cell} size={size} />
            {state === 'visited' && (
              <g transform={`translate(${cell.x + cell.w - 20} ${cell.y + 6})`} aria-hidden="true">
                <circle cx="7" cy="7" r="8" className="badge-fill" />
                <path d="M3.5 7.2 6 9.7 10.7 4.6" className="badge-check" />
              </g>
            )}
            {state === 'required' && (
              <circle
                cx={cell.x + cell.w - 13}
                cy={cell.y + 13}
                r="6.5"
                className="badge-ring"
                aria-hidden="true"
              />
            )}
          </g>
        );
      })}

      <g aria-hidden="true" className="doors">
        {plan.doors.map((d, i) => (
          <path key={i} d={doorPath(d, plan.doorRadius)} className="door" />
        ))}
      </g>

      <text x={plan.corridor.x} y={plan.corridor.y} textAnchor="middle" fontSize={size * 0.75} className="corridor" aria-hidden="true">
        CORREDOR CENTRAL
      </text>

      {plan.entrance && (
        <g aria-hidden="true">
          <rect x={plan.entrance.x} y={plan.entrance.y - 3} width={plan.entrance.w} height="5" className="entrance-bar" />
          <text x={plan.entrance.x + plan.entrance.w / 2} y={plan.entrance.y + 22} textAnchor="middle" fontSize={size} className="entrance-label">
            ENTRADA
          </text>
        </g>
      )}
    </svg>
  );
}

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type { MapRoom } from '../api';
import type { Cell, FloorPlan } from '../floorplans';
import { STATE_TEXT, stateOf, type RoomState } from '../roomState';

// Vista 3D em SVG: os três pisos empilhados. O piso escolhido fica em destaque; os de cima
// "sobem" e somem; os de baixo aparecem como lajes por baixo. Projeção mais de cima que a
// isométrica clássica (S > C), melhor para celular em pé e para rótulos maiores.
const C = 0.42;
const S = 0.55;
const SLAB = 16;
const DROP = 58; // quanto cada piso abaixo aparece por baixo do escolhido
const LIFT = 220; // quanto os pisos acima sobem ao sair
const TARGET_PX = 14; // tamanho desejado do texto na tela do celular
const REF_WIDTH_PX = 340; // largura típica do mapa no celular

const HEIGHT: Record<RoomState, number> = { required: 22, visited: 14, optional: 14, unavailable: 5 };
const STRUCT_H = 6;

const proj = (x: number, y: number, z = 0): [number, number] => [(x - y) * C, (x + y) * S - z];
const pts = (list: [number, number][]) => list.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');

export type IsoFloor = { plan: FloorPlan; rooms: Map<string, MapRoom>; name: string };

type Props = {
  floors: IsoFloor[];
  selected: number; // order do piso em destaque
  onSelectRoom: (room: MapRoom, floorName: string) => void;
  onSelectFloor: (order: number) => void;
};

type Box = { minX: number; minY: number; w: number; h: number };

function floorBox(plan: FloorPlan, below: number): Box {
  const pts2 = [proj(0, 0, 44), proj(plan.width, 0, 44), proj(plan.width, plan.height, -SLAB), proj(0, plan.height, -SLAB)];
  const minX = Math.min(...pts2.map((p) => p[0])) - 12;
  const maxX = Math.max(...pts2.map((p) => p[0])) + 12;
  const minY = Math.min(...pts2.map((p) => p[1])) - 12;
  const maxY = Math.max(...pts2.map((p) => p[1])) + 40 + below * DROP;
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

function Prism({ x, y, w, h, z, z0 = 0 }: { x: number; y: number; w: number; h: number; z: number; z0?: number }) {
  const top = pts([proj(x, y, z), proj(x + w, y, z), proj(x + w, y + h, z), proj(x, y + h, z)]);
  const right = pts([proj(x + w, y, z), proj(x + w, y + h, z), proj(x + w, y + h, z0), proj(x + w, y, z0)]);
  const left = pts([proj(x, y + h, z), proj(x + w, y + h, z), proj(x + w, y + h, z0), proj(x, y + h, z0)]);
  return (
    <>
      <polygon className="iso-l" points={left} />
      <polygon className="iso-r" points={right} />
      <polygon className="iso-t" points={top} />
    </>
  );
}

// Tamanho do texto de uma sala: o desejado, reduzido só se não couber no topo do bloco.
function fitSize(cell: Cell, wanted: number): number {
  const widest = Math.max(...cell.label.map((l) => l.length));
  const available = (cell.w + cell.h) * C * 0.9;
  return Math.max(wanted * 0.78, Math.min(wanted, available / (widest * 0.55)));
}

function IsoLabel({ cell, z, size, cls }: { cell: Cell; z: number; size: number; cls?: string }) {
  const [cx, cy] = proj(cell.x + cell.w / 2, cell.y + cell.h / 2, z);
  const lineH = size * 1.18;
  const startY = cy - ((cell.label.length - 1) * lineH) / 2;
  return (
    <text x={cx} y={startY} textAnchor="middle" dominantBaseline="central" fontSize={size} className={cls}>
      {cell.label.map((line, i) => (
        <tspan key={i} x={cx} dy={i === 0 ? 0 : lineH}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function FloorDetail({
  floor, active, labelSize, onSelectRoom,
}: { floor: IsoFloor; active: boolean; labelSize: number; onSelectRoom: Props['onSelectRoom'] }) {
  const { plan, rooms } = floor;
  const H = plan.height;
  const cells = useMemo(
    () => [...plan.cells].sort((a, b) => a.x + a.w / 2 + a.y + a.h / 2 - (b.x + b.w / 2 + b.y + b.h / 2)),
    [plan],
  );

  return (
    <>
      {cells.map((cell) => {
        if (cell.kind === 'structure') {
          return (
            <g key={cell.id} aria-hidden="true" className="iso-cell iso-structure">
              <Prism x={cell.x} y={cell.y} w={cell.w} h={cell.h} z={STRUCT_H} />
            </g>
          );
        }
        const room = cell.slug ? rooms.get(cell.slug) : undefined;
        const state = stateOf(room);
        const name = room?.name ?? cell.label.join(' ');
        const activate = () => room && onSelectRoom(room, floor.name);
        const onKey = (e: KeyboardEvent<SVGGElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        };
        const selectable = active && Boolean(room);
        return (
          <g
            key={cell.id}
            className={`iso-cell iso-room is-${state}`}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
            aria-label={selectable ? `${name}, ${STATE_TEXT[state]}` : undefined}
            onClick={activate}
            onKeyDown={onKey}
          >
            <g className="iso-lift">
              <Prism x={cell.x} y={cell.y} w={cell.w} h={cell.h} z={HEIGHT[state]} />
            </g>
          </g>
        );
      })}

      {/* Rótulos e selos acima de todos os blocos, para nenhum ficar escondido por um vizinho mais alto. */}
      <g aria-hidden="true" className="iso-labels">
        {cells.map((cell) => {
          if (cell.kind === 'structure') {
            const narrow = cell.w < 60;
            return (
              <IsoLabel
                key={cell.id}
                cell={narrow ? { ...cell, label: cell.label.slice(0, 1) } : cell}
                z={STRUCT_H}
                size={labelSize * (narrow ? 0.62 : 0.78)}
                cls="iso-lbl-struct"
              />
            );
          }
          const room = cell.slug ? rooms.get(cell.slug) : undefined;
          const state = stateOf(room);
          const z = HEIGHT[state];
          const [bx, by] = proj(cell.x + cell.w - 14, cell.y + 14, z);
          return (
            <g key={cell.id}>
              <IsoLabel cell={cell} z={z} size={fitSize(cell, labelSize)} cls={state === 'unavailable' ? 'iso-lbl-off' : ''} />
              {state === 'visited' && (
                <g transform={`translate(${bx - 9} ${by - 9})`}>
                  <circle cx="9" cy="9" r="10" className="badge-fill" />
                  <path d="M4.5 9.2 8 12.6 13.8 6.2" className="badge-check" />
                </g>
              )}
              {state === 'required' && <circle cx={bx} cy={by} r="8" className="badge-ring" />}
            </g>
          );
        })}
      </g>

      {plan.entrance && (
        <g aria-hidden="true">
          <polygon
            className="iso-entrance"
            points={pts([
              proj(plan.entrance.x, H, 0),
              proj(plan.entrance.x + plan.entrance.w, H, 0),
              proj(plan.entrance.x + plan.entrance.w, H + 14, 0),
              proj(plan.entrance.x, H + 14, 0),
            ])}
          />
          <text
            x={proj(plan.entrance.x + plan.entrance.w / 2, H + 14, -SLAB)[0]}
            y={proj(plan.entrance.x + plan.entrance.w / 2, H + 14, -SLAB)[1] + 24}
            textAnchor="middle"
            fontSize={labelSize * 0.8}
            className="entrance-label"
          >
            ENTRADA
          </text>
        </g>
      )}
    </>
  );
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function IsoStack({ floors, selected, onSelectRoom, onSelectFloor }: Props) {
  const current = floors.find((f) => f.plan.order === selected) ?? floors[0]!;
  const lowest = Math.min(...floors.map((f) => f.plan.order));
  const target = useMemo(() => floorBox(current.plan, current.plan.order - lowest), [current, lowest]);

  // O enquadramento acompanha o piso escolhido (zoom suave), para o piso sempre ocupar a largura.
  const [vb, setVb] = useState<Box>(target);
  const vbRef = useRef<Box>(target);
  useEffect(() => {
    const from = vbRef.current;
    if (reduced()) {
      vbRef.current = target;
      setVb(target);
      return;
    }
    const start = performance.now();
    const dur = 520;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const next = {
        minX: from.minX + (target.minX - from.minX) * e,
        minY: from.minY + (target.minY - from.minY) * e,
        w: from.w + (target.w - from.w) * e,
        h: from.h + (target.h - from.h) * e,
      };
      vbRef.current = next;
      setVb(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const labelSize = Math.min(32, Math.max(19, (TARGET_PX * target.w) / REF_WIDTH_PX));

  return (
    <svg
      className="isomap"
      viewBox={`${vb.minX.toFixed(1)} ${vb.minY.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`}
      role="group"
      aria-label={`Mapa em 3D do ${current.plan.title}`}
    >
      <defs>
        <pattern id="hatch-iso" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#E4E2D8" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="#B9B6A6" strokeWidth="3" />
        </pattern>
      </defs>

      {[...floors].sort((a, b) => a.plan.order - b.plan.order).map((floor) => {
        const o = floor.plan.order;
        const state = o === selected ? 'is-current' : o < selected ? 'is-below' : 'is-above';
        const dy = o === selected ? 0 : o < selected ? (selected - o) * DROP : -(o - selected) * LIFT;
        return (
          <g key={o} className={`iso-floor ${state}`} style={{ transform: `translateY(${dy}px)` }}>
            <g aria-hidden="true" className="iso-slab">
              <Prism x={0} y={0} w={floor.plan.width} h={floor.plan.height} z={0} z0={-SLAB} />
            </g>
            {state === 'is-below' && (
              <g className="iso-ghost-hit" aria-hidden="true" onClick={() => onSelectFloor(o)}>
                <polygon className="iso-ghost-area" points={pts([proj(0, floor.plan.height, -SLAB), proj(floor.plan.width, floor.plan.height, -SLAB), proj(floor.plan.width, floor.plan.height, 0), proj(0, floor.plan.height, 0)])} />
              </g>
            )}
            <g className="iso-detail" aria-hidden={o === selected ? undefined : true}>
              <FloorDetail floor={floor} active={o === selected} labelSize={labelSize} onSelectRoom={onSelectRoom} />
            </g>
          </g>
        );
      })}

      {/* Etiquetas dos pisos de baixo, fixas na base da tela: tocar leva ao piso. */}
      {floors
        .filter((f) => f.plan.order < selected)
        .sort((a, b) => b.plan.order - a.plan.order)
        .map((f, k) => {
          const h = labelSize * 1.7;
          const w = labelSize * 5.2;
          const x = vb.minX + 10;
          const y = vb.minY + vb.h - 10 - h - k * (h + 8);
          const go = () => onSelectFloor(f.plan.order);
          return (
            <g
              key={f.plan.order}
              className="iso-tag"
              role="button"
              tabIndex={0}
              aria-label={`Ver ${f.plan.title}`}
              onClick={go}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  go();
                }
              }}
            >
              <rect x={x} y={y} width={w} height={h} rx={h / 2} />
              <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central" fontSize={labelSize * 0.85}>
                {f.plan.title}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

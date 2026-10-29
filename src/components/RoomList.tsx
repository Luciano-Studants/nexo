import { Check, Circle, Lock } from 'lucide-react';

import type { MapFloor, MapRoom } from '../api';
import { STATE_SHORT, roomTitle, stateOf } from '../roomState';

// Lista alternativa ao mapa: todos os ambientes, por piso e por número/nome.
export function RoomList({ floors, onSelect }: { floors: MapFloor[]; onSelect: (room: MapRoom, floor: MapFloor) => void }) {
  return (
    <div className="roomlist">
      {floors.map((floor) => (
        <section key={floor.id} aria-labelledby={`floor-${floor.id}`}>
          <h3 id={`floor-${floor.id}`}>{floor.name}</h3>
          <ul>
            {floor.rooms.map((room) => {
              const state = stateOf(room);
              const Icon = state === 'visited' ? Check : state === 'unavailable' ? Lock : Circle;
              return (
                <li key={room.id}>
                  <button type="button" className="roomlist-item" onClick={() => onSelect(room, floor)}>
                    <span className="roomlist-name">{roomTitle(room)}</span>
                    <span className={`state-chip is-${state}`}>
                      <Icon size={14} aria-hidden="true" />
                      {STATE_SHORT[state]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

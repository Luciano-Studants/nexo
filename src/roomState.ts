import type { MapRoom } from './api';

export type RoomState = 'unavailable' | 'visited' | 'required' | 'optional';

export function stateOf(room: MapRoom | undefined): RoomState {
  if (!room || !room.available) return 'unavailable';
  if (room.visited) return 'visited';
  if (room.required) return 'required';
  return 'optional';
}

// Texto completo (leitor de tela e detalhe da sala).
export const STATE_TEXT: Record<RoomState, string> = {
  unavailable: 'indisponível no evento',
  visited: 'visitado',
  required: 'obrigatório, ainda não visitado',
  optional: 'não visitado',
};

// Texto curto (lista e etiquetas).
export const STATE_SHORT: Record<RoomState, string> = {
  unavailable: 'Indisponível',
  visited: 'Visitado',
  required: 'Pendente',
  optional: 'Opcional',
};

export function roomTitle(room: MapRoom): string {
  return room.number && !room.name.includes(room.number) ? `${room.name} (${room.number})` : room.name;
}

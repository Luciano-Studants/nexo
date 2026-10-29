import { db } from '../db.js';

export type ProgressData = {
  requiredCount: number;
  visitedCount: number;
  // Zero ambientes obrigatórios é erro de configuração, nunca "concluído".
  configurationError: boolean;
  completed: boolean;
};

// Só contam ambientes obrigatórios, ativos e em pisos ativos.
export async function getProgress(eventId: string, participantId: string): Promise<ProgressData> {
  const { rows } = await db.query<{ required: number; visited: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM rooms r JOIN floors f ON f.id = r.floor_id
         WHERE f.event_id = $1 AND f.active AND r.active AND r.is_required) AS required,
       (SELECT COUNT(*)::int FROM visits v JOIN rooms r ON r.id = v.room_id
          JOIN floors f ON f.id = r.floor_id
         WHERE v.participant_id = $2 AND f.active AND r.active AND r.is_required) AS visited`,
    [eventId, participantId],
  );
  const { required, visited } = rows[0]!;
  return {
    requiredCount: required,
    visitedCount: visited,
    configurationError: required === 0,
    completed: required > 0 && visited >= required,
  };
}

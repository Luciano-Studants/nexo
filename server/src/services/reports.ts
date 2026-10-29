import { db } from '../db.js';

const TZ = 'America/Sao_Paulo';

export type FloorRow = {
  floor: string; order: number; rooms: number; activeRooms: number; requiredRooms: number;
  visits: number; uniqueVisitors: number; reachPct: number; avgPerRoom: number;
};
export type RoomRow = {
  rank: number; floor: string; number: string | null; name: string; required: boolean; active: boolean;
  visits: number; reachPct: number; firstVisit: Date | null; lastVisit: Date | null;
};
export type ParticipantRow = {
  name: string; createdAt: Date; lastSeenAt: Date; visits: number; requiredVisited: number;
  progressPct: number; completed: boolean; completedAt: Date | null;
};
export type Report = {
  generatedAt: Date;
  event: { name: string; edition: string | null; startsAt: Date | null; endsAt: Date | null; status: string; timezone: string };
  summary: {
    participants: number; withVisit: number; withoutVisit: number; completed: number; completionPct: number;
    visits: number; avgVisits: number; avgProgressPct: number; requiredRooms: number; activeRooms: number;
    firstVisit: Date | null; lastVisit: Date | null;
  };
  floors: FloorRow[];
  rooms: RoomRow[];            // ordenadas do mais ao menos visitado
  mostVisited: RoomRow[];
  leastVisited: RoomRow[];
  distribution: Array<{ label: string; count: number; pct: number }>;
  hourly: Array<{ hour: string; visits: number }>;
  participants: ParticipantRow[];
  visits: Array<{ at: Date; participant: string; floor: string; room: string; required: boolean }>;
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

export async function buildReport(eventId: string): Promise<Report> {
  const [ev, floorQ, roomQ, partQ, visitQ] = await Promise.all([
    db.query(`SELECT name, edition_label, starts_at, ends_at, status, timezone FROM events WHERE id = $1`, [eventId]),
    db.query(
      `SELECT f.name, f.sort_order,
              COUNT(r.id)::int AS rooms,
              COUNT(r.id) FILTER (WHERE r.active)::int AS active_rooms,
              COUNT(r.id) FILTER (WHERE r.active AND r.is_required)::int AS required_rooms,
              (SELECT COUNT(*)::int FROM visits v JOIN rooms rr ON rr.id = v.room_id WHERE rr.floor_id = f.id) AS visits,
              (SELECT COUNT(DISTINCT v.participant_id)::int FROM visits v JOIN rooms rr ON rr.id = v.room_id WHERE rr.floor_id = f.id) AS uniq
         FROM floors f LEFT JOIN rooms r ON r.floor_id = f.id
        WHERE f.event_id = $1 GROUP BY f.id ORDER BY f.sort_order`,
      [eventId],
    ),
    db.query(
      `SELECT f.name AS floor, f.sort_order, r.room_number, r.name, r.is_required, r.active,
              COUNT(v.id)::int AS visits, MIN(v.visited_at) AS first_visit, MAX(v.visited_at) AS last_visit
         FROM rooms r JOIN floors f ON f.id = r.floor_id LEFT JOIN visits v ON v.room_id = r.id
        WHERE f.event_id = $1 GROUP BY f.id, r.id
        ORDER BY COUNT(v.id) DESC, f.sort_order, r.room_number NULLS LAST, r.name`,
      [eventId],
    ),
    db.query(
      `WITH req AS (SELECT r.id FROM rooms r JOIN floors f ON f.id = r.floor_id
                     WHERE f.event_id = $1 AND f.active AND r.active AND r.is_required),
            total AS (SELECT COUNT(*)::int AS n FROM req)
       SELECT p.full_name, p.created_at, p.last_seen_at,
              (SELECT COUNT(*)::int FROM visits v WHERE v.participant_id = p.id) AS visits,
              (SELECT COUNT(*)::int FROM visits v JOIN req ON req.id = v.room_id WHERE v.participant_id = p.id) AS req_visited,
              (SELECT n FROM total) AS req_total,
              (SELECT MAX(v.visited_at) FROM visits v JOIN req ON req.id = v.room_id WHERE v.participant_id = p.id) AS last_req
         FROM participants p WHERE p.event_id = $1 ORDER BY p.created_at`,
      [eventId],
    ),
    db.query(
      `SELECT v.visited_at, p.full_name, f.name AS floor, r.name AS room, r.is_required
         FROM visits v JOIN participants p ON p.id = v.participant_id
         JOIN rooms r ON r.id = v.room_id JOIN floors f ON f.id = r.floor_id
        WHERE p.event_id = $1 ORDER BY v.visited_at`,
      [eventId],
    ),
  ]);

  const e = ev.rows[0]!;
  const nParticipants = partQ.rows.length;

  const participants: ParticipantRow[] = partQ.rows.map((r) => {
    const completed = r.req_total > 0 && r.req_visited >= r.req_total;
    return {
      name: r.full_name, createdAt: r.created_at, lastSeenAt: r.last_seen_at, visits: r.visits,
      requiredVisited: r.req_visited, progressPct: pct(r.req_visited, r.req_total), completed,
      completedAt: completed ? r.last_req : null,
    };
  });
  const requiredRooms: number = partQ.rows[0]?.req_total ?? floorQ.rows.reduce((a, f) => a + f.required_rooms, 0);
  const completed = participants.filter((p) => p.completed).length;
  const withVisit = participants.filter((p) => p.visits > 0).length;

  const rooms: RoomRow[] = roomQ.rows.map((r, i) => ({
    rank: i + 1, floor: r.floor, number: r.room_number, name: r.name, required: r.is_required, active: r.active,
    visits: r.visits, reachPct: pct(r.visits, nParticipants), firstVisit: r.first_visit, lastVisit: r.last_visit,
  }));
  const rankable = rooms.filter((r) => r.active);

  const floors: FloorRow[] = floorQ.rows.map((f) => ({
    floor: f.name, order: f.sort_order, rooms: f.rooms, activeRooms: f.active_rooms, requiredRooms: f.required_rooms,
    visits: f.visits, uniqueVisitors: f.uniq, reachPct: pct(f.uniq, nParticipants),
    avgPerRoom: f.active_rooms > 0 ? Math.round((f.visits / f.active_rooms) * 10) / 10 : 0,
  }));

  const buckets = [
    { label: '0% (nenhum obrigatório)', test: (p: number) => p === 0 },
    { label: '1% a 25%', test: (p: number) => p > 0 && p <= 25 },
    { label: '26% a 50%', test: (p: number) => p > 25 && p <= 50 },
    { label: '51% a 75%', test: (p: number) => p > 50 && p <= 75 },
    { label: '76% a 99%', test: (p: number) => p > 75 && p < 100 },
    { label: '100% (concluiu)', test: (p: number) => p >= 100 },
  ];
  const distribution = buckets.map((b) => {
    const count = participants.filter((p) => b.test(p.progressPct)).length;
    return { label: b.label, count, pct: pct(count, nParticipants) };
  });

  const hourFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', hour12: false });
  const byHour = new Map<string, number>();
  for (const v of visitQ.rows) {
    const key = hourFmt.format(v.visited_at).replace(',', '').replace(/\s+/g, ' ') ;
    byHour.set(key, (byHour.get(key) ?? 0) + 1);
  }
  const hourly = [...byHour].map(([hour, visits]) => ({ hour: `${hour}h`, visits }));

  const times = visitQ.rows.map((v) => v.visited_at as Date);
  return {
    generatedAt: new Date(),
    event: { name: e.name, edition: e.edition_label, startsAt: e.starts_at, endsAt: e.ends_at, status: e.status, timezone: e.timezone },
    summary: {
      participants: nParticipants, withVisit, withoutVisit: nParticipants - withVisit, completed,
      completionPct: pct(completed, nParticipants), visits: visitQ.rows.length,
      avgVisits: nParticipants ? Math.round((visitQ.rows.length / nParticipants) * 10) / 10 : 0,
      avgProgressPct: nParticipants ? Math.round((participants.reduce((a, p) => a + p.progressPct, 0) / nParticipants) * 10) / 10 : 0,
      requiredRooms, activeRooms: rankable.length,
      firstVisit: times[0] ?? null, lastVisit: times[times.length - 1] ?? null,
    },
    floors, rooms,
    mostVisited: rankable.slice(0, 5),
    leastVisited: [...rankable].reverse().slice(0, 5),
    distribution, hourly, participants,
    visits: visitQ.rows.map((v) => ({ at: v.visited_at, participant: v.full_name, floor: v.floor, room: v.room, required: v.is_required })),
  };
}

export const fmtDateTime = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'medium' }).format(d) : '';

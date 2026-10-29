import { db } from '../db.js';
import type { EventRow } from './eventState.js';

export type ActiveEvent = EventRow & {
  id: string;
  name: string;
  edition_label: string | null;
  timezone: string;
};

export async function loadActiveEvent(slug: string): Promise<ActiveEvent | null> {
  const { rows } = await db.query<ActiveEvent>(
    `SELECT id, name, edition_label, timezone, status, test_mode, starts_at, ends_at
       FROM events WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

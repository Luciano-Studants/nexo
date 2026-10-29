import { db } from '../db.js';

export async function audit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
  outcome: 'success' | 'failure' = 'success',
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, outcome, details)
     VALUES ('staff', $1, $2, $3, $4, $5, $6::jsonb)`,
    [actorId, action, entityType, entityId, outcome, JSON.stringify(details)],
  );
}

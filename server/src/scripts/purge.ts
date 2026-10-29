import 'dotenv/config';

import { db } from '../db.js';

// Retenção de 30 dias (decisão do projeto). NÃO roda sozinho e NÃO exclui por padrão:
// sem --confirm apenas conta o que seria apagado. Exporte os relatórios antes de confirmar
// e valide a política com a instituição (LGPD/backups).
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 30;

async function run(): Promise<void> {
  const confirm = process.argv.includes('--confirm');

  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM participants p
         JOIN events e ON e.id = p.event_id
        WHERE e.status = 'ended'
          AND COALESCE(e.ends_at, e.updated_at) < now() - make_interval(days => $1)) AS participantes`,
    [RETENTION_DAYS],
  );
  console.log(`Participantes de eventos encerrados há mais de ${RETENTION_DAYS} dias: ${rows[0].participantes}`);

  if (!confirm) {
    console.log('Simulação. Nada foi apagado. Use --confirm para excluir.');
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const ids = `SELECT p.id FROM participants p JOIN events e ON e.id = p.event_id
                 WHERE e.status = 'ended'
                   AND COALESCE(e.ends_at, e.updated_at) < now() - make_interval(days => $1)`;
    await client.query(`DELETE FROM visits WHERE participant_id IN (${ids})`, [RETENTION_DAYS]);
    const del = await client.query(`DELETE FROM participants WHERE id IN (${ids})`, [RETENTION_DAYS]);
    await client.query(
      `INSERT INTO audit_log (actor_type, action, entity_type, details)
       VALUES ('system', 'purge', 'participants', $1::jsonb)`,
      [JSON.stringify({ removed: del.rowCount, retentionDays: RETENTION_DAYS })],
    );
    await client.query('COMMIT');
    console.log(`Excluídos: ${del.rowCount} participantes (e suas visitas).`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

run()
  .catch((error) => {
    console.error('Falha na limpeza:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.end());

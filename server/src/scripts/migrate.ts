import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../db.js';

// Executor mínimo: aplica server/migrations/*.sql em ordem, cada arquivo em uma transação,
// e registra o que já foi aplicado em schema_migrations. Use --seed para rodar server/seeds.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..', '..');

async function sqlFiles(dir: string): Promise<string[]> {
  const names = await readdir(path.join(serverRoot, dir));
  return names.filter((n) => n.endsWith('.sql')).sort();
}

async function run(): Promise<void> {
  const withSeed = process.argv.includes('--seed');

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await db.query('SELECT name FROM schema_migrations')).rows.map(
      (r: { name: string }) => r.name,
    ),
  );

  for (const file of await sqlFiles('migrations')) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(serverRoot, 'migrations', file), 'utf8');
    const client = await db.connect();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Migração aplicada: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  if (withSeed) {
    for (const file of await sqlFiles('seeds')) {
      const sql = await readFile(path.join(serverRoot, 'seeds', file), 'utf8');
      await db.query(sql);
      console.log(`Semente executada: ${file}`);
    }
  }

  console.log('Banco atualizado.');
}

run()
  .catch((error) => {
    console.error('Falha na migração:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.end());

import 'dotenv/config';

import { db } from '../db.js';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../services/adminAuth.js';

// Uso (a partir de /server). A senha vem de ADMIN_PASSWORD para não ficar no histórico do terminal:
//   ADMIN_PASSWORD='...' npm run admin -- create <usuario>
//   ADMIN_PASSWORD='...' npm run admin -- set-password <usuario>
//   npm run admin -- unlock <usuario>     (tira o bloqueio por tentativas erradas)
//   npm run admin -- disable <usuario> | enable <usuario> | list
async function main(): Promise<void> {
  const [command, username] = process.argv.slice(2);

  if (command === 'list') {
    const { rows } = await db.query('SELECT username, active, created_at FROM admin_accounts ORDER BY username');
    for (const r of rows) console.log(`${r.active ? 'ativo  ' : 'inativo'}  ${r.username}  (criado em ${r.created_at.toISOString()})`);
    if (rows.length === 0) console.log('Nenhuma conta de staff.');
    return;
  }
  if (!username || !/^[a-z0-9._-]{3,40}$/i.test(username)) {
    throw new Error('Informe um usuário de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).');
  }

  if (command === 'create' || command === 'set-password') {
    const password = process.env.ADMIN_PASSWORD ?? '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Defina ADMIN_PASSWORD com pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    const hash = await hashPassword(password);
    if (command === 'create') {
      await db.query('INSERT INTO admin_accounts (username, password_hash) VALUES ($1, $2)', [username, hash]);
      console.log(`Conta "${username}" criada.`);
    } else {
      const r = await db.query(
        'UPDATE admin_accounts SET password_hash = $2, failed_count = 0, locked_until = NULL WHERE username = $1',
        [username, hash],
      );
      if (r.rowCount === 0) throw new Error('Usuário não encontrado.');
      await db.query('DELETE FROM admin_sessions WHERE admin_id = (SELECT id FROM admin_accounts WHERE username = $1)', [username]);
      console.log(`Senha de "${username}" alterada; sessões abertas foram encerradas.`);
    }
  } else if (command === 'unlock') {
    const r = await db.query('UPDATE admin_accounts SET failed_count = 0, locked_until = NULL WHERE username = $1', [username]);
    if (r.rowCount === 0) throw new Error('Usuário não encontrado.');
    console.log(`Conta "${username}" desbloqueada.`);
  } else if (command === 'disable' || command === 'enable') {
    const r = await db.query('UPDATE admin_accounts SET active = $2 WHERE username = $1', [username, command === 'enable']);
    if (r.rowCount === 0) throw new Error('Usuário não encontrado.');
    if (command === 'disable') {
      await db.query('DELETE FROM admin_sessions WHERE admin_id = (SELECT id FROM admin_accounts WHERE username = $1)', [username]);
    }
    console.log(`Conta "${username}" ${command === 'enable' ? 'ativada' : 'desativada'}.`);
  } else {
    throw new Error('Comando inválido. Use create, set-password, unlock, disable, enable ou list.');
  }
}

main()
  .catch((error) => {
    console.error('Erro:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.end());

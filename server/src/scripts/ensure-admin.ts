import 'dotenv/config';

import { db } from '../db.js';
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from '../services/adminAuth.js';

// Usado na publicação (hospedagens sem terminal): garante que a conta do staff exista com a senha
// definida em ADMIN_USER / ADMIN_PASSWORD. Para trocar a senha, mude a variável e publique de novo.
// Se a senha já confere, nada muda (as sessões abertas continuam valendo).
async function main(): Promise<void> {
  const username = process.env.ADMIN_USER ?? '';
  const password = process.env.ADMIN_PASSWORD ?? '';

  if (!username && !password) {
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM admin_accounts WHERE active');
    console.log(rows[0].n > 0 ? 'ADMIN_USER/ADMIN_PASSWORD não definidos: contas existentes mantidas.' : 'ATENÇÃO: não há conta de staff ativa. Defina ADMIN_USER e ADMIN_PASSWORD.');
    return;
  }
  if (!/^[a-z0-9._-]{3,40}$/i.test(username)) throw new Error('ADMIN_USER inválido: use de 3 a 40 letras, números, ponto, hífen ou sublinhado.');
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`ADMIN_PASSWORD precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);

  const { rows } = await db.query('SELECT id, password_hash FROM admin_accounts WHERE username = $1', [username]);
  if (rows.length === 0) {
    await db.query('INSERT INTO admin_accounts (username, password_hash) VALUES ($1, $2)', [username, await hashPassword(password)]);
    console.log(`Conta de staff "${username}" criada.`);
  } else if (!(await verifyPassword(password, rows[0].password_hash))) {
    await db.query('UPDATE admin_accounts SET password_hash = $2, failed_count = 0, locked_until = NULL WHERE username = $1', [username, await hashPassword(password)]);
    await db.query('DELETE FROM admin_sessions WHERE admin_id = $1', [rows[0].id]);
    console.log(`Senha de "${username}" atualizada; sessões abertas foram encerradas.`);
  } else {
    console.log(`Conta de staff "${username}" já está com a senha configurada.`);
  }
}

main()
  .catch((error) => {
    console.error('Falha ao preparar a conta de staff:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.end());

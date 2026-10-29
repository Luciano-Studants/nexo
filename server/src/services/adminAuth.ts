import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type BinaryLike } from 'node:crypto';

import { db } from '../db.js';

// Senhas com scrypt (nativo do Node, sem dependência extra). Formato: scrypt$N$salt$hash (base64url).
const N = 16384;
const KEYLEN = 64;

function scrypt(password: string, salt: BinaryLike, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, KEYLEN, { N: n, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N);
  return `scrypt$${N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, nRaw, saltRaw, keyRaw] = stored.split('$');
  const n = Number(nRaw);
  if (alg !== 'scrypt' || !Number.isInteger(n) || !saltRaw || !keyRaw) return false;
  const expected = Buffer.from(keyRaw, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltRaw, 'base64url'), n);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Hash fictício para gastar o mesmo tempo quando o usuário não existe.
const DUMMY = await hashPassword('senha-ficticia-para-igualar-tempo');

export const SESSION_IDLE_MINUTES = 30;
export const SESSION_MAX_HOURS = 12;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export type AdminSession = { adminId: string; username: string };

export type LoginResult =
  | { ok: true; token: string; username: string; adminId: string }
  | { ok: false; reason: 'invalid' | 'locked'; retryAfterSeconds?: number; adminId?: string };

export async function login(username: string, password: string): Promise<LoginResult> {
  const { rows } = await db.query<{
    id: string; password_hash: string; active: boolean; failed_count: number; locked_until: Date | null;
  }>('SELECT id, password_hash, active, failed_count, locked_until FROM admin_accounts WHERE username = $1', [username]);
  const account = rows[0];

  if (account?.locked_until && account.locked_until.getTime() > Date.now()) {
    return { ok: false, reason: 'locked', adminId: account.id, retryAfterSeconds: Math.ceil((account.locked_until.getTime() - Date.now()) / 1000) };
  }

  const valid = await verifyPassword(password, account?.password_hash ?? DUMMY);
  if (!account || !account.active || !valid) {
    if (account) {
      await db.query(
        `UPDATE admin_accounts
            SET failed_count = CASE WHEN failed_count + 1 >= $2 THEN 0 ELSE failed_count + 1 END,
                locked_until = CASE WHEN failed_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
          WHERE id = $1`,
        [account.id, MAX_FAILED_LOGINS, LOCK_MINUTES],
      );
    }
    return { ok: false, reason: 'invalid', adminId: account?.id };
  }

  await db.query('UPDATE admin_accounts SET failed_count = 0, locked_until = NULL WHERE id = $1', [account.id]);
  const token = `ns_${randomBytes(32).toString('base64url')}`;
  await db.query('INSERT INTO admin_sessions (admin_id, token_hash) VALUES ($1, $2)', [account.id, sha256(token)]);
  return { ok: true, token, username, adminId: account.id };
}

// Valida e renova a sessão (inatividade de 30 min, vida máxima de 12 h). Limpa sessões vencidas.
export async function touchSession(token: string): Promise<AdminSession | null> {
  if (!/^ns_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await db.query<{ admin_id: string; username: string }>(
    `UPDATE admin_sessions s SET last_seen_at = now()
       FROM admin_accounts a
      WHERE s.token_hash = $1 AND a.id = s.admin_id AND a.active
        AND s.last_seen_at > now() - make_interval(mins => $2)
        AND s.created_at   > now() - make_interval(hours => $3)
      RETURNING s.admin_id, a.username`,
    [sha256(token), SESSION_IDLE_MINUTES, SESSION_MAX_HOURS],
  );
  if (!rows[0]) return null;
  return { adminId: rows[0].admin_id, username: rows[0].username };
}

export async function logout(token: string): Promise<void> {
  await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [sha256(token)]);
}

export async function purgeExpiredSessions(): Promise<void> {
  await db.query(
    `DELETE FROM admin_sessions
      WHERE last_seen_at < now() - make_interval(mins => $1) OR created_at < now() - make_interval(hours => $2)`,
    [SESSION_IDLE_MINUTES, SESSION_MAX_HOURS],
  );
}

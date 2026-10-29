import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

// Avatares temporários (a arte final é definida depois). A chave é só um identificador.
export const AVATAR_KEYS = Array.from(
  { length: 12 },
  (_, i) => `avatar-${String(i + 1).padStart(2, '0')}`,
);

export function randomAvatarKey(): string {
  return AVATAR_KEYS[randomInt(AVATAR_KEYS.length)]!;
}

// Compara nomes sem diferenciar caixa, acentos ou espaços repetidos.
export function normalizeName(fullName: string): string {
  return fullName
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Token de acesso do aparelho (vai para o localStorage). O banco guarda só o hash.
export function newAccessToken(): { token: string; hash: string } {
  const token = `nx_${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// O IP nunca é gravado em texto: apenas um HMAC com segredo do servidor.
export function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex');
}

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Sem 0/O, 1/I/L para evitar confusão ao digitar o código impresso.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const MANUAL_CODE_LENGTH = 8;
export const TOKEN_LENGTH = 32;

const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest();

// Token opaco do QR: derivado de (segredo, sala, versão). É imprevisível sem o segredo, e
// permite reimprimir a mesma versão sem guardar o token em texto no banco.
export function deriveToken(secret: string, roomId: string, version: number): string {
  return hmac(secret, `qr:v1:${roomId}:${version}`).toString('base64url').slice(0, TOKEN_LENGTH);
}

// Código curto para digitar quando a câmera falha (8 caracteres, formato ABCD-EFGH).
export function deriveManualCode(secret: string, roomId: string, version: number): string {
  const bytes = hmac(secret, `manual:v1:${roomId}:${version}`);
  let out = '';
  for (let i = 0; i < MANUAL_CODE_LENGTH; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export const formatManualCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

// Aceita minúsculas, espaços e hífen. Devolve null se não tiver o formato.
export function normalizeManualCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s-]+/g, '');
  if (clean.length !== MANUAL_CODE_LENGTH) return null;
  for (const ch of clean) if (!ALPHABET.includes(ch)) return null;
  return clean;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const hashManualCode = (secret: string, roomId: string, code: string) =>
  hmac(secret, `manualhash:v1:${roomId}:${code}`).toString('hex');

// O QR pode conter a URL (/q/<token>) ou só o token. Devolve o token ou null.
export function extractToken(input: string): string | null {
  const text = input.trim();
  const fromUrl = /\/q\/([A-Za-z0-9_-]{32})(?:[/?#].*)?$/.exec(text);
  const candidate = fromUrl ? fromUrl[1]! : text;
  return /^[A-Za-z0-9_-]{32}$/.test(candidate) ? candidate : null;
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

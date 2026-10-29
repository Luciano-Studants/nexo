// O QR da sala contém a URL do app (/q/<token>) ou só o token (32 caracteres base64url).
// Mesma regra do servidor (server/src/services/qr.ts).
export function extractToken(input: string): string | null {
  const text = input.trim();
  const fromUrl = /\/q\/([A-Za-z0-9_-]{32})(?:[/?#].*)?$/.exec(text);
  const candidate = fromUrl ? fromUrl[1]! : text;
  return /^[A-Za-z0-9_-]{32}$/.test(candidate) ? candidate : null;
}

// Código digitado: aceita minúsculas, espaço e hífen; mostra no formato ABCD-EFGH.
export function formatTypedCode(input: string): string {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

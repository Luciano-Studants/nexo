// Configuração lida do ambiente. Valores sensíveis nunca vão para o frontend nem para os logs.
function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`A variável ${name} deve ser um inteiro positivo.`);
  }
  return value;
}

export function loadConfig() {
  const ipHashSecret = process.env.IP_HASH_SECRET ?? '';
  if (ipHashSecret.length < 16) {
    throw new Error('A variável IP_HASH_SECRET deve ter pelo menos 16 caracteres.');
  }

  // Segredo dos QR Codes: deriva o token e o código manual de cada versão. Trocar o segredo
  // invalida TODOS os QR já impressos. Guarde fora do repositório.
  const qrSecret = process.env.QR_SECRET ?? '';
  if (qrSecret.length < 16) {
    throw new Error('A variável QR_SECRET deve ter pelo menos 16 caracteres.');
  }

  return {
    ipHashSecret,
    qrSecret,
    // Janela em que nome completo + mesmo IP reconhece um perfil perdido.
    resumeWindowHours: intFromEnv('RESUME_WINDOW_HOURS', 6),
    // Teto de perfis novos criados pelo mesmo IP em uma hora.
    profilesPerIpPerHour: intFromEnv('PROFILES_PER_IP_PER_HOUR', 60),
    // Slug da edição ativa.
    eventSlug: process.env.EVENT_SLUG || 'procidadania-ceumap',
    // Endereço público do app, gravado nos QR Codes (ex.: https://nexo.exemplo.com).
    publicAppUrl: /^https?:\/\//.test(process.env.PUBLIC_APP_URL ?? '') ? (process.env.PUBLIC_APP_URL as string) : '',
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;

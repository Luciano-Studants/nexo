// Cliente da API do painel. O token fica em sessionStorage: fechar a aba encerra o acesso neste aparelho.
const BASE: string = import.meta.env.VITE_API_BASE_URL ?? '/api';
const KEY = 'nexo.admin.token';
let memory: string | null = null;

export const adminToken = {
  get(): string | null {
    try { return sessionStorage.getItem(KEY) ?? memory; } catch { return memory; }
  },
  set(t: string) {
    memory = t;
    try { sessionStorage.setItem(KEY, t); } catch { /* segue em memória */ }
  },
  clear() {
    memory = null;
    try { sessionStorage.removeItem(KEY); } catch { /* ignorar */ }
  },
};

export class AdminError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export type AdminRoom = {
  id: string; slug: string; name: string; number: string | null; description: string;
  active: boolean; required: boolean; visits: number; qrActive: number | null; qrPending: number | null;
  photoVersion: number | null;
};
export type AdminFloor = { id: string; name: string; order: number; active: boolean; rooms: AdminRoom[] };
export type AdminEvent = {
  name: string; editionLabel: string | null; status: string; testMode: boolean;
  startsAt: string | null; endsAt: string | null; timezone: string;
  phase: 'before_open' | 'open' | 'paused' | 'ended'; registrationAllowed: boolean; visitsAllowed: boolean; roomsLocked: boolean;
};
export type Overview = {
  event: AdminEvent;
  stats: { participants: number; visits: number; completed: number; requiredActive: number; activeRooms: number; roomsTotal: number };
  floors: AdminFloor[];
  publicAppUrlConfigured: boolean;
  entryUrl: string | null;
};
export type ParticipantRow = {
  id: string; fullName: string; avatarKey: string; createdAt: string; lastSeenAt: string;
  visits: number; requiredVisited: number; completed: boolean;
};
export type ReportRoom = { rank: number; floor: string; number: string | null; name: string; required: boolean; active: boolean; visits: number; reachPct: number };
export type ReportData = {
  generatedAt: string;
  summary: {
    participants: number; withVisit: number; withoutVisit: number; completed: number; completionPct: number; visits: number;
    avgVisits: number; avgProgressPct: number; requiredRooms: number; activeRooms: number; firstVisit: string | null; lastVisit: string | null;
  };
  floors: Array<{ floor: string; rooms: number; activeRooms: number; requiredRooms: number; visits: number; uniqueVisitors: number; reachPct: number; avgPerRoom: number }>;
  rooms: ReportRoom[]; mostVisited: ReportRoom[]; leastVisited: ReportRoom[];
  distribution: Array<{ label: string; count: number; pct: number }>;
  hourly: Array<{ hour: string; visits: number }>;
};
export type AuditRow = {
  id: number; at: string; action: string; entity: string; entityId: string | null;
  outcome: string; details: Record<string, unknown>; username: string | null;
};

async function send(path: string, init: { method?: string; body?: unknown; auth?: boolean; raw?: Blob } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.raw) headers['Content-Type'] = init.raw.type || 'image/jpeg';
  const t = init.auth === false ? null : adminToken.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET', headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    });
  } catch {
    throw new AdminError('Sem conexão com o servidor.', 0);
  }
  if (!res.ok) {
    let data: any = null;
    try { data = await res.json(); } catch { /* sem corpo */ }
    throw new AdminError(data?.message ?? 'Não foi possível concluir a operação.', res.status, data?.code);
  }
  return res;
}

const json = async <T,>(path: string, init?: Parameters<typeof send>[1]) => (await send(path, init)).json() as Promise<T>;

export const adminApi = {
  login: (username: string, password: string) =>
    json<{ token: string; username: string }>('/admin/login', { method: 'POST', body: { username, password }, auth: false }),
  logout: () => json('/admin/logout', { method: 'POST' }),
  me: () => json<{ username: string }>('/admin/me'),
  overview: () => json<Overview>('/admin/overview'),
  updateEvent: (body: Record<string, unknown>) => json('/admin/event', { method: 'PATCH', body }),
  eventAction: (action: string, confirm?: boolean) => json('/admin/event/action', { method: 'POST', body: { action, confirm } }),
  updateRoom: (id: string, body: Record<string, unknown>) => json<{ ok: boolean; qrReprintNeeded: boolean }>(`/admin/rooms/${id}`, { method: 'PATCH', body }),
  qrPrepare: (roomIds: string[]) => json<{ results: Array<{ created: boolean }> }>('/admin/qr/prepare', { method: 'POST', body: { roomIds } }),
  qrActivate: (roomIds: string[]) => json<{ results: unknown[] }>('/admin/qr/activate', { method: 'POST', body: { roomIds } }),
  participants: (q: string, page: number) =>
    json<{ total: number; page: number; pageSize: number; items: ParticipantRow[] }>(`/admin/participants?q=${encodeURIComponent(q)}&page=${page}`),
  uploadPhoto: async (roomId: string, file: Blob) =>
    (await send(`/admin/rooms/${roomId}/photo`, { method: 'PUT', raw: file })).json() as Promise<{ ok: boolean; photoVersion: number; width: number; height: number; bytes: number }>,
  deletePhoto: (roomId: string) => json<{ ok: boolean; removed: boolean }>(`/admin/rooms/${roomId}/photo`, { method: 'DELETE' }),
  report: () => json<ReportData>('/admin/reports'),
  audit: () => json<{ items: AuditRow[] }>('/admin/audit'),

  // Arquivos exigem o cabeçalho Authorization, então são baixados como blob e salvos pelo navegador.
  async download(path: string, filename: string, init?: Parameters<typeof send>[1]) {
    const res = await send(path, init);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  },
};

// America/Sao_Paulo não tem horário de verão desde 2019: o deslocamento é fixo em -03:00.
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}
export function fromLocalInput(value: string): string | null {
  return value ? `${value}:00-03:00` : null;
}
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
}

export const photoUrl = (room: { id: string; photoVersion: number | null }) =>
  room.photoVersion === null ? null : `${BASE}/rooms/${room.id}/photo?v=${room.photoVersion}`;

// Reduz a foto no próprio aparelho antes de enviar (economiza dados móveis). Se o navegador não
// conseguir decodificar, envia o arquivo original e o servidor valida.
export async function shrinkImage(file: File, maxSide = 1600): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

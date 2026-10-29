// Cliente da API do NEXO. O token do aparelho fica no localStorage (com reserva em memória
// caso o navegador bloqueie o armazenamento).
const BASE: string = import.meta.env.VITE_API_BASE_URL ?? '/api';
const TOKEN_KEY = 'nexo.token';
let memoryToken: string | null = null;

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? memoryToken;
    } catch {
      return memoryToken;
    }
  },
  set(token: string): void {
    memoryToken = token;
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* armazenamento indisponível: segue em memória */
    }
  },
  clear(): void {
    memoryToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignorar */
    }
  },
};

export type EventPhase = 'before_open' | 'open' | 'paused' | 'ended';

export type EventInfo = {
  name: string;
  editionLabel: string | null;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  testMode: boolean;
  phase: EventPhase;
  registrationAllowed: boolean;
  visitsAllowed: boolean;
};

export type Participant = { id: string; fullName: string; avatarKey: string };

export type Progress = {
  requiredCount: number;
  visitedCount: number;
  configurationError: boolean;
  completed: boolean;
};

export type MapRoom = {
  id: string;
  slug: string;
  name: string;
  number: string | null;
  description: string;
  available: boolean;
  required: boolean;
  visited: boolean;
  // Versão da foto do interior (null = sem foto). Também serve para renovar o cache.
  photoVersion: number | null;
};

export type MapFloor = { id: string; name: string; order: number; active: boolean; rooms: MapRoom[] };

export type VisitResult = {
  status: 'registered' | 'already_visited';
  room: { id: string; slug: string; name: string; number: string | null; floorName: string; floorOrder: number; required: boolean };
  fragmentUnlocked: boolean;
  progress: Progress;
};

export type EnterResult =
  | { status: 'created' | 'resumed'; participant: Participant; token: string }
  | {
      status: 'resume_available';
      candidate: { fullName: string; avatarKey: string; visitedCount: number };
    };

// Endereço da foto do interior da sala (null se a equipe ainda não enviou).
export function roomPhotoUrl(room: { id: string; photoVersion: number | null }): string | null {
  return room.photoVersion === null ? null : `${BASE}/rooms/${room.id}/photo?v=${room.photoVersion}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public fieldErrors?: Array<{ field: string; message: string }>,
    public extra?: { phase?: string; attemptsLeft?: number; retryAfterSeconds?: number },
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = init.auth ? tokenStore.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('Sem conexão com o servidor. Confira sua internet e tente de novo.', 0);
  }

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    /* corpo vazio ou inválido */
  }

  if (!response.ok) {
    throw new ApiError(
      data?.message ?? 'Não foi possível concluir a operação.',
      response.status,
      data?.code,
      data?.errors,
      { phase: data?.phase, attemptsLeft: data?.attemptsLeft, retryAfterSeconds: data?.retryAfterSeconds },
    );
  }
  return data as T;
}

export const api = {
  event: () => request<EventInfo>('/event'),
  map: () => request<{ floors: MapFloor[] }>('/map', { auth: true }),
  me: () => request<{ participant: Participant; progress: Progress }>('/me', { auth: true }),
  visit: (code: string) => request<VisitResult>('/visits', { method: 'POST', body: { code }, auth: true }),
  visitManual: (roomId: string, code: string) =>
    request<VisitResult>('/visits/manual', { method: 'POST', body: { roomId, code }, auth: true }),
  enter: (fullName: string, decision?: 'resume' | 'new') =>
    request<EnterResult>('/participants', { method: 'POST', body: { fullName, decision } }),
};

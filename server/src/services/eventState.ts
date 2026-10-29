export type EventStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'ended';

export type EventRow = {
  status: EventStatus;
  test_mode: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
};

export type EventPhase = 'before_open' | 'open' | 'paused' | 'ended';

export type EventState = {
  phase: EventPhase;
  // Cadastro e instruções: permitidos antes e durante; bloqueados após o encerramento.
  registrationAllowed: boolean;
  // Visitas e peças: só durante o evento (ou em modo de teste, fora de pausa/encerramento).
  visitsAllowed: boolean;
};

// Estado calculado no servidor (America/Sao_Paulo é só a exibição; os instantes são absolutos).
export function computeEventState(event: EventRow, now: Date = new Date()): EventState {
  const t = now.getTime();
  const ended =
    event.status === 'ended' || (event.ends_at !== null && t >= event.ends_at.getTime());

  let phase: EventPhase;
  if (ended) {
    phase = 'ended';
  } else if (event.status === 'paused') {
    phase = 'paused';
  } else if (
    event.status === 'active' ||
    (event.starts_at !== null && t >= event.starts_at.getTime())
  ) {
    phase = 'open';
  } else {
    phase = 'before_open';
  }

  const visitsAllowed =
    phase === 'open' || (event.test_mode && phase === 'before_open');

  return { phase, registrationAllowed: phase !== 'ended', visitsAllowed };
}

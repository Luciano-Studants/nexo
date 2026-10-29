import { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import { Box as BoxIcon, Compass, List, Map as MapIcon, QrCode, Trophy } from 'lucide-react';

import {
  api,
  ApiError,
  tokenStore,
  type EventInfo,
  type MapFloor,
  type MapRoom,
  type Participant,
  type Progress,
  type VisitResult,
} from './api';
import { Avatar } from './avatars';
import { Entry } from './components/Entry';
import { FloorMap } from './components/FloorMap';
import { IsoStack, type IsoFloor } from './components/IsoMap';
import { Intro } from './components/Intro';
import { ProgressScreen } from './components/Progress';
import { RoomList } from './components/RoomList';
import { RoomSheet } from './components/RoomSheet';
import { Scanner } from './components/Scanner';
import { VisitResultDialog, type Outcome } from './components/VisitResult';
import { FLOOR_PLANS, planForFloor } from './floorplans';

type Me = { participant: Participant; progress: Progress };
type Tab = 'map' | 'progress';
type View = 'map' | 'iso' | 'list';

const INTRO_KEY = 'nexo.intro-seen';
const PENDING_KEY = 'nexo.pending-qr';

// QR lido pela câmera nativa do celular abre o app em /q/<token>. Guarda o token (a pessoa
// pode ainda precisar entrar com o nome) e limpa o endereço.
function takeDeepLink(): string | null {
  const m = /^\/q\/([A-Za-z0-9_-]{32})\/?$/.exec(window.location.pathname);
  if (m) {
    try {
      sessionStorage.setItem(PENDING_KEY, m[1]!);
    } catch {
      /* ignorar */
    }
    window.history.replaceState(null, '', '/');
    return m[1]!;
  }
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function clearPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignorar */
  }
}

function introSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_KEY, '1');
  } catch {
    /* ignorar */
  }
}

const fmt = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });

function EventBanner({ event }: { event: EventInfo }) {
  let text: string | null = null;
  if (event.phase === 'ended') {
    text = 'O evento foi encerrado. Você ainda pode ver seu progresso final.';
  } else if (event.phase === 'paused') {
    text = 'O evento está temporariamente interrompido. As visitas voltam quando a organização retomar.';
  } else if (event.phase === 'before_open') {
    text = event.testMode
      ? 'Modo de teste: as visitas estão liberadas para treino da equipe.'
      : `O evento ainda não começou${event.startsAt ? ` (abertura: ${fmt(event.startsAt, event.timezone)})` : ''}. Você já pode explorar o mapa; as visitas abrem com o evento.`;
  }
  if (!text) return null;
  return (
    <p className={`banner banner-${event.phase}`} role="status">
      {text}
    </p>
  );
}

export default function App() {
  const [boot, setBoot] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bootError, setBootError] = useState('');
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [floors, setFloors] = useState<MapFloor[]>([]);
  const [tab, setTab] = useState<Tab>('map');
  const [view, setView] = useState<View>('map');
  const [floorOrder, setFloorOrder] = useState(1);
  const [selected, setSelected] = useState<{ room: MapRoom; floorName: string } | null>(null);
  const [intro, setIntro] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(takeDeepLink);

  // Carrega evento, perfil (se houver token) e mapa. Token inválido é descartado.
  const load = useCallback(async () => {
    const ev = await api.event();
    setEvent(ev);
    document.title = `NEXO · ${ev.name}`;

    if (tokenStore.get()) {
      try {
        const [mine, map] = await Promise.all([api.me(), api.map()]);
        setMe(mine);
        setFloors(map.floors);
        return;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          tokenStore.clear();
          setMe(null);
        } else {
          throw e;
        }
      }
    }
    setMe(null);
  }, []);

  useEffect(() => {
    load()
      .then(() => setBoot('ready'))
      .catch((e: unknown) => {
        setBootError(e instanceof Error ? e.message : 'Não foi possível carregar.');
        setBoot('error');
      });
  }, [load]);

  // Ao voltar para a aba/app, atualiza o estado do evento e o progresso.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && boot === 'ready') {
        load().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [boot, load]);

  // O evento abre, pausa e encerra por horário ou pela equipe: confere o estado a cada 30 s (aba visível)
  // e recarrega tudo só quando a situação mudou.
  const phaseRef = useRef('');
  useEffect(() => {
    phaseRef.current = event ? `${event.phase}|${event.visitsAllowed}|${event.registrationAllowed}|${event.name}` : '';
  }, [event]);
  useEffect(() => {
    if (boot !== 'ready') return;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const e = await api.event();
        const key = `${e.phase}|${e.visitsAllowed}|${e.registrationAllowed}|${e.name}`;
        if (key !== phaseRef.current) await load();
      } catch {
        /* sem rede agora: tenta de novo no próximo ciclo */
      }
    };
    const id = window.setInterval(() => void tick(), 30_000);
    return () => window.clearInterval(id);
  }, [boot, load]);

  const onEntered = useCallback(
    async (_participant: Participant, token: string) => {
      tokenStore.set(token);
      try {
        await load();
        if (!introSeen()) setIntro(true);
      } catch (e) {
        setBootError(e instanceof Error ? e.message : 'Não foi possível carregar.');
        setBoot('error');
      }
    },
    [load],
  );

  const leave = useCallback(() => {
    const ok = window.confirm(
      'Sair deste aparelho? Para voltar ao seu progresso você precisará informar o mesmo nome em até 6 horas, na mesma rede.',
    );
    if (!ok) return;
    tokenStore.clear();
    setMe(null);
    setTab('map');
  }, []);

  const showError = useCallback((e: unknown) => {
    const err = e instanceof ApiError ? e : null;
    if (err?.status === 401) {
      tokenStore.clear();
      setMe(null);
    }
    setScannerOpen(false);
    setOutcome({
      kind: 'error',
      message: err?.message ?? 'Não foi possível registrar a visita.',
      retry: err?.code !== 'VISITS_NOT_OPEN' && err?.status !== 401,
    });
  }, []);

  const finishVisit = useCallback(
    (data: VisitResult) => {
      setScannerOpen(false);
      setOutcome({ kind: 'ok', data });
      load().catch(() => undefined);
    },
    [load],
  );

  const submitCode = useCallback(
    async (code: string) => {
      try {
        finishVisit(await api.visit(code));
      } catch (e) {
        showError(e);
      }
    },
    [finishVisit, showError],
  );

  // Código manual: erros voltam para o leitor, que os mostra no formulário.
  const submitManual = useCallback(
    async (roomId: string, code: string) => {
      try {
        finishVisit(await api.visitManual(roomId, code));
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.code === 'VISITS_NOT_OPEN')) {
          showError(e);
          return;
        }
        throw e;
      }
    },
    [finishVisit, showError],
  );

  // QR aberto pela câmera nativa: registra assim que houver perfil.
  useEffect(() => {
    if (boot === 'ready' && me && pendingCode) {
      const code = pendingCode;
      setPendingCode(null);
      clearPending();
      void submitCode(code);
    }
  }, [boot, me, pendingCode, submitCode]);

  const roomsBySlug = useMemo(() => {
    const floor = floors.find((f) => f.order === floorOrder);
    return new Map((floor?.rooms ?? []).map((r) => [r.slug, r]));
  }, [floors, floorOrder]);

  const currentFloor = floors.find((f) => f.order === floorOrder);
  const isoFloors: IsoFloor[] = useMemo(
    () =>
      FLOOR_PLANS.map((p) => {
        const f = floors.find((x) => x.order === p.order);
        return { plan: p, name: f?.name ?? p.title, rooms: new Map((f?.rooms ?? []).map((r) => [r.slug, r])) };
      }),
    [floors],
  );
  const plan = planForFloor(floorOrder);

  if (boot === 'loading') {
    return (
      <div className="app app-center">
        <Compass size={36} aria-hidden="true" className="spin" />
        <p role="status">Carregando…</p>
      </div>
    );
  }

  if (boot === 'error' || !event) {
    return (
      <div className="app app-center">
        <h1 className="h-small">Não foi possível abrir o NEXO</h1>
        <p className="lead">{bootError || 'Tente novamente em instantes.'}</p>
        <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
          Tentar de novo
        </button>
      </div>
    );
  }

  const header = (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><Compass size={22} /></span>
        <span>
          NEXO
          <small>{event.name}</small>
        </span>
      </div>
      {me && (
        <div className="who">
          <Avatar avatarKey={me.participant.avatarKey} size={36} />
          <span>{me.participant.fullName.split(' ')[0]}</span>
        </div>
      )}
    </header>
  );

  if (!me) {
    return (
      <div className="app">
        {header}
        <main>
          <Entry event={event} onEntered={onEntered} />
        </main>
      </div>
    );
  }

  return (
    <div className="app has-nav">
      {header}
      <main>
        <EventBanner event={event} />

        {tab === 'map' && (
          <>
            <button
              className="btn btn-primary scan-btn"
              type="button"
              disabled={!event.visitsAllowed}
              aria-describedby={event.visitsAllowed ? undefined : 'scan-note'}
              onClick={() => setScannerOpen(true)}
            >
              <QrCode size={20} aria-hidden="true" /> Ler QR Code
            </button>
            {!event.visitsAllowed && (
              <p id="scan-note" className="help scan-note">
                {event.phase === 'ended'
                  ? 'O evento foi encerrado.'
                  : event.phase === 'paused'
                    ? 'Visitas temporariamente interrompidas.'
                    : 'A leitura de QR Code abre junto com o evento.'}
              </p>
            )}

            <div className="toolbar">
              <div className="seg" role="group" aria-label="Piso">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={floorOrder === n}
                    className={floorOrder === n ? 'on' : ''}
                    onClick={() => setFloorOrder(n)}
                  >
                    {n}º piso
                  </button>
                ))}
              </div>
              <div className="seg seg-icons" role="group" aria-label="Forma de exibição">
                <button type="button" aria-pressed={view === 'map'} className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
                  <MapIcon size={16} aria-hidden="true" /> Mapa
                </button>
                <button type="button" aria-pressed={view === 'iso'} className={view === 'iso' ? 'on' : ''} onClick={() => setView('iso')}>
                  <BoxIcon size={16} aria-hidden="true" /> 3D
                </button>
                <button type="button" aria-pressed={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
                  <List size={16} aria-hidden="true" /> Lista
                </button>
              </div>
            </div>

            {(view === 'map' || view === 'iso') && plan ? (
              <section className="card card-map" aria-label={`Mapa do ${plan.title}`}>
                {view === 'iso' ? (
                  <IsoStack
                    floors={isoFloors}
                    selected={floorOrder}
                    onSelectRoom={(room, floorName) => setSelected({ room, floorName })}
                    onSelectFloor={setFloorOrder}
                  />
                ) : (
                  <FloorMap
                    plan={plan}
                    rooms={roomsBySlug}
                    onSelect={(room) => setSelected({ room, floorName: currentFloor?.name ?? plan.title })}
                  />
                )}
                <ul className="legend" aria-label="Legenda">
                  <li><i className="lg lg-visited" /> Visitado</li>
                  <li><i className="lg lg-required" /> Obrigatório pendente</li>
                  <li><i className="lg lg-optional" /> Opcional</li>
                  <li><i className="lg lg-off" /> Indisponível</li>
                </ul>
              </section>
            ) : (
              <RoomList
                floors={floors}
                onSelect={(room, floor) => setSelected({ room, floorName: floor.name })}
              />
            )}
          </>
        )}

        {tab === 'progress' && (
          <ProgressScreen
            progress={me.progress}
            floors={floors}
            event={event}
            onHelp={() => setIntro(true)}
            onLeave={leave}
          />
        )}
      </main>

      <nav className="bottomnav" aria-label="Navegação principal">
        <button type="button" aria-current={tab === 'map' ? 'page' : undefined} onClick={() => setTab('map')}>
          <MapIcon size={22} aria-hidden="true" /> Mapa
        </button>
        <button type="button" aria-current={tab === 'progress' ? 'page' : undefined} onClick={() => setTab('progress')}>
          <Trophy size={22} aria-hidden="true" /> Progresso
        </button>
      </nav>

      {selected && (
        <RoomSheet
          room={selected.room}
          floorName={selected.floorName}
          event={event}
          onClose={() => setSelected(null)}
          onScan={() => {
            setSelected(null);
            setScannerOpen(true);
          }}
        />
      )}
      {scannerOpen && (
        <Scanner
          floors={floors}
          onCode={(code) => void submitCode(code)}
          onManual={submitManual}
          onClose={() => setScannerOpen(false)}
        />
      )}
      {outcome && (
        <VisitResultDialog
          outcome={outcome}
          onSeeCollection={() => setTab('progress')}
          onRetry={() => {
            setOutcome(null);
            setScannerOpen(true);
          }}
          onContinue={(data) => {
            setOutcome(null);
            if (data) {
              setFloorOrder(data.room.floorOrder);
              setTab('map');
              setView('map');
            }
          }}
        />
      )}
      {intro && (
        <Intro
          onClose={() => {
            markIntroSeen();
            setIntro(false);
          }}
        />
      )}
    </div>
  );
}

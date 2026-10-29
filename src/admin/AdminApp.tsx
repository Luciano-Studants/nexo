import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import './admin.css';
import { AdminError, adminApi, adminToken, type Overview } from './adminApi';
import { AuditPanel, EventPanel, OverviewPanel, ParticipantsPanel, PhotosPanel, QrPanel, ReportsPanel, RoomsPanel } from './panels';

export type Ctx = {
  overview: Overview;
  reload: () => Promise<void>;
  // Executa uma ação, mostra o resultado e trata sessão expirada.
  act: <T>(fn: () => Promise<T>, okMessage?: string) => Promise<T | undefined>;
  notify: (kind: 'ok' | 'err', text: string) => void;
};

const TABS = [
  ['overview', 'Visão geral'],
  ['rooms', 'Ambientes'],
  ['photos', 'Fotos'],
  ['event', 'Evento'],
  ['qr', 'QR Codes'],
  ['people', 'Participantes'],
  ['reports', 'Relatórios'],
  ['audit', 'Histórico'],
] as const;
type Tab = (typeof TABS)[number][0];

function Login({ onDone, notice }: { onDone: () => void; notice: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await adminApi.login(username.trim(), password);
      adminToken.set(r.token);
      onDone();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ad-login">
      <form className="ad-card" onSubmit={submit} aria-labelledby="ad-login-title">
        <p className="ad-eyebrow">NEXO · Equipe</p>
        <h1 id="ad-login-title">Entrar no painel</h1>
        {notice && <p className="ad-note" role="status">{notice}</p>}
        <label>
          Usuário
          <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          Senha
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="ad-error" role="alert">{error}</p>}
        <button className="ad-btn ad-primary" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="ad-help">Acesso exclusivo da organização. A sessão termina após 30 minutos sem uso.</p>
      </form>
    </main>
  );
}

export default function AdminApp() {
  const [state, setState] = useState<'checking' | 'out' | 'in'>('checking');
  const [notice, setNotice] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), kind === 'ok' ? 4000 : 9000);
  }, []);

  const expire = useCallback((message: string) => {
    adminToken.clear();
    setOverview(null);
    setNotice(message);
    setState('out');
  }, []);

  const reload = useCallback(async () => {
    try {
      setOverview(await adminApi.overview());
      setLoadError('');
      setState('in');
    } catch (e) {
      if (e instanceof AdminError && e.status === 401) {
        expire(adminToken.get() ? 'Sua sessão expirou. Entre novamente.' : '');
      } else {
        setLoadError(e instanceof AdminError ? e.message : 'Falha ao carregar.');
        setState('in');
      }
    }
  }, [expire]);

  useEffect(() => {
    if (!adminToken.get()) {
      setState('out');
      return;
    }
    void reload();
  }, [reload]);

  const act: Ctx['act'] = useCallback(
    async (fn, okMessage) => {
      try {
        const out = await fn();
        if (okMessage) flash('ok', okMessage);
        return out;
      } catch (e) {
        if (e instanceof AdminError && e.status === 401 && e.code === 'ADMIN_UNAUTHENTICATED') {
          expire('Sua sessão expirou. Entre novamente.');
        } else {
          flash('err', e instanceof Error ? e.message : 'Algo deu errado.');
        }
        return undefined;
      }
    },
    [expire, flash],
  );

  // Números e situação do evento se atualizam sozinhos (30 s) enquanto a aba está visível.
  useEffect(() => {
    if (state !== 'in') return;
    const tick = () => { if (document.visibilityState === 'visible') void reload(); };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [state, reload]);

  const leave = async () => {
    try { await adminApi.logout(); } catch { /* sessão já inválida */ }
    expire('');
  };

  if (state === 'checking') return <div className="ad-root"><p className="ad-center">Carregando…</p></div>;
  if (state === 'out') {
    return <div className="ad-root"><Login notice={notice} onDone={() => { setNotice(''); setState('checking'); void reload(); }} /></div>;
  }

  const ctx: Ctx | null = overview ? { overview, reload, act, notify: flash } : null;

  return (
    <div className="ad-root">
      <header className="ad-top">
        <div>
          <strong className="ad-brand">NEXO</strong> <span className="ad-sub">Painel da equipe</span>
        </div>
        <button className="ad-btn ad-ghost" type="button" onClick={leave}>Sair</button>
      </header>

      <nav className="ad-tabs" aria-label="Seções do painel">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      <main className="ad-main">
        {toast && <p className={`ad-toast ${toast.kind === 'ok' ? 'is-ok' : 'is-err'}`} role={toast.kind === 'ok' ? 'status' : 'alert'}>{toast.text}</p>}
        {loadError && (
          <p className="ad-error" role="alert">
            {loadError} <button className="ad-link" type="button" onClick={() => void reload()}>Tentar de novo</button>
          </p>
        )}
        {ctx && (
          <>
            {tab === 'overview' && <OverviewPanel ctx={ctx} goto={(t) => setTab(t)} />}
            {tab === 'rooms' && <RoomsPanel ctx={ctx} />}
            {tab === 'photos' && <PhotosPanel ctx={ctx} />}
            {tab === 'event' && <EventPanel ctx={ctx} />}
            {tab === 'qr' && <QrPanel ctx={ctx} />}
            {tab === 'people' && <ParticipantsPanel ctx={ctx} />}
            {tab === 'reports' && <ReportsPanel ctx={ctx} />}
            {tab === 'audit' && <AuditPanel ctx={ctx} />}
          </>
        )}
      </main>
    </div>
  );
}

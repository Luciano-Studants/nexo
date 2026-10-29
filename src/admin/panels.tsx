import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { FLOOR_PLANS } from '../floorplans';
import type { Ctx } from './AdminApp';
import {
  adminApi, formatDateTime, fromLocalInput, photoUrl, shrinkImage, toLocalInput,
  type AdminRoom, type AuditRow, type ParticipantRow, type ReportData,
} from './adminApi';
import { PhotoMap } from './PhotoMap';

// Janela de diálogo acessível: foco vai para dentro, Tab não escapa, Esc fecha e o foco volta ao botão de origem.
function Dialog({ labelId, role = 'dialog', onClose, children, as = 'div', onSubmit }: {
  labelId: string; role?: 'dialog' | 'alertdialog'; onClose: () => void; children: ReactNode;
  as?: 'div' | 'form'; onSubmit?: (e: React.FormEvent) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  // onClose muda a cada renderização do pai; guardado em ref para o efeito (foco) rodar só ao abrir.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const focusable = () => Array.from(box?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute('disabled'));
    (box?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const els = focusable();
      if (els.length === 0) return;
      const first = els[0]!, last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);

  const props = { className: 'ad-card ad-dialog', role, 'aria-modal': true as const, 'aria-labelledby': labelId, onClick: (e: React.MouseEvent) => e.stopPropagation() };
  return (
    <div className="ad-backdrop" onClick={onClose}>
      {as === 'form'
        ? <form ref={ref as React.RefObject<HTMLFormElement>} {...props} onSubmit={onSubmit}>{children}</form>
        : <div ref={ref as React.RefObject<HTMLDivElement>} {...props}>{children}</div>}
    </div>
  );
}

const PHASE: Record<string, string> = {
  before_open: 'Antes da abertura', open: 'Aberto', paused: 'Pausado', ended: 'Encerrado',
};

// ---------------------------------------------------------------- Visão geral
export function OverviewPanel({ ctx, goto }: { ctx: Ctx; goto: (tab: 'rooms' | 'event' | 'qr') => void }) {
  const { event, stats, floors, publicAppUrlConfigured } = ctx.overview;
  const required = floors.flatMap((f) => f.rooms).filter((r) => r.required && r.active);
  const withoutQr = required.filter((r) => r.qrActive === null);

  const warnings: Array<{ text: string; to?: 'rooms' | 'event' | 'qr' }> = [];
  if (stats.requiredActive === 0) warnings.push({ text: 'Nenhum ambiente obrigatório definido: os visitantes não conseguem formar a coleção.', to: 'rooms' });
  if (withoutQr.length > 0) warnings.push({ text: `${withoutQr.length} ambiente(s) obrigatório(s) ainda sem QR Code ativo.`, to: 'qr' });
  if (!publicAppUrlConfigured) warnings.push({ text: 'PUBLIC_APP_URL não está configurado no servidor: não é possível gerar etiquetas.' });
  if (!event.startsAt) warnings.push({ text: 'Data e horário do evento ainda não definidos.', to: 'event' });
  if (event.testMode && event.phase === 'before_open') warnings.push({ text: 'Modo de teste ligado: visitas estão liberadas antes da abertura. Desligue antes do evento.', to: 'event' });

  return (
    <>
      <section className="ad-card">
        <p className="ad-eyebrow">{event.editionLabel || 'Edição atual'}</p>
        <h1>{event.name}</h1>
        <p><span className={`ad-badge is-${event.phase}`}>{PHASE[event.phase]}</span> {event.testMode && <span className="ad-badge is-test">Modo de teste</span>}</p>
        <p className="ad-help">Início: {formatDateTime(event.startsAt)} · Término: {formatDateTime(event.endsAt)}</p>
      </section>

      {warnings.length > 0 && (
        <section className="ad-card ad-warn" aria-label="Pendências">
          <h2>Pendências</h2>
          <ul>
            {warnings.map((w) => (
              <li key={w.text}>{w.text} {w.to && <button className="ad-link" type="button" onClick={() => goto(w.to!)}>Resolver</button>}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="ad-stats" aria-label="Números do evento">
        <Stat label="Participantes" value={stats.participants} />
        <Stat label="Visitas registradas" value={stats.visits} />
        <Stat label="Coleções completas" value={stats.completed} />
        <Stat label="Obrigatórios" value={stats.requiredActive} hint={`de ${stats.roomsTotal} ambientes`} />
      </section>

      <section className="ad-card">
        <h2>Visitas por ambiente</h2>
        <ul className="ad-bars">
          {floors.flatMap((f) => f.rooms.map((r) => ({ ...r, floor: f.name }))).filter((r) => r.active).sort((a, b) => b.visits - a.visits).map((r) => {
            const max = Math.max(1, ...floors.flatMap((f) => f.rooms.map((x) => x.visits)));
            return (
              <li key={r.id}>
                <span>{r.name}{r.required ? ' ★' : ''} <small>{r.floor}</small></span>
                <span className="ad-bar" aria-hidden="true"><i style={{ width: `${(r.visits / max) * 100}%` }} /></span>
                <b>{r.visits}</b>
              </li>
            );
          })}
        </ul>
        <p className="ad-help">★ = obrigatório</p>
      </section>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="ad-stat">
      <b>{value}</b>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </div>
  );
}

// ---------------------------------------------------------------- Ambientes
export function RoomsPanel({ ctx }: { ctx: Ctx }) {
  const { floors, event } = ctx.overview;
  const [editing, setEditing] = useState<AdminRoom | null>(null);
  const [deactivating, setDeactivating] = useState<AdminRoom | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = event.roomsLocked;

  // Uma alteração por vez: evita cliques repetidos antes de o servidor responder.
  const patch = async (room: AdminRoom, body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try {
      await ctx.act(async () => { await adminApi.updateRoom(room.id, body); await ctx.reload(); }, msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="ad-card">
        <h1>Ambientes</h1>
        <p className="ad-help">
          <b>Ativo</b>: aparece no evento. <b>Obrigatório</b>: conta para completar a coleção (define o número de peças da imagem).
        </p>
        {locked && (
          <p className="ad-note" role="status">
            Com o evento {PHASE[event.phase].toLowerCase()}, ativar/desativar e marcar obrigatórios está travado. Nome, número e descrição continuam editáveis.
          </p>
        )}
      </section>

      {floors.map((f) => (
        <section className="ad-card" key={f.id} aria-label={f.name}>
          <h2>{f.name}</h2>
          <div className="ad-tablewrap">
            <table className="ad-table">
              <thead>
                <tr><th>Ambiente</th><th>Ativo</th><th>Obrigatório</th><th>Visitas</th><th>QR</th><th /></tr>
              </thead>
              <tbody>
                {f.rooms.map((r) => (
                  <tr key={r.id} className={r.active ? '' : 'is-off'}>
                    <td>{r.name}{r.number ? <small> · sala {r.number}</small> : null}</td>
                    <td>
                      <input type="checkbox" checked={r.active} disabled={locked || busy} aria-label={`${r.name}: ativo`}
                        onChange={(e) => (e.target.checked ? void patch(r, { active: true }, 'Ambiente ativado.') : setDeactivating(r))} />
                    </td>
                    <td>
                      <input type="checkbox" checked={r.required} disabled={locked || busy} aria-label={`${r.name}: obrigatório`}
                        onChange={(e) => void patch(r, { required: e.target.checked }, e.target.checked ? 'Marcado como obrigatório.' : 'Não é mais obrigatório.')} />
                    </td>
                    <td>{r.visits}</td>
                    <td><QrBadge room={r} /></td>
                    <td><button className="ad-btn ad-small" type="button" onClick={() => setEditing(r)}>Editar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {editing && (
        <RoomEditor room={editing} onClose={() => setEditing(null)}
          onSave={async (body) => {
            const r = await ctx.act(async () => { const out = await adminApi.updateRoom(editing.id, body) as { qrReprintNeeded?: boolean }; await ctx.reload(); return out; });
            if (r) {
              ctx.notify('ok', r.qrReprintNeeded
                ? 'Ambiente atualizado. A etiqueta impressa ficou desatualizada: uma versão nova ficou pendente na aba QR Codes para reimprimir e ativar.'
                : 'Ambiente atualizado.');
              setEditing(null);
            }
          }} />
      )}

      {deactivating && (
        <Dialog role="alertdialog" labelId="ad-deact" onClose={() => setDeactivating(null)}>
          <h2 id="ad-deact">Desativar “{deactivating.name}”?</h2>
          <p>O ambiente some do mapa e deixa de contar visitas e peças da coleção.{deactivating.required ? ' Ele é obrigatório: o número de peças da imagem diminui.' : ''}{deactivating.visits > 0 ? ` ${deactivating.visits} visita(s) já registrada(s) são mantidas no histórico.` : ''}</p>
          <div className="ad-row">
            <button className="ad-btn ad-danger" type="button" onClick={() => { const r = deactivating; setDeactivating(null); void patch(r, { active: false }, 'Ambiente desativado.'); }}>Desativar</button>
            <button className="ad-btn" type="button" data-autofocus onClick={() => setDeactivating(null)}>Cancelar</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function QrBadge({ room }: { room: AdminRoom }) {
  if (room.qrActive !== null) return <span className="ad-badge is-open">v{room.qrActive} ativo{room.qrPending !== null ? ` · v${room.qrPending} pendente` : ''}</span>;
  if (room.qrPending !== null) return <span className="ad-badge is-paused">v{room.qrPending} pendente</span>;
  return <span className="ad-badge">sem QR</span>;
}

function RoomEditor({ room, onClose, onSave }: { room: AdminRoom; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(room.name);
  const [number, setNumber] = useState(room.number ?? '');
  const [description, setDescription] = useState(room.description);
  return (
    <Dialog as="form" labelId="ad-room-title" onClose={onClose}
      onSubmit={(e) => { e.preventDefault(); void onSave({ name, number: number.trim() || null, description }); }}>
        <h2 id="ad-room-title">Editar ambiente</h2>
        <label>Nome<input type="text" data-autofocus value={name} maxLength={160} onChange={(e) => setName(e.target.value)} required /></label>
        {(name.trim() !== room.name || (number.trim() || null) !== room.number) && room.qrActive !== null && (
          <p className="ad-note" role="status">Este ambiente já tem QR ativo. Mudar nome ou número deixa a etiqueta impressa desatualizada: ao salvar, uma nova versão fica pendente para você reimprimir e ativar.</p>
        )}
        <label>Número da sala (opcional)<input type="text" value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} /></label>
        <label>Descrição (o visitante vê no detalhe da sala)<textarea value={description} maxLength={2000} rows={4} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="ad-row">
          <button className="ad-btn ad-primary" type="submit" disabled={!name.trim()}>Salvar</button>
          <button className="ad-btn" type="button" onClick={onClose}>Cancelar</button>
        </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Evento
function remaining(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  if (d > 0) return `${d} dia${d > 1 ? 's' : ''}${h ? ` e ${h} h` : ''}`;
  if (h > 0) return `${h} h${m ? ` ${m} min` : ''}`;
  return m > 0 ? `${m} min` : 'menos de 1 min';
}

// Resume, em palavras, o que vai acontecer sozinho e o que depende de você.
function Timeline({ event }: { event: import('./adminApi').AdminEvent }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id); }, []);
  const start = event.startsAt ? new Date(event.startsAt).getTime() : null;
  const end = event.endsAt ? new Date(event.endsAt).getTime() : null;
  const lines: string[] = [];
  if (event.phase === 'before_open') {
    lines.push(start && start > now
      ? `Abre sozinho em ${formatDateTime(event.startsAt)} (faltam ${remaining(start - now)}). Ou toque em “Abrir agora” para antecipar.`
      : 'Sem horário de início: o evento só abre quando você tocar em “Abrir agora”.');
  }
  if (event.phase === 'open' || event.phase === 'before_open' || event.phase === 'paused') {
    if (end && end > now) lines.push(`Encerra sozinho em ${formatDateTime(event.endsAt)} (${event.phase === 'open' ? 'faltam ' + remaining(end - now) : 'mesmo se abrir antes'}). Ou toque em “Encerrar evento” para encerrar na hora.`);
    else if (!end) lines.push('Sem horário de término: o evento só encerra quando você tocar em “Encerrar evento”.');
  }
  if (event.phase === 'paused') lines.push('Pausado: ninguém registra visitas até você tocar em “Retomar”.');
  if (event.phase === 'ended') lines.push('Encerrado: visitas bloqueadas e progresso congelado. Se foi um engano, use “Reabrir evento”.');
  return <ul className="ad-timeline" aria-label="O que vai acontecer">{lines.map((l) => <li key={l}>{l}</li>)}</ul>;
}

export function EventPanel({ ctx }: { ctx: Ctx }) {
  const { event } = ctx.overview;
  const [name, setName] = useState(event.name);
  const [edition, setEdition] = useState(event.editionLabel ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(event.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(event.endsAt));
  const [testMode, setTestMode] = useState(event.testMode);
  const [confirm, setConfirm] = useState<null | 'end' | 'schedule' | 'reopen'>(null);
  const startMs = startsAt ? new Date(fromLocalInput(startsAt)!).getTime() : null;
  const endMs = endsAt ? new Date(fromLocalInput(endsAt)!).getTime() : null;
  const badRange = startMs !== null && endMs !== null && endMs <= startMs;
  const startPast = event.phase === 'before_open' && startMs !== null && startMs <= Date.now();

  const save = () =>
    ctx.act(async () => {
      await adminApi.updateEvent({ name, editionLabel: edition.trim() || null, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt), testMode });
      await ctx.reload();
    }, 'Dados do evento salvos.');

  const run = (action: string, ok: string, confirmed?: boolean) =>
    ctx.act(async () => { await adminApi.eventAction(action, confirmed); await ctx.reload(); setConfirm(null); }, ok);

  const p = event.phase;
  return (
    <>
      <section className="ad-card">
        <h1>Evento</h1>
        <p><span className={`ad-badge is-${p}`}>{PHASE[p]}</span></p>
        <Timeline event={event} />
        <div className="ad-actions">
          {p === 'before_open' && <button className="ad-btn ad-primary" type="button" onClick={() => void run('open', 'Evento aberto: as visitas estão liberadas.')}>Abrir agora</button>}
          {p === 'open' && <button className="ad-btn" type="button" onClick={() => void run('pause', 'Evento pausado.')}>Pausar</button>}
          {p === 'paused' && <button className="ad-btn ad-primary" type="button" onClick={() => void run('resume', 'Evento retomado.')}>Retomar</button>}
          {p !== 'before_open' && p !== 'ended' && <button className="ad-btn" type="button" onClick={() => setConfirm('schedule')}>Voltar para “antes da abertura”</button>}
          {p !== 'ended' && <button className="ad-btn ad-danger" type="button" onClick={() => setConfirm('end')}>Encerrar evento</button>}
          {p === 'ended' && <button className="ad-btn ad-primary" type="button" onClick={() => setConfirm('reopen')}>Reabrir evento</button>}
        </div>
      </section>

      <form className="ad-card" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2>Dados e horários</h2>
        <label>Nome do evento (aparece no app)<input type="text" value={name} minLength={3} maxLength={160} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Edição (opcional)<input type="text" value={edition} maxLength={160} onChange={(e) => setEdition(e.target.value)} /></label>
        <div className="ad-grid2">
          <label>Início (horário de Brasília)<input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
          <label>Término (horário de Brasília)<input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
        </div>
        <label className="ad-check">
          <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
          <span><b>Modo de teste</b> — libera registrar visitas antes da abertura (treino da equipe). Desligue antes do evento.</span>
        </label>
        {badRange && <p className="ad-error" role="alert">O término precisa ser depois do início.</p>}
        {startPast && !badRange && <p className="ad-note" role="status">O horário de início já passou: ao salvar, o evento abre imediatamente.</p>}
        <button className="ad-btn ad-primary" type="submit" disabled={badRange}>Salvar</button>
        <p className="ad-help">Chegando o horário de início, o evento abre sozinho; ao chegar o término, encerra sozinho. Você pode antecipar ou encerrar na hora pelos botões acima.</p>
      </form>

      {confirm && (
        <Dialog role="alertdialog" labelId="ad-confirm" onClose={() => setConfirm(null)}>
            <h2 id="ad-confirm">{confirm === 'end' ? 'Encerrar o evento agora?' : confirm === 'reopen' ? 'Reabrir o evento?' : 'Voltar para antes da abertura?'}</h2>
            <p>{confirm === 'end'
              ? 'As visitas deixam de ser registradas e o progresso dos visitantes fica congelado. Se foi um engano, dá para reabrir por aqui.'
              : confirm === 'reopen'
                ? 'As visitas voltam a ser registradas. Se o horário de término já passou, defina um novo término antes.'
                : 'As visitas deixam de ser registradas até o evento abrir de novo. Se o horário de início já passou, defina um novo antes.'}</p>
            <div className="ad-row">
              <button className="ad-btn ad-danger" type="button" onClick={() => void run(confirm, confirm === 'end' ? 'Evento encerrado.' : confirm === 'reopen' ? 'Evento reaberto.' : 'Evento voltou para antes da abertura.', true)}>Confirmar</button>
              <button className="ad-btn" type="button" data-autofocus onClick={() => setConfirm(null)}>Cancelar</button>
            </div>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------- QR Codes
export function QrPanel({ ctx }: { ctx: Ctx }) {
  const { floors, publicAppUrlConfigured } = ctx.overview;
  const all = useMemo(() => floors.flatMap((f) => f.rooms.map((r) => ({ ...r, floor: f.name }))), [floors]);
  const [onlyRequired, setOnlyRequired] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<'a4' | 'a6'>('a4');
  const [confirmActivate, setConfirmActivate] = useState(false);

  const list = all.filter((r) => r.active && (!onlyRequired || r.required));
  const ids = list.filter((r) => picked.has(r.id)).map((r) => r.id);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allPicked = list.length > 0 && ids.length === list.length;
  const pendingCount = list.filter((r) => picked.has(r.id) && r.qrPending !== null).length;
  const replaceCount = list.filter((r) => picked.has(r.id) && r.qrPending !== null && r.qrActive !== null).length;

  const prepare = () => ctx.act(async () => {
    const r = await adminApi.qrPrepare(ids);
    await ctx.reload();
    return r;
  }, 'Versões pendentes preparadas.');

  const labels = (status: 'pending' | 'active') =>
    ctx.act(() => adminApi.download('/admin/qr/labels', `nexo-qr-${status}-${format}.pdf`, { method: 'POST', body: { roomIds: ids, status, format } }),
      'PDF gerado. Trate o arquivo como material sensível.');

  const activate = () => ctx.act(async () => { await adminApi.qrActivate(ids); await ctx.reload(); setConfirmActivate(false); }, 'QR Codes ativados.');

  return (
    <>
      <section className="ad-card">
        <h2>QR de entrada do evento</h2>
        <p>É o QR que o visitante lê para abrir o NEXO. Aponta para: <b>{ctx.overview.entryUrl ?? 'endereço não configurado (PUBLIC_APP_URL)'}</b></p>
        <div className="ad-actions">
          <button className="ad-btn ad-primary" type="button" disabled={!publicAppUrlConfigured}
            onClick={() => void ctx.act(() => adminApi.download('/admin/entry-qr?format=pdf', 'nexo-qr-entrada-cartaz.pdf'), 'Cartaz gerado.')}>Baixar cartaz (PDF A4)</button>
          <button className="ad-btn" type="button" disabled={!publicAppUrlConfigured}
            onClick={() => void ctx.act(() => adminApi.download('/admin/entry-qr?format=png', 'nexo-qr-entrada.png'), 'QR gerado.')}>Baixar só o QR (PNG)</button>
        </div>
        <p className="ad-help">Imprima o cartaz e fixe na entrada. Confira com um celular antes do evento.</p>
      </section>

      <section className="ad-card">
        <h1>QR Codes das salas</h1>
        <ol className="ad-steps">
          <li><b>Preparar</b>: cria a nova versão (ainda não vale).</li>
          <li><b>Baixar etiquetas pendentes</b> e imprimir.</li>
          <li><b>Colar e conferir</b> no local (o QR pendente ainda não registra visita).</li>
          <li><b>Ativar</b>: a versão nova passa a valer e a antiga deixa de valer na hora.</li>
        </ol>
        {!publicAppUrlConfigured && <p className="ad-error" role="alert">PUBLIC_APP_URL não está configurado no servidor. Sem ele não dá para gerar etiquetas.</p>}
        <p className="ad-note">Os PDFs contêm QR Codes e códigos válidos: não compartilhe nem guarde em pastas públicas.</p>
      </section>

      <section className="ad-card">
        <div className="ad-row ad-between">
          <label className="ad-check"><input type="checkbox" checked={onlyRequired} onChange={(e) => setOnlyRequired(e.target.checked)} /> <span>Só obrigatórios</span></label>
          <label className="ad-check"><input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(list.map((r) => r.id)))} /> <span>Selecionar todos ({list.length})</span></label>
        </div>
        <div className="ad-tablewrap">
          <table className="ad-table">
            <thead><tr><th /><th>Ambiente</th><th>Piso</th><th>QR</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Selecionar ${r.name}`} /></td>
                  <td>{r.name}{r.required ? ' ★' : ''}</td><td>{r.floor}</td><td><QrBadge room={r} /></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={4}>Nenhum ambiente nesta lista.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="ad-actions">
          <label>Formato
            <select value={format} onChange={(e) => setFormat(e.target.value as 'a4' | 'a6')}>
              <option value="a4">A4 (4 etiquetas por folha)</option>
              <option value="a6">A6 (1 por página)</option>
            </select>
          </label>
          <button className="ad-btn" type="button" disabled={ids.length === 0} onClick={() => void prepare()}>1. Preparar pendentes ({ids.length})</button>
          <button className="ad-btn" type="button" disabled={ids.length === 0 || !publicAppUrlConfigured} onClick={() => void labels('pending')}>2. Baixar etiquetas pendentes</button>
          <button className="ad-btn ad-primary" type="button" disabled={pendingCount === 0} onClick={() => setConfirmActivate(true)}>4. Ativar pendentes ({pendingCount})</button>
          <button className="ad-btn" type="button" disabled={ids.length === 0 || !publicAppUrlConfigured} onClick={() => void labels('active')}>Reimprimir etiquetas ativas</button>
        </div>
      </section>

      {confirmActivate && (
        <Dialog role="alertdialog" labelId="ad-act" onClose={() => setConfirmActivate(false)}>
            <h2 id="ad-act">Ativar {pendingCount} QR Code(s)?</h2>
            <p>{replaceCount > 0 ? `${replaceCount} ambiente(s) já têm QR ativo: a etiqueta antiga deixa de valer imediatamente. ` : ''}Só ative depois de colar as novas etiquetas e conferir.</p>
            <div className="ad-row">
              <button className="ad-btn ad-primary" type="button" onClick={() => void activate()}>Ativar</button>
              <button className="ad-btn" type="button" data-autofocus onClick={() => setConfirmActivate(false)}>Cancelar</button>
            </div>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Participantes
export function ParticipantsPanel({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; items: ParticipantRow[] } | null>(null);
  const { act } = ctx;
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const r = await act(() => adminApi.participants(q, page));
    // Ignora respostas antigas que chegam depois de uma busca mais nova.
    if (r && mine === seq.current) setData(r);
  }, [act, q, page]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section className="ad-card">
      <h1>Participantes</h1>
      <p className="ad-help">Contém nomes completos: use só para a operação do evento e exclua os arquivos exportados ao terminar.</p>
      <div className="ad-row ad-between">
        <label className="ad-grow">Buscar por nome<input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <div className="ad-actions">
          <button className="ad-btn" type="button" onClick={() => void ctx.act(() => adminApi.download('/admin/export/participants.csv', 'nexo-participantes.csv'))}>Exportar participantes (CSV)</button>
          <button className="ad-btn" type="button" onClick={() => void ctx.act(() => adminApi.download('/admin/export/visits.csv', 'nexo-visitas.csv'))}>Exportar visitas (CSV)</button>
        </div>
      </div>
      <div className="ad-tablewrap">
        <table className="ad-table">
          <thead><tr><th>Nome</th><th>Visitas</th><th>Obrigatórios</th><th>Completou</th><th>Último acesso</th></tr></thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.id}>
                <td>{p.fullName}</td><td>{p.visits}</td><td>{p.requiredVisited}</td>
                <td>{p.completed ? <span className="ad-badge is-open">sim</span> : 'não'}</td><td>{formatDateTime(p.lastSeenAt)}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && <tr><td colSpan={5}>Nenhum participante encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="ad-row ad-between">
        <span className="ad-help">{data ? `${data.total} participante(s)` : 'Carregando…'}</span>
        <div className="ad-row">
          <button className="ad-btn ad-small" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
          <span>{page} / {pages}</span>
          <button className="ad-btn ad-small" type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Histórico
const ACTION: Record<string, string> = {
  'admin.login': 'Login', 'event.update': 'Evento editado', 'event.open': 'Evento aberto', 'event.pause': 'Evento pausado',
  'event.resume': 'Evento retomado', 'event.end': 'Evento encerrado', 'event.schedule': 'Evento voltou a “antes da abertura”',
  'room.update': 'Ambiente editado', 'qr.prepare': 'QR preparado', 'qr.activate': 'QR ativado', 'qr.labels': 'Etiquetas geradas',
  'export.participants': 'Exportou participantes', 'export.visits': 'Exportou visitas',
};

export function AuditPanel({ ctx }: { ctx: Ctx }) {
  const [items, setItems] = useState<AuditRow[] | null>(null);
  const { act } = ctx;
  const load = useCallback(() => act(() => adminApi.audit()).then((r) => { if (r) setItems(r.items); }), [act]);
  useEffect(() => { void load(); }, [load]);
  return (
    <section className="ad-card">
      <div className="ad-row ad-between">
        <h1>Histórico de ações</h1>
        <button className="ad-btn ad-small" type="button" onClick={() => void load()}>Atualizar</button>
      </div>
      <p className="ad-help">As 100 ações mais recentes da equipe.</p>
      <div className="ad-tablewrap">
        <table className="ad-table">
          <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Resultado</th></tr></thead>
          <tbody>
            {items?.map((i) => (
              <tr key={i.id}><td>{formatDateTime(i.at)}</td><td>{i.username ?? '—'}</td><td>{ACTION[i.action] ?? i.action}</td><td>{i.outcome === 'success' ? 'ok' : 'falhou'}</td></tr>
            ))}
            {items && items.length === 0 && <tr><td colSpan={4}>Nada registrado ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Fotos
export function PhotosPanel({ ctx }: { ctx: Ctx }) {
  const { floors } = ctx.overview;
  const [floorOrder, setFloorOrder] = useState(floors[0]?.order ?? 1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const allRooms = useMemo(() => floors.flatMap((f) => f.rooms.map((r) => ({ ...r, floorName: f.name, floorOrder: f.order }))), [floors]);
  const selected = allRooms.find((r) => r.id === selectedId) ?? null;
  const floor = floors.find((f) => f.order === floorOrder);
  const plan = FLOOR_PLANS.find((p) => p.order === floorOrder);
  const bySlug = useMemo(() => new Map((floor?.rooms ?? []).map((r) => [r.slug, r])), [floor]);
  const withPhoto = allRooms.filter((r) => r.photoVersion !== null).length;
  const missing = allRooms.filter((r) => r.active && r.photoVersion === null);

  const choose = (room: AdminRoom & { floorOrder?: number }) => {
    setSelectedId(room.id);
    const f = floors.find((x) => x.rooms.some((r) => r.id === room.id));
    if (f) setFloorOrder(f.order);
  };

  const send = async (file: File | undefined) => {
    if (!file || !selected) return;
    setBusy(true);
    try {
      await ctx.act(async () => {
        const blob = await shrinkImage(file);
        await adminApi.uploadPhoto(selected.id, blob);
        await ctx.reload();
      }, `Foto de “${selected.name}” salva.`);
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    if (!selected) return;
    setConfirmDelete(false);
    setBusy(true);
    try {
      await ctx.act(async () => { await adminApi.deletePhoto(selected.id); await ctx.reload(); }, 'Foto removida.');
    } finally {
      setBusy(false);
    }
  };

  const url = selected ? photoUrl(selected) : null;
  return (
    <>
      <section className="ad-card">
        <h1>Fotos dos ambientes</h1>
        <p>Toque numa sala do mapa e envie a foto do interior. O visitante vê essa foto ao tocar na sala no mapa.</p>
        <p className="ad-help"><b>{withPhoto}</b> de {allRooms.length} ambientes com foto{missing.length > 0 ? ` · faltam ${missing.length} dos ativos` : ' · todos os ativos têm foto'}.</p>
        <div className="ad-seg" role="group" aria-label="Piso">
          {floors.map((f) => (
            <button key={f.id} type="button" aria-pressed={floorOrder === f.order} className={floorOrder === f.order ? 'on' : ''} onClick={() => setFloorOrder(f.order)}>{f.name}</button>
          ))}
        </div>
      </section>

      <div className="ad-photolayout">
        <section className="ad-card ad-photomapwrap" aria-label="Mapa">
          {plan && <PhotoMap plan={plan} rooms={bySlug} selectedId={selectedId} onSelect={choose} />}
          <ul className="ad-legend" aria-label="Legenda">
            <li><i className="lg-has" /> Com foto</li>
            <li><i className="lg-no" /> Sem foto</li>
            <li><i className="lg-off" /> Ambiente desativado</li>
          </ul>
        </section>

        <section className="ad-card ad-photoside" aria-label="Foto do ambiente selecionado" aria-live="polite">
          {!selected ? (
            <>
              <h2>Escolha uma sala</h2>
              <p className="ad-help">Toque numa sala do mapa para ver, enviar ou trocar a foto.</p>
              {missing.length > 0 && (
                <>
                  <h3 className="ad-h3">Ainda sem foto</h3>
                  <ul className="ad-missing">
                    {missing.slice(0, 12).map((r) => (
                      <li key={r.id}><button className="ad-link" type="button" onClick={() => choose(r)}>{r.name}</button> <small>{r.floorName}</small></li>
                    ))}
                    {missing.length > 12 && <li className="ad-help">e mais {missing.length - 12}…</li>}
                  </ul>
                </>
              )}
            </>
          ) : (
            <>
              <p className="ad-eyebrow">{selected.floorName}{selected.number ? ` · sala ${selected.number}` : ''}</p>
              <h2>{selected.name}</h2>
              {url ? (
                <img className="ad-photo" src={url} alt={`Foto atual do interior: ${selected.name}`} />
              ) : (
                <p className="ad-nophoto">Este ambiente ainda não tem foto.</p>
              )}
              <div className="ad-actions">
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void send(e.target.files?.[0])} data-testid="photo-camera" />
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void send(e.target.files?.[0])} data-testid="photo-file" />
                <button className="ad-btn ad-primary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {busy ? 'Enviando…' : url ? 'Trocar foto' : 'Enviar foto'}
                </button>
                <button className="ad-btn ad-camera" type="button" disabled={busy} onClick={() => cameraRef.current?.click()}>Tirar foto agora</button>
                {url && <button className="ad-btn ad-danger" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Remover</button>}
              </div>
              <p className="ad-help">JPEG, PNG ou WebP. A foto é reduzida e o local de onde foi tirada (GPS) é apagado. Evite fotografar pessoas.</p>
            </>
          )}
        </section>
      </div>

      {confirmDelete && selected && (
        <Dialog role="alertdialog" labelId="ad-photo-del" onClose={() => setConfirmDelete(false)}>
          <h2 id="ad-photo-del">Remover a foto de “{selected.name}”?</h2>
          <p>O visitante deixa de ver a imagem desta sala.</p>
          <div className="ad-row">
            <button className="ad-btn ad-danger" type="button" onClick={() => void remove()}>Remover</button>
            <button className="ad-btn" type="button" data-autofocus onClick={() => setConfirmDelete(false)}>Cancelar</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Relatórios
const pctText = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div className="ad-bar" role="img" aria-label={label}>
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function ReportsPanel({ ctx }: { ctx: Ctx }) {
  const { act } = ctx;
  const [data, setData] = useState<ReportData | null>(null);
  const [busy, setBusy] = useState<'' | 'pdf' | 'xlsx'>('');

  const load = useCallback(async () => {
    const r = await act(() => adminApi.report());
    if (r) setData(r);
  }, [act]);
  useEffect(() => { void load(); }, [load]);

  const save = async (fmt: 'pdf' | 'xlsx') => {
    setBusy(fmt);
    const stamp = new Date().toISOString().slice(0, 10);
    await act(() => adminApi.download(`/admin/reports/export.${fmt}`, `nexo-relatorio-${stamp}.${fmt}`), `Relatório ${fmt.toUpperCase()} gerado.`);
    setBusy('');
  };

  if (!data) return <section className="ad-card"><h1>Relatórios</h1><p>Carregando…</p></section>;
  const s = data.summary;
  const maxRoom = Math.max(1, ...data.rooms.map((r) => r.visits));
  const maxHour = Math.max(1, ...data.hourly.map((h) => h.visits));
  const roomName = (r: { name: string; number: string | null }) => (r.number && !r.name.includes(r.number) ? `${r.name} (${r.number})` : r.name);

  return (
    <>
      <section className="ad-card">
        <h1>Relatórios</h1>
        <p className="ad-help">Os arquivos trazem a versão completa: resumo, piso, ambiente, ranking, conclusão, visitas por hora, lista de participantes e todas as visitas (o XLSX tem uma aba para cada). Contêm nomes de participantes: use só para a organização.</p>
        <div className="ad-actions">
          <button className="ad-btn ad-primary" type="button" disabled={busy !== ''} onClick={() => void save('pdf')}>{busy === 'pdf' ? 'Gerando…' : 'Baixar relatório PDF'}</button>
          <button className="ad-btn ad-primary" type="button" disabled={busy !== ''} onClick={() => void save('xlsx')}>{busy === 'xlsx' ? 'Gerando…' : 'Baixar relatório XLSX'}</button>
          <button className="ad-btn" type="button" onClick={() => void load()}>Atualizar números</button>
        </div>
        <p className="ad-help">Números de {formatDateTime(data.generatedAt)}.</p>
      </section>

      <div className="ad-stats">
        <div className="ad-stat"><b>{s.participants}</b><span>Participantes</span><small>{s.withVisit} com visita · {s.withoutVisit} sem</small></div>
        <div className="ad-stat"><b>{pctText(s.completionPct)}</b><span>Taxa de conclusão</span><small>{s.completed} concluíram</small></div>
        <div className="ad-stat"><b>{s.visits}</b><span>Visitas</span><small>média {String(s.avgVisits).replace('.', ',')} por pessoa</small></div>
        <div className="ad-stat"><b>{pctText(s.avgProgressPct)}</b><span>Progresso médio</span><small>{s.requiredRooms} obrigatórios ativos</small></div>
      </div>

      <section className="ad-card">
        <h2>Por piso</h2>
        <div className="ad-tablewrap"><table className="ad-table">
          <thead><tr><th>Piso</th><th>Ambientes</th><th>Obrig.</th><th>Visitas</th><th>Visitantes</th><th>Alcance</th></tr></thead>
          <tbody>{data.floors.map((f) => (
            <tr key={f.floor}><td>{f.floor}</td><td>{f.activeRooms}/{f.rooms}</td><td>{f.requiredRooms}</td><td>{f.visits}</td><td>{f.uniqueVisitors}</td><td>{pctText(f.reachPct)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="ad-card">
        <h2>Ambientes mais e menos visitados</h2>
        <div className="ad-two">
          <div><h3>Mais visitados</h3><ol className="ad-rank">{data.mostVisited.map((r) => <li key={r.rank}><span>{roomName(r)}</span><b>{r.visits}</b></li>)}</ol></div>
          <div><h3>Menos visitados</h3><ol className="ad-rank">{data.leastVisited.map((r) => <li key={r.rank}><span>{roomName(r)}</span><b>{r.visits}</b></li>)}</ol></div>
        </div>
      </section>

      <section className="ad-card">
        <h2>Conclusão dos obrigatórios</h2>
        <table className="ad-table"><tbody>{data.distribution.map((d) => (
          <tr key={d.label}><td>{d.label}</td><td style={{ width: '40%' }}><Bar value={d.pct} label={`${d.label}: ${pctText(d.pct)}`} /></td><td>{d.count} ({pctText(d.pct)})</td></tr>
        ))}</tbody></table>
      </section>

      <section className="ad-card">
        <h2>Todos os ambientes</h2>
        <div className="ad-tablewrap"><table className="ad-table">
          <thead><tr><th>#</th><th>Ambiente</th><th>Piso</th><th>Visitas</th><th>Alcance</th></tr></thead>
          <tbody>{data.rooms.map((r) => (
            <tr key={r.rank} className={r.active ? '' : 'is-off'}>
              <td>{r.rank}</td><td>{roomName(r)}{r.required && <small> · obrigatório</small>}{!r.active && <small> · inativo</small>}</td><td>{r.floor}</td>
              <td><Bar value={(r.visits / maxRoom) * 100} label={`${r.visits} visitas`} />{r.visits}</td><td>{pctText(r.reachPct)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>

      {data.hourly.length > 0 && (
        <section className="ad-card">
          <h2>Visitas por hora</h2>
          <table className="ad-table"><tbody>{data.hourly.map((h) => (
            <tr key={h.hour}><td>{h.hour}</td><td style={{ width: '55%' }}><Bar value={(h.visits / maxHour) * 100} label={`${h.visits} visitas`} /></td><td>{h.visits}</td></tr>
          ))}</tbody></table>
        </section>
      )}
    </>
  );
}

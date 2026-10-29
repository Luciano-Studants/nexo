import { AlertTriangle, Check, HelpCircle, LogOut, PartyPopper } from 'lucide-react';

import type { EventInfo, MapFloor, MapRoom, Progress as ProgressData } from '../api';
import { roomTitle } from '../roomState';
import { Collection } from './Collection';

type Props = {
  progress: ProgressData;
  floors: MapFloor[];
  event: EventInfo;
  onHelp: () => void;
  onLeave: () => void;
};

export function ProgressScreen({ progress, floors, event, onHelp, onLeave }: Props) {
  // Ordenado por piso e número/nome (como vem do servidor).
  const required: Array<{ room: MapRoom; floor: string }> = floors.flatMap((f) =>
    f.rooms.filter((r) => r.required).map((room) => ({ room, floor: f.name })),
  );
  const visited = required.filter((r) => r.room.visited);
  const pending = required.filter((r) => !r.room.visited);
  const pct = progress.requiredCount > 0 ? Math.round((progress.visitedCount / progress.requiredCount) * 100) : 0;

  return (
    <div className="progress">
      {progress.configurationError ? (
        <div className="notice notice-warn" role="status">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>Nenhum ambiente obrigatório foi definido ainda.</strong>
            <p>A coleção só começa depois que a organização escolher os ambientes. Avise a equipe se isso persistir.</p>
          </div>
        </div>
      ) : (
        <section className="card" aria-labelledby="prog-title">
          <h2 id="prog-title">Sua coleção</h2>
          <Collection visited={required.map((r) => r.room.visited)} completed={progress.completed} />
          <p className="big">{pct}%</p>
          <div
            className="bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.requiredCount}
            aria-valuenow={progress.visitedCount}
            aria-label="Ambientes visitados"
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="muted">
            {progress.visitedCount} de {progress.requiredCount} ambientes visitados · faltam{' '}
            {progress.requiredCount - progress.visitedCount}
          </p>

          {progress.completed && (
            <div className="notice notice-ok" role="status">
              <PartyPopper size={20} aria-hidden="true" />
              <div>
                <strong>Parabéns! Você completou a coleção.</strong>
                <p>Obrigado por explorar os espaços com a gente.</p>
              </div>
            </div>
          )}
          {!progress.completed && event.phase === 'ended' && (
            <div className="notice notice-warn" role="status">
              <AlertTriangle size={20} aria-hidden="true" />
              <div>
                <strong>O evento foi encerrado.</strong>
                <p>Este é o seu progresso final.</p>
              </div>
            </div>
          )}
        </section>
      )}

      {!progress.configurationError && (
        <>
          <section className="card" aria-labelledby="pend-title">
            <h3 id="pend-title">Ainda faltam ({pending.length})</h3>
            {pending.length === 0 ? (
              <p className="muted">Nada pendente.</p>
            ) : (
              <ul className="plain-list">
                {pending.map(({ room, floor }) => (
                  <li key={room.id}>
                    <span>{roomTitle(room)}</span>
                    <small>{floor}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" aria-labelledby="done-title">
            <h3 id="done-title">Já visitados ({visited.length})</h3>
            {visited.length === 0 ? (
              <p className="muted">Você ainda não visitou nenhum ambiente.</p>
            ) : (
              <ul className="plain-list">
                {visited.map(({ room, floor }) => (
                  <li key={room.id}>
                    <span>
                      <Check size={15} aria-hidden="true" /> {roomTitle(room)}
                    </span>
                    <small>{floor}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <div className="row-actions">
        <button className="btn btn-secondary" type="button" onClick={onHelp}>
          <HelpCircle size={18} aria-hidden="true" /> Como funciona
        </button>
        <button className="btn btn-ghost" type="button" onClick={onLeave}>
          <LogOut size={18} aria-hidden="true" /> Sair deste aparelho
        </button>
      </div>
    </div>
  );
}

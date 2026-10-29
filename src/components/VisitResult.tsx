import { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, PartyPopper, RotateCcw } from 'lucide-react';

import type { VisitResult as Data } from '../api';

export type Outcome =
  | { kind: 'ok'; data: Data }
  | { kind: 'error'; message: string; retry: boolean };

type Props = { outcome: Outcome; onContinue: (data?: Data) => void; onRetry: () => void; onSeeCollection?: () => void };

export function VisitResultDialog({ outcome, onContinue, onRetry, onSeeCollection }: Props) {
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    btn.current?.focus();
  }, []);

  if (outcome.kind === 'error') {
    return (
      <div className="sheet-backdrop">
        <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="vr-title" aria-describedby="vr-msg">
          <AlertCircle size={32} aria-hidden="true" className="vr-icon vr-bad" />
          <h2 id="vr-title">Não foi possível registrar</h2>
          <p id="vr-msg" className="sheet-desc">{outcome.message}</p>
          {outcome.retry && (
            <button ref={btn} className="btn btn-primary" type="button" onClick={onRetry}>
              <RotateCcw size={18} aria-hidden="true" /> Tentar de novo
            </button>
          )}
          <button
            ref={outcome.retry ? undefined : btn}
            className={`btn ${outcome.retry ? 'btn-ghost-dark' : 'btn-primary'}`}
            type="button"
            onClick={() => onContinue()}
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  const { data } = outcome;
  const { room, progress } = data;
  const isNew = data.status === 'registered';

  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="vr-title">
        {progress.completed && isNew ? (
          <PartyPopper size={34} aria-hidden="true" className="vr-icon vr-ok" />
        ) : (
          <CheckCircle2 size={34} aria-hidden="true" className="vr-icon vr-ok" />
        )}

        <h2 id="vr-title">
          {isNew ? 'Visita registrada!' : 'Você já visitou este ambiente'}
        </h2>
        <p className="sheet-meta">{room.floorName} · {room.name}</p>

        <p className="sheet-desc">
          {data.fragmentUnlocked && 'Você liberou uma peça da coleção.'}
          {isNew && !data.fragmentUnlocked && 'Este ambiente não conta para a coleção, mas sua visita foi registrada.'}
          {!isNew && 'Sua visita já estava registrada e não rende outra peça.'}
        </p>

        {!progress.configurationError && (
          <p className="vr-progress">
            {progress.visitedCount} de {progress.requiredCount} ambientes da coleção
          </p>
        )}

        {progress.completed && (
          <div className="notice notice-ok" role="status">
            <PartyPopper size={20} aria-hidden="true" />
            <div>
              <strong>Parabéns! Você completou a coleção.</strong>
              <p>Obrigado por explorar os espaços com a gente.</p>
            </div>
          </div>
        )}

        {data.fragmentUnlocked && onSeeCollection && (
          <button ref={btn} className="btn btn-primary" type="button" onClick={() => { onContinue(data); onSeeCollection(); }}>
            Ver minha coleção
          </button>
        )}
        <button
          ref={data.fragmentUnlocked && onSeeCollection ? undefined : btn}
          className={`btn ${data.fragmentUnlocked && onSeeCollection ? 'btn-ghost-dark' : 'btn-primary'}`}
          type="button"
          onClick={() => onContinue(data)}
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

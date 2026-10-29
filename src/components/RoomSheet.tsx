import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Lock, QrCode, X } from 'lucide-react';

import { roomPhotoUrl, type EventInfo, type MapRoom } from '../api';
import { STATE_SHORT, roomTitle, stateOf } from '../roomState';

type Props = {
  room: MapRoom;
  floorName: string;
  event: EventInfo;
  onClose: () => void;
  onScan: () => void;
};

export function RoomSheet({ room, floorName, event, onClose, onScan }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const state = stateOf(room);
  const photo = roomPhotoUrl(room);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const Icon = state === 'visited' ? Check : state === 'unavailable' ? Lock : Circle;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} className="icon-btn sheet-close" type="button" onClick={onClose} aria-label="Fechar detalhes">
          <X size={20} aria-hidden="true" />
        </button>

        <p className="sheet-meta">
          {floorName}
          {room.number ? ` · Sala ${room.number}` : ''}
        </p>
        <h2 id="room-title">{roomTitle(room)}</h2>

        {photo && !photoFailed && (
          <button type="button" className="room-photo" onClick={() => setZoom(true)} aria-label={`Ampliar foto do interior: ${room.name}`}>
            <img src={photo} alt={`Foto do interior: ${room.name}`} loading="lazy" decoding="async" onError={() => setPhotoFailed(true)} />
            <span className="room-photo-hint" aria-hidden="true">Toque para ampliar</span>
          </button>
        )}

        <p className={`state-chip is-${state}`}>
          <Icon size={15} aria-hidden="true" />
          {STATE_SHORT[state]}
          {state === 'required' && ' · conta para completar a coleção'}
          {state === 'visited' && ' · peça liberada'}
          {state === 'optional' && ' · não conta para a coleção'}
          {state === 'unavailable' && ' · fora do evento'}
        </p>

        <p className="sheet-desc">
          {room.description.trim() || 'A descrição deste ambiente ainda não foi informada.'}
        </p>

        {state !== 'unavailable' && !room.visited && (
          <>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!event.visitsAllowed}
              aria-describedby="qr-note"
              onClick={onScan}
            >
              <QrCode size={18} aria-hidden="true" />
              Ler QR Code
            </button>
            <p id="qr-note" className="help">
              {event.visitsAllowed
                ? 'Escaneie a etiqueta na porta deste ambiente para registrar a visita.'
                : 'As visitas serão liberadas na abertura do evento.'}
            </p>
          </>
        )}
      </div>

      {zoom && photo && (
        <div className="photo-zoom" role="dialog" aria-modal="true" aria-label={`Foto do interior: ${room.name}`} onClick={(e) => { e.stopPropagation(); setZoom(false); }}>
          <img src={photo} alt={`Foto do interior: ${room.name}`} />
          <button type="button" className="icon-btn photo-zoom-close" aria-label="Fechar foto" onClick={(e) => { e.stopPropagation(); setZoom(false); }}>
            <X size={22} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

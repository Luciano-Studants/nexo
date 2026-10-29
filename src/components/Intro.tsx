import { useEffect, useRef } from 'react';
import { Map as MapIcon, QrCode, Sparkles } from 'lucide-react';

export function Intro({ onClose }: { onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="intro-title">
        <h2 id="intro-title">Como funciona</h2>
        <ol className="steps">
          <li>
            <MapIcon size={22} aria-hidden="true" />
            <span><strong>Explore o mapa.</strong> Escolha o piso e toque em um ambiente para ver os detalhes.</span>
          </li>
          <li>
            <QrCode size={22} aria-hidden="true" />
            <span><strong>Leia o QR Code da sala.</strong> Ao chegar a um ambiente, escaneie a identificação na porta.</span>
          </li>
          <li>
            <Sparkles size={22} aria-hidden="true" />
            <span><strong>Complete a coleção.</strong> Cada ambiente obrigatório visitado libera uma peça da ilustração.</span>
          </li>
        </ol>
        <button ref={btn} className="btn btn-primary" type="button" onClick={onClose}>
          Começar a explorar
        </button>
      </div>
    </div>
  );
}

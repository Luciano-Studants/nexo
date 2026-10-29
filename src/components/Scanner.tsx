import { useEffect, useRef, useState, type FormEvent } from 'react';
import QrScanner from 'qr-scanner';
import { Keyboard, ScanLine, X } from 'lucide-react';

import { ApiError, type MapFloor } from '../api';
import { extractToken, formatTypedCode } from '../qr';
import { roomTitle } from '../roomState';

type Props = {
  floors: MapFloor[];
  // Câmera leu um QR do NEXO: o app registra a visita.
  onCode: (code: string) => void;
  // Código digitado: devolve erro (ApiError) para exibir aqui mesmo.
  onManual: (roomId: string, code: string) => Promise<void>;
  onClose: () => void;
  startInManual?: boolean;
};

function cameraProblem(error: unknown): string {
  if (!window.isSecureContext) {
    return 'A câmera só funciona em conexão segura (HTTPS). Digite o código da sala.';
  }
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || String(error).includes('NotAllowed')) {
    return 'O acesso à câmera foi negado. Permita a câmera nas configurações do navegador ou digite o código da sala.';
  }
  return 'Não foi possível usar a câmera neste aparelho. Digite o código da sala.';
}

export function Scanner({ floors, onCode, onManual, onClose, startInManual }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<'camera' | 'manual'>(startInManual ? 'manual' : 'camera');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const [roomId, setRoomId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (mode !== 'camera' || !videoRef.current) return;
    let done = false;
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        if (done) return;
        const token = extractToken(result.data);
        if (!token) {
          setHint('Esse QR Code não é do NEXO. Procure a etiqueta na porta da sala.');
          return;
        }
        done = true;
        scanner.stop();
        onCode(result.data);
      },
      {
        preferredCamera: 'environment',
        returnDetailedScanResult: true,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        maxScansPerSecond: 8,
      },
    );
    scanner.start().catch((e: unknown) => {
      setCameraError(cameraProblem(e));
      setMode('manual');
    });
    return () => {
      done = true;
      scanner.stop();
      scanner.destroy();
    };
  }, [mode, onCode]);

  const available = floors.map((f) => ({ ...f, rooms: f.rooms.filter((r) => r.available) }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!roomId) return setError('Escolha o ambiente.');
    if (code.replace('-', '').length !== 8) return setError('O código tem 8 caracteres (ex.: ABCD-EFGH).');
    setBusy(true);
    setError(null);
    try {
      await onManual(roomId, code);
    } catch (err) {
      if (err instanceof ApiError && err.extra?.attemptsLeft !== undefined) {
        setError(`${err.message} Tentativas restantes: ${err.extra.attemptsLeft}.`);
      } else {
        setError(err instanceof Error ? err.message : 'Não foi possível validar o código.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-labelledby="scan-title">
      <div className="scanner-bar">
        <h2 id="scan-title">{mode === 'camera' ? 'Aponte para o QR Code' : 'Digitar código da sala'}</h2>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Fechar leitor">
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      {mode === 'camera' ? (
        <>
          <div className="scanner-view">
            <video ref={videoRef} muted playsInline aria-label="Imagem da câmera" />
          </div>
          <div className="scanner-foot">
            <p role="status" className="scanner-hint">
              {hint ?? 'Escaneie a etiqueta na porta do ambiente.'}
            </p>
            <button className="btn btn-secondary" type="button" onClick={() => setMode('manual')}>
              <Keyboard size={18} aria-hidden="true" /> Digitar código
            </button>
          </div>
        </>
      ) : (
        <form className="scanner-manual" onSubmit={submit} noValidate>
          {cameraError && <p className="notice notice-warn" role="status">{cameraError}</p>}
          <label htmlFor="room">Ambiente</label>
          <select id="room" value={roomId} onChange={(e) => { setRoomId(e.target.value); setError(null); }}>
            <option value="">Escolha o ambiente…</option>
            {available.map((f) => (
              <optgroup key={f.id} label={f.name}>
                {f.rooms.map((r) => (
                  <option key={r.id} value={r.id}>{roomTitle(r)}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <label htmlFor="manual-code">Código impresso na etiqueta</label>
          <input
            id="manual-code"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD-EFGH"
            value={code}
            onChange={(e) => { setCode(formatTypedCode(e.target.value)); setError(null); }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'manual-error' : undefined}
          />
          {error && <p id="manual-error" className="field-error" role="alert">{error}</p>}

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Validando…' : 'Registrar visita'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => { setCameraError(null); setMode('camera'); }}>
            <ScanLine size={18} aria-hidden="true" /> Usar a câmera
          </button>
        </form>
      )}
    </div>
  );
}

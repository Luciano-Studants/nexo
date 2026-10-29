import { useState, type FormEvent } from 'react';
import { ArrowRight, Compass, ShieldCheck } from 'lucide-react';

import { Avatar } from '../avatars';
import { api, ApiError, type EventInfo, type Participant } from '../api';

type Props = {
  event: EventInfo;
  onEntered: (participant: Participant, token: string) => void;
};

type Candidate = { fullName: string; avatarKey: string; visitedCount: number };

// Mesma regra do servidor: nome e sobrenome, cada um com pelo menos 2 letras.
export function validateFullName(value: string): string | null {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Informe seu nome completo.';
  if (clean.length > 160) return 'O nome deve ter no máximo 160 caracteres.';
  if (!/^[\p{L}][\p{L}\p{M}'’.\- ]*$/u.test(clean)) return 'Use apenas letras no nome.';
  const parts = clean.split(' ').filter((p) => p.replace(/[^\p{L}]/gu, '').length >= 2);
  if (parts.length < 2) return 'Informe nome e sobrenome.';
  return null;
}

export function Entry({ event, onEntered }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);

  async function send(decision?: 'resume' | 'new') {
    setBusy(true);
    setError(null);
    try {
      const result = await api.enter(name, decision);
      if (result.status === 'resume_available') {
        setCandidate(result.candidate);
      } else {
        onEntered(result.participant, result.token);
      }
    } catch (e) {
      setCandidate(null);
      if (e instanceof ApiError && e.fieldErrors?.length) {
        setError(e.fieldErrors.map((f) => f.message).join(' '));
      } else {
        setError(e instanceof Error ? e.message : 'Não foi possível entrar agora.');
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = validateFullName(name);
    if (problem) {
      setError(problem);
      return;
    }
    void send();
  }

  if (!event.registrationAllowed) {
    return (
      <section className="entry card-dark" aria-labelledby="entry-title">
        <h1 id="entry-title">O evento foi encerrado</h1>
        <p className="lead">Obrigado por participar! Não é possível criar novos perfis.</p>
      </section>
    );
  }

  if (candidate) {
    return (
      <section className="entry card-dark" aria-labelledby="resume-title">
        <h1 id="resume-title">É você?</h1>
        <p className="lead">Encontramos um perfil recente com esse nome neste aparelho ou rede.</p>
        <div className="candidate">
          <Avatar avatarKey={candidate.avatarKey} size={56} />
          <div>
            <strong>{candidate.fullName}</strong>
            <span>
              {candidate.visitedCount === 1
                ? '1 ambiente visitado'
                : `${candidate.visitedCount} ambientes visitados`}
            </span>
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void send('resume')}>
            Sim, continuar de onde parei
          </button>
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void send('new')}>
            Não, criar um novo perfil
          </button>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="entry card-dark" aria-labelledby="entry-title">
      <div className="eyebrow"><Compass size={15} aria-hidden="true" /> {event.name}</div>
      <h1 id="entry-title">
        Explore espaços.
        <br />
        <em>Descubra possibilidades.</em>
      </h1>
      <p className="lead">
        Informe seu nome completo para abrir o mapa. Não precisa de senha nem de e-mail.
      </p>

      <form onSubmit={submit} noValidate>
        <label htmlFor="fullName">Nome completo</label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          maxLength={160}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'name-error name-help' : 'name-help'}
          placeholder="Ex.: Maria da Silva"
        />
        <p id="name-help" className="help">Nome e sobrenome, para evitar confusão com outros visitantes.</p>
        {error && <p id="name-error" className="field-error" role="alert">{error}</p>}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar e ver o mapa'}
          {!busy && <ArrowRight size={18} aria-hidden="true" />}
        </button>
      </form>

      <p className="privacy">
        <ShieldCheck size={17} aria-hidden="true" />
        <span>
          Seu nome é usado só para registrar seu progresso neste evento e fica guardado por até 30
          dias. Seu acesso fica salvo neste aparelho.
        </span>
      </p>
    </section>
  );
}

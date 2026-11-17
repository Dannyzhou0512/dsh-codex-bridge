import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives';
import type { SourceDraft, SourceSaveResult, SourceTestResult } from '../shared.js';
import type { LocaleKey } from './locales.js';

export interface SourceSetupActions {
  readonly suggestions: () => Promise<SourceDraft>;
  readonly test: (draft: SourceDraft) => Promise<SourceTestResult>;
  readonly save: (ticket: string) => Promise<SourceSaveResult>;
  readonly enableWrites: () => Promise<SourceSaveResult>;
}

interface Props {
  readonly actions: SourceSetupActions;
  readonly label: (key: LocaleKey) => string;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}

const empty: SourceDraft = { executable: '', codexHome: '', cwd: '' };

export function SourceSetupForm({ actions, label, onCancel, onSaved }: Props) {
  const id = useId();
  const [draft, setDraft] = useState(empty);
  const [phase, setPhase] = useState<'loading' | 'test' | 'save' | 'idle'>('loading');
  const [notice, setNotice] = useState<LocaleKey | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const alive = useRef(false);

  useEffect(() => {
    let current = true;
    alive.current = true;
    void actions.suggestions().then(value => {
      if (current) setDraft(value);
    }, () => {
      if (current) setNotice('setup-no-suggestions');
    }).finally(() => {
      if (current) setPhase('idle');
    });
    return () => { current = false; alive.current = false; };
  }, [actions]);

  const update = (key: keyof SourceDraft, value: string) => {
    setDraft(previous => ({ ...previous, [key]: value }));
    setTicket(null);
    setNotice(null);
  };
  const test = async () => {
    setPhase('test'); setTicket(null); setNotice(null);
    try {
      const result = await actions.test({ executable: draft.executable.trim(), codexHome: draft.codexHome.trim(), cwd: draft.cwd.trim() });
      if (alive.current) { setTicket(result.ticket); setNotice(result.state); }
    } catch {
      if (alive.current) setNotice('setup-connection');
    } finally { if (alive.current) setPhase('idle'); }
  };
  const save = async () => {
    if (ticket === null) return;
    setPhase('save'); setNotice(null);
    try {
      const result = await actions.save(ticket);
      if (!alive.current) return;
      if (result === 'setup-saved') onSaved();
      else {
        if (result !== 'setup-cancelled') setTicket(null);
        setNotice(result);
      }
    } catch {
      if (alive.current) { setTicket(null); setNotice('setup-save-failed'); }
    } finally { if (alive.current) setPhase('idle'); }
  };
  const pending = phase !== 'idle';
  const outcome = phase === 'loading' ? 'setup-loading' : phase === 'test' || phase === 'save' ? 'setup-confirm-windows' : notice;
  const alert = Boolean(notice && notice !== 'setup-connected' && notice !== 'setup-empty');
  return <section className="dsh-codex-setup" aria-labelledby={id} aria-busy={pending}>
    <h2 id={id}>{label('setup-title')}</h2>
    <div className="dsh-codex-setup-field">
      <label htmlFor={id + '-exe'}>{label('setup-program')}</label>
      <Input id={id + '-exe'} type="text" value={draft.executable} disabled={pending} maxLength={512}
        spellCheck={false} aria-describedby={id + '-exe-help'} aria-invalid={notice === 'setup-executable'} onChange={event => update('executable', event.target.value)} />
      <p id={id + '-exe-help'}>{label('setup-program-help')}</p>
    </div>
    <div className="dsh-codex-setup-field">
      <label htmlFor={id + '-home'}>{label('setup-history')}</label>
      <Input id={id + '-home'} type="text" value={draft.codexHome} disabled={pending} maxLength={512}
        spellCheck={false} aria-describedby={id + '-home-help'} aria-invalid={notice === 'setup-directory'} onChange={event => update('codexHome', event.target.value)} />
      <p id={id + '-home-help'}>{label('setup-history-help')}</p>
    </div>
    <details className="dsh-codex-setup-field">
      <summary>{label('setup-advanced')}</summary>
      <label htmlFor={id + '-cwd'}>{label('setup-startup')}</label>
      <Input id={id + '-cwd'} type="text" value={draft.cwd} disabled={pending} maxLength={512}
        spellCheck={false} aria-invalid={notice === 'setup-cwd'} onChange={event => update('cwd', event.target.value)} />
      <p>{label('setup-startup-help')}</p>
    </details>
    {outcome && <p role={alert && !pending ? 'alert' : 'status'}>{label(outcome)}</p>}
    <div className="dsh-codex-toolbar">
      <Button onClick={() => { void test(); }} disabled={pending || !draft.executable.trim() || !draft.codexHome.trim()}>{label('setup-test')}</Button>
      <Button variant="outline" onClick={() => { void save(); }} disabled={pending || !ticket}>{label('setup-save')}</Button>
      <Button variant="ghost" disabled={phase === 'test' || phase === 'save'} onClick={onCancel}>{label('setup-cancel')}</Button>
    </div>
  </section>;
}

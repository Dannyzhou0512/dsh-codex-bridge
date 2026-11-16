import { useId } from 'react';
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import type { HistoryOutcome, HistoryReview, ThreadRow } from '../shared.js';
import { lossLabels, type LocaleKey } from './locales.js';

export interface SingleImportState {
  readonly thread: ThreadRow;
  readonly remapCwd: string;
  readonly review: HistoryReview | null;
  readonly outcome: HistoryOutcome | null;
}

interface Props {
  readonly state: SingleImportState;
  readonly label: (key: LocaleKey) => string;
  readonly busy: boolean;
  readonly error: 'read' | 'write' | null;
  readonly writeEnabled: boolean;
  readonly onClose: () => void;
  readonly onRemap: (cwd: string) => void;
  readonly onReview: () => void;
  readonly onConfirm: (dryRun: boolean) => void;
}

export function SingleImport({ state, label, busy, error, writeEnabled, onClose, onRemap, onReview, onConfirm }: Props) {
  const inputId = useId();
  const row = state.review?.rows[0];
  const result = state.outcome?.rows[0];
  const imported = row?.state === 'already-imported' || result?.state === 'already-imported';
  const completed = result?.state === 'completed';
  const failed = Boolean(result && !['dry-run', 'completed', 'already-imported'].includes(result.state));
  const eligible = row?.state === 'needs-review' || row?.state === 'ready';
  const canConfirm = eligible && !busy && !error && !failed && !completed && !imported;
  const blockers = row?.blockers.filter(value => !value.startsWith('consent-required:')) ?? [];

  return <Modal open onClose={onClose} title={label('singleTitle')} closeLabel={label('close')} className="dsh-codex-import-dialog"
    contentClassName="dsh-codex-import-content" footer={<div className="dsh-codex-import-actions">
      <Button variant="outline" disabled={busy} onClick={onClose}>{label('close')}</Button>
      {canConfirm&&<>
        <Button variant="outline" onClick={()=>onConfirm(true)}>{label('dryOnly')}</Button>
        {writeEnabled&&<Button onClick={()=>onConfirm(false)}>{label(row.losses.length ? 'acceptAndImport' : 'importOneConfirm')}</Button>}
      </>}
      {!canConfirm&&!busy&&!imported&&!completed&&<Button onClick={onReview}>{label('checkAgain')}</Button>}
    </div>}>
    <div className="dsh-codex-import-summary" aria-busy={busy}>
      <strong>{(row ? row.title : state.thread.title) ?? label('noTitle')}</strong>
      <p className="dsh-codex-meta">{state.thread.id}</p>

      {row?.targetCwd&&!imported&&<p><strong>{label('target')}</strong><br/>{row.targetCwd}
        {row.workspaceAction&&<small>{label(row.workspaceAction === 'create' ? 'createWorkspace' : 'reuseWorkspace')}</small>}
      </p>}
      {row?.state==='needs-remap'&&<p role="alert">{label('remapRequired')}</p>}
      {!imported&&!completed&&<details open={row?.state==='needs-remap'||Boolean(state.remapCwd)||(!row&&!busy)}>
        <summary>{label('remap')}</summary>
        <label htmlFor={inputId}>{label('target')}</label>
        <Input id={inputId} type="text" value={state.remapCwd} disabled={busy} onChange={event=>onRemap(event.target.value)}/>
        <p className="dsh-codex-meta">{label('remapHint')}</p>
      </details>}

      {!!row?.losses.length&&!imported&&!completed&&<section>
        <h3>{label('conversionChanges')}</h3>
        <ul>{row.losses.map(loss=><li key={loss}>{lossLabels[loss] ? label(lossLabels[loss]) : loss}</li>)}</ul>
      </section>}
      {!eligible&&!imported&&blockers.length>0&&<details open={row?.state!=='needs-remap'}><summary>{label('blockers')}</summary><ul>{blockers.map(reason=><li key={reason}>{reason}</li>)}</ul></details>}
      {!!row?.warnings.length&&!imported&&!completed&&<details><summary>{label('warnings')}</summary><p>{row.warnings.join(', ')}</p></details>}

      {busy&&<p role="status">{label('busy')}</p>}
      {error&&<p role="alert">{label(error==='write'?'writeUnconfirmed':'error')}</p>}
      {!busy&&imported&&<p role="status">{label('alreadyThere')}</p>}
      {!busy&&completed&&<p role="status">{label('singleCompleted')}</p>}
      {!busy&&result?.state==='dry-run'&&<p role="status">{label('trialPassed')}</p>}
      {failed&&<p role="alert">{label(result?.mayHaveCommitted?'writeUnconfirmed':result?.state==='stale-plan'?'reviewChanged':'singleFailed')}
        {result?.reason&&<small>{result.reason}</small>}
      </p>}
      {eligible&&!writeEnabled&&!completed&&<p>{label('writeDisabled')}</p>}
    </div>
  </Modal>;
}

import type { ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ThreadRow, HistoryPreview, ReviewSelection, HistoryReview, HistoryOutcome } from '../shared.js';
import { lossLabels, type LocaleKey } from './locales.js';
type Label = (key: LocaleKey) => string;
function time(value: number): string { return new Date(value).toLocaleString(); }
export function ThreadRows({rows,selected,batchMode,active,busy,label,onSelect,onPreview,onImport}:{rows:readonly ThreadRow[];selected:readonly ReviewSelection[];batchMode:boolean;active:string|null;busy:boolean;label:Label;onSelect:(id:string,checked:boolean)=>void;onPreview:(id:string)=>void;onImport:(row:ThreadRow)=>void}):ReactNode {
  return <ul className="dsh-codex-rows">{rows.map(row=>{
    const checked=selected.some(selection=>selection.threadId===row.id);
    const title=<strong>{row.title??label('noTitle')}</strong>;
    return <li key={row.id} data-active={active===row.id}>
    <div className="dsh-codex-row-title">{batchMode?<label><input type="checkbox" checked={checked} disabled={busy||(!checked&&selected.length>=20)} onChange={e=>onSelect(row.id,e.target.checked)} aria-label={`${label('choose')}: ${row.title??row.id}`}/>{title}</label>:title}
    <div className="dsh-codex-row-actions">
      <Button variant="outline" size="sm" disabled={busy} onClick={()=>onPreview(row.id)}>{label('preview')}</Button>
      {!batchMode&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>onImport(row)}>{label('importOne')}</Button>}
    </div></div>
    <div className="dsh-codex-meta">{row.id} · {row.status}</div><p>{row.cwd}</p>
    <div className="dsh-codex-meta">{label('created')}: {time(row.createdAtMs)}<br/>{label('updated')}: {time(row.updatedAtMs)} · {label('unknownCounts')}</div>
  </li>;})}</ul>;
}
export function ThreadInspector({preview,selected,busy,label,onEdit,onImport}:{preview:HistoryPreview|null;selected:ReviewSelection|undefined;busy:boolean;label:Label;onEdit:(changes:Partial<ReviewSelection>)=>void;onImport:(()=>void)|undefined}):ReactNode {
  if(!preview)return <aside className="dsh-codex-inspector"><h2>{label('noPreview')}</h2><p>{label('previewHint')}</p></aside>;
  return <aside className="dsh-codex-inspector"><div className="dsh-codex-row-title dsh-codex-inspector-heading"><h2>{label('preview')}</h2>
    {onImport&&<Button size="sm" disabled={busy} onClick={onImport}>{label('importPreview')}</Button>}</div>
    <p className="dsh-codex-meta">{preview.threadId}<br/>{label('counts')}: {preview.turns} / {preview.messages} / {preview.tools}</p>
    {selected&&<><fieldset disabled={busy}><label htmlFor="codex-remap">{label('remap')}</label><input id="codex-remap" type="text" value={selected.remapCwd??''} onChange={e=>onEdit({remapCwd:e.target.value.trim()?e.target.value:null})}/><p>{label('remapHint')}</p>
      </fieldset><fieldset disabled={busy}><legend>{label('losses')}</legend>{preview.losses.map(loss=><label className="dsh-codex-loss" key={loss}><input type="checkbox" checked={selected.acceptedLosses.includes(loss)} onChange={e=>onEdit({acceptedLosses:e.target.checked?[...selected.acceptedLosses,loss]:selected.acceptedLosses.filter(x=>x!==loss)})}/>{lossLabels[loss]?label(lossLabels[loss]):loss}</label>)}</fieldset></>}
    {preview.truncated&&<p role="status">{label('truncated')}</p>}
    <div className="dsh-codex-messages">{preview.messagesView.map((message,index)=><article key={index}><strong>{message.category}</strong><pre>{message.text}</pre></article>)}</div>
  </aside>;
}
export function PlanRows({review,label}:{review:HistoryReview;label:Label}):ReactNode {
  return <div><h2>{label('reviewTitle')}</h2><p>{label('expiry')}</p><ul className="dsh-codex-review">{review.rows.map(row=><li key={row.threadId}><strong>{row.threadId}</strong><p>{row.sessionId}</p><p>{label('state')}: {row.state} · {row.workspaceAction??'—'}<br/>{label('target')}: {row.targetCwd??'—'}</p>
    {row.losses.length>0&&<p>{label('losses')}: {row.losses.join(', ')}</p>}{row.blockers.length>0&&<p>{label('blockers')}: {row.blockers.join(', ')}</p>}{row.warnings.length>0&&<details><summary>{label('warnings')}</summary><p>{row.warnings.join(', ')}</p></details>}</li>)}</ul></div>;
}
export function ResultRows({outcome,label}:{outcome:HistoryOutcome;label:Label}):ReactNode {
  return <section aria-live="polite"><h2>{label('results')} · {outcome.dryRun?'dry-run':'import'}</h2><ul className="dsh-codex-review">{outcome.rows.map(row=><li key={row.threadId}><strong>{row.threadId} · {row.state}</strong><p>{row.sessionId}</p>{row.reason&&<p>{row.reason}</p>}{row.verified&&<p>{label('verified')}</p>}{row.mayHaveCommitted&&row.state!=='completed'&&<p>{label('mayCommitted')}</p>}{row.warnings.length>0&&<p>{row.warnings.join(', ')}</p>}</li>)}</ul></section>;
}

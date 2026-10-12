/** Browser-only history workflow. Host owns executable config and all original plans. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import type { BridgeUiStatus, HistoryList, HistoryPreview, HistoryReview, HistoryOutcome, ReviewSelection, ThreadRow } from '../shared.js';
import type { LocaleKey } from './locales.js';
import { ThreadRows, ThreadInspector, PlanRows, ResultRows } from './HistoryPanels.js';
export interface PageFace {
  readonly read:()=>Promise<BridgeUiStatus>; readonly label:(key:LocaleKey)=>string;
  readonly list:(archived:boolean)=>Promise<HistoryList>;
  readonly preview:(threadId:string)=>Promise<HistoryPreview>;
  readonly review:(selections:readonly ReviewSelection[])=>Promise<HistoryReview>;
  readonly execute:(handle:string,digest:string,dryRun:boolean)=>Promise<HistoryOutcome>;
}
export function CodexHistoryPage({read,label,list,preview,review,execute}:PageFace):ReactNode {
  const [status,setStatus]=useState<BridgeUiStatus|null>(null),[phase,setPhase]=useState<'loading'|'ready'|'error'>('loading');
  const [busy,setBusy]=useState(false),[error,setError]=useState<'read'|'write'|null>(null),[archived,setArchived]=useState(false);
  const [rows,setRows]=useState<readonly ThreadRow[]>([]),[selected,setSelected]=useState<readonly ReviewSelection[]>([]);
  const [inspector,setInspector]=useState<HistoryPreview|null>(null),[plan,setPlan]=useState<HistoryReview|null>(null),[outcome,setOutcome]=useState<HistoryOutcome|null>(null),[confirmed,setConfirmed]=useState(false);
  const alive=useRef(false),revision=useRef(0),running=useRef(false);
  const refresh=async():Promise<void>=>{const id=++revision.current;setPhase('loading');try{const value=await read();if(alive.current&&id===revision.current){setStatus(value);setPhase('ready');}}catch{if(alive.current&&id===revision.current)setPhase('error');}};
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;revision.current++;};},[read]);
  const action=async<T,>(call:()=>Promise<T>,receive:(value:T)=>void,write=false):Promise<void>=>{
    if(running.current)return;running.current=true;setBusy(true);setError(null);const id=revision.current;
    try{const value=await call();if(alive.current&&id===revision.current)receive(value);}catch{if(alive.current&&id===revision.current)setError(write?'write':'read');}finally{running.current=false;if(alive.current&&id===revision.current)setBusy(false);}
  };
  const invalidate=():void=>{setPlan(null);setOutcome(null);setConfirmed(false);};
  const select=(threadId:string,checked:boolean):void=>{invalidate();setSelected(previous=>checked?[...previous,{threadId,remapCwd:null,acceptedLosses:[]}]:previous.filter(row=>row.threadId!==threadId));};
  const edit=(changes:Partial<ReviewSelection>):void=>{invalidate();setSelected(previous=>previous.map(row=>row.threadId===inspector?.threadId?{...row,...changes}:row));};
  const dryPassed=Boolean(outcome?.dryRun&&outcome.rows.length&&outcome.rows.every(row=>row.state==='dry-run'));
  const ready=Boolean(plan?.rows.length&&plan.rows.every(row=>row.state==='ready'||row.state==='already-imported'));
  return <section className="dsh-codex-ui" aria-label={label('title')}>
    <header><div><h1>{label('title')}</h1><p>{label('intro')}</p></div><Button variant="outline" size="sm" disabled={phase==='loading'||busy} onClick={()=>{void refresh();}}>{label('refresh')}</Button></header>
    <div role={phase==='error'?'alert':'status'} aria-live="polite" className="dsh-codex-ui-state">{label(phase==='loading'?'loading':phase==='error'?'error':'connected')}</div>
    {phase==='ready'&&status&&<>
      {status.sourceState!=='configured'?<><h2>{label('source')}</h2><p>{label(status.sourceState==='invalid-config'?'invalid':'pending')}</p><dl>{status.capabilities.map(c=><div key={c.name}><dt>{label(c.name as LocaleKey)}</dt><dd>{label(c.available?'available':'missing')}</dd></div>)}</dl></>:<>
        <div className="dsh-codex-toolbar"><label><input type="checkbox" checked={archived} disabled={busy} onChange={e=>{setArchived(e.target.checked);setRows([]);setSelected([]);setInspector(null);invalidate();}}/>{label('archived')}</label>
          <Button variant="outline" size="sm" disabled={busy} onClick={()=>{invalidate();setSelected([]);setInspector(null);void action(()=>list(archived),value=>setRows(value.rows));}}>{label('scan')}</Button><span>{label('selected')}: {selected.length} / 20</span></div>
        {busy&&<p role="status">{label('busy')}</p>}{error&&<p role="alert">{label(error==='write'?'writeUnconfirmed':'error')}</p>}
        <div className="dsh-codex-browser"><div>{rows.length?<ThreadRows rows={rows} selected={selected} active={inspector?.threadId??null} busy={busy} label={label} onSelect={select} onPreview={id=>{setInspector(null);void action(()=>preview(id),setInspector);}}/>:<><h2>{label('empty')}</h2><p>{label('emptyHint')}</p></>}</div>
          <ThreadInspector preview={inspector} selected={selected.find(row=>row.threadId===inspector?.threadId)} busy={busy} label={label} onEdit={edit}/></div>
        <div className="dsh-codex-toolbar"><Button variant="outline" size="sm" disabled={busy||!selected.length} onClick={()=>{invalidate();void action(()=>review(selected),setPlan);}}>{label('review')}</Button></div>
        {plan&&<><PlanRows review={plan} label={label}/><div className="dsh-codex-toolbar"><Button variant="outline" size="sm" disabled={busy||!ready} onClick={()=>{setOutcome(null);setConfirmed(false);void action(()=>execute(plan.handle,plan.digest,true),setOutcome);}}>{label('dry')}</Button></div>
          <p>{label(status.importEnabled?'dryRequired':'writeDisabled')}</p><label className="dsh-codex-loss"><input type="checkbox" checked={confirmed} disabled={busy||!dryPassed||!status.importEnabled} onChange={e=>setConfirmed(e.target.checked)}/>{label('confirm')}</label>
          <Button variant="outline" size="sm" disabled={busy||!ready||!dryPassed||!confirmed||!status.importEnabled} onClick={()=>{setConfirmed(false);setPlan(null);setOutcome(null);void action(()=>execute(plan.handle,plan.digest,false),setOutcome,true);}}>{label('write')}</Button></>}
        {outcome&&<ResultRows outcome={outcome} label={label}/>}</>}
    </>}
  </section>;
}

/** Browser-only history workflow. Host owns executable config and all original plans. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import type { BridgeUiStatus, HistoryList, HistoryPreview, HistoryReview, HistoryOutcome, ReviewSelection, ThreadRow } from '../shared.js';
import type { LocaleKey } from './locales.js';
import { ThreadRows, ThreadInspector, PlanRows, ResultRows } from './HistoryPanels.js';
import { SingleImport, type SingleImportState } from './SingleImport.js';
import { SourceSetupForm, type SourceSetupActions } from './SourceSetupForm.js';
export interface PageFace {
  readonly read:()=>Promise<BridgeUiStatus>; readonly label:(key:LocaleKey)=>string;
  readonly list:(archived:boolean)=>Promise<HistoryList>;
  readonly preview:(threadId:string)=>Promise<HistoryPreview>;
  readonly review:(selections:readonly ReviewSelection[])=>Promise<HistoryReview>;
  readonly execute:(handle:string,digest:string,dryRun:boolean)=>Promise<HistoryOutcome>;
  readonly confirmSingle:(handle:string,digest:string,dryRun:boolean)=>Promise<HistoryOutcome>;
  readonly setup: SourceSetupActions;
}
export function CodexHistoryPage({read,label,list,preview,review,execute,confirmSingle,setup}:PageFace):ReactNode {
  const [status,setStatus]=useState<BridgeUiStatus|null>(null),[phase,setPhase]=useState<'loading'|'ready'|'error'>('loading');
  const [busy,setBusy]=useState(false),[error,setError]=useState<'read'|'write'|null>(null),[archived,setArchived]=useState(false);
  const [rows,setRows]=useState<readonly ThreadRow[]>([]),[selected,setSelected]=useState<readonly ReviewSelection[]>([]);
  const [inspector,setInspector]=useState<HistoryPreview|null>(null),[plan,setPlan]=useState<HistoryReview|null>(null),[outcome,setOutcome]=useState<HistoryOutcome|null>(null),[confirmed,setConfirmed]=useState(false);
  const [single,setSingle]=useState<SingleImportState|null>(null);
  const [batchMode,setBatchMode]=useState(false);
  const [showSetup,setShowSetup]=useState(false),[setupNotice,setSetupNotice]=useState<LocaleKey|null>(null);
  const alive=useRef(false),revision=useRef(0),running=useRef(false);
  const refresh=async():Promise<void>=>{const id=++revision.current;setPhase('loading');try{const value=await read();if(alive.current&&id===revision.current){setStatus(value);setPhase('ready');}}catch{if(alive.current&&id===revision.current)setPhase('error');}};
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;revision.current++;};},[read]);
  const action=async<T,>(call:()=>Promise<T>,receive:(value:T)=>void,write=false):Promise<void>=>{
    if(running.current)return;running.current=true;setBusy(true);setError(null);const id=revision.current;
    try{const value=await call();if(alive.current&&id===revision.current)receive(value);}catch{if(alive.current&&id===revision.current)setError(write?'write':'read');}finally{running.current=false;if(alive.current&&id===revision.current)setBusy(false);}
  };
  const invalidate=():void=>{setPlan(null);setOutcome(null);setConfirmed(false);};
  const resetHistory=():void=>{setRows([]);setSelected([]);setInspector(null);setSingle(null);setError(null);invalidate();};
  const onSourceSaved=():void=>{setShowSetup(false);setArchived(false);resetHistory();void refresh();};
  const enableWrites=():void=>{
    setSetupNotice(null);
    void action(setup.enableWrites,result=>{
      if(result!=='setup-saved'){setSetupNotice(result);return;}
      setSetupNotice('setup-writes-on');
      setBusy(false);
      onSourceSaved();
    });
  };
  const select=(threadId:string,checked:boolean):void=>{invalidate();setSelected(previous=>checked?[...previous,{threadId,remapCwd:null,acceptedLosses:[]}]:previous.filter(row=>row.threadId!==threadId));};
  const edit=(changes:Partial<ReviewSelection>):void=>{invalidate();setSelected(previous=>previous.map(row=>row.threadId===inspector?.threadId?{...row,...changes}:row));};
  const checkSingle=(thread:ThreadRow,remapCwd:string):void=>{
    setSetupNotice(null);
    const draft={thread,remapCwd,review:null,outcome:null};
    setSingle(draft);
    void action(()=>review([{threadId:thread.id,remapCwd:remapCwd.trim()||null,acceptedLosses:[]}]),value=>setSingle({...draft,review:value}));
  };
  const runSingle=(dryRun:boolean):void=>{
    const current=single?.review;
    if(!single||!current)return;
    void action(()=>confirmSingle(current.handle,current.digest,dryRun),value=>setSingle({...single,outcome:value}),!dryRun);
  };
  const dryPassed=Boolean(outcome?.dryRun&&outcome.rows.length&&outcome.rows.every(row=>row.state==='dry-run'));
  const ready=Boolean(plan?.rows.length&&plan.rows.every(row=>row.state==='ready'||row.state==='already-imported'));
  const previewed=rows.find(row=>row.id===inspector?.threadId);
  return <section className="dsh-codex-ui" aria-label={label('title')} tabIndex={0}>
    <header><div><h1>{label('title')}</h1><p>{label('intro')}</p></div>
      {!showSetup&&<Button variant="outline" size="sm" disabled={phase==='loading'||busy} onClick={()=>{setSetupNotice(null);void refresh();}}>{label('refresh')}</Button>}
    </header>
    <div role={phase==='error'?'alert':'status'} aria-live="polite" className="dsh-codex-ui-state">{label(phase==='loading'?'loading':phase==='error'?'error':'connected')}</div>
    {phase==='ready'&&status&&<>
      {showSetup&&status.setupAvailable?<SourceSetupForm actions={setup} label={label} onCancel={()=>setShowSetup(false)} onSaved={onSourceSaved}/>
        :status.sourceState!=='configured'?<><h2>{label('source')}</h2><p>{label(status.sourceState==='invalid-config'?'invalid':'pending')}</p>
          {status.setupAvailable?<Button onClick={()=>setShowSetup(true)}>{label('setup-title')}</Button>:<p>{label('setup-unavailable')}</p>}
          <dl>{status.capabilities.map(c=><div key={c.name}><dt>{label(c.name as LocaleKey)}</dt><dd>{label(c.available?'available':'missing')}</dd></div>)}</dl></>:<>
        <div className="dsh-codex-toolbar"><label><input type="checkbox" checked={archived} disabled={busy} onChange={e=>{setArchived(e.target.checked);setRows([]);setSelected([]);setInspector(null);invalidate();}}/>{label('archived')}</label>
          <Button variant="outline" size="sm" disabled={busy} onClick={()=>{invalidate();setSelected([]);setInspector(null);void action(()=>list(archived),value=>setRows(value.rows));}}>{label('scan')}</Button>
          {status.setupAvailable&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>{setSetupNotice(null);setShowSetup(true);}}>{label('setup-change')}</Button>}
          <Button variant="outline" size="sm" aria-pressed={batchMode} disabled={busy} onClick={()=>{
            setBatchMode(!batchMode);setSelected([]);invalidate();setError(null);
          }}>{label('batchMode')}</Button>
          {batchMode&&<><span>{label('selected')}: {selected.length} / 20</span>
            <Button variant="outline" size="sm" disabled={busy||!selected.length} onClick={()=>{invalidate();void action(()=>review(selected),setPlan);}}>{label('review')}</Button>
          </>}
        </div>
        {!single&&busy&&<p role="status">{label('busy')}</p>}{!single&&error&&<p role="alert">{label(error==='write'?'writeUnconfirmed':'error')}</p>}
        {!single&&setupNotice&&<p role={setupNotice==='setup-writes-on'?'status':'alert'}>{label(setupNotice)}</p>}
        {plan&&<><PlanRows review={plan} label={label}/><div className="dsh-codex-toolbar"><Button variant="outline" size="sm" disabled={busy||!ready} onClick={()=>{setOutcome(null);setConfirmed(false);void action(()=>execute(plan.handle,plan.digest,true),setOutcome);}}>{label('dry')}</Button></div>
          <p>{label(status.importEnabled?'dryRequired':'writeDisabled')}</p><label className="dsh-codex-loss"><input type="checkbox" checked={confirmed} disabled={busy||!dryPassed||!status.importEnabled} onChange={e=>setConfirmed(e.target.checked)}/>{label('confirm')}</label>
          {status.setupAvailable&&!status.importEnabled&&dryPassed&&<Button variant="outline" size="sm" disabled={busy} onClick={enableWrites}>{label('setup-enable-writes')}</Button>}
          <Button variant="outline" size="sm" disabled={busy||!ready||!dryPassed||!confirmed||!status.importEnabled} onClick={()=>{setConfirmed(false);setPlan(null);setOutcome(null);void action(()=>execute(plan.handle,plan.digest,false),setOutcome,true);}}>{label('write')}</Button></>}
        {outcome&&<ResultRows outcome={outcome} label={label}/>}
        <div className="dsh-codex-browser"><div>{rows.length?<ThreadRows rows={rows} selected={selected} batchMode={batchMode} active={inspector?.threadId??null} busy={busy} label={label} onSelect={select} onPreview={id=>{setInspector(null);void action(()=>preview(id),setInspector);}} onImport={row=>checkSingle(row,'')}/>:<><h2>{label('empty')}</h2><p>{label('emptyHint')}</p></>}</div>
          <ThreadInspector preview={inspector} selected={selected.find(row=>row.threadId===inspector?.threadId)} busy={busy} label={label} onEdit={edit}
            onImport={!batchMode&&previewed?()=>checkSingle(previewed,''):undefined}/></div>
        {single&&<SingleImport state={single} label={label} busy={busy} error={error} writeEnabled={status.importEnabled}
          onEnableWrites={status.setupAvailable?enableWrites:undefined} setupNotice={setupNotice}
          onClose={()=>{if(!busy){setSingle(null);setError(null);}}}
          onRemap={remapCwd=>{setSingle({...single,remapCwd,review:null,outcome:null});setError(null);}}
          onReview={()=>checkSingle(single.thread,single.remapCwd)} onConfirm={runSingle}/>}
      </>}
    </>}
  </section>;
}

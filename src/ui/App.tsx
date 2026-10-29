import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Outcome } from '../strategies/types';
import { LOCAL_ARMS } from '../strategies/index';
import { createFreeTextDetector } from '../detect/freetext';
import { SMOKE_CASES } from './assets';
import type { SmokeCase } from './assets';
import { PARSE_DEADLINE_MS } from '../core/limits';
import type { UiArm, WorkerRequest, WorkerResponse } from './worker';
import { ResultsPanel } from './components/ResultsPanel';
import { ConfigDiff } from './components/ConfigDiff';
import './style.css';

export const BANNER_TEXT = 'Synthetic test data only. Processing is local. No output is safe to share.';
export function App(): ReactElement {
  const [caseId,setCaseId]=useState(SMOKE_CASES[0]?.caseId??'');
  const [arm,setArm]=useState<UiArm>('lab-scrub');
  const [outcome,setOutcome]=useState<Outcome|null>(null);
  const [status,setStatus]=useState('Ready. Smoke fixtures are never scored.');
  const [running,setRunning]=useState(false);
  const [paste,setPaste]=useState('');
  const [mode,setMode]=useState<'fixtures'|'paste'>('fixtures');
  const worker=useRef<Worker|null>(null),timer=useRef<number|null>(null),request=useRef(0);
  const selected=SMOKE_CASES.find(c=>c.caseId===caseId)??null;
  const stop=():void=>{request.current++;worker.current?.terminate();worker.current=null;if(timer.current!==null)window.clearTimeout(timer.current);timer.current=null;};
  useEffect(()=>()=>stop(),[]);
  const reset=():void=>{stop();setRunning(false);setOutcome(null);setStatus('Ready. Previous output cleared.');};
  const run=(target:SmokeCase):void=>{
    stop();setOutcome(null);setRunning(true);setStatus('Transforming locally in an isolated worker…');
    const id=++request.current,w=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});worker.current=w;
    timer.current=window.setTimeout(()=>{if(request.current!==id)return;stop();setRunning(false);setStatus('Stopped: 5 second deadline exceeded. No partial output retained.');},PARSE_DEADLINE_MS);
    w.onerror=()=>{if(request.current!==id)return;stop();setRunning(false);setStatus('Worker failed. No sensitive error details displayed.');};
    w.onmessage=(e:MessageEvent<WorkerResponse>)=>{if(e.data.requestId!==id||request.current!==id)return;stop();setRunning(false);if(e.data.kind==='outcome'){setOutcome(e.data.outcome);setStatus(`${arm}: ${e.data.outcome.status}; ${e.data.outcome.diagnostics.length} diagnostic(s).`);}else setStatus(`Stopped: ${e.data.code}.`);};
    const message:WorkerRequest={requestId:id,arm,input:{caseId:target.caseId,files:target.files.map(f=>({...f}))}};w.postMessage(message);
  };
  const warnings=paste.length<=65536?createFreeTextDetector().detect(paste):[];
  return <main>
    <header className="masthead"><div><p className="eyebrow">OFFLINE RESEARCH WORKBENCH / S43</p><h1>Netconfig<span> privacy lab</span></h1><p>Inspect how configuration transformations trade identifiers for network meaning.</p></div><span className="phase">CONSTRUCTION · UNVERIFIED</span></header>
    <p className="banner" role="note">{BANNER_TEXT}</p>
    <div className="layout"><aside><h2>Experiment controls</h2><div className="segmented"><button aria-pressed={mode==='fixtures'} onClick={()=>{reset();setMode('fixtures');}}>Synthetic fixtures</button><button aria-pressed={mode==='paste'} onClick={()=>{reset();setMode('paste');}}>Paste inspection</button></div>
      {mode==='fixtures'?<><label>Builder smoke case<select value={caseId} onChange={e=>{reset();setCaseId(e.target.value);}}>{SMOKE_CASES.map(c=><option key={c.caseId} value={c.caseId}>{c.caseId} · {c.family}</option>)}</select></label><p className="muted">Three handwritten smoke fixtures. No held-out data, oracle badges or measured rates.</p></>:<><label>Synthetic configuration<textarea maxLength={65536} value={paste} onChange={e=>{reset();setPaste(e.target.value);}} placeholder="Paste synthetic IOS text only"/></label><p className="muted">Heuristic inspection only. {warnings.length} public-pattern match(es). No rate, completeness or oracle claim.</p></>}
      <label>Transformation<select value={arm} onChange={e=>{reset();setArm(e.target.value as UiArm);}}>{LOCAL_ARMS.map(a=><option key={a}>{a}</option>)}</select></label>
      <p className="muted">Session keys stay in the worker. A fresh worker creates a fresh random key; this preview is not the seeded experiment runner.</p>
      <div className="actions"><button className="primary" disabled={running||mode==='paste'||!selected} onClick={()=>{const target=mode==='fixtures'?selected:{caseId:'paste',family:'inspection',files:[{fileId:'p1',name:'n01.cfg',text:paste}]};if(target)run(target);}}>Transform locally</button><button disabled={!running} onClick={()=>{reset();setStatus('Cancelled. Worker and output discarded.');}}>Cancel</button></div>
      <p role="status" className="status">{status}</p><div className="gate"><strong>Admission pending</strong><p>G0 tools and author · G1 frozen vault · G2 preregistration. No experiment has run.</p></div>
    </aside><article><section className="panel"><div className="section-heading"><div><p className="eyebrow">LOCAL PREVIEW</p><h2>Original → transformed</h2></div><span className="badge">{mode==='paste'?'HEURISTICS ONLY':'BUILDER FIXTURE'}</span></div>
      {(mode==='fixtures'?selected?.files??[]:[{fileId:'p1',name:'n01.cfg',text:paste}]).map(f=><ConfigDiff key={f.fileId} original={f} output={outcome?.files.find(o=>o.fileId===f.fileId)??null}/>)}
      {outcome?.diagnostics.length?<details><summary>Transformation diagnostics</summary><ul>{outcome.diagnostics.map((d,i)=><li key={i}>{d.code} · {d.fileId} · line {d.ordinal}</li>)}</ul></details>:null}
    </section><section className="panel"><ResultsPanel/></section></article></div>
    <footer>Research on synthetic configurations only. Prefix preservation reveals structure; lower residual leakage does not establish safety.</footer>
  </main>;
}

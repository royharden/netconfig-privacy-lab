import type { RecordingBundleV1 } from './recordings';
import type { Trace } from './evaluator';
import { sameTrace } from './evaluator';
import { count } from './leakscore';
import type { Count } from './leakscore';
import type { ExpectedAnswers } from '../core/expected';
import { DISPOSITIONS, ID_PATTERN } from '../core/types';

export interface BatfishComparison { status:'available'|'not_run'; reason:string|null; scheduled:Count; evaluable:Count; coverage:Count; evaluatorAgreement:Count; authorAgreement:Count }
/** The recorder specification must retain native answers AND stable structural trace IDs.
 * Unknown native versions are refused, never inferred from evaluator answers. */
export function recordedTraces(bundle:RecordingBundleV1): Map<string,Trace> {
  const out=new Map<string,Trace>();
  if(bundle.tool!=='batfish')return out;
  for(const row of bundle.normalisedRows.filter(r=>r.query==='traceroute')){
    let answer:unknown;try{answer=JSON.parse(row.answer);}catch{continue;}
    if(!answer||typeof answer!=='object')continue;
    const a=answer as Partial<Trace>;
    if(!row.disposition||!DISPOSITIONS.includes(row.disposition)||!Array.isArray(a.nodeIds)||!a.nodeIds.length||!a.nodeIds.every(n=>typeof n==='string'&&ID_PATTERN.test(n))||!Array.isArray(a.interfaceHops)||a.interfaceHops.length!==a.nodeIds.length)continue;
    if(!a.interfaceHops.every(h=>h&&typeof h.nodeId==='string'&&ID_PATTERN.test(h.nodeId)&&typeof h.ingress==='string'&&ID_PATTERN.test(h.ingress)&&(h.egress===null||typeof h.egress==='string'&&ID_PATTERN.test(h.egress))))continue;
    if(a.aclDecision!==null&&(!a.aclDecision||typeof a.aclDecision.nodeId!=='string'||!ID_PATTERN.test(a.aclDecision.nodeId)||typeof a.aclDecision.aclId!=='string'||!ID_PATTERN.test(a.aclDecision.aclId)||!Number.isSafeInteger(a.aclDecision.entryOrdinal)||a.aclDecision.entryOrdinal<0))continue;
    out.set(row.rowId,{flowId:row.rowId,disposition:row.disposition,nodeIds:a.nodeIds,interfaceHops:a.interfaceHops,aclDecision:a.aclDecision??null,diagnostics:[]});
  }
  return out;
}
export function compareBatfish(original:RecordingBundleV1|null, output:RecordingBundleV1|null, scheduledIds:string[], evaluatorOriginal:Trace[], author?:ExpectedAnswers):BatfishComparison{
  const a=original?recordedTraces(original):new Map<string,Trace>(),b=output?recordedTraces(output):new Map<string,Trace>();
  let preserved=0,evaluable=0,evalAgree=0,evalN=0,authorAgree=0,authorN=0;
  for(const id of scheduledIds){const before=a.get(id),after=b.get(id);if(before&&after&&before.disposition!=='unsupported'&&after.disposition!=='unsupported'){evaluable++;if(sameTrace(before,after))preserved++;}
    const ev=evaluatorOriginal.find(t=>t.flowId===id);if(before&&ev&&before.disposition!=='unsupported'&&ev.disposition!=='unsupported'){evalN++;if(sameTrace(before,ev))evalAgree++;}
    const expected=author?.flows.find(f=>f.flowId===id);if(before&&expected&&before.disposition!=='unsupported'){authorN++;if(sameTrace(before,{...expected,diagnostics:[]}))authorAgree++;}
  }
  return {status:evaluable?'available':'not_run',reason:evaluable?null:!original||!output?'validated-batfish-recordings-required':'native-trace-shape-or-correspondence-unavailable',scheduled:count(preserved,scheduledIds.length),evaluable:count(preserved,evaluable),coverage:count(evaluable,scheduledIds.length),evaluatorAgreement:count(evalAgree,evalN),authorAgreement:count(authorAgree,authorN)};
}

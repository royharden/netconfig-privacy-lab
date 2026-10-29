import { expect,it } from 'vitest';
import { compareBatfish,recordedTraces } from '../../src/eval/oracle';
import type { RecordingBundleV1 } from '../../src/eval/recordings';
import type { Trace } from '../../src/eval/evaluator';
const trace:Trace={flowId:'q1',disposition:'delivered',nodeIds:['n1'],interfaceHops:[{nodeId:'n1',ingress:'i1',egress:null}],aclDecision:null,diagnostics:[]};
const bundle=(answer:unknown)=>({tool:'batfish',normalisedRows:[{query:'traceroute',rowId:'q1',disposition:'delivered',answer:JSON.stringify(answer)}]}) as RecordingBundleV1;
it('unknown native shape remains not_run with scheduled denominator',()=>{
 const b=bundle({nativeUnknown:['unadapted']});expect(recordedTraces(b).size).toBe(0);
 expect(compareBatfish(b,b,['q1'],[trace])).toMatchObject({status:'not_run',scheduled:{numerator:0,denominator:1},evaluable:{denominator:0}});
});
it('full stable trace and native disposition compare independently to evaluator',()=>{
 const b=bundle({...trace,disposition:'ACCEPTED'}),result=compareBatfish(b,b,['q1'],[trace]);
 expect(result.status).toBe('available');expect(result.scheduled.value).toBe(1);expect(result.evaluatorAgreement.value).toBe(1);
});
it('empty trace never earns identity preservation',()=>expect(recordedTraces(bundle({nodeIds:[],interfaceHops:[],aclDecision:null})).size).toBe(0));

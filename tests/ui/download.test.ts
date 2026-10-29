import { expect, it } from 'vitest';
import { aggregateExport } from '../../src/ui/download';
import { emptyReport } from '../../src/eval/results';
import type { Report } from '../../src/eval/results';
it('aggregate allowlist excludes injected raw configs filenames keys maps and leak strings',()=>{
 const report=Object.assign(emptyReport('pending'),{raw:'SENTINEL_RAW',filename:'SENTINEL_FILE',key:'SENTINEL_KEY',map:{secret:'SENTINEL_MAP'}});
 const value=JSON.stringify(aggregateExport(report));
 expect(value).not.toContain('SENTINEL');expect(value).not.toContain('caseId');expect(value).toContain('aggregate-v1');
});
it('rejects nested raw strings and nonfinite report counts before serialisation',()=>{
 for(const bad of ['SENTINEL_RAW',NaN,Infinity,-1]){
  const r=emptyReport('pending');r.rows=[{caseId:'s01',arm:'identity',status:'evaluated',retention:{overRedaction:{numerator:bad,denominator:1,value:0}}}] as unknown as Report['rows'];
  expect(()=>aggregateExport(r)).toThrow('invalid-aggregate-count');
 }
});
it('includes missing scheduled cases in aggregate denominators',()=>{
 const report=emptyReport('pending');report.rows=[{caseId:'c1',arm:'identity',status:'evaluated',utility:{scheduled:{numerator:32,denominator:32,value:1}}},{caseId:'c2',arm:'identity',status:'not_run',utility:{scheduled:{numerator:0,denominator:32,value:0}}}] as unknown as Report['rows'];
 const result=aggregateExport(report) as {rows:{arm:string;scheduled:{numerator:number;denominator:number;value:number}}[]};
 expect(result.rows.find(r=>r.arm==='identity')!.scheduled).toEqual({numerator:32,denominator:64,value:.5});
});
it('rejects accumulated integer overflow',()=>{
 const report=emptyReport('pending');report.rows=[1,2].map(i=>({caseId:`c${i}`,arm:'identity',status:'evaluated',retention:{overRedaction:{numerator:0,denominator:Number.MAX_SAFE_INTEGER,value:0}}})) as unknown as Report['rows'];
 expect(()=>aggregateExport(report)).toThrow('invalid-aggregate-total');
});

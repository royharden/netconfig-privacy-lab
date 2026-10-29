import { expect, it } from 'vitest';
import { emptyReport, renderReport } from '../../src/eval/results';
import { count, scoreLeaks } from '../../src/eval/leakscore';
it('report displays every available metric family and named safe failures',()=>{
 const report=emptyReport('pending');
 report.rows=[{caseId:'c1',family:'ring',arm:'identity',status:'evaluated',leaks:scoreLeaks({schema:'ledger-v1',caseId:'c1',entities:[]},{caseId:'c1',arm:'identity',status:'ok',files:[],diagnostics:[]}),retention:{overRedaction:count(1,2),freeTextRetention:count(3,4),finalOctetRetention:count(2,3)},oracle:{flows:count(4,5),findings:{preserved:2,lost:1,introduced:0}},probes:{prefix:[{k:1,meanBits:17,full24:count(1,2)}],fingerprint:{candidateSetSize:2,unique:false,reciprocalRank:.75},reason:null},correspondence:{conflicts:0,manyToOne:1,missing:0}}];
 report.failures=[{failureId:'f1',caseId:'c1',arm:'identity',classOrFlowOrFindingId:'correspondence',rule:'many-to-one',evidenceRef:'results/dev.json#c1',status:'observed'}];
 report.intervals=[{arm:'identity',reference:'naive-mask',metric:'scheduled-flow-preservation',interval:{low:.1,high:.9,resamples:2000,seed:43}}];
 const text=renderReport(report);
 for(const expected of ['Variant','Prefix pairs','References','Retention','17','4/5','0.75','many-to-one','0.1','2000','Batfish comparisons: not_run'])expect(text).toContain(expected);
 expect(text).not.toContain('CUSTODY_SENTINEL');
});

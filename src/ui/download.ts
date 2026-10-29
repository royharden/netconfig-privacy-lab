import type { Report } from '../eval/results';
import type { Count } from '../eval/leakscore';
/** Construct a fresh aggregate-only allowlist. Never serialize an incoming report wholesale. */
export function aggregateExport(report: Report): object {
  const sum = (counts: (Count | undefined)[]): Count => {
    for(const c of counts)if(c && (!Number.isSafeInteger(c.numerator)||!Number.isSafeInteger(c.denominator)||c.numerator<0||c.denominator<0||c.numerator>c.denominator))throw new Error('invalid-aggregate-count');
    const numerator=counts.reduce((n,c)=>n+(c?.numerator??0),0),denominator=counts.reduce((n,c)=>n+(c?.denominator??0),0);
    if(!Number.isSafeInteger(numerator)||!Number.isSafeInteger(denominator))throw new Error('invalid-aggregate-total');
    return {numerator,denominator,value:denominator?numerator/denominator:null};
  };
  const arms = ['identity','naive-mask','random-consistent','lab-scrub','lab-drop','netconan-minimal','netconan-operator','netconan-ledger-informed','lab-scrub@key2'];
  return {schema:'aggregate-v1',phase:report.phase==='confirmatory'?'confirmatory':report.phase==='exploratory'?'exploratory':'development',rows:arms.map(arm=>{
    const rows=report.rows.filter(r=>r.arm===arm),evaluated=rows.filter(r=>r.status==='evaluated').length;
    return {arm,status:evaluated?'available':'not_run',caseCount:rows.length,evaluatedCaseCount:evaluated,scheduled:sum(rows.map(r=>r.utility?.scheduled)),evaluable:sum(rows.map(r=>r.utility?.evaluable)),coverage:sum(rows.map(r=>r.utility?.coverage)),overRedaction:sum(rows.map(r=>r.retention?.overRedaction)),freeTextRetention:sum(rows.map(r=>r.retention?.freeTextRetention)),finalOctetRetention:sum(rows.map(r=>r.retention?.finalOctetRetention))};
  })};
}
export function downloadAggregate(report: Report): void {
  const blob=new Blob([JSON.stringify(aggregateExport(report),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='aggregate-results.json';a.click();URL.revokeObjectURL(url);
}

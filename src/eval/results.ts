import { ARMS } from '../strategies/types';
import type { Arm } from '../strategies/types';
import type { LeakClassScore, Count } from './leakscore';
import type { UtilityScore } from './utility';
import type { Interval } from './bootstrap';
import type { Family } from '../core/types';
import type { BatfishComparison } from './oracle';

export interface CaseResult { caseId: string; arm: Arm; status: 'evaluated' | 'not_run'; family?: Family; reason?: string; evidence?: { kind: 'recorded'; tool: string; toolVersion: string; sourceSha256: string }; leaks?: LeakClassScore[]; utility?: UtilityScore; utilityReason?:string; batfish?:BatfishComparison; correspondence?: {conflicts:number;manyToOne:number;missing:number}; retention?: { overRedaction: Count; freeTextRetention: Count; finalOctetRetention: Count }; probes?: { prefix: { k: number; meanBits: number | null; full24: Count }[]; fingerprint: { candidateSetSize: number; unique: boolean; reciprocalRank: number } | null; reason: string | null }; oracle?: ReturnType<typeof import('./utility').authorAgreement> }
export interface Failure { failureId:string; caseId: string; arm: Arm; classOrFlowOrFindingId: string; rule: string; evidenceRef: string; status:'observed'|'not_run' }
export interface Report { schema: 'results-v1'; phase: 'development' | 'confirmatory' | 'exploratory'; runtimeVerified: boolean; rows: CaseResult[]; failures: Failure[]; intervals?: { arm: Arm; reference: Arm; metric: string; interval: Interval }[]; seeds: { bootstrap: number; probe: number }; pins: Record<string, string>; machine: string; tables: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F', { status: 'not_run' | 'available'; reason: string | null }>; denominatorDefinitions: string[] }
export function emptyReport(reason: string): Report {
  return { schema: 'results-v1', phase: 'development', runtimeVerified: false, rows: ARMS.map(arm => ({ caseId: 'aggregate', arm, status: 'not_run', reason })), failures: [], seeds: { bootstrap: 43, probe: 43 }, pins: {}, machine: 'unrecorded', tables: Object.fromEntries(['A','B','C','D','E','F'].map(k => [k, { status: 'not_run', reason }])) as Report['tables'], denominatorDefinitions: ['Scheduled includes errors, missing recordings and unmappable output as not preserved.', 'Evaluable excludes unsupported or unmappable traces; coverage = evaluable / scheduled.', 'Unsupported cases contribute leakage only. Zero support is N/A.'] };
}
export function renderReport(report: Report): string {
  const lines = ['# Synthetic privacy experiment', '', `Phase: ${report.phase}. Runtime verified: ${report.runtimeVerified}.`, '', 'No output is safe to share.', ''];
  for (const [table, value] of Object.entries(report.tables)) lines.push(`## Table ${table}`, '', `${value.status}${value.reason ? ` — ${value.reason}` : ''}`, '');
  lines.push('| Arm | Case | Status | Scheduled flow rate | Evaluable rate | Coverage |', '|---|---|---|---|---|---|');
  const ratio = (c?: Count): string => c ? c.value === null ? 'N/A' : `${c.numerator}/${c.denominator}` : 'not_run';
  for (const r of report.rows) lines.push(`| ${r.arm} | ${r.caseId} | ${r.status} | ${ratio(r.utility?.scheduled)} | ${ratio(r.utility?.evaluable)} | ${ratio(r.utility?.coverage)} |`);
  lines.push('', '### A — Residual identifiers', '', '| Arm | Case | Class | Entities | Occurrences | Any location | Ambiguous numeric |', '|---|---|---|---|---|---|---|');
  for (const r of report.rows) for (const c of r.leaks ?? []) lines.push(`| ${r.arm} | ${r.caseId} | ${c.class} | ${ratio(c.entities)} | ${ratio(c.occurrences)} | ${ratio(c.anyLocation)} | ${ratio(c.ambiguousNumeric)} |`);
  lines.push('', '| Arm | Case | Class | Variant | Residual |','|---|---|---|---|---|');
  for(const r of report.rows)for(const c of r.leaks??[])for(const [variant,value] of Object.entries(c.variants))lines.push(`| ${r.arm} | ${r.caseId} | ${c.class} | ${variant} | ${ratio(value)} |`);
  lines.push('','### B — Utility and correspondence','','| Arm | Case | Parse clean | Findings preserved/lost/introduced | Prefix pairs | Subnet relations | References | Correspondence conflicts/collapses/missing |','|---|---|---|---|---|---|---|---|');
  for(const r of report.rows)lines.push(`| ${r.arm} | ${r.caseId} | ${r.utility?.parseClean??r.utilityReason??'not_run'} | ${r.utility?`${r.utility.findings.preserved}/${r.utility.findings.lost}/${r.utility.findings.introduced}`:'not_run'} | ${ratio(r.utility?.addressPairs)} | ${ratio(r.utility?.subnetRelations)} | ${ratio(r.utility?.referenceIntegrity)} | ${r.correspondence?`${r.correspondence.conflicts}/${r.correspondence.manyToOne}/${r.correspondence.missing}`:'not_run'} |`);
  lines.push('', '### C — Retention', '', '| Arm | Case | Over-redaction | Free-text retention | Final-octet retention |', '|---|---|---|---|---|');
  for (const r of report.rows) lines.push(`| ${r.arm} | ${r.caseId} | ${ratio(r.retention?.overRedaction)} | ${ratio(r.retention?.freeTextRetention)} | ${ratio(r.retention?.finalOctetRetention)} |`);
  lines.push('','### D — Probes','','| Arm | Case | k | Extra inferred bits | /24 implied | Fingerprint candidates | Tie-aware reciprocal rank |','|---|---|---|---|---|---|---|');
  for(const r of report.rows){for(const p of r.probes?.prefix??[])lines.push(`| ${r.arm} | ${r.caseId} | ${p.k} | ${p.meanBits??'N/A'} | ${ratio(p.full24)} | ${r.probes?.fingerprint?.candidateSetSize??'not_run'} | ${r.probes?.fingerprint?.reciprocalRank??'not_run'} |`);if(!r.probes?.prefix.length)lines.push(`| ${r.arm} | ${r.caseId} | not_run | ${r.probes?.reason??'not_run'} | not_run | ${r.probes?.fingerprint?.candidateSetSize??'not_run'} | ${r.probes?.fingerprint?.reciprocalRank??'not_run'} |`);}
  lines.push('','### E — Oracle agreement','','Batfish comparisons: not_run unless independently pinned recordings and stable native trace shape are available.','','| Case | Evaluator vs author flows | Author findings preserved/lost/introduced |','|---|---|---|');
  for(const r of report.rows.filter(r=>r.arm==='identity'))lines.push(`| ${r.caseId} | ${ratio(r.oracle?.flows)} | ${r.oracle?`${r.oracle.findings.preserved}/${r.oracle.findings.lost}/${r.oracle.findings.introduced}`:'not_run'} |`);
  lines.push('','| Arm | Case | Batfish evidence | Batfish scheduled / evaluable / coverage | Evaluator vs Batfish | Author vs Batfish |','|---|---|---|---|---|---|');
  for(const r of report.rows)lines.push(`| ${r.arm} | ${r.caseId} | ${r.batfish?.status??'not_run'} | ${ratio(r.batfish?.scheduled)} / ${ratio(r.batfish?.evaluable)} / ${ratio(r.batfish?.coverage)} | ${ratio(r.batfish?.evaluatorAgreement)} | ${ratio(r.batfish?.authorAgreement)} |`);
  lines.push('','### Paired stratified case-cluster intervals','','| Arm | Reference | Metric | 95% low | 95% high | Resamples | Seed |','|---|---|---|---|---|---|---|');
  for(const i of report.intervals??[])lines.push(`| ${i.arm} | ${i.reference} | ${i.metric} | ${i.interval.low??'N/A'} | ${i.interval.high??'N/A'} | ${i.interval.resamples} | ${i.interval.seed} |`);
  lines.push('', '### F — Named failures', '', '| Arm | Case | Item | Code | Evidence |', '|---|---|---|---|---|');
  for (const f of report.failures) lines.push(`| ${f.arm} | ${f.caseId} | ${f.classOrFlowOrFindingId} | ${f.rule} | ${f.evidenceRef} (${f.status}, ${f.failureId}) |`);
  return lines.join('\n') + '\n';
}

import type { CaseInput, Outcome } from '../strategies/types';
import type { CaseSidecar, Flow } from '../core/sidecar';
import { parseCase } from '../core/parser';
import { count } from './leakscore';
import { evaluateFlow, sameTrace } from './evaluator';
import { compareFindings, findFindings } from './findings';
import { commonPrefixLength, inSubnet, parseIPv4, formatIPv4 } from '../core/ipv4';
import type { Count } from './leakscore';
import type { ExpectedAnswers } from '../core/expected';

export interface UtilityScore { scheduled: Count; evaluable: Count; coverage: Count; parseClean: boolean; findings: ReturnType<typeof compareFindings>; addressPairs: Count; subnetRelations: Count; referenceIntegrity: Count }
/** Address map is runner-private and never copied into a result. Missing/conflicting correspondences fail closed. */
export function scoreUtility(original: CaseInput, outcome: Outcome, sidecar: CaseSidecar, addresses: ReadonlyMap<string, string>, correspondenceHealthy = true): UtilityScore {
  const a = parseCase(original), b = parseCase(outcome);
  let preserved = 0, evaluable = 0;
  if (sidecar.stratum === 'semantic-positive' && outcome.status !== 'error' && correspondenceHealthy) for (const f of sidecar.flows) {
    const src = addresses.get(f.src), dst = addresses.get(f.dst);
    if (!src || !dst) continue;
    const transformed: Flow = { ...f, src, dst };
    const before = evaluateFlow(original, sidecar, f), after = evaluateFlow(outcome, sidecar, transformed);
    if (before.disposition === 'unsupported' || after.disposition === 'unsupported') continue;
    evaluable++;
    if (sameTrace(before, after)) preserved++;
  }
  const scheduled = sidecar.stratum === 'semantic-positive' ? sidecar.flows.length : 0;
  const originalAddresses = [...new Set(a.files.flatMap(f=>f.device.interfaces.flatMap(i=>i.address?[i.address.address]:[])))];
  const pairs = originalAddresses.map(x => [x,parseIPv4(addresses.get(formatIPv4(x))??'')] as const);
  let pairN = 0, pairOK = 0, subnetN = 0, subnetOK = 0;
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    pairN++;
    const pi=pairs[i]!,pj=pairs[j]!;
    if (pi[1]!==null&&pj[1]!==null&&commonPrefixLength(pi[0],pj[0])===commonPrefixLength(pi[1],pj[1])) pairOK++;
  }
  let refs = 0, refsOK = 0;
  for (const file of a.files) {
    const out = b.files.find(x => x.fileId === file.fileId)?.device;
    for (const i of file.device.interfaces) {
      if (i.address) for (const [x, y] of pairs) {
        const mapped = addresses.get(formatIPv4(i.address.address));
        const mappedAddress = mapped ? parseIPv4(mapped) : null;
        subnetN++;
        if (mappedAddress !== null && y!==null && inSubnet(x, i.address.address, i.address.prefixLength) === inSubnet(y, mappedAddress, i.address.prefixLength)) subnetOK++;
      }
      for (const g of i.accessGroups) if (file.device.acls.some(x => x.name === g.aclName)) {
        refs++;
        const oi = out?.interfaces.find(x => x.ordinal === i.ordinal);
        if (oi?.accessGroups.some(og => og.direction === g.direction && out?.acls.some(oa => oa.name === og.aclName))) refsOK++;
      }
    }
    for (const r of file.device.staticRoutes) if (file.device.interfaces.some(i => i.address && !i.shutdown && inSubnet(r.nextHop, i.address.address, i.address.prefixLength))) {
      refs++;
      const or = out?.staticRoutes.find(x => x.ordinal === r.ordinal);
      if (or && out?.interfaces.some(i => i.address && !i.shutdown && inSubnet(or.nextHop, i.address.address, i.address.prefixLength))) refsOK++;
    }
  }
  const parseClean=b.violations.length===0&&b.files.length===a.files.length&&a.files.every(f=>{
    const out=b.files.find(x=>x.fileId===f.fileId);if(!out)return false;
    return out.lines.filter(l=>l.node.kind==='unknown').every(l=>f.lines[l.ordinal-1]?.node.kind==='unknown'&&f.lines[l.ordinal-1]?.text===l.text);
  });
  return { scheduled: count(preserved, scheduled), evaluable: count(preserved, evaluable), coverage: count(evaluable, scheduled), parseClean, findings: compareFindings(findFindings(original, sidecar), findFindings(outcome, sidecar)), addressPairs: count(pairOK, pairN), subnetRelations: count(subnetOK, subnetN), referenceIntegrity: count(refsOK, refs) };
}

export function unavailableUtility(original: CaseInput, sidecar: CaseSidecar): UtilityScore {
  return scoreUtility(original,{caseId:original.caseId,arm:'identity',status:'error',files:[],diagnostics:[]},sidecar,new Map(),false);
}

export function authorAgreement(original: CaseInput, sidecar: CaseSidecar, expected: ExpectedAnswers): { flows: Count; findings: ReturnType<typeof compareFindings> } {
  if (expected.caseId!==original.caseId) throw new Error('oracle-case-mismatch');
  let correct=0;
  for(const e of expected.flows){const flow=sidecar.flows.find(f=>f.id===e.flowId);if(!flow)throw new Error('oracle-flow-missing');const actual=evaluateFlow(original,sidecar,flow);if(sameTrace(actual,{...e,diagnostics:[]}))correct++;}
  return {flows:count(correct,expected.flows.length),findings:compareFindings(expected.findings,findFindings(original,sidecar))};
}

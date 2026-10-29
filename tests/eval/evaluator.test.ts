import { describe, expect, it } from 'vitest';
import { evaluateFlow } from '../../src/eval/evaluator';
import { findFindings, compareFindings } from '../../src/eval/findings';
import { parseCase } from '../../src/core/parser';
import { deriveCorrespondence } from '../../src/eval/correspondence';
import { scoreUtility, unavailableUtility } from '../../src/eval/utility';
import type { Outcome } from '../../src/strategies/types';
import type { CaseSidecar, Flow } from '../../src/core/sidecar';
import type { CaseInput } from '../../src/strategies/types';

// Builder-only literal unit networks; never author/practice/held-out data.
function network(first: string, second = '', third = ''): { input: CaseInput; sidecar: CaseSidecar; flow: Flow } {
  const input: CaseInput = { caseId: 'unit', files: [first, second, third].map((extra, i) => ({ fileId: `f${i}`, name: `n${i}.cfg`, text: `hostname node${i}\ninterface GigabitEthernet0/0\n ip address 10.0.${i}.1 255.255.255.0\n!\n${extra}\nend\n` })) };
  for (const file of input.files) file.text=file.text.replace(/!\ninterface GigabitEthernet0\/0\n/g, "");
  const parsed = parseCase(input);
  const sidecar: CaseSidecar = { schema: 'case-v1', caseId: 'unit', family: 'ring', stratum: 'semantic-positive', files: input.files.map((f,i) => ({ ...f, path: f.name, nodeId: `n${i}` })), nodes: input.files.map((f,i) => ({id:`n${i}`,fileId:f.fileId})), interfaces: parsed.files.flatMap((f,i) => f.device.interfaces.map(x => ({id:`i${i}-${x.ordinal}`,nodeId:`n${i}`,ordinal:x.ordinal}))), acls: parsed.files.flatMap((f,i) => f.device.acls.map((a,j) => ({id:`a${i}-${j}`,nodeId:`n${i}`,aclName:a.name}))), aclEntries: [], flows: [] };
  const flow: Flow = { id:'q',ingressNodeId:'n0',ingressInterfaceId:'i0-1',src:'10.0.0.1',dst:'10.0.0.1',protocol:'tcp',srcPort:1000,dstPort:80 };
  return { input, sidecar, flow };
}
function run(extra: string, dst = '10.0.0.1') {
  const n = network(extra);
  return evaluateFlow(n.input, n.sidecar, { ...n.flow, dst });
}
describe('literal evaluator networks', () => {
  // Every expected trace below is hand-derived and literal: no expected value
  // calls evaluateFlow, follows a parsed route, or copies an evaluator result.
  it('delivers a local active address without selecting an egress', () => {
    expect(run('')).toEqual({
      flowId: 'q', disposition: 'delivered', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: null }],
      aclDecision: null, diagnostics: [],
    });
  });
  it('delivers an unowned connected destination to its subnet', () => {
    expect(run('', '10.0.0.2')).toEqual({
      flowId: 'q', disposition: 'delivered-to-subnet', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: 'i0-1' }],
      aclDecision: null, diagnostics: [],
    });
  });
  it('stops at the ingress device when no route matches', () => {
    expect(run('', '192.0.2.1')).toEqual({
      flowId: 'q', disposition: 'no-route', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: null }],
      aclDecision: null, diagnostics: [],
    });
  });
  it('exits via the connected interface of an unowned external next hop', () => {
    expect(run('ip route 0.0.0.0 0.0.0.0 10.0.0.254', '192.0.2.1')).toEqual({
      flowId: 'q', disposition: 'exits-network', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: 'i0-1' }],
      aclDecision: null, diagnostics: [],
    });
  });
  it('cannot select an egress for an unresolved static next hop', () => {
    expect(run('ip route 0.0.0.0 0.0.0.0 198.51.100.1', '192.0.2.1')).toEqual({
      flowId: 'q', disposition: 'unsupported', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: null }],
      aclDecision: null, diagnostics: ['unresolved-next-hop'],
    });
  });
  it('checks the inbound ACL before local delivery and records the matching entry', () => {
    expect(run('interface GigabitEthernet0/0\n ip access-group BLOCK in\n!\nip access-list extended BLOCK\n permit tcp any any eq 443\n deny ip any any')).toEqual({
      flowId: 'q', disposition: 'deny-in', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: null }],
      aclDecision: { nodeId: 'n0', aclId: 'a0-0', entryOrdinal: 2 }, diagnostics: [],
    });
  });
  it('records implicit inbound deny with entry ordinal zero', () => {
    expect(run('interface GigabitEthernet0/0\n ip access-group BLOCK in\n!\nip access-list extended BLOCK\n permit tcp any any eq 443')).toEqual({
      flowId: 'q', disposition: 'deny-in', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: null }],
      aclDecision: { nodeId: 'n0', aclId: 'a0-0', entryOrdinal: 0 }, diagnostics: [],
    });
  });
  it('does not apply an outbound ACL to local delivery', () => {
    expect(run('interface GigabitEthernet0/0\n ip access-group BLOCK out\n!\nip access-list extended BLOCK\n deny ip any any')).toEqual({
      flowId: 'q', disposition: 'delivered', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: null }],
      aclDecision: null, diagnostics: [],
    });
  });
  it('records the egress and deciding outbound ACL before denying forwarding', () => {
    expect(run('interface GigabitEthernet0/0\n ip access-group BLOCK out\n!\nip access-list extended BLOCK\n deny ip any any', '10.0.0.2')).toEqual({
      flowId: 'q', disposition: 'deny-out', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: 'i0-1' }],
      aclDecision: { nodeId: 'n0', aclId: 'a0-0', entryOrdinal: 1 }, diagnostics: [],
    });
  });
  it('refuses an undefined inbound ACL without inventing an ACL decision', () => {
    expect(run('interface GigabitEthernet0/0\n ip access-group MISSING in')).toEqual({
      flowId: 'q', disposition: 'unsupported', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: null }],
      aclDecision: null, diagnostics: ['undefined-acl'],
    });
  });
  it('refuses an undefined outbound ACL after selecting the egress', () => {
    expect(run('interface GigabitEthernet0/0\n ip access-group MISSING out', '10.0.0.2')).toEqual({
      flowId: 'q', disposition: 'unsupported', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: 'i0-1' }],
      aclDecision: null, diagnostics: ['undefined-acl'],
    });
  });
  it('prefers a connected route over an equal-prefix static route', () => {
    // The losing static route has an unreachable next hop, making the choice observable.
    expect(run('ip route 10.0.0.0 255.255.255.0 192.0.2.1', '10.0.0.2')).toEqual({
      flowId: 'q', disposition: 'delivered-to-subnet', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: 'i0-1' }],
      aclDecision: null, diagnostics: [],
    });
  });
  it('selects the longest matching prefix before a static default', () => {
    expect(run('ip route 0.0.0.0 0.0.0.0 192.0.2.1\nip route 198.51.100.0 255.255.255.0 10.0.0.254', '198.51.100.2')).toEqual({
      flowId: 'q', disposition: 'exits-network', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: 'i0-1' }],
      aclDecision: null, diagnostics: [],
    });
  });
  it('rejects tied longest-prefix static routes without choosing either egress', () => {
    expect(run('ip route 192.0.2.0 255.255.255.0 10.0.0.253\nip route 192.0.2.0 255.255.255.0 10.0.0.254', '192.0.2.1')).toEqual({
      flowId: 'q', disposition: 'unsupported', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: null }],
      aclDecision: null, diagnostics: ['equal-static-routes'],
    });
  });
  it('keeps the original ingress and egress identities after an interface rename', () => {
    const n = network('interface GigabitEthernet0/0\n ip access-group ALLOW out\n!\nip access-list extended ALLOW\n permit ip any any');
    n.input.files[0]!.text = n.input.files[0]!.text.replace('GigabitEthernet0/0', 'GigabitEthernet9/9');
    expect(evaluateFlow(n.input, n.sidecar, { ...n.flow, dst: '10.0.0.2' })).toEqual({
      flowId: 'q', disposition: 'delivered-to-subnet', nodeIds: ['n0'],
      interfaceHops: [{ nodeId: 'n0', ingress: 'i0-1', egress: 'i0-1' }],
      aclDecision: { nodeId: 'n0', aclId: 'a0-0', entryOrdinal: 1 }, diagnostics: [],
    });
  });
  it('detects a static loop only when the device and ingress pair repeats', () => {
    const n = network(
      'interface GigabitEthernet0/1\n ip address 10.9.0.1 255.255.255.252\n!\nip route 192.0.2.0 255.255.255.0 10.9.0.2',
      'interface GigabitEthernet0/1\n ip address 10.9.0.2 255.255.255.252\n!\nip route 192.0.2.0 255.255.255.0 10.9.0.1',
    );
    expect(evaluateFlow(n.input, n.sidecar, { ...n.flow, dst: '192.0.2.1' })).toEqual({
      flowId: 'q', disposition: 'loop', nodeIds: ['n0', 'n1', 'n0'],
      interfaceHops: [
        { nodeId: 'n0', ingress: 'i0-1', egress: 'i0-2' },
        { nodeId: 'n1', ingress: 'i1-2', egress: 'i1-2' },
        { nodeId: 'n0', ingress: 'i0-2', egress: 'i0-2' },
      ],
      aclDecision: null, diagnostics: [],
    });
  });
  it('exhausts a positive hop limit after real forwarding on an otherwise deliverable path', () => {
    const n = network(
      'interface GigabitEthernet0/1\n ip address 10.9.0.1 255.255.255.252\n!\nip route 10.0.2.0 255.255.255.0 10.9.0.2',
      'interface GigabitEthernet0/1\n ip address 10.9.0.2 255.255.255.252\n!\ninterface GigabitEthernet0/2\n ip address 10.9.1.1 255.255.255.252\n!\nip route 10.0.2.0 255.255.255.0 10.9.1.2',
      'interface GigabitEthernet0/1\n ip address 10.9.1.2 255.255.255.252',
    );
    const flow = { ...n.flow, dst: '10.0.2.1' };
    expect(evaluateFlow(n.input, n.sidecar, flow, { hopLimit: 2 })).toEqual({
      flowId: 'q', disposition: 'loop', nodeIds: ['n0', 'n1'],
      interfaceHops: [
        { nodeId: 'n0', ingress: 'i0-1', egress: 'i0-2' },
        { nodeId: 'n1', ingress: 'i1-2', egress: 'i1-3' },
      ],
      aclDecision: null, diagnostics: ['hop-limit'],
    });
    expect(evaluateFlow(n.input, n.sidecar, flow)).toEqual({
      flowId: 'q', disposition: 'delivered', nodeIds: ['n0', 'n1', 'n2'],
      interfaceHops: [
        { nodeId: 'n0', ingress: 'i0-1', egress: 'i0-2' },
        { nodeId: 'n1', ingress: 'i1-2', egress: 'i1-3' },
        { nodeId: 'n2', ingress: 'i2-2', egress: null },
      ],
      aclDecision: null, diagnostics: [],
    });
  });
});
describe('utility denominators and mutation response',()=>{
 it('a route mutation lowers utility with unchanged config-present flow endpoints',()=>{
  const n=network('ip route 192.0.2.0 255.255.255.0 10.0.0.254\nip access-list extended ENDPOINTS\n permit tcp host 10.0.0.1 host 192.0.2.1 eq 80');
  n.sidecar.flows=[{...n.flow,dst:'192.0.2.1'}];
  const addresses=new Map([['10.0.0.1','10.0.0.1'],['192.0.2.1','192.0.2.1']]);
  const before:Outcome={...n.input,arm:'identity',status:'ok',diagnostics:[]};
  const after:Outcome={...before,files:before.files.map((f,i)=>i===0?{...f,text:f.text.replace('ip route 192.0.2.0','ip route 198.51.100.0')}:f)};
  expect(scoreUtility(n.input,before,n.sidecar,addresses).scheduled).toEqual({numerator:1,denominator:1,value:1});
  expect(scoreUtility(n.input,after,n.sidecar,addresses).scheduled).toEqual({numerator:0,denominator:1,value:0});
 });
 it('missing recording/error retains every scheduled flow',()=>{const n=network('');n.sidecar.flows=Array.from({length:32},(_,i)=>({...n.flow,id:`q${i}`}));const score=unavailableUtility(n.input,n.sidecar);expect(score.scheduled).toMatchObject({numerator:0,denominator:32,value:0});expect(score.evaluable.value).toBeNull();expect(score.coverage).toMatchObject({numerator:0,denominator:32,value:0});});
 it('ACL and reference mutations lower scores',()=>{
  const n=network('interface GigabitEthernet0/0\n ip access-group A in\n!\nip access-list extended A\n permit tcp any any eq 80');n.sidecar.flows=[n.flow];
  const score=(text:string)=>{const out:Outcome={caseId:'unit',arm:'identity',status:'ok',files:n.input.files.map((f,i)=>i===0?{...f,text}:f),diagnostics:[]};const c=deriveCorrespondence(n.input,out,n.sidecar);return scoreUtility(n.input,out,n.sidecar,c.addresses,c.healthy);};
  const base=score(n.input.files[0]!.text);expect(base.scheduled.value).toBe(1);
  expect(score(n.input.files[0]!.text.replace('permit tcp','deny tcp')).scheduled.value).toBe(0);
  const broken=score(n.input.files[0]!.text.replace('access-group A','access-group MISSING'));expect(broken.referenceIntegrity.value).toBe(0);expect(broken.scheduled.value).toBe(0);
 });
 it('new unknown line cannot replace an old unknown line and claim parse-clean',()=>{
  const n=network('logging old-target');const out:Outcome={...n.input,arm:'identity',status:'ok',diagnostics:[],files:n.input.files.map((f,i)=>i===0?{...f,text:f.text.replace('logging old-target','logging new-target')}:f)};
  expect(scoreUtility(n.input,out,n.sidecar,new Map()).parseClean).toBe(false);
  expect(scoreUtility(n.input,{...out,files:out.files.slice(1)},n.sidecar,new Map()).parseClean).toBe(false);
 });
});
describe('five findings have positive and negative controls',()=>{
  const cases = [
    ['permit-ip-any-any','ip access-list extended A\n permit ip any any','ip access-list extended A\n deny ip any any'],
    ['duplicate-acl-entry','ip access-list extended A\n deny ip any any\n deny ip any any','ip access-list extended A\n deny ip any any'],
    ['duplicate-interface-address','interface GigabitEthernet0/1\n ip address 10.0.0.1 255.255.255.0',''],
    ['unresolved-acl-reference','interface GigabitEthernet0/0\n ip access-group MISSING in',''],
    ['default-snmp-community','snmp-server community public RO','snmp-server community altered RO'],
  ];
  for(const [rule,positive,negative] of cases) it(rule!,()=>{ const p=network(positive!),n=network(negative!); const before=findFindings(p.input,p.sidecar),after=findFindings(n.input,n.sidecar); expect(before.some(f=>f.rule===rule)).toBe(true); expect(after.some(f=>f.rule===rule)).toBe(false); expect(compareFindings(before,after).lost).toBeGreaterThan(0); });
});

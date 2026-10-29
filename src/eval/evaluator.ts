import type { CaseSidecar, Flow } from '../core/sidecar';
import type { CaseInput } from '../strategies/types';
import type { AddrMatch, DeviceModel, InterfaceModel } from '../core/model';
import type { Disposition } from '../core/types';
import { parseCase, caseDiagnostics } from '../core/parser';
import { inSubnet, isNetworkOrBroadcast, parseIPv4 } from '../core/ipv4';

export interface Hop { nodeId: string; ingress: string; egress: string | null }
export interface AclDecision { nodeId: string; aclId: string; entryOrdinal: number }
export interface Trace { flowId: string; disposition: Disposition; nodeIds: string[]; interfaceHops: Hop[]; aclDecision: AclDecision | null; diagnostics: string[] }
const active = (i: InterfaceModel): boolean => !i.shutdown && i.address !== null && !isNetworkOrBroadcast(i.address.address, i.address.prefixLength);
const matchAddress = (a: AddrMatch, ip: number): boolean => a.type === 'any' || (a.type === 'host' ? a.address === ip : inSubnet(ip, a.address, a.prefixLength));

/** Stable identities come from file IDs and structural ordinals, never a hostname repair. */
export function evaluateFlow(input: CaseInput, sidecar: CaseSidecar, flow: Flow, options: { hopLimit?: number } = {}): Trace {
  const parsed = parseCase(input);
  const trace: Trace = { flowId: flow.id, disposition: 'unsupported', nodeIds: [], interfaceHops: [], aclDecision: null, diagnostics: [] };
  const finish = (disposition: Disposition, diagnostic?: string): Trace => {
    trace.disposition = disposition;
    if (diagnostic) trace.diagnostics.push(diagnostic);
    return trace;
  };
  if (parsed.violations.length || parsed.stratum !== 'semantic-positive') return finish('unsupported', 'parse-or-stratum');
  if (caseDiagnostics(parsed).some(d => d.code === 'duplicate-hostname' || d.code === 'duplicate-acl-name')) return finish('unsupported', 'ambiguous-name');
  const models = new Map<string, DeviceModel>();
  for (const n of sidecar.nodes) {
    const model = parsed.files.find(f => f.fileId === n.fileId)?.device;
    if (!model) return finish('unsupported', 'missing-node');
    models.set(n.id, model);
  }
  if (models.size !== parsed.files.length) return finish('unsupported', 'node-count');
  const ifaceId = (nodeId: string, i: InterfaceModel): string | null => sidecar.interfaces.find(x => x.nodeId === nodeId && x.ordinal === i.ordinal)?.id ?? null;
  const src = parseIPv4(flow.src), dst = parseIPv4(flow.dst);
  if (src === null || dst === null) return finish('unsupported', 'invalid-query');
  let nodeId = flow.ingressNodeId;
  const initial = sidecar.interfaces.find(i => i.id === flow.ingressInterfaceId && i.nodeId === nodeId);
  let ingress = models.get(nodeId)?.interfaces.find(i => i.ordinal === initial?.ordinal);
  const seen = new Set<string>();
  const owners = (address: number): { nodeId: string; iface: InterfaceModel }[] => {
    const out: { nodeId: string; iface: InterfaceModel }[] = [];
    for (const [id, d] of models) for (const i of d.interfaces) if (active(i) && i.address?.address === address) out.push({ nodeId: id, iface: i });
    return out;
  };
  const acl = (d: DeviceModel, i: InterfaceModel, direction: 'in' | 'out'): 'permit' | 'deny' | 'unsupported' => {
    const groups = i.accessGroups.filter(g => g.direction === direction);
    if (groups.length > 1) { trace.diagnostics.push('duplicate-access-group'); return 'unsupported'; }
    const group = groups[0];
    if (!group) return 'permit';
    const list = d.acls.find(a => a.name === group.aclName);
    if (!list) { trace.diagnostics.push('undefined-acl'); return 'unsupported'; }
    const stable = sidecar.acls.find(a => a.nodeId === nodeId && d.acls.findIndex(x => x.name === a.aclName) === d.acls.indexOf(list));
    // Transformed ACL names may differ: source declaration order is the fallback structural identity.
    const ordinal = d.acls.indexOf(list);
    const stableAcl = stable ?? sidecar.acls.filter(a => a.nodeId === nodeId)[ordinal];
    if (!stableAcl) return 'unsupported';
    const entry = list.entries.find(e => (e.protocol === 'ip' || e.protocol === flow.protocol) && matchAddress(e.src, src) && matchAddress(e.dst, dst) && (e.dstPort === null || e.dstPort === flow.dstPort));
    trace.aclDecision = { nodeId, aclId: stableAcl.id, entryOrdinal: entry?.ordinal ?? 0 };
    return entry?.action ?? 'deny';
  };
  const limit = options.hopLimit ?? models.size * 2;
  for (let step = 0; step < limit; step++) {
    const d = models.get(nodeId);
    if (!d || !ingress || !active(ingress)) return finish('unsupported', 'ingress-inactive');
    const inId = ifaceId(nodeId, ingress);
    if (!inId) return finish('unsupported', 'missing-interface');
    const visit = `${nodeId}/${inId}`;
    if (seen.has(visit)) return finish('loop');
    seen.add(visit);
    trace.nodeIds.push(nodeId);
    const hop: Hop = { nodeId, ingress: inId, egress: null };
    trace.interfaceHops.push(hop);
    const inbound = acl(d, ingress, 'in');
    if (inbound === 'unsupported') return finish('unsupported');
    if (inbound === 'deny') return finish('deny-in');
    if (d.interfaces.some(i => active(i) && i.address?.address === dst)) return finish('delivered');
    const routes = [
      ...d.interfaces.filter(active).filter(i => i.address && inSubnet(dst, i.address.address, i.address.prefixLength)).map(i => ({ len: i.address!.prefixLength, connected: true, iface: i, nextHop: dst })),
      ...d.staticRoutes.filter(r => inSubnet(dst, r.prefix, r.prefixLength)).map(r => ({ len: r.prefixLength, connected: false, iface: null as InterfaceModel | null, nextHop: r.nextHop })),
    ].sort((a, b) => b.len - a.len || Number(b.connected) - Number(a.connected));
    const route = routes[0];
    if (!route) return finish('no-route');
    if (!route.connected && routes[1]?.len === route.len && !routes[1].connected) return finish('unsupported', 'equal-static-routes');
    const candidates = route.iface ? [route.iface] : d.interfaces.filter(i => active(i) && i.address && inSubnet(route.nextHop, i.address.address, i.address.prefixLength));
    if (candidates.length !== 1) return finish('unsupported', 'unresolved-next-hop');
    const egress = candidates[0]!;
    hop.egress = ifaceId(nodeId, egress);
    if (!hop.egress) return finish('unsupported', 'missing-interface');
    const outbound = acl(d, egress, 'out');
    if (outbound === 'unsupported') return finish('unsupported');
    if (outbound === 'deny') return finish('deny-out');
    const next = owners(route.nextHop);
    if (next.length === 1) { nodeId = next[0]!.nodeId; ingress = next[0]!.iface; continue; }
    if (next.length > 1) return finish('unsupported', 'ambiguous-next-hop');
    if (route.connected) return finish('delivered-to-subnet');
    const internal = [...models.values()].some(m => m.interfaces.some(i => active(i) && i.address && inSubnet(dst, i.address.address, i.address.prefixLength)));
    return internal ? finish('unsupported', 'unowned-internal-next-hop') : finish('exits-network');
  }
  return finish('loop', 'hop-limit');
}

export function sameTrace(a: Trace, b: Trace): boolean {
  return a.disposition !== 'unsupported' && b.disposition !== 'unsupported' && a.disposition === b.disposition && JSON.stringify(a.nodeIds) === JSON.stringify(b.nodeIds) && JSON.stringify(a.interfaceHops) === JSON.stringify(b.interfaceHops) && JSON.stringify(a.aclDecision) === JSON.stringify(b.aclDecision);
}

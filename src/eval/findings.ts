import type { CaseInput } from '../strategies/types';
import type { CaseSidecar } from '../core/sidecar';
import type { FindingRule } from '../core/types';
import { parseCase } from '../core/parser';

export interface Finding { rule: FindingRule; nodeId: string; aclId?: string; direction?: 'in' | 'out'; ordinal: number }
export function findFindings(input: CaseInput, sidecar: CaseSidecar): Finding[] {
  const parsed = parseCase(input), out: Finding[] = [], addresses = new Set<number>();
  for (const n of sidecar.nodes) {
    const d = parsed.files.find(f => f.fileId === n.fileId)?.device;
    if (!d) continue;
    for (const [ai, a] of d.acls.entries()) {
      const aclId = sidecar.acls.filter(s => s.nodeId === n.id)[ai]?.id;
      const seen = new Set<string>();
      for (const e of a.entries) {
        const common = { nodeId: n.id, ...(aclId ? { aclId } : {}), ordinal: e.ordinal };
        if (e.action === 'permit' && e.protocol === 'ip' && e.src.type === 'any' && e.dst.type === 'any' && e.dstPort === null) out.push({ ...common, rule: 'permit-ip-any-any' });
        const signature = JSON.stringify([e.action, e.protocol, e.src, e.dst, e.dstPort]);
        if (seen.has(signature)) out.push({ ...common, rule: 'duplicate-acl-entry' });
        seen.add(signature);
      }
    }
    for (const i of d.interfaces) {
      if (i.address) {
        if (addresses.has(i.address.address)) out.push({ rule: 'duplicate-interface-address', nodeId: n.id, ordinal: i.ordinal });
        addresses.add(i.address.address);
      }
      for (const g of i.accessGroups) if (!d.acls.some(a => a.name === g.aclName)) out.push({ rule: 'unresolved-acl-reference', nodeId: n.id, direction: g.direction, ordinal: i.ordinal });
    }
    for (const c of d.snmpCommunities) if (['public', 'private'].includes(c.community.toLowerCase())) out.push({ rule: 'default-snmp-community', nodeId: n.id, ordinal: c.lineOrdinal });
  }
  return out;
}

export function compareFindings(original: Finding[], output: Finding[]): { preserved: number; lost: number; introduced: number } {
  const key = (f: Finding): string => JSON.stringify([f.rule, f.nodeId, f.aclId ?? null, f.direction ?? null, f.ordinal]);
  const remaining = output.map(key);
  let preserved = 0;
  for (const f of original) { const i = remaining.indexOf(key(f)); if (i >= 0) { preserved++; remaining.splice(i, 1); } }
  return { preserved, lost: original.length - preserved, introduced: remaining.length };
}

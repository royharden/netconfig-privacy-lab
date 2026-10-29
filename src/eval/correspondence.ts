import type { CaseSidecar } from '../core/sidecar';
import type { CaseInput, Outcome } from '../strategies/types';
import type { AddrSpec, ParsedLine } from '../core/model';
import { parseCase } from '../core/parser';
import { formatIPv4 } from '../core/ipv4';

export interface CorrespondenceIssue { kind: 'conflict' | 'many-to-one' | 'missing'; scope: string; id: string }
/** Runner-private induced correspondence. Never repair a collision or serialize this into results. */
export interface Correspondence {
  nodes: Map<string, string>;
  interfaces: Map<string, string>;
  acls: Map<string, string>;
  aclEntries: Map<string, number>;
  addresses: Map<string, string>;
  issues: CorrespondenceIssue[];
  healthy: boolean;
}

/** Address roles in structural order; masks, wildcards and numeric constants are excluded. */
function addresses(lines: readonly ParsedLine[]): { role: string; value: string }[] {
  const out: { role: string; value: string }[] = [];
  const add = (role: string, n: number) => { out.push({ role, value: formatIPv4(n) }); };
  const spec = (role: string, s: AddrSpec) => { if (s.type !== 'any') add(role, s.value); };
  for (const line of lines) {
    const n = line.node;
    switch (n.kind) {
      case 'if-address': add('interface', n.addressValue); break;
      case 'static-route': add('route-prefix', n.prefixValue); add('next-hop', n.nextHopValue); break;
      case 'acl-entry': spec('acl-source', n.src); spec('acl-destination', n.dst); break;
      case 'bgp-remote-as': add('neighbor', n.neighborValue); break;
      default: break;
    }
  }
  return out;
}

/** Preserve declaration slots even when a transformed named ACL collides with an earlier one.
 * The aggregate parser model merges those names, which would hide a many-to-one collapse. */
function aclSlots(lines: readonly ParsedLine[]): { name: string; entries: number[] }[] {
  const slots: { name: string; entries: number[] }[] = [];
  const numbered = new Map<string, { name: string; entries: number[] }>();
  let active: { name: string; entries: number[] } | undefined;
  for (const line of lines) {
    const n = line.node;
    if (n.kind === 'acl-named-header') { active = { name: n.name.text, entries: [] }; slots.push(active); }
    else if ((n.kind === 'acl-entry' || n.kind === 'acl-remark') && n.numberTok !== null) {
      let slot = numbered.get(n.aclName);
      if (!slot) { slot = { name: n.aclName, entries: [] }; numbered.set(n.aclName, slot); slots.push(slot); }
      if (n.kind === 'acl-entry') slot.entries.push(slot.entries.length + 1);
    } else if (n.kind === 'acl-entry' && active) active.entries.push(active.entries.length + 1);
  }
  return slots;
}

export function deriveCorrespondence(original: CaseInput, outcome: Outcome, sidecar: CaseSidecar): Correspondence {
  const result: Correspondence = { nodes: new Map(), interfaces: new Map(), acls: new Map(), aclEntries: new Map(), addresses: new Map(), issues: [], healthy: false };
  const reverse = new Map<string, string>();
  const bind = <T extends string | number>(map: Map<string, T>, id: string, value: T, scope: string) => {
    if (map.has(id) && map.get(id) !== value) result.issues.push({ kind: 'conflict', scope, id });
    else map.set(id, value);
    const key = `${scope}\0${value}`;
    if (reverse.has(key) && reverse.get(key) !== id) result.issues.push({ kind: 'many-to-one', scope, id });
    else reverse.set(key, id);
  };
  const missing = (scope: string, id: string) => { result.issues.push({ kind: 'missing', scope, id }); };
  if (original.caseId !== outcome.caseId || original.caseId !== sidecar.caseId || outcome.status === 'error') {
    missing('case', sidecar.caseId); return result;
  }
  const before = parseCase(original), after = parseCase({ caseId: outcome.caseId, files: outcome.files });
  for (const sf of sidecar.files) {
    const a = before.files.find((f) => f.fileId === sf.fileId), b = after.files.find((f) => f.fileId === sf.fileId);
    if (!a || !b) { missing('file', sf.fileId); continue; }
    if (b.device.hostname === null) missing('node', sf.nodeId);
    else bind(result.nodes, sf.nodeId, b.device.hostname, 'node');
    for (const si of sidecar.interfaces.filter((i) => i.nodeId === sf.nodeId)) {
      const ai = a.device.interfaces.find((i) => i.ordinal === si.ordinal);
      const bi = b.device.interfaces.find((i) => i.ordinal === si.ordinal);
      if (!ai || !bi) missing('interface', si.id);
      else bind(result.interfaces, si.id, bi.name, `interface/${sf.nodeId}`);
    }
    const originalAcls = aclSlots(a.lines), outputAcls = aclSlots(b.lines);
    for (const sa of sidecar.acls.filter((acl) => acl.nodeId === sf.nodeId)) {
      const index = originalAcls.findIndex((acl) => acl.name === sa.aclName);
      const acl = index < 0 ? undefined : outputAcls[index];
      if (!acl) { missing('acl', sa.id); continue; }
      bind(result.acls, sa.id, acl.name, `acl/${sf.nodeId}`);
      for (const se of sidecar.aclEntries.filter((entry) => entry.aclId === sa.id)) {
        const entry = acl.entries.find((ordinal) => ordinal === se.ordinal);
        if (!entry) missing('acl-entry', se.id);
        else bind(result.aclEntries, se.id, entry, `acl-entry/${sa.id}`);
      }
    }
    const av = addresses(a.lines), bv = addresses(b.lines);
    if (av.length !== bv.length) missing('address-roles', sf.fileId);
    av.forEach((item, i) => {
      const target = bv[i];
      if (!target || target.role !== item.role) missing('address-role', sf.fileId);
      else bind(result.addresses, item.value, target.value, 'address');
    });
  }
  // Reject duplicated stable IDs rather than silently accepting find()'s first file.
  for (const files of [original.files, outcome.files]) {
    const seen = new Set<string>();
    for (const f of files) { if (seen.has(f.fileId)) result.issues.push({ kind: 'conflict', scope: 'file', id: f.fileId }); seen.add(f.fileId); }
  }
  result.healthy = result.issues.length === 0;
  return result;
}

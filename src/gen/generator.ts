import type { ConfigFileInput, Family, Stratum } from '../core/types';
import { ID_PATTERN } from '../core/types';
import type { Ledger, LedgerEntity } from '../core/ledger';
import { parseLedger } from '../core/ledger';
import type { CaseLabels } from '../core/labels';
import { parseLabels } from '../core/labels';
import type { CaseSidecar, Flow } from '../core/sidecar';
import { parseSidecar } from '../core/sidecar';
import { parseCase } from '../core/parser';
import { validateLabelSpans, validateLedgerSpans } from '../core/ledgerValidate';
import { inSubnet, formatIPv4, parseIPv4, networkOf, isNetworkOrBroadcast } from '../core/ipv4';
import { buildTopology, firstHop } from './families';
import { createPrng } from './prng';
import { inventedNames } from './names';
import { ConfigText, CorpusText, ident, word } from './text';
import * as traps from './traps';

export interface GeneratorSpec { caseId: string; family: Family; deviceCount: number; seed: number; stratum: Stratum }
export interface GeneratedCase { spec: GeneratorSpec; files: ConfigFileInput[]; sidecar: CaseSidecar; ledger: Ledger; labels: CaseLabels }
interface End { node: number; peer: number; address: LedgerEntity; peerAddress: LedgerEntity; shutdown: boolean }

/** Source-only dev/decoy generator. No expected answers, keys, author data or evaluator imports. */
export function generateCase(spec: GeneratorSpec): GeneratedCase {
  if (!ID_PATTERN.test(spec.caseId)) throw new Error('invalid opaque case id');
  const random = createPrng(spec.seed);
  const topology = buildTopology(spec.family, spec.deviceCount, random.fork('topology'));
  const corpus = new CorpusText(spec.caseId);
  const hosts = inventedNames(random.fork('names'), spec.deviceCount).map((n) => corpus.entity('hostname', n));
  const octet = random.fork('addresses').int(1, 220);
  const addressEntities = new Map<string, LedgerEntity>();
  const ip = (value: string): LedgerEntity => {
    let e = addressEntities.get(value);
    if (e === undefined) { e = corpus.entity('ipv4', value); addressEntities.set(value, e); }
    return e;
  };
  const lans = hosts.map((_, i) => i === 0 ? '192.0.2' : i === 1 ? `172.${32 + octet % 32}.1` : `10.${octet}.${i + 1}`);
  const lanIps = lans.map((p) => ip(`${p}.1`));
  const lanBases = lans.map((p) => ip(`${p}.0`));
  const ends: End[][] = hosts.map(() => []);
  topology.links.forEach((link, i) => {
    const base = (parseIPv4(`10.${octet}.250.0`) ?? 0) + 4 * i;
    const a = ip(formatIPv4(base + 1)), b = ip(formatIPv4(base + 2));
    ends[link.a].push({ node: link.a, peer: link.b, address: a, peerAddress: b, shutdown: link.shutdown });
    ends[link.b].push({ node: link.b, peer: link.a, address: b, peerAddress: a, shutdown: link.shutdown });
  });
  const domain = corpus.entity('domain', `${hosts[0].value}.example`);
  const asn = corpus.entity('asn', '150'), remoteAs = corpus.entity('asn', '443');
  const secret = traps.plantUnknownFormatSecret(corpus);
  const community = corpus.entity('community', 'public');
  const org = corpus.entity('org', 'zephyra');
  const acl = corpus.entity('acl-name', 'zephyra-EDGE-IN');
  const spare = ip(`10.${octet}.249.1`);
  const external = ip('198.51.100.77');
  const externalA = ip('203.0.113.77');
  const extraStubCount = random.fork('stubs').int(0, 3);
  const stubOwners = Array.from({ length: extraStubCount }, (_, i) => random.fork(`stub-${i}`).int(0, spec.deviceCount - 1));
  const configs: ConfigText[] = [];
  for (let n = 0; n < spec.deviceCount; n++) {
    const file = new ConfigText(corpus, `n${String(n + 1).padStart(2, '0')}`); configs.push(file);
    file.add('hostname ', ident(hosts[n]));
    if (n === 0) traps.plantHostnameInDomainAndDescription(file, hosts[0], domain);
    file.add('interface GigabitEthernet0/0');
    if (n === 0) file.add(' description ', word('Service'), ' ', ident(hosts[0]), ' ', traps.plantMixedCaseRepeat(hosts[0]),
      ' ', traps.plantEmbeddedName(hosts[0]), ' ', traps.plantIpInFreeText(lanIps[0]), ' ', traps.plantIpPrefixText(lanIps[0]),
      ' ', traps.plantSplitIp(lanIps[0]), ' ', traps.plantMacAndSerial(corpus), ' ', traps.plantHtmlInDescription(),
      ' ', traps.plantBenignSubstring(hosts[0]));
    else file.add(' description ', word('Synthetic'), ' ', word('LAN'));
    file.add(' ip address ', ident(lanIps[n]), ' ', traps.plantMaskLikeAddress('255.255.255.0'));
    if (n === 0) file.add(' ip access-group ', traps.plantOrgInAclName(acl, org), ' in');
    file.add('!');
    ends[n].forEach((end, i) => {
      file.add(`interface GigabitEthernet0/${i + 1}`);
      file.add(' ip address ', ident(end.address), ' ', traps.plantMaskLikeAddress('255.255.255.252'));
      if (end.shutdown) file.add(' shutdown');
      file.add('!');
    });
    if (n < 2) traps.plantDuplicateInterfaceIp(file, spare, ends[n].length + 1);
    if (n === 0 && spec.family === 'dual-isp-edge') {
      for (let k = 0; k < 2; k++) {
        file.add(`interface GigabitEthernet0/${ends[n].length + 2 + k}`);
        file.add(' ip address ', ident(ip(`10.${octet}.248.${k * 4 + 1}`)), ' ', traps.plantMaskLikeAddress('255.255.255.252'));
        file.add('!');
      }
      traps.plantDefaultRoute(file, ip(`10.${octet}.248.2`));
      file.add('ip route ', traps.plantNetworkBase(ip('198.51.0.0')), ' ', traps.plantMaskLikeAddress('255.255.0.0'), ' ', ident(ip(`10.${octet}.248.6`)));
    }
    // Seeded optional access stubs make the family/count pool contain prefix-multiset diversity.
    // They cannot be next hops or scheduled endpoints. All remain valid /24 host interfaces.
    let nextInterface = ends[n].length + (n < 2 ? 2 : 1) + (n === 0 && spec.family === 'dual-isp-edge' ? 2 : 0);
    stubOwners.forEach((owner, i) => {
      if (owner !== n) return;
      file.add(`interface GigabitEthernet0/${nextInterface++}`);
      file.add(' ip address ', ident(ip(`10.${octet}.${240 + i}.1`)), ' ', traps.plantMaskLikeAddress('255.255.255.0'));
      file.add('!');
    });
    for (let target = 0; target < spec.deviceCount; target++) {
      if (target === n) continue;
      const next = firstHop(topology, n, target);
      const end = ends[n].find((e) => e.peer === next && !e.shutdown);
      if (end === undefined) throw new Error('missing active next hop');
      file.add('ip route ', traps.plantNetworkBase(lanBases[target]), ' ', traps.plantMaskLikeAddress('255.255.255.0'), ' ', ident(end.peerAddress));
    }
    if (spec.family === 'dual-isp-edge' && n > 0) {
      const end = ends[n].find((e) => e.peer === firstHop(topology, n, 0) && !e.shutdown);
      if (end === undefined) throw new Error('missing edge path');
      traps.plantDefaultRoute(file, end.peerAddress);
    }
    if (n === 0) {
      file.add('ip access-list extended ', traps.plantOrgInAclName(acl, org));
      file.add(' deny tcp any host ', ident(lanIps[1]), ' eq ', traps.plantAsnEqualsPort(remoteAs));
      file.add(' deny tcp any host ', ident(lanIps[1]), ' eq ', traps.plantAsnEqualsPort(remoteAs));
      file.add(' permit ip any any'); file.add('!');
      traps.plantAsnEqualsAcl(file, asn);
      // Config-present external target; never a query-only address.
      file.add('access-list 151 permit ip any host ', ident(external));
      file.add('access-list 151 permit ip any host ', ident(externalA));
      file.add('router bgp ', ident(asn));
      file.add(' neighbor ', ident(external), ' remote-as ', ident(remoteAs));
      file.add(' neighbor ', ident(external), ' description ', word('External'), ' ', ident(hosts[0])); file.add('!');
      traps.plantCommonWordCommunity(file, community);
      traps.plantUsernameEqualsHostname(file, corpus, hosts[0], secret);
      file.add('enable secret 9 ', ident(secret));
      traps.plantEmailInBanner(file, corpus, hosts[0], domain);
      file.add('! ', word('Contact'), ' ', traps.plantIpInFreeText(lanIps[0]));
      file.add('banner motd #', word('Address'), ' ', traps.plantIpInFreeText(lanIps[0]), '#');
      traps.plantFilenameTrap(file, corpus, hosts[0]);
      if (spec.stratum === 'unsupported') traps.plantUnsupportedRoutingLine(file);
    }
    file.add('end');
  }
  const files = configs.map((c) => c.input());
  const parsed = parseCase({ caseId: spec.caseId, files });
  if (parsed.stratum !== spec.stratum || parsed.violations.length > 0) throw new Error('generated parse/stratum violation');
  const sidecar: CaseSidecar = { schema: 'case-v1', caseId: spec.caseId, family: spec.family, stratum: spec.stratum,
    files: files.map((f) => ({ fileId: f.fileId, path: `${f.fileId}.cfg`, name: f.name, nodeId: f.fileId })),
    nodes: files.map((f) => ({ id: f.fileId, fileId: f.fileId })), interfaces: [], acls: [], aclEntries: [], flows: [] };
  for (const f of parsed.files) {
    for (const iface of f.device.interfaces) sidecar.interfaces.push({ id: `${f.fileId}i${iface.ordinal}`, nodeId: f.fileId, ordinal: iface.ordinal });
    f.device.acls.forEach((a, i) => {
      const id = `${f.fileId}a${i + 1}`;
      sidecar.acls.push({ id, nodeId: f.fileId, aclName: a.name });
      for (const entry of a.entries) sidecar.aclEntries.push({ id: `${id}e${entry.ordinal}`, nodeId: f.fileId, aclId: id, aclName: a.name, ordinal: entry.ordinal });
    });
  }
  // Four fixed quotas of eight: cross-LAN, local delivery, ACL-port, external. No answers are computed or emitted.
  if (spec.stratum === 'semantic-positive') for (let q = 0; q < 4; q++) for (let j = 0; j < 8; j++) {
    const source = q === 2 ? 0 : j % spec.deviceCount;
    const destination = q === 1 ? source : q === 2 ? 1 : (source + 1 + (j % (spec.deviceCount - 1))) % spec.deviceCount;
    const protocol = q === 2 ? 'tcp' : j === 0 ? 'icmp' : j % 2 === 0 ? 'udp' : 'tcp';
    const fileId = files[source].fileId;
    const flow: Flow = { id: `f${String(q * 8 + j + 1).padStart(2, '0')}`, ingressNodeId: fileId,
      ingressInterfaceId: `${fileId}i1`, src: lanIps[source].value, dst: q === 3 ? (j % 2 === 0 ? external.value : externalA.value) : lanIps[destination].value,
      protocol, srcPort: protocol === 'icmp' ? 0 : 12000 + q * 8 + j, dstPort: protocol === 'icmp' ? 0 : q === 2 ? 443 : 80 + j };
    sidecar.flows.push(flow);
  }
  const result: GeneratedCase = { spec, files, sidecar, ledger: corpus.ledger, labels: corpus.labels };
  auditGeneratedCase(result);
  return result;
}

/** Fail closed: topology/flow rules are checked independently against parser output, not generator bookkeeping. */
export function auditGeneratedCase(g: GeneratedCase): void {
  const fail = (condition: boolean, code: string): void => { if (!condition) throw new Error(`generator audit: ${code}`); };
  fail(parseSidecar(g.sidecar).ok && parseLedger(g.ledger).ok && parseLabels(g.labels).ok, 'schema');
  fail(validateLedgerSpans(g.ledger, g.files, g.spec.caseId).length === 0, 'ledger-spans-and-caps');
  fail(validateLabelSpans(g.labels, g.files, g.spec.caseId).length === 0, 'label-spans');
  fail(g.sidecar.flows.length === (g.spec.stratum === 'semantic-positive' ? 32 : 0), 'flow-count');
  const parsed = parseCase({ caseId: g.spec.caseId, files: g.files });
  fail(parsed.violations.length === 0 && parsed.stratum === g.spec.stratum, 'parse');
  const hosts = parsed.files.map((f) => f.device.hostname?.toLowerCase());
  fail(new Set(hosts).size === g.spec.deviceCount && hosts.every((h) => h !== undefined), 'unique-hostnames');
  const endpointValues = new Set<number>();
  const interfaceOwners = new Map<number, number>();
  for (const file of parsed.files) for (const iface of file.device.interfaces) if (iface.address !== null) {
    interfaceOwners.set(iface.address.address, (interfaceOwners.get(iface.address.address) ?? 0) + 1);
  }
  const nextHops = new Set(parsed.files.flatMap((f) => f.device.staticRoutes.map((r) => r.nextHop)));
  for (const file of parsed.files) {
    const d = file.device;
    fail(d.diagnostics.length === 0, 'model-diagnostics');
    fail(d.bgp === null || d.bgp.neighbors.length <= 4, 'bgp-count');
    fail(d.bgp === null || d.bgp.neighbors.every((n) => !interfaceOwners.has(n.address)), 'external-bgp-only');
    fail(new Set(d.acls.map((a) => a.name)).size === d.acls.length, 'unique-acl');
    const active = d.interfaces.filter((i) => !i.shutdown && i.address !== null);
    for (const iface of d.interfaces) {
      const a = iface.address;
      fail(a !== null && [24, 30].includes(a.prefixLength) && !isNetworkOrBroadcast(a.address, a.prefixLength), 'interface-host');
      fail(new Set(iface.accessGroups.map((ag) => ag.direction)).size === iface.accessGroups.length, 'one-acl-per-direction');
      if (a !== null && !iface.shutdown) endpointValues.add(a.address);
    }
    fail(d.staticRoutes.filter((r) => r.prefixLength === 0).length <= 1, 'one-default');
    fail(new Set(d.staticRoutes.map((r) => `${r.prefix}/${r.prefixLength}`)).size === d.staticRoutes.length, 'unique-route');
    for (const route of d.staticRoutes) {
      fail([0, 16, 24, 30, 32].includes(route.prefixLength), 'route-length');
      fail(route.prefix === networkOf(route.prefix, route.prefixLength), 'canonical-network');
      fail(active.some((i) => i.address !== null && inSubnet(route.nextHop, i.address.address, i.address.prefixLength)), 'connected-next-hop');
      endpointValues.add(route.nextHop);
      fail((interfaceOwners.get(route.nextHop) ?? 0) <= 1, 'unambiguous-next-hop');
    }
    for (const acl of d.acls) for (const e of acl.entries) for (const a of [e.src, e.dst]) if (a.type === 'host') endpointValues.add(a.address);
  }
  for (const flow of g.sidecar.flows) {
    const src = parseIPv4(flow.src), dst = parseIPv4(flow.dst);
    fail(src !== null && dst !== null && endpointValues.has(src) && endpointValues.has(dst), 'config-present-endpoints');
    fail(src !== null && dst !== null && (interfaceOwners.get(src) ?? 0) <= 1 && (interfaceOwners.get(dst) ?? 0) <= 1, 'duplicate-not-endpoint');
    const sf = g.sidecar.interfaces.find((i) => i.id === flow.ingressInterfaceId);
    const device = parsed.files.find((f) => f.fileId === flow.ingressNodeId)?.device;
    const iface = device?.interfaces.find((i) => i.ordinal === sf?.ordinal);
    fail(iface !== undefined && !iface.shutdown, 'active-ingress');
  }
  for (const [address, count] of interfaceOwners) if (count > 1) fail(!nextHops.has(address), 'duplicate-not-next-hop');
  // Completeness includes embedded and transformed variants. A benign look-alike or the same string in
  // another class's slot (username/filename) is intentional; ASN decimal text is checked by role below.
  for (const entity of g.ledger.entities) {
    if (entity.class === 'asn') continue;
    for (const text of new Set([entity.value, ...entity.occurrences.map((o) => o.text)])) {
      for (const file of g.files) {
        const targets = [{ text: file.name, ordinal: 0, location: 'name' as const },
          ...file.text.trimEnd().split('\n').map((line, i) => ({ text: line, ordinal: i + 1, location: 'line' as const }))];
        for (const target of targets) {
          let start = target.text.indexOf(text);
          while (start >= 0) {
            const end = start + text.length;
            if (entity.class === 'ipv4' && (/\d|\./.test(target.text[start - 1] ?? '') || /\d|\./.test(target.text[end] ?? ''))) {
              start = target.text.indexOf(text, start + 1); continue;
            }
            const labelled = g.ledger.entities.some((e) => e.occurrences.some((o) => o.fileId === file.fileId && o.location === target.location && o.ordinal === target.ordinal && o.start === start && o.end === end));
            const benign = target.location === 'line' && g.labels.benignSpans.some((b) => b.fileId === file.fileId && b.ordinal === target.ordinal && b.start <= start && b.end >= end);
            fail(labelled || benign, 'unlabelled-occurrence');
            start = target.text.indexOf(text, start + 1);
          }
        }
      }
    }
  }
  // Every typed identifier slot must have an exact ledger span. Numeric look-alikes are exempt by role, never by value.
  for (const file of parsed.files) for (const line of file.lines) {
    const node = line.node;
    const slots: { start: number; end: number }[] = [];
    switch (node.kind) {
      case 'hostname': case 'domain-name': slots.push(node.name); break;
      case 'if-address': slots.push(node.address); break;
      case 'static-route': if (node.prefixValue !== 0) slots.push(node.prefix); slots.push(node.nextHop); break;
      case 'if-access-group': if (!node.numbered) slots.push(node.acl); break;
      case 'acl-named-header': slots.push(node.name); break;
      case 'acl-entry': for (const a of [node.src, node.dst]) if (a.type !== 'any') slots.push(a.address); break;
      case 'bgp-router': slots.push(node.asn); break;
      case 'bgp-remote-as': slots.push(node.neighbor, node.asn); break;
      case 'bgp-description': slots.push(node.neighbor); break;
      case 'username': slots.push(node.name, node.hash); break;
      case 'enable-secret': slots.push(node.hash); break;
      case 'snmp-community': slots.push(node.community); break;
      default: break;
    }
    for (const slot of slots) fail(g.ledger.entities.some((e) => e.occurrences.some((o) => o.location === 'line' && o.fileId === file.fileId && o.ordinal === line.ordinal && o.start === slot.start && o.end === slot.end)), 'unlabelled-slot');
  }
}

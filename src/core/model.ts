/**
 * Typed model of one parsed config (PLAN.md §3). Two layers:
 *  - `ParsedLine[]`: every source line with its 1-based ordinal, raw text, terminator, enclosing block and a `LineNode` that
 *    records the span of every token a strategy may rewrite. Joining `text + eol` over all lines reproduces the input exactly.
 *  - `DeviceModel`: the forwarding-relevant facts aggregated from those lines (interfaces, static routes, ACLs, BGP metadata,
 *    communities, users) with structural ordinals, plus model diagnostics. It carries no secret or hash values.
 *
 * Ordinals (docs/SEMANTICS.md): `lineOrdinal` = 1-based line number in the original file; interface `ordinal` = 1-based
 * position among the file's interface blocks; ACL entry `ordinal` = 1-based position among that ACL's permit/deny entries
 * (remarks excluded); static route `ordinal` = 1-based position among the file's `ip route` lines.
 */
import type { AclAction, AclProtocol, Direction, LineTerminator } from './types';
import { isNetworkOrBroadcast } from './ipv4';

/** A token of a line: its text and its span in the line (0-based start, exclusive end). */
export interface Tok {
  text: string;
  start: number;
  end: number;
}

export type AddrSpec =
  | { type: 'any'; keyword: Tok }
  | { type: 'host'; keyword: Tok; address: Tok; value: number }
  | { type: 'wildcard'; address: Tok; wildcard: Tok; value: number; prefixLength: number };

/** The block a line belongs to. `unknown-block` follows an unrecognised top-level line until the next top-level line. */
export type BlockKind = 'top' | 'interface' | 'acl' | 'bgp' | 'unknown-block';

export type LineNode =
  | { kind: 'blank' }
  | { kind: 'comment'; text: Tok | null }
  | { kind: 'end' }
  | { kind: 'hostname'; name: Tok }
  | { kind: 'domain-name'; name: Tok }
  | { kind: 'interface'; name: Tok }
  | { kind: 'if-description'; text: Tok }
  | { kind: 'if-address'; address: Tok; mask: Tok; addressValue: number; prefixLength: number }
  | { kind: 'if-access-group'; acl: Tok; direction: Direction; numbered: boolean }
  | { kind: 'if-shutdown' }
  | { kind: 'if-no-shutdown' }
  | {
      kind: 'static-route';
      prefix: Tok;
      mask: Tok;
      nextHop: Tok;
      prefixValue: number;
      prefixLength: number;
      nextHopValue: number;
    }
  | { kind: 'acl-named-header'; name: Tok }
  | {
      kind: 'acl-entry';
      /** The ACL this entry belongs to: the enclosing named ACL, or the number of a numbered `access-list` line. */
      aclName: string;
      /** The ACL number token of a numbered `access-list N ...` line; null inside a named ACL block. */
      numberTok: Tok | null;
      action: AclAction;
      protocol: AclProtocol;
      src: AddrSpec;
      dst: AddrSpec;
      port: Tok | null;
      portValue: number | null;
    }
  | { kind: 'acl-remark'; aclName: string; numberTok: Tok | null; text: Tok }
  | { kind: 'bgp-router'; asn: Tok }
  | { kind: 'bgp-remote-as'; neighbor: Tok; neighborValue: number; asn: Tok }
  | { kind: 'bgp-description'; neighbor: Tok; neighborValue: number; text: Tok }
  | { kind: 'snmp-community'; community: Tok; access: 'RO' | 'RW' }
  | { kind: 'username'; name: Tok; hashType: '5' | '9'; hash: Tok }
  | { kind: 'enable-secret'; hashType: '5' | '9'; hash: Tok }
  | { kind: 'banner-motd'; text: Tok }
  | { kind: 'unknown'; forwardingAffecting: boolean; keyword: string | null };

export type LineKind = LineNode['kind'];

export interface ParsedLine {
  /** 1-based line number in the original file. */
  ordinal: number;
  /** Raw line text without its terminator (byte-for-byte for unknown lines). */
  text: string;
  eol: LineTerminator;
  block: BlockKind;
  node: LineNode;
}

export interface InterfaceAddress {
  address: number;
  prefixLength: number;
  lineOrdinal: number;
}

export interface AccessGroupModel {
  aclName: string;
  direction: Direction;
  lineOrdinal: number;
}

export interface InterfaceModel {
  name: string;
  /** 1-based position among this file's interface blocks (the interface "source ordinal"). */
  ordinal: number;
  lineOrdinal: number;
  description: string | null;
  address: InterfaceAddress | null;
  accessGroups: AccessGroupModel[];
  shutdown: boolean;
}

export interface StaticRouteModel {
  ordinal: number;
  lineOrdinal: number;
  prefix: number;
  prefixLength: number;
  nextHop: number;
}

export type AddrMatch =
  | { type: 'any' }
  | { type: 'host'; address: number }
  | { type: 'prefix'; address: number; prefixLength: number };

export interface AclEntryModel {
  /** 1-based position among this ACL's permit/deny entries (remarks excluded). */
  ordinal: number;
  lineOrdinal: number;
  action: AclAction;
  protocol: AclProtocol;
  src: AddrMatch;
  dst: AddrMatch;
  dstPort: number | null;
}

export interface AclModel {
  name: string;
  form: 'named' | 'numbered';
  /** Line ordinal of the first declaration (named header or first numbered line). */
  lineOrdinal: number;
  entries: AclEntryModel[];
}

export interface BgpNeighborModel {
  address: number;
  remoteAs: string | null;
  hasDescription: boolean;
  lineOrdinal: number;
}

export interface BgpModel {
  asn: string;
  lineOrdinal: number;
  neighbors: BgpNeighborModel[];
}

export interface SnmpCommunityModel {
  community: string;
  access: 'RO' | 'RW';
  lineOrdinal: number;
}

export interface UsernameModel {
  name: string;
  hashType: '5' | '9';
  lineOrdinal: number;
}

export interface UnknownLineModel {
  lineOrdinal: number;
  forwardingAffecting: boolean;
  keyword: string | null;
}

export type ModelDiagnosticCode =
  | 'duplicate-hostname-line'
  | 'duplicate-domain-line'
  | 'duplicate-acl-name'
  | 'duplicate-bgp-router'
  | 'interface-address-redefined'
  | 'invalid-host-address'
  | 'undefined-acl';

export interface ModelDiagnostic {
  code: ModelDiagnosticCode;
  lineOrdinal: number;
}

export interface DeviceModel {
  fileId: string;
  hostname: string | null;
  hostnameLineOrdinal: number | null;
  domainName: string | null;
  interfaces: InterfaceModel[];
  staticRoutes: StaticRouteModel[];
  acls: AclModel[];
  bgp: BgpModel | null;
  snmpCommunities: SnmpCommunityModel[];
  usernames: UsernameModel[];
  enableSecret: { hashType: '5' | '9'; lineOrdinal: number } | null;
  bannerLineOrdinals: number[];
  unknownLines: UnknownLineModel[];
  diagnostics: ModelDiagnostic[];
}

export interface ParsedFile {
  fileId: string;
  name: string;
  lines: ParsedLine[];
  device: DeviceModel;
  /** UTF-8 byte length of the input text. */
  byteLength: number;
}

export function toAddrMatch(spec: AddrSpec): AddrMatch {
  switch (spec.type) {
    case 'any':
      return { type: 'any' };
    case 'host':
      return { type: 'host', address: spec.value };
    case 'wildcard':
      return { type: 'prefix', address: spec.value, prefixLength: spec.prefixLength };
  }
}

export function aclEntryCount(device: DeviceModel): number {
  let n = 0;
  for (const acl of device.acls) n += acl.entries.length;
  return n;
}

export function unknownLineCount(file: ParsedFile): number {
  return file.device.unknownLines.length;
}

export function forwardingUnknownLineCount(file: ParsedFile): number {
  let n = 0;
  for (const u of file.device.unknownLines) if (u.forwardingAffecting) n++;
  return n;
}

/** Aggregates parsed lines into a DeviceModel. The parser guarantees sub-command nodes appear only inside their block. */
export function buildDeviceModel(fileId: string, lines: readonly ParsedLine[]): DeviceModel {
  const device: DeviceModel = {
    fileId,
    hostname: null,
    hostnameLineOrdinal: null,
    domainName: null,
    interfaces: [],
    staticRoutes: [],
    acls: [],
    bgp: null,
    snmpCommunities: [],
    usernames: [],
    enableSecret: null,
    bannerLineOrdinals: [],
    unknownLines: [],
    diagnostics: [],
  };
  const aclByName = new Map<string, AclModel>();
  let iface: InterfaceModel | null = null;

  const diag = (code: ModelDiagnosticCode, lineOrdinal: number): void => {
    device.diagnostics.push({ code, lineOrdinal });
  };
  const ensureAcl = (name: string, form: 'named' | 'numbered', lineOrdinal: number): AclModel => {
    let acl = aclByName.get(name);
    if (acl === undefined) {
      acl = { name, form, lineOrdinal, entries: [] };
      aclByName.set(name, acl);
      device.acls.push(acl);
    }
    return acl;
  };
  const neighborOf = (address: number, lineOrdinal: number): BgpNeighborModel | null => {
    if (device.bgp === null) return null;
    let n = device.bgp.neighbors.find((x) => x.address === address);
    if (n === undefined) {
      n = { address, remoteAs: null, hasDescription: false, lineOrdinal };
      device.bgp.neighbors.push(n);
    }
    return n;
  };

  for (const line of lines) {
    const node = line.node;
    const ord = line.ordinal;
    switch (node.kind) {
      case 'hostname':
        if (device.hostname !== null) diag('duplicate-hostname-line', ord);
        else {
          device.hostname = node.name.text;
          device.hostnameLineOrdinal = ord;
        }
        break;
      case 'domain-name':
        if (device.domainName !== null) diag('duplicate-domain-line', ord);
        else device.domainName = node.name.text;
        break;
      case 'interface':
        iface = {
          name: node.name.text,
          ordinal: device.interfaces.length + 1,
          lineOrdinal: ord,
          description: null,
          address: null,
          accessGroups: [],
          shutdown: false,
        };
        device.interfaces.push(iface);
        break;
      case 'if-description':
        if (iface !== null) iface.description = node.text.text;
        break;
      case 'if-address':
        if (iface !== null) {
          if (iface.address !== null) diag('interface-address-redefined', ord);
          iface.address = { address: node.addressValue, prefixLength: node.prefixLength, lineOrdinal: ord };
          if (isNetworkOrBroadcast(node.addressValue, node.prefixLength)) diag('invalid-host-address', ord);
        }
        break;
      case 'if-access-group':
        if (iface !== null) iface.accessGroups.push({ aclName: node.acl.text, direction: node.direction, lineOrdinal: ord });
        break;
      case 'if-shutdown':
        if (iface !== null) iface.shutdown = true;
        break;
      case 'if-no-shutdown':
        if (iface !== null) iface.shutdown = false;
        break;
      case 'static-route':
        device.staticRoutes.push({
          ordinal: device.staticRoutes.length + 1,
          lineOrdinal: ord,
          prefix: node.prefixValue,
          prefixLength: node.prefixLength,
          nextHop: node.nextHopValue,
        });
        break;
      case 'acl-named-header':
        if (aclByName.has(node.name.text)) diag('duplicate-acl-name', ord);
        ensureAcl(node.name.text, 'named', ord);
        break;
      case 'acl-entry': {
        const acl = ensureAcl(node.aclName, node.numberTok === null ? 'named' : 'numbered', ord);
        acl.entries.push({
          ordinal: acl.entries.length + 1,
          lineOrdinal: ord,
          action: node.action,
          protocol: node.protocol,
          src: toAddrMatch(node.src),
          dst: toAddrMatch(node.dst),
          dstPort: node.portValue,
        });
        break;
      }
      case 'acl-remark':
        if (node.numberTok !== null) ensureAcl(node.aclName, 'numbered', ord);
        break;
      case 'bgp-router':
        if (device.bgp !== null) diag('duplicate-bgp-router', ord);
        else device.bgp = { asn: node.asn.text, lineOrdinal: ord, neighbors: [] };
        break;
      case 'bgp-remote-as': {
        const n = neighborOf(node.neighborValue, ord);
        if (n !== null) n.remoteAs = node.asn.text;
        break;
      }
      case 'bgp-description': {
        const n = neighborOf(node.neighborValue, ord);
        if (n !== null) n.hasDescription = true;
        break;
      }
      case 'snmp-community':
        device.snmpCommunities.push({ community: node.community.text, access: node.access, lineOrdinal: ord });
        break;
      case 'username':
        device.usernames.push({ name: node.name.text, hashType: node.hashType, lineOrdinal: ord });
        break;
      case 'enable-secret':
        device.enableSecret = { hashType: node.hashType, lineOrdinal: ord };
        break;
      case 'banner-motd':
        device.bannerLineOrdinals.push(ord);
        break;
      case 'unknown':
        device.unknownLines.push({ lineOrdinal: ord, forwardingAffecting: node.forwardingAffecting, keyword: node.keyword });
        break;
      case 'blank':
      case 'comment':
      case 'end':
        break;
    }
  }

  for (const i of device.interfaces) {
    for (const g of i.accessGroups) if (!aclByName.has(g.aclName)) diag('undefined-acl', g.lineOrdinal);
  }
  return device;
}

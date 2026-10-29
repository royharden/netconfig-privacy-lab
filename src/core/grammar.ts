/**
 * Grammar v1 (closed), PLAN.md §2 row 4 and §3. This module holds the token patterns, the registry of supported constructs
 * (one parser branch and one test file each) and the forwarding-affecting keyword list that puts a case in the unsupported
 * stratum. `docs/GRAMMAR.md` is the prose version; tests/parser/grammarRegistry.test.ts checks that the two lists agree.
 *
 * Keywords are matched case-sensitively in lower case (the closed grammar has exactly one spelling of each); identifiers are
 * ASCII. Free text (descriptions, remarks, banner, comments) may hold any UTF-8.
 */
import type { BlockKind, LineKind } from './model';

export const INTERFACE_NAME_RE = /^GigabitEthernet\d{1,2}\/\d{1,2}$/;
/** `hostname NAME`: a letter, then letters, digits or '-' (max 63). Case-insensitive as an identifier. */
export const HOSTNAME_RE = /^[A-Za-z][A-Za-z0-9-]{0,62}$/;
/** `ip domain-name NAME`: dot-separated DNS labels (max 253). Case-insensitive as an identifier. */
export const DOMAIN_RE =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
/** Named ACL: starts with a letter (so it can never collide with a number). Case-sensitive. */
export const ACL_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
/** Numbered extended ACL: 100–199. The number is the ACL's name and a typed constant (row 34). */
export const NUMBERED_ACL_RE = /^1\d\d$/;
/** `username NAME`. Case-sensitive. */
export const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Any decimal ASN token (row 14); range handling is the lab arms' job. */
export const ASN_RE = /^(?:0|[1-9]\d{0,9})$/;
export const MAX_ASN = 4294967295;
export const PORT_RE = /^(?:0|[1-9]\d{0,4})$/;
export const MAX_PORT = 65535;
/** One-line banner with `#` delimiters; the text may not contain `#`. */
export const BANNER_RE = /^banner motd #([^#]*)#[ \t]*$/;
/** A sub-command line starts with a space or tab. */
export const INDENT_RE = /^[ \t]/;

export const HASH_TYPES = ['5', '9'] as const;
export const SNMP_ACCESS = ['RO', 'RW'] as const;

/** Typed constants: never identifiers, never rewritten by any lab or naive arm (§3, row 34). */
export const TYPED_CONSTANTS = [
  'netmasks',
  'ACL wildcards',
  'ports',
  'any',
  'host',
  '0.0.0.0',
  'numbered ACL numbers 100-199',
  'interface names',
] as const;

export function isNumberedAclName(text: string): boolean {
  return NUMBERED_ACL_RE.test(text);
}

export function isValidAsn(text: string): boolean {
  return ASN_RE.test(text) && Number(text) <= MAX_ASN;
}

export function isValidPort(text: string): boolean {
  return PORT_RE.test(text) && Number(text) <= MAX_PORT;
}

export type ConstructBlock = 'top' | 'interface' | 'acl' | 'bgp' | 'any';

export interface ConstructSpec {
  id: string;
  block: ConstructBlock;
  syntax: string;
  /** The LineNode kind the parser emits for it. */
  nodeKind: LineKind;
  /** The parser test file dedicated to this construct (tests/parser/<file>). */
  testFile: string;
}

export const SUPPORTED_CONSTRUCTS: readonly ConstructSpec[] = [
  { id: 'hostname', block: 'top', syntax: 'hostname NAME', nodeKind: 'hostname', testFile: 'hostname.test.ts' },
  {
    id: 'domain-name',
    block: 'top',
    syntax: 'ip domain-name NAME',
    nodeKind: 'domain-name',
    testFile: 'domainName.test.ts',
  },
  {
    id: 'interface',
    block: 'top',
    syntax: 'interface GigabitEthernetN/N',
    nodeKind: 'interface',
    testFile: 'interface.test.ts',
  },
  {
    id: 'if-description',
    block: 'interface',
    syntax: ' description TEXT',
    nodeKind: 'if-description',
    testFile: 'interfaceDescription.test.ts',
  },
  {
    id: 'if-address',
    block: 'interface',
    syntax: ' ip address A M  (M contiguous, /1–/32)',
    nodeKind: 'if-address',
    testFile: 'interfaceAddress.test.ts',
  },
  {
    id: 'if-access-group',
    block: 'interface',
    syntax: ' ip access-group NAME|100-199 in|out',
    nodeKind: 'if-access-group',
    testFile: 'accessGroup.test.ts',
  },
  { id: 'if-shutdown', block: 'interface', syntax: ' shutdown', nodeKind: 'if-shutdown', testFile: 'shutdown.test.ts' },
  {
    id: 'if-no-shutdown',
    block: 'interface',
    syntax: ' no shutdown',
    nodeKind: 'if-no-shutdown',
    testFile: 'noShutdown.test.ts',
  },
  {
    id: 'static-route',
    block: 'top',
    syntax: 'ip route P M NH  (P is the network base of P/M, NH a dotted quad)',
    nodeKind: 'static-route',
    testFile: 'staticRoute.test.ts',
  },
  {
    id: 'acl-named-header',
    block: 'top',
    syntax: 'ip access-list extended NAME',
    nodeKind: 'acl-named-header',
    testFile: 'namedAcl.test.ts',
  },
  {
    id: 'acl-entry',
    block: 'acl',
    syntax: ' permit|deny ip|tcp|udp|icmp SRC DST [eq PORT]  (SRC/DST = any | host A | A WILDCARD)',
    nodeKind: 'acl-entry',
    testFile: 'aclEntry.test.ts',
  },
  {
    id: 'acl-numbered-entry',
    block: 'top',
    syntax: 'access-list 100-199 permit|deny PROTO SRC DST [eq PORT]',
    nodeKind: 'acl-entry',
    testFile: 'numberedAcl.test.ts',
  },
  {
    id: 'acl-remark',
    block: 'any',
    syntax: ' remark TEXT  (in a named ACL) | access-list 100-199 remark TEXT',
    nodeKind: 'acl-remark',
    testFile: 'aclRemark.test.ts',
  },
  { id: 'bgp-router', block: 'top', syntax: 'router bgp ASN', nodeKind: 'bgp-router', testFile: 'bgpRouter.test.ts' },
  {
    id: 'bgp-remote-as',
    block: 'bgp',
    syntax: ' neighbor IP remote-as ASN',
    nodeKind: 'bgp-remote-as',
    testFile: 'bgpRemoteAs.test.ts',
  },
  {
    id: 'bgp-description',
    block: 'bgp',
    syntax: ' neighbor IP description TEXT',
    nodeKind: 'bgp-description',
    testFile: 'bgpDescription.test.ts',
  },
  {
    id: 'snmp-community',
    block: 'top',
    syntax: 'snmp-server community STR RO|RW',
    nodeKind: 'snmp-community',
    testFile: 'snmpCommunity.test.ts',
  },
  {
    id: 'username',
    block: 'top',
    syntax: 'username NAME secret 5|9 HASH  (HASH = any non-space token)',
    nodeKind: 'username',
    testFile: 'username.test.ts',
  },
  {
    id: 'enable-secret',
    block: 'top',
    syntax: 'enable secret 5|9 HASH',
    nodeKind: 'enable-secret',
    testFile: 'enableSecret.test.ts',
  },
  { id: 'banner-motd', block: 'top', syntax: 'banner motd #text#', nodeKind: 'banner-motd', testFile: 'banner.test.ts' },
  { id: 'comment', block: 'any', syntax: '! text', nodeKind: 'comment', testFile: 'comment.test.ts' },
  { id: 'end', block: 'top', syntax: 'end', nodeKind: 'end', testFile: 'end.test.ts' },
];

/**
 * Forwarding-affecting keyword list (§3). An UNKNOWN line whose leading tokens (trimmed, lower-cased) equal one of these entries
 * puts the case in the unsupported stratum. Additionally, every unknown line inside an ACL or BGP block is forwarding-affecting.
 * Supported lines never match (they are not unknown). Keep in sync with docs/GRAMMAR.md (checked by a test).
 */
export const FORWARDING_AFFECTING_KEYWORDS: readonly string[] = [
  'router',
  'ip route',
  'ipv6',
  'ip address',
  'ip unnumbered',
  'ip access-group',
  'ip access-list',
  'access-list',
  'permit',
  'deny',
  'neighbor',
  'network',
  'redistribute',
  'address-family',
  'default-information',
  'distance',
  'maximum-paths',
  'ip nat',
  'ip policy',
  'ip local policy',
  'route-map',
  'ip prefix-list',
  'object-group',
  'vrf',
  'ip vrf',
  'interface',
  'encapsulation',
  'switchport',
  'bridge-group',
  'channel-group',
  'standby',
  'vrrp',
  'glbp',
  'ip default-gateway',
  'ip default-network',
  'ip routing',
  'ip classless',
  'ip forward-protocol',
  'ip helper-address',
  'ip directed-broadcast',
  'ip proxy-arp',
  'ip verify',
  'ip ospf',
  'ip rip',
  'ip multicast-routing',
  'ip pim',
  'ip sla',
  'track',
  'tunnel',
  'crypto',
  'mpls',
  'shutdown',
  'no shutdown',
  'no ip route',
  'no ip address',
  'no ip access-group',
  'no ip routing',
  'no ip classless',
  'no ip proxy-arp',
  'no access-list',
  'no router',
  'no interface',
  'no neighbor',
  'no switchport',
];

/** Blocks in which every unknown line is forwarding-affecting (a malformed entry or BGP sub-command changes semantics). */
export const ALWAYS_FORWARDING_BLOCKS: readonly BlockKind[] = ['acl', 'bgp'];

const KEYWORDS_LONGEST_FIRST: readonly string[][] = [...FORWARDING_AFFECTING_KEYWORDS]
  .map((k) => k.split(' '))
  .sort((a, b) => b.length - a.length);

/** Returns the forwarding-affecting keyword an unknown line starts with, or null. */
export function matchForwardingKeyword(trimmedLine: string): string | null {
  const tokens = trimmedLine.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  for (const kw of KEYWORDS_LONGEST_FIRST) {
    if (kw.length <= tokens.length && kw.every((k, i) => tokens[i] === k)) return kw.join(' ');
  }
  return null;
}

export interface UnknownClassification {
  forwardingAffecting: boolean;
  keyword: string | null;
}

/** Classifies an unknown line given the block it appeared in. */
export function classifyUnknown(trimmedLine: string, block: BlockKind): UnknownClassification {
  const keyword = matchForwardingKeyword(trimmedLine);
  if (ALWAYS_FORWARDING_BLOCKS.includes(block)) return { forwardingAffecting: true, keyword: keyword ?? `<${block}-block>` };
  return { forwardingAffecting: keyword !== null, keyword };
}

/**
 * Closed-grammar parser (PLAN.md §3). Every line becomes a ParsedLine; a line that does not match a supported construct exactly
 * is an `unknown` node whose raw text is kept byte-for-byte and counted, and classified as forwarding-affecting or not
 * (grammar.ts). Caps are checked before (bytes, lines, UTF-8) and after (interfaces, routes, ACL entries, BGP neighbours)
 * building the device model; any violation yields no ParsedFile.
 *
 * Block rule: a non-indented line is top level and closes any open block; an indented line is a sub-command of the most
 * recent block header (`interface`, `ip access-list extended`, `router bgp`). Indented lines under an unknown header, or with
 * no open block, are unknown. Blank lines and comments never close a block, except that a non-indented `!` line does.
 */
import type { ConfigFileInput, Direction, Stratum } from './types';
import { ACL_PROTOCOLS, splitLines } from './types';
import type { AddrSpec, BlockKind, LineNode, ParsedFile, ParsedLine, Tok } from './model';
import { buildDeviceModel, forwardingUnknownLineCount } from './model';
import {
  ACL_NAME_RE,
  BANNER_RE,
  DOMAIN_RE,
  HOSTNAME_RE,
  INDENT_RE,
  INTERFACE_NAME_RE,
  USERNAME_RE,
  classifyUnknown,
  isNumberedAclName,
  isValidAsn,
  isValidPort,
} from './grammar';
import { maskToPrefix, parseIPv4, prefixToMask, wildcardToPrefix } from './ipv4';
import type { LimitViolation } from './limits';
import { checkCaseFiles, checkDeviceModel, checkFileText, utf8ByteLength } from './limits';

/**
 * Tokens are runs of characters other than space and tab (GRAMMAR.md). Deliberately NOT `\S`: JavaScript's `\s` also matches
 * U+FEFF and other Unicode spaces, which would silently skip a BOM or a no-break space instead of making the line unknown.
 */
export function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  const re = /[^ \t]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) toks.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return toks;
}

function isBlankChar(ch: string): boolean {
  return ch === ' ' || ch === '\t';
}

/** The free text from token `from` to the end of the last token (leading and trailing whitespace excluded). */
function restFrom(text: string, toks: readonly Tok[], from: number): Tok {
  const first = toks[from];
  const last = toks[toks.length - 1];
  return { text: text.slice(first.start, last.end), start: first.start, end: last.end };
}

function commentText(text: string): Tok | null {
  let start = text.indexOf('!') + 1;
  let end = text.length;
  while (start < end && isBlankChar(text[start])) start++;
  while (end > start && isBlankChar(text[end - 1])) end--;
  if (end <= start) return null;
  return { text: text.slice(start, end), start, end };
}

function unknownNode(text: string, block: BlockKind): LineNode {
  const c = classifyUnknown(text.trim(), block);
  return { kind: 'unknown', forwardingAffecting: c.forwardingAffecting, keyword: c.keyword };
}

function isDirection(text: string): text is Direction {
  return text === 'in' || text === 'out';
}

function isHashType(text: string): text is '5' | '9' {
  return text === '5' || text === '9';
}

interface AddrParse {
  spec: AddrSpec;
  next: number;
}

function parseAddrSpec(toks: readonly Tok[], j: number): AddrParse | null {
  if (j >= toks.length) return null;
  const a = toks[j];
  if (a.text === 'any') return { spec: { type: 'any', keyword: a }, next: j + 1 };
  if (j + 1 >= toks.length) return null;
  const b = toks[j + 1];
  if (a.text === 'host') {
    const value = parseIPv4(b.text);
    return value === null ? null : { spec: { type: 'host', keyword: a, address: b, value }, next: j + 2 };
  }
  const value = parseIPv4(a.text);
  const wildcard = parseIPv4(b.text);
  if (value === null || wildcard === null) return null;
  const prefixLength = wildcardToPrefix(wildcard);
  if (prefixLength === null || (value & wildcard) >>> 0 !== 0) return null;
  return { spec: { type: 'wildcard', address: a, wildcard: b, value, prefixLength }, next: j + 2 };
}

/** `permit|deny PROTO SRC DST [eq PORT]` starting at token i. `eq PORT` is destination-only and only for tcp/udp. */
function parseAclEntry(toks: readonly Tok[], i: number, aclName: string, numberTok: Tok | null): LineNode | null {
  if (toks.length < i + 4) return null;
  const action = toks[i].text;
  const protocol = toks[i + 1].text;
  if (action !== 'permit' && action !== 'deny') return null;
  const proto = ACL_PROTOCOLS.find((p) => p === protocol);
  if (proto === undefined) return null;
  const src = parseAddrSpec(toks, i + 2);
  if (src === null) return null;
  const dst = parseAddrSpec(toks, src.next);
  if (dst === null) return null;
  let port: Tok | null = null;
  let portValue: number | null = null;
  if (dst.next < toks.length) {
    if (dst.next + 2 !== toks.length || toks[dst.next].text !== 'eq') return null;
    if (proto !== 'tcp' && proto !== 'udp') return null;
    const p = toks[dst.next + 1];
    if (!isValidPort(p.text)) return null;
    port = p;
    portValue = Number(p.text);
  }
  return {
    kind: 'acl-entry',
    aclName,
    numberTok,
    action,
    protocol: proto,
    src: src.spec,
    dst: dst.spec,
    port,
    portValue,
  };
}

interface TopResult {
  node: LineNode;
  block: BlockKind;
  aclName: string | null;
}

function top(node: LineNode): TopResult {
  return { node, block: 'top', aclName: null };
}

function parseTopLevel(text: string, toks: readonly Tok[]): TopResult {
  const t = toks.map((x) => x.text);
  const n = toks.length;
  const unknown = (): TopResult => ({ node: unknownNode(text, 'top'), block: 'unknown-block', aclName: null });

  switch (t[0]) {
    case 'hostname':
      return n === 2 && HOSTNAME_RE.test(t[1]) ? top({ kind: 'hostname', name: toks[1] }) : unknown();
    case 'ip': {
      if (n === 3 && t[1] === 'domain-name' && DOMAIN_RE.test(t[2])) return top({ kind: 'domain-name', name: toks[2] });
      if (n === 5 && t[1] === 'route') {
        const prefixValue = parseIPv4(t[2]);
        const mask = parseIPv4(t[3]);
        const nextHopValue = parseIPv4(t[4]);
        const prefixLength = mask === null ? null : maskToPrefix(mask);
        if (
          prefixValue !== null &&
          nextHopValue !== null &&
          prefixLength !== null &&
          (prefixValue & prefixToMask(prefixLength)) >>> 0 === prefixValue
        ) {
          return top({
            kind: 'static-route',
            prefix: toks[2],
            mask: toks[3],
            nextHop: toks[4],
            prefixValue,
            prefixLength,
            nextHopValue,
          });
        }
        return unknown();
      }
      if (n === 4 && t[1] === 'access-list' && t[2] === 'extended' && ACL_NAME_RE.test(t[3])) {
        return { node: { kind: 'acl-named-header', name: toks[3] }, block: 'acl', aclName: t[3] };
      }
      return unknown();
    }
    case 'interface':
      return n === 2 && INTERFACE_NAME_RE.test(t[1])
        ? { node: { kind: 'interface', name: toks[1] }, block: 'interface', aclName: null }
        : unknown();
    case 'access-list': {
      if (n >= 3 && isNumberedAclName(t[1])) {
        if (t[2] === 'remark') {
          return n >= 4
            ? top({ kind: 'acl-remark', aclName: t[1], numberTok: toks[1], text: restFrom(text, toks, 3) })
            : unknown();
        }
        const entry = parseAclEntry(toks, 2, t[1], toks[1]);
        if (entry !== null) return top(entry);
      }
      return unknown();
    }
    case 'router':
      return n === 3 && t[1] === 'bgp' && isValidAsn(t[2])
        ? { node: { kind: 'bgp-router', asn: toks[2] }, block: 'bgp', aclName: null }
        : unknown();
    case 'snmp-server': {
      const access = t[3];
      return n === 4 && t[1] === 'community' && (access === 'RO' || access === 'RW')
        ? top({ kind: 'snmp-community', community: toks[2], access })
        : unknown();
    }
    case 'username': {
      const hashType = t[3];
      return n === 5 && USERNAME_RE.test(t[1]) && t[2] === 'secret' && isHashType(hashType)
        ? top({ kind: 'username', name: toks[1], hashType, hash: toks[4] })
        : unknown();
    }
    case 'enable': {
      const hashType = t[2];
      return n === 4 && t[1] === 'secret' && isHashType(hashType)
        ? top({ kind: 'enable-secret', hashType, hash: toks[3] })
        : unknown();
    }
    case 'banner': {
      const m = BANNER_RE.exec(text);
      if (m === null) return unknown();
      const body = m[1] ?? '';
      const start = text.indexOf('#') + 1;
      return top({ kind: 'banner-motd', text: { text: body, start, end: start + body.length } });
    }
    case 'end':
      return n === 1 ? top({ kind: 'end' }) : unknown();
    default:
      return unknown();
  }
}

function parseInterfaceSub(text: string, toks: readonly Tok[]): LineNode | null {
  const t = toks.map((x) => x.text);
  const n = toks.length;
  if (t[0] === 'description' && n >= 2) return { kind: 'if-description', text: restFrom(text, toks, 1) };
  if (t[0] === 'ip' && t[1] === 'address' && n === 4) {
    const addressValue = parseIPv4(t[2]);
    const mask = parseIPv4(t[3]);
    const prefixLength = mask === null ? null : maskToPrefix(mask);
    if (addressValue === null || prefixLength === null || prefixLength < 1) return null;
    return { kind: 'if-address', address: toks[2], mask: toks[3], addressValue, prefixLength };
  }
  if (t[0] === 'ip' && t[1] === 'access-group' && n === 4) {
    const direction = t[3];
    const numbered = isNumberedAclName(t[2]);
    if (!isDirection(direction) || !(numbered || ACL_NAME_RE.test(t[2]))) return null;
    return { kind: 'if-access-group', acl: toks[2], direction, numbered };
  }
  if (t[0] === 'shutdown' && n === 1) return { kind: 'if-shutdown' };
  if (t[0] === 'no' && t[1] === 'shutdown' && n === 2) return { kind: 'if-no-shutdown' };
  return null;
}

function parseAclSub(text: string, toks: readonly Tok[], aclName: string): LineNode | null {
  if (toks[0].text === 'remark') {
    return toks.length >= 2 ? { kind: 'acl-remark', aclName, numberTok: null, text: restFrom(text, toks, 1) } : null;
  }
  return parseAclEntry(toks, 0, aclName, null);
}

function parseBgpSub(text: string, toks: readonly Tok[]): LineNode | null {
  const t = toks.map((x) => x.text);
  const n = toks.length;
  if (t[0] !== 'neighbor' || n < 4) return null;
  const neighborValue = parseIPv4(t[1]);
  if (neighborValue === null) return null;
  if (t[2] === 'remote-as' && n === 4 && isValidAsn(t[3])) {
    return { kind: 'bgp-remote-as', neighbor: toks[1], neighborValue, asn: toks[3] };
  }
  if (t[2] === 'description') {
    return { kind: 'bgp-description', neighbor: toks[1], neighborValue, text: restFrom(text, toks, 3) };
  }
  return null;
}

function parseSub(text: string, toks: readonly Tok[], block: BlockKind, aclName: string | null): LineNode | null {
  switch (block) {
    case 'interface':
      return parseInterfaceSub(text, toks);
    case 'acl':
      return aclName === null ? null : parseAclSub(text, toks, aclName);
    case 'bgp':
      return parseBgpSub(text, toks);
    case 'top':
    case 'unknown-block':
      return null;
  }
}

/** Splits and classifies every line without checking caps or building the model (exported for tests and diagnostics). */
export function parseLines(text: string): ParsedLine[] {
  const raw = splitLines(text);
  const lines: ParsedLine[] = [];
  let block: BlockKind = 'top';
  let aclName: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const { text: lineText, eol } = raw[i];
    const toks = tokenize(lineText);
    const indented = INDENT_RE.test(lineText);
    let node: LineNode;
    let lineBlock: BlockKind;
    if (toks.length === 0) {
      node = { kind: 'blank' };
      lineBlock = block;
    } else if (toks[0].text.startsWith('!')) {
      if (!indented) {
        block = 'top';
        aclName = null;
      }
      node = { kind: 'comment', text: commentText(lineText) };
      lineBlock = block;
    } else if (indented) {
      lineBlock = block;
      node = parseSub(lineText, toks, block, aclName) ?? unknownNode(lineText, block);
    } else {
      const r = parseTopLevel(lineText, toks);
      node = r.node;
      block = r.block;
      aclName = r.aclName;
      lineBlock = 'top';
    }
    lines.push({ ordinal: i + 1, text: lineText, eol, block: lineBlock, node });
  }
  return lines;
}

export interface FileParseResult {
  file: ParsedFile | null;
  violations: LimitViolation[];
}

export function parseConfig(input: ConfigFileInput): FileParseResult {
  const pre = checkFileText(input.fileId, input.text);
  if (pre.length > 0) return { file: null, violations: pre };
  const lines = parseLines(input.text);
  const device = buildDeviceModel(input.fileId, lines);
  const post = checkDeviceModel(input.fileId, device);
  if (post.length > 0) return { file: null, violations: post };
  return {
    file: { fileId: input.fileId, name: input.name, lines, device, byteLength: utf8ByteLength(input.text) },
    violations: [],
  };
}

export interface CaseParseResult {
  caseId: string;
  /** Parsed files in input order (only those that parsed within caps). */
  files: ParsedFile[];
  violations: LimitViolation[];
  /** null when any cap was violated (the case is an error, not a stratum member). */
  stratum: Stratum | null;
}

export function parseCase(input: { caseId: string; files: readonly ConfigFileInput[] }): CaseParseResult {
  const violations: LimitViolation[] = [...checkCaseFiles(input.files)];
  const files: ParsedFile[] = [];
  for (const f of input.files) {
    const r = parseConfig(f);
    violations.push(...r.violations);
    if (r.file !== null) files.push(r.file);
  }
  let stratum: Stratum | null = null;
  if (violations.length === 0) {
    stratum = files.some((f) => forwardingUnknownLineCount(f) > 0) ? 'unsupported' : 'semantic-positive';
  }
  return { caseId: input.caseId, files, violations, stratum };
}

/** Codes and positions only: never config text (custody, row 28). Case-level items use fileId '' and ordinal 0. */
export interface ParseDiagnostic {
  code: string;
  fileId: string;
  ordinal: number;
}

export function caseDiagnostics(result: CaseParseResult): ParseDiagnostic[] {
  const out: ParseDiagnostic[] = [];
  for (const v of result.violations) out.push({ code: v.code, fileId: v.fileId ?? '', ordinal: 0 });
  const seenHostnames = new Map<string, string>();
  for (const f of result.files) {
    for (const u of f.device.unknownLines) {
      out.push({ code: u.forwardingAffecting ? 'unknown-line-forwarding' : 'unknown-line', fileId: f.fileId, ordinal: u.lineOrdinal });
    }
    for (const d of f.device.diagnostics) out.push({ code: d.code, fileId: f.fileId, ordinal: d.lineOrdinal });
    const host = f.device.hostname;
    if (host !== null) {
      const key = host.toLowerCase();
      if (seenHostnames.has(key)) {
        out.push({ code: 'duplicate-hostname', fileId: f.fileId, ordinal: f.device.hostnameLineOrdinal ?? 0 });
      } else {
        seenHostnames.set(key, f.fileId);
      }
    }
  }
  return out;
}

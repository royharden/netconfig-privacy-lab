/**
 * Shared vocabulary for the core contracts (PLAN.md §2 rows 7–9, 38, 41, 42; §3; §4), plus two small groups of runtime helpers
 * that every core module needs and that must not live in the grammar-aware parser:
 *  - line splitting (`splitLines`/`joinLines`), used by the parser AND by the pure-string ledger validator;
 *  - a tiny structural JSON checker (`ShapeChecker`), used by the sidecar/labels/ledger/expected/manifest readers.
 */

export type Family = 'ring' | 'hub-and-spoke' | 'campus-tree' | 'dual-isp-edge';
export const FAMILIES: readonly Family[] = ['ring', 'hub-and-spoke', 'campus-tree', 'dual-isp-edge'];

/** §5 strata: semantic-positive = every line supported or harmless; unsupported = a forwarding-affecting unknown line. */
export type Stratum = 'semantic-positive' | 'unsupported';
export const STRATA: readonly Stratum[] = ['semantic-positive', 'unsupported'];

export type Split = 'dev' | 'practice' | 'heldout';
export const SPLITS: readonly Split[] = ['dev', 'practice', 'heldout'];

/** Row 8 dispositions (the TypeScript evaluator's vocabulary; Batfish raw dispositions map onto these). */
export type Disposition =
  | 'delivered'
  | 'delivered-to-subnet'
  | 'deny-in'
  | 'deny-out'
  | 'no-route'
  | 'loop'
  | 'exits-network'
  | 'unsupported';
export const DISPOSITIONS: readonly Disposition[] = [
  'delivered',
  'delivered-to-subnet',
  'deny-in',
  'deny-out',
  'no-route',
  'loop',
  'exits-network',
  'unsupported',
];

/** Row 9: the five policy findings. */
export type FindingRule =
  | 'permit-ip-any-any'
  | 'duplicate-acl-entry'
  | 'duplicate-interface-address'
  | 'unresolved-acl-reference'
  | 'default-snmp-community';
export const FINDING_RULES: readonly FindingRule[] = [
  'permit-ip-any-any',
  'duplicate-acl-entry',
  'duplicate-interface-address',
  'unresolved-acl-reference',
  'default-snmp-community',
];

export type Direction = 'in' | 'out';
export const DIRECTIONS: readonly Direction[] = ['in', 'out'];

export type AclAction = 'permit' | 'deny';
export type AclProtocol = 'ip' | 'tcp' | 'udp' | 'icmp';
export const ACL_PROTOCOLS: readonly AclProtocol[] = ['ip', 'tcp', 'udp', 'icmp'];

/** Protocols of scheduled flows (Codex `Flow` shape). `ip` is an ACL match keyword, never a flow protocol. */
export type FlowProtocol = 'tcp' | 'udp' | 'icmp';
export const FLOW_PROTOCOLS: readonly FlowProtocol[] = ['tcp', 'udp', 'icmp'];

/**
 * A span inside one line's text (line terminator excluded) or inside a file name: 0-based `start`, exclusive `end`, measured in
 * UTF-16 code units (JavaScript string indices). For ASCII text, which is all the grammar admits outside free text, this equals
 * byte offsets.
 */
export interface Span {
  start: number;
  end: number;
}

/** One config file as strategies and the parser see it (row 41): stable `fileId`, display `name`, full `text`. */
export interface ConfigFileInput {
  fileId: string;
  name: string;
  text: string;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Line splitting. Line ordinals everywhere in this repo are 1-based indices into splitLines(text).
// ---------------------------------------------------------------------------------------------------------------------------

export type LineTerminator = '' | '\n' | '\r\n';

export interface RawLine {
  /** The line without its terminator. */
  text: string;
  /** The terminator that followed it ('' only for a final line with no newline). */
  eol: LineTerminator;
}

/**
 * Splits text into lines on LF, recording CRLF terminators so `joinLines(splitLines(t)) === t` for every string `t`. A trailing
 * newline does not create an extra empty line; an empty string has zero lines.
 */
export function splitLines(text: string): RawLine[] {
  const out: RawLine[] = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    if (nl === -1) {
      out.push({ text: text.slice(pos), eol: '' });
      break;
    }
    const hasCr = nl > pos && text.charCodeAt(nl - 1) === 13;
    out.push({ text: text.slice(pos, hasCr ? nl - 1 : nl), eol: hasCr ? '\r\n' : '\n' });
    pos = nl + 1;
  }
  return out;
}

export function joinLines(lines: readonly RawLine[]): string {
  let out = '';
  for (const line of lines) out += line.text + line.eol;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Structural JSON checking (hand-written; the JSON Schemas in schemas/ describe the same shapes).
// ---------------------------------------------------------------------------------------------------------------------------

/** Synthetic IDs: case, file, node, interface, ACL, entry, flow, entity and span IDs. Opaque, lowercase, never hostnames. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface ValidationIssue {
  path: string;
  message: string;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A file name is a display string only: never a path to follow. No separators, no control characters, not '.' or '..'. */
export function isSafeFileName(name: string): boolean {
  if (name.length === 0 || name.length > 255 || name === '.' || name === '..') return false;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || name[i] === '/' || name[i] === '\\') return false;
  }
  return true;
}

/** Accumulates structural issues; each reader checks fields with it and returns `result()`. */
export class ShapeChecker {
  readonly issues: ValidationIssue[] = [];

  fail(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  object(
    value: unknown,
    path: string,
    required: readonly string[],
    optional: readonly string[] = [],
  ): Record<string, unknown> | null {
    if (!isRecord(value)) {
      this.fail(path, 'expected an object');
      return null;
    }
    for (const key of required) if (!(key in value)) this.fail(`${path}.${key}`, 'missing required field');
    for (const key of Object.keys(value)) {
      if (!required.includes(key) && !optional.includes(key)) this.fail(`${path}.${key}`, 'unexpected field');
    }
    return value;
  }

  constant(value: unknown, path: string, expected: string): void {
    if (value !== expected) this.fail(path, `expected the constant "${expected}"`);
  }

  string(value: unknown, path: string, pattern?: RegExp, maxLength = 4096): string | null {
    if (typeof value !== 'string') {
      this.fail(path, 'expected a string');
      return null;
    }
    if (value.length > maxLength) {
      this.fail(path, `longer than ${maxLength} characters`);
      return null;
    }
    if (pattern !== undefined && !pattern.test(value)) {
      this.fail(path, `does not match ${String(pattern)}`);
      return null;
    }
    return value;
  }

  integer(value: unknown, path: string, min: number, max: number): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      this.fail(path, `expected an integer in [${min}, ${max}]`);
      return null;
    }
    return value;
  }

  enumValue<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | null {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      this.fail(path, `expected one of: ${allowed.join(', ')}`);
      return null;
    }
    return value as T;
  }

  array(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): unknown[] | null {
    if (!Array.isArray(value)) {
      this.fail(path, 'expected an array');
      return null;
    }
    if (value.length < min || value.length > max) {
      this.fail(path, `expected between ${min} and ${max} items, found ${value.length}`);
    }
    return value;
  }

  /** Records `id` in `seen`, failing if it was already there. A null id (already reported) is ignored. */
  unique(id: string | null, seen: Set<string>, path: string): void {
    if (id === null) return;
    if (seen.has(id)) this.fail(path, `duplicate id "${id}"`);
    seen.add(id);
  }

  /** Call only after every field of `value` has been checked; the cast is justified by those checks. */
  result<T>(value: unknown): Validated<T> {
    return this.issues.length === 0 ? { ok: true, value: value as T } : { ok: false, issues: [...this.issues] };
  }
}

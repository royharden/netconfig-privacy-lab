/**
 * IPv4 primitives, written in place (PLAN.md Claude "Reuse" item 5). Addresses are unsigned 32-bit integers held in a JS number.
 * Dotted quads are strict: exactly four decimal octets 0–255, no leading zeros (so "010.1.1.1" is not an address).
 */

const OCTET_RE = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)$/;

export function parseIPv4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!OCTET_RE.test(part)) return null;
    value = value * 256 + Number(part);
  }
  return value >>> 0;
}

export function formatIPv4(value: number): string {
  const v = value >>> 0;
  return `${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`;
}

/** Netmask for a prefix length 0–32 (0 → 0.0.0.0, 32 → 255.255.255.255). */
export function prefixToMask(prefixLength: number): number {
  if (prefixLength <= 0) return 0;
  if (prefixLength >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefixLength)) >>> 0;
}

/** Prefix length of a contiguous netmask, or null when the mask is not contiguous. */
export function maskToPrefix(mask: number): number | null {
  const m = mask >>> 0;
  for (let len = 0; len <= 32; len++) if (prefixToMask(len) === m) return len;
  return null;
}

/** Prefix length of a contiguous ACL wildcard (inverse mask), or null when it is not contiguous. */
export function wildcardToPrefix(wildcard: number): number | null {
  return maskToPrefix(~wildcard >>> 0);
}

export function networkOf(address: number, prefixLength: number): number {
  return (address & prefixToMask(prefixLength)) >>> 0;
}

export function broadcastOf(address: number, prefixLength: number): number {
  return (networkOf(address, prefixLength) | (~prefixToMask(prefixLength) >>> 0)) >>> 0;
}

export function inSubnet(address: number, network: number, prefixLength: number): boolean {
  return networkOf(address, prefixLength) === networkOf(network, prefixLength);
}

/** True when `address` is its subnet's network or broadcast address. /31 and /32 have no such addresses. */
export function isNetworkOrBroadcast(address: number, prefixLength: number): boolean {
  if (prefixLength >= 31) return false;
  return address >>> 0 === networkOf(address, prefixLength) || address >>> 0 === broadcastOf(address, prefixLength);
}

/** Number of leading bits two addresses share (32 when equal). */
export function commonPrefixLength(a: number, b: number): number {
  const x = (a ^ b) >>> 0;
  return x === 0 ? 32 : Math.clz32(x);
}

export interface DottedQuadMatch {
  start: number;
  end: number;
  value: number;
}

/**
 * Every valid dotted quad in free text, not glued to a neighbouring digit or ".digit" (so "1.2.3.4.5" is not matched, while
 * "10.1.2.3/24" and "10.1.2.3," are). A quad split by a space ("10.1. 2.3") is deliberately NOT matched: it is a planted trap.
 */
export function findDottedQuads(text: string): DottedQuadMatch[] {
  const re = /(?<!\d)(?<!\d\.)(?:\d{1,3}\.){3}\d{1,3}(?!\d)(?!\.\d)/g;
  const out: DottedQuadMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = parseIPv4(m[0]);
    if (value !== null) out.push({ start: m.index, end: m.index + m[0].length, value });
  }
  return out;
}

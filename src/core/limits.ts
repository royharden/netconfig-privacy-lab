/**
 * Caps from PLAN.md §3 (and row 5 for BGP neighbours, row 6 for entity caps), enforced with explicit, structured violations.
 * `docs/GRAMMAR.md` repeats these numbers; tests/parser/caps.test.ts checks both the constants and their enforcement.
 */
import type { ConfigFileInput } from './types';
import { splitLines } from './types';
import type { DeviceModel } from './model';
import { aclEntryCount } from './model';

export const MIN_DEVICES_PER_CASE = 3;
export const MAX_DEVICES_PER_CASE = 8;
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_CASE_BYTES = 512 * 1024;
export const MAX_LINES_PER_FILE = 1000;
export const MAX_INTERFACES_PER_DEVICE = 16;
export const MAX_STATIC_ROUTES_PER_DEVICE = 32;
export const MAX_ACL_ENTRIES_PER_DEVICE = 32;
export const MAX_BGP_NEIGHBORS_PER_DEVICE = 4;
export const MAX_SCHEDULED_FLOWS_PER_CASE = 32;
export const MAX_SENSITIVE_ENTITIES_PER_CASE = 64;
export const MAX_VARIANTS_PER_ENTITY = 8;
/** Worker deadline for parsing + one strategy (row 27 UI, §3). Exceeding it is an error, never a partial result. */
export const PARSE_DEADLINE_MS = 5000;

export const LIMITS = {
  minDevicesPerCase: MIN_DEVICES_PER_CASE,
  maxDevicesPerCase: MAX_DEVICES_PER_CASE,
  maxFileBytes: MAX_FILE_BYTES,
  maxCaseBytes: MAX_CASE_BYTES,
  maxLinesPerFile: MAX_LINES_PER_FILE,
  maxInterfacesPerDevice: MAX_INTERFACES_PER_DEVICE,
  maxStaticRoutesPerDevice: MAX_STATIC_ROUTES_PER_DEVICE,
  maxAclEntriesPerDevice: MAX_ACL_ENTRIES_PER_DEVICE,
  maxBgpNeighborsPerDevice: MAX_BGP_NEIGHBORS_PER_DEVICE,
  maxScheduledFlowsPerCase: MAX_SCHEDULED_FLOWS_PER_CASE,
  maxSensitiveEntitiesPerCase: MAX_SENSITIVE_ENTITIES_PER_CASE,
  maxVariantsPerEntity: MAX_VARIANTS_PER_ENTITY,
  parseDeadlineMs: PARSE_DEADLINE_MS,
} as const;

export type LimitCode =
  | 'invalid-unicode'
  | 'file-too-large'
  | 'too-many-lines'
  | 'too-many-interfaces'
  | 'too-many-static-routes'
  | 'too-many-acl-entries'
  | 'too-many-bgp-neighbors'
  | 'too-few-devices'
  | 'too-many-devices'
  | 'case-too-large'
  | 'too-many-flows'
  | 'too-many-entities'
  | 'too-many-variants'
  | 'deadline-exceeded';

export interface LimitViolation {
  code: LimitCode;
  limit: number;
  actual: number;
  /** The offending file, or null for a case-level cap. */
  fileId: string | null;
}

/** Thrown by callers that prefer exceptions (`assertNoViolations`); the parser itself returns violations. */
export class LimitError extends Error {
  readonly violations: readonly LimitViolation[];

  constructor(violations: readonly LimitViolation[]) {
    super(`limit exceeded: ${violations.map((v) => `${v.code} (${v.actual} > ${v.limit})`).join(', ')}`);
    this.name = 'LimitError';
    this.violations = violations;
  }
}

export function assertNoViolations(violations: readonly LimitViolation[]): void {
  if (violations.length > 0) throw new LimitError(violations);
}

const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}

/** False when the string holds a lone UTF-16 surrogate, i.e. it cannot have come from valid UTF-8. */
export function isWellFormedUnicode(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Strict UTF-8 decoding for loaders: invalid bytes return null; a BOM is kept as text so offsets stay byte-faithful. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

function over(code: LimitCode, limit: number, actual: number, fileId: string | null): LimitViolation[] {
  return actual > limit ? [{ code, limit, actual, fileId }] : [];
}

/** File-level caps checked before parsing: UTF-8 validity, 64 KiB, 1,000 lines. */
export function checkFileText(fileId: string, text: string): LimitViolation[] {
  if (!isWellFormedUnicode(text)) return [{ code: 'invalid-unicode', limit: 0, actual: 1, fileId }];
  return [
    ...over('file-too-large', MAX_FILE_BYTES, utf8ByteLength(text), fileId),
    ...over('too-many-lines', MAX_LINES_PER_FILE, splitLines(text).length, fileId),
  ];
}

/** Device-level caps checked after parsing: 16 interfaces, 32 static routes, 32 ACL entries, 4 BGP neighbours. */
export function checkDeviceModel(fileId: string, device: DeviceModel): LimitViolation[] {
  return [
    ...over('too-many-interfaces', MAX_INTERFACES_PER_DEVICE, device.interfaces.length, fileId),
    ...over('too-many-static-routes', MAX_STATIC_ROUTES_PER_DEVICE, device.staticRoutes.length, fileId),
    ...over('too-many-acl-entries', MAX_ACL_ENTRIES_PER_DEVICE, aclEntryCount(device), fileId),
    ...over('too-many-bgp-neighbors', MAX_BGP_NEIGHBORS_PER_DEVICE, device.bgp?.neighbors.length ?? 0, fileId),
  ];
}

/**
 * Case-level caps: 3–8 devices (one config file per device) and 512 KiB in total. With ≤8 files of ≤64 KiB the total cap is
 * implied by the file cap; it is still checked so a change to either number cannot silently drop it.
 */
export function checkCaseFiles(files: readonly ConfigFileInput[]): LimitViolation[] {
  const out: LimitViolation[] = [];
  if (files.length < MIN_DEVICES_PER_CASE) {
    out.push({ code: 'too-few-devices', limit: MIN_DEVICES_PER_CASE, actual: files.length, fileId: null });
  }
  out.push(...over('too-many-devices', MAX_DEVICES_PER_CASE, files.length, null));
  let total = 0;
  for (const f of files) total += utf8ByteLength(f.text);
  out.push(...over('case-too-large', MAX_CASE_BYTES, total, null));
  return out;
}

export function checkFlowCount(count: number): LimitViolation[] {
  return over('too-many-flows', MAX_SCHEDULED_FLOWS_PER_CASE, count, null);
}

/** Row 6: ≤64 sensitive entities per case and ≤8 distinct surface strings ("variants") per entity. */
export function checkEntityCaps(entities: readonly { occurrences: readonly { text: string }[] }[]): LimitViolation[] {
  const out = over('too-many-entities', MAX_SENSITIVE_ENTITIES_PER_CASE, entities.length, null);
  for (const e of entities) {
    const distinct = new Set(e.occurrences.map((o) => o.text)).size;
    out.push(...over('too-many-variants', MAX_VARIANTS_PER_ENTITY, distinct, null));
  }
  return out;
}

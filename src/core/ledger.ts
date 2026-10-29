/**
 * Planted-identifier ledger (PLAN.md §4, rows 6 and 41). Schema: schemas/ledger.schema.json. A label file: read only by the
 * scorer, ledger-validate and loaders; strategies never import it (row 29).
 *
 * Occurrence positions:
 *  - location 'line': `ordinal` = 1-based line number; `start`/`end` index into that line's text (terminator excluded).
 *  - location 'name': `ordinal` = 0; `start`/`end` index into the file's display name (`case.json` files[].name).
 *  Spans are 0-based start, exclusive end, UTF-16 code units (= bytes for ASCII). `text` is the exact substring at the span.
 *
 * Protocol rules (docs/PLANTING-PROTOCOL.md): an exact span belongs to one entity only; spans of different entities may nest
 * (a hostname inside a domain) but never partially overlap; ≤64 entities per case and ≤8 distinct occurrence strings per entity.
 */
import type { Validated } from './types';
import { ID_PATTERN, ShapeChecker } from './types';
import { MAX_LINES_PER_FILE, MAX_SENSITIVE_ENTITIES_PER_CASE } from './limits';

export const LEDGER_SCHEMA_ID = 'ledger-v1';

export type LedgerClass =
  | 'hostname'
  | 'domain'
  | 'ipv4'
  | 'asn'
  | 'username'
  | 'secret'
  | 'community'
  | 'person'
  | 'org'
  | 'acl-name'
  | 'email'
  | 'serial'
  | 'mac'
  | 'filename';
export const LEDGER_CLASSES: readonly LedgerClass[] = [
  'hostname',
  'domain',
  'ipv4',
  'asn',
  'username',
  'secret',
  'community',
  'person',
  'org',
  'acl-name',
  'email',
  'serial',
  'mac',
  'filename',
];

/** How an occurrence's text relates to the entity's canonical value (§5 variant rules). */
export type Variant = 'exact' | 'case' | 'embedded' | 'split' | 'dotted' | 'dashed';
export const VARIANTS: readonly Variant[] = ['exact', 'case', 'embedded', 'split', 'dotted', 'dashed'];

export type OccurrenceLocation = 'line' | 'name';

export interface LedgerOccurrence {
  fileId: string;
  location: OccurrenceLocation;
  /** 1-based line number for 'line'; always 0 for 'name'. */
  ordinal: number;
  start: number;
  end: number;
  text: string;
  variant: Variant;
}

export interface LedgerEntity {
  entityId: string;
  class: LedgerClass;
  /** Canonical value (e.g. MAC `00:a1:b2:c3:d4:e5`); occurrences may be variants of it. */
  value: string;
  occurrences: LedgerOccurrence[];
}

export interface Ledger {
  schema: typeof LEDGER_SCHEMA_ID;
  caseId: string;
  entities: LedgerEntity[];
}

export function parseLedger(value: unknown): Validated<Ledger> {
  const c = new ShapeChecker();
  const root = c.object(value, '$', ['schema', 'caseId', 'entities']);
  if (root === null) return c.result<Ledger>(value);
  c.constant(root.schema, '$.schema', LEDGER_SCHEMA_ID);
  c.string(root.caseId, '$.caseId', ID_PATTERN);
  const ids = new Set<string>();
  (c.array(root.entities, '$.entities', 0, MAX_SENSITIVE_ENTITIES_PER_CASE) ?? []).forEach((item, i) => {
    const p = `$.entities[${i}]`;
    const o = c.object(item, p, ['entityId', 'class', 'value', 'occurrences']);
    if (o === null) return;
    c.unique(c.string(o.entityId, `${p}.entityId`, ID_PATTERN), ids, `${p}.entityId`);
    c.enumValue(o.class, `${p}.class`, LEDGER_CLASSES);
    c.string(o.value, `${p}.value`, /^\S(?:.*\S)?$/, 255);
    (c.array(o.occurrences, `${p}.occurrences`, 1) ?? []).forEach((occ, j) => {
      const q = `${p}.occurrences[${j}]`;
      const oo = c.object(occ, q, ['fileId', 'location', 'ordinal', 'start', 'end', 'text', 'variant']);
      if (oo === null) return;
      c.string(oo.fileId, `${q}.fileId`, ID_PATTERN);
      const location = c.enumValue(oo.location, `${q}.location`, ['line', 'name'] as const);
      if (location === 'name') c.integer(oo.ordinal, `${q}.ordinal`, 0, 0);
      else c.integer(oo.ordinal, `${q}.ordinal`, 1, MAX_LINES_PER_FILE);
      const start = c.integer(oo.start, `${q}.start`, 0, 65535);
      const end = c.integer(oo.end, `${q}.end`, 1, 65536);
      if (start !== null && end !== null && end <= start) c.fail(q, 'end must be greater than start');
      const text = c.string(oo.text, `${q}.text`);
      if (text !== null && start !== null && end !== null && text.length !== end - start) {
        c.fail(`${q}.text`, 'length differs from end - start');
      }
      c.enumValue(oo.variant, `${q}.variant`, VARIANTS);
    });
  });
  return c.result<Ledger>(value);
}

/**
 * `labels.json` (PLAN.md row 42c): benign labelled spans (over-redaction denominator) and free-text token labels (free-text
 * retention denominator). A label file, like `ledger.json` and `expected.json`: the label-blind preflight only hashes it.
 * Schema: schemas/labels.schema.json. Never imported by strategies (row 29).
 *
 * Spans index into one line's text (terminator excluded): 0-based start, exclusive end, UTF-16 code units (= bytes for ASCII);
 * `ordinal` is the 1-based line number. `text` is the exact substring, checked by scripts/ledger-validate.ts.
 */
import type { Validated } from './types';
import { ID_PATTERN, ShapeChecker } from './types';
import { MAX_LINES_PER_FILE } from './limits';

export const LABELS_SCHEMA_ID = 'labels-v1';

/** A span that is NOT an identifier and should survive any arm (a look-alike, a typed constant, HTML-ish text...). */
export interface BenignSpan {
  id: string;
  fileId: string;
  ordinal: number;
  start: number;
  end: number;
  text: string;
  /** Which trap or constant this span exercises, e.g. `benign-substring`, `mask-like-address`, `html-in-description`. */
  note: string;
}

/** A non-identifier word of a description, remark, banner, comment or neighbour description. */
export interface FreeTextToken {
  fileId: string;
  ordinal: number;
  start: number;
  end: number;
  text: string;
}

export interface CaseLabels {
  schema: typeof LABELS_SCHEMA_ID;
  caseId: string;
  benignSpans: BenignSpan[];
  freeTextTokens: FreeTextToken[];
}

function checkLineSpan(c: ShapeChecker, o: Record<string, unknown>, p: string): void {
  c.string(o.fileId, `${p}.fileId`, ID_PATTERN);
  c.integer(o.ordinal, `${p}.ordinal`, 1, MAX_LINES_PER_FILE);
  const start = c.integer(o.start, `${p}.start`, 0, 65535);
  const end = c.integer(o.end, `${p}.end`, 1, 65536);
  if (start !== null && end !== null && end <= start) c.fail(p, 'end must be greater than start');
  const text = c.string(o.text, `${p}.text`);
  if (text !== null && start !== null && end !== null && text.length !== end - start) {
    c.fail(`${p}.text`, 'length differs from end - start');
  }
}

export function parseLabels(value: unknown): Validated<CaseLabels> {
  const c = new ShapeChecker();
  const root = c.object(value, '$', ['schema', 'caseId', 'benignSpans', 'freeTextTokens']);
  if (root === null) return c.result<CaseLabels>(value);
  c.constant(root.schema, '$.schema', LABELS_SCHEMA_ID);
  c.string(root.caseId, '$.caseId', ID_PATTERN);
  const ids = new Set<string>();
  (c.array(root.benignSpans, '$.benignSpans') ?? []).forEach((item, i) => {
    const p = `$.benignSpans[${i}]`;
    const o = c.object(item, p, ['id', 'fileId', 'ordinal', 'start', 'end', 'text', 'note']);
    if (o === null) return;
    c.unique(c.string(o.id, `${p}.id`, ID_PATTERN), ids, `${p}.id`);
    checkLineSpan(c, o, p);
    c.string(o.note, `${p}.note`, /^[a-z0-9][a-z0-9-]{0,63}$/);
  });
  (c.array(root.freeTextTokens, '$.freeTextTokens') ?? []).forEach((item, i) => {
    const p = `$.freeTextTokens[${i}]`;
    const o = c.object(item, p, ['fileId', 'ordinal', 'start', 'end', 'text']);
    if (o === null) return;
    checkLineSpan(c, o, p);
  });
  return c.result<CaseLabels>(value);
}

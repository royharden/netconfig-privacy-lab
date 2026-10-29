/**
 * `ledger-validate` core (PLAN.md §4, row 41): a PURE STRING check that every ledger occurrence (and every labelled span) sits at
 * its stated span, in the line (location 'line') or in the file's display name (location 'name'). It never parses config
 * grammar: it only splits lines (core/types.splitLines, the same split every ordinal is defined by) and compares substrings.
 * It also checks the protocol rules that need no grammar: entity caps (row 6), one entity per exact span, no partial overlaps.
 *
 * Issues carry codes and positions only, never the occurrence text, so its output can be shared as a receipt.
 */
import type { ConfigFileInput } from './types';
import { splitLines } from './types';
import type { Ledger, LedgerOccurrence } from './ledger';
import type { CaseLabels } from './labels';
import { MAX_SENSITIVE_ENTITIES_PER_CASE, MAX_VARIANTS_PER_ENTITY } from './limits';

export type SpanIssueCode =
  | 'case-id-mismatch'
  | 'unknown-file'
  | 'bad-ordinal'
  | 'name-ordinal-not-zero'
  | 'empty-span'
  | 'span-out-of-range'
  | 'text-mismatch'
  | 'duplicate-entity-id'
  | 'too-many-entities'
  | 'too-many-variants'
  | 'duplicate-span'
  | 'partial-overlap';

export interface SpanIssue {
  code: SpanIssueCode;
  entityId: string | null;
  fileId: string | null;
  /** Line ordinal (0 for a file name, null when not applicable). */
  ordinal: number | null;
  /** Index of the occurrence within its entity, or of the label within its list; null for entity/case-level issues. */
  index: number | null;
}

export interface IndexedFile {
  name: string;
  lines: string[];
}

function indexFiles(files: readonly ConfigFileInput[]): Map<string, IndexedFile> {
  const map = new Map<string, IndexedFile>();
  for (const f of files) map.set(f.fileId, { name: f.name, lines: splitLines(f.text).map((l) => l.text) });
  return map;
}

export interface SpanRef {
  fileId: string;
  location: 'line' | 'name';
  ordinal: number;
  start: number;
  end: number;
  text: string;
}

/** Checks one span; returns the first problem found or null. */
export function checkSpan(files: ReadonlyMap<string, IndexedFile>, ref: SpanRef): SpanIssueCode | null {
  const file = files.get(ref.fileId);
  if (file === undefined) return 'unknown-file';
  let target: string;
  if (ref.location === 'name') {
    if (ref.ordinal !== 0) return 'name-ordinal-not-zero';
    target = file.name;
  } else {
    if (!Number.isInteger(ref.ordinal) || ref.ordinal < 1 || ref.ordinal > file.lines.length) return 'bad-ordinal';
    target = file.lines[ref.ordinal - 1];
  }
  if (!(ref.end > ref.start)) return 'empty-span';
  if (ref.start < 0 || ref.end > target.length) return 'span-out-of-range';
  return target.slice(ref.start, ref.end) === ref.text ? null : 'text-mismatch';
}

interface Placed {
  entityId: string;
  occ: LedgerOccurrence;
}

function overlapIssues(placed: readonly Placed[]): SpanIssue[] {
  const groups = new Map<string, Placed[]>();
  for (const p of placed) {
    const key = `${p.occ.fileId}|${p.occ.location}|${p.occ.ordinal}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [p]);
    else g.push(p);
  }
  const out: SpanIssue[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i].occ;
        const b = group[j].occ;
        const issue = (code: SpanIssueCode): SpanIssue => ({
          code,
          entityId: group[j].entityId,
          fileId: b.fileId,
          ordinal: b.ordinal,
          index: null,
        });
        if (a.start === b.start && a.end === b.end) {
          out.push(issue('duplicate-span'));
          continue;
        }
        const overlap = a.start < b.end && b.start < a.end;
        const nested = (a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end);
        if (overlap && !nested) out.push(issue('partial-overlap'));
      }
    }
  }
  return out;
}

/** Validates every occurrence of a ledger against the case's files (ids, names and texts). */
export function validateLedgerSpans(ledger: Ledger, files: readonly ConfigFileInput[], caseId?: string): SpanIssue[] {
  const issues: SpanIssue[] = [];
  if (caseId !== undefined && ledger.caseId !== caseId) {
    issues.push({ code: 'case-id-mismatch', entityId: null, fileId: null, ordinal: null, index: null });
  }
  if (ledger.entities.length > MAX_SENSITIVE_ENTITIES_PER_CASE) {
    issues.push({ code: 'too-many-entities', entityId: null, fileId: null, ordinal: null, index: null });
  }
  const indexed = indexFiles(files);
  const ids = new Set<string>();
  const placed: Placed[] = [];
  for (const entity of ledger.entities) {
    if (ids.has(entity.entityId)) {
      issues.push({ code: 'duplicate-entity-id', entityId: entity.entityId, fileId: null, ordinal: null, index: null });
    }
    ids.add(entity.entityId);
    if (new Set(entity.occurrences.map((o) => o.text)).size > MAX_VARIANTS_PER_ENTITY) {
      issues.push({ code: 'too-many-variants', entityId: entity.entityId, fileId: null, ordinal: null, index: null });
    }
    entity.occurrences.forEach((occ, index) => {
      const code = checkSpan(indexed, occ);
      if (code !== null) issues.push({ code, entityId: entity.entityId, fileId: occ.fileId, ordinal: occ.ordinal, index });
      else placed.push({ entityId: entity.entityId, occ });
    });
  }
  issues.push(...overlapIssues(placed));
  return issues;
}

/** Validates every benign span and free-text token of a labels file the same way (location is always 'line'). */
export function validateLabelSpans(labels: CaseLabels, files: readonly ConfigFileInput[], caseId?: string): SpanIssue[] {
  const issues: SpanIssue[] = [];
  if (caseId !== undefined && labels.caseId !== caseId) {
    issues.push({ code: 'case-id-mismatch', entityId: null, fileId: null, ordinal: null, index: null });
  }
  const indexed = indexFiles(files);
  const check = (span: Omit<SpanRef, 'location'>, index: number): void => {
    const code = checkSpan(indexed, { ...span, location: 'line' });
    if (code !== null) issues.push({ code, entityId: null, fileId: span.fileId, ordinal: span.ordinal, index });
  };
  labels.benignSpans.forEach((s, i) => check(s, i));
  labels.freeTextTokens.forEach((t, i) => check(t, i));
  return issues;
}

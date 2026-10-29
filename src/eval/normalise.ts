import type { Disposition } from '../core/types';
import { ID_PATTERN, ShapeChecker } from '../core/types';

export const NORMALISER_VERSION = 's43-normalise-v1';
export const BATFISH_QUERIES = ['fileParseStatus', 'initIssues', 'routes', 'traceroute', 'testFilters', 'undefinedReferences', 'ipOwners'] as const;
export type RecordingTool = 'netconan' | 'batfish';
export interface NormalisedRow { query: string; rowId: string; disposition: Disposition | null; answer: string }

/** JSON is compared structurally, never by object insertion order. Array order remains significant. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('non-json-value');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function mapBatfishDisposition(raw: string): Disposition {
  switch (raw) {
    case 'ACCEPTED': return 'delivered';
    case 'DELIVERED_TO_SUBNET': return 'delivered-to-subnet';
    case 'DENIED_IN': return 'deny-in';
    case 'DENIED_OUT': return 'deny-out';
    case 'NO_ROUTE': return 'no-route';
    case 'LOOP': return 'loop';
    case 'EXITS_NETWORK': return 'exits-network';
    default: return 'unsupported';
  }
}

/**
 * Offline interchange envelope: query + opaque stable rowId + untouched native JSON answer.
 * Batfish trace rows additionally carry the raw disposition extracted from the native answer;
 * its value must equal answer.disposition. No caller-supplied normalized rows are trusted.
 */
export function normaliseRawAnswers(tool: RecordingTool, rawAnswers: string): NormalisedRow[] {
  const value: unknown = JSON.parse(rawAnswers);
  const c = new ShapeChecker();
  const root = c.object(value, '$raw', ['schema', 'answers']);
  if (root === null) throw new Error('invalid-raw-envelope');
  c.constant(root.schema, '$raw.schema', 'raw-recording-v1');
  const ids = new Set<string>();
  const rows: NormalisedRow[] = [];
  for (const [i, entry] of (c.array(root.answers, '$raw.answers', 0, 100000) ?? []).entries()) {
    const p = `$raw.answers[${i}]`;
    const row = c.object(entry, p, ['query', 'rowId', 'answer']);
    if (row === null) continue;
    const query = c.enumValue(row.query, `${p}.query`, tool === 'batfish' ? BATFISH_QUERIES : ['output'] as const);
    const rowId = c.string(row.rowId, `${p}.rowId`, ID_PATTERN);
    if (query === null || rowId === null) continue;
    c.unique(`${query}:${rowId}`, ids, p);
    let disposition: Disposition | null = null;
    if (query === 'traceroute') {
      if (typeof row.answer !== 'object' || row.answer === null || Array.isArray(row.answer) ||
          typeof (row.answer as Record<string, unknown>).disposition !== 'string') c.fail(`${p}.answer`, 'missing raw disposition');
      else disposition = mapBatfishDisposition((row.answer as { disposition: string }).disposition);
    }
    rows.push({ query, rowId, disposition, answer: canonicalJson(row.answer) });
  }
  if (c.issues.length > 0) throw new Error('invalid-raw-envelope');
  return rows.sort((a, b) => a.query.localeCompare(b.query) || a.rowId.localeCompare(b.rowId));
}

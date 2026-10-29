import { findDottedQuads } from '../core/ipv4';
import { PUBLIC_PATTERNS } from './patterns';

export interface Span { start: number; end: number; kind: string }
export interface FreeTextDetector { detect(text: string): Span[] }

/** Longest-first overlap resolution is deterministic. Operator matches require token boundaries;
 * embedded/split variants deliberately remain a measurable limitation. */
export function createFreeTextDetector(operatorList: readonly string[] = []): FreeTextDetector {
  return { detect(text) {
    const spans: Span[] = findDottedQuads(text).map((q) => {
      const suffix = /^\/(?:[0-9]|[12][0-9]|3[0-2])(?!\d)/.exec(text.slice(q.end));
      return { start: q.start, end: q.end + (suffix?.[0].length ?? 0), kind: suffix ? 'prefix' : 'ipv4' };
    });
    for (const { kind, pattern } of PUBLIC_PATTERNS) {
      for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags))) spans.push({ start: m.index, end: m.index + m[0].length, kind });
    }
    for (const word of operatorList) {
      if (!word) continue;
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'gi');
      for (const m of text.matchAll(re)) spans.push({ start: m.index, end: m.index + m[0].length, kind: 'operator' });
    }
    const chosen: Span[] = [];
    for (const span of spans.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start || a.kind.localeCompare(b.kind))) {
      if (!chosen.some((s) => span.start < s.end && span.end > s.start)) chosen.push(span);
    }
    return chosen.sort((a, b) => a.start - b.start);
  } };
}

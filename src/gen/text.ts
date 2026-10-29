import type { Ledger, LedgerClass, LedgerEntity, Variant } from '../core/ledger';
import type { CaseLabels } from '../core/labels';
import type { ConfigFileInput } from '../core/types';
interface Mark { entity: LedgerEntity; start: number; end: number; variant: Variant }
interface LabelMark { start: number; end: number; note: string }
export interface Piece { text: string; marks: Mark[]; benign: LabelMark[]; words: { start: number; end: number }[] }
export function plain(text: string): Piece { return { text, marks: [], benign: [], words: [] }; }
export function ident(entity: LedgerEntity, text = entity.value, variant: Variant = 'exact'): Piece {
  return { ...plain(text), marks: [{ entity, start: 0, end: text.length, variant }] };
}
export function benign(text: string, note: string): Piece {
  return { ...plain(text), benign: [{ start: 0, end: text.length, note }] };
}
export function word(text: string): Piece {
  return { ...plain(text), words: [{ start: 0, end: text.length }] };
}
export function concat(...parts: (Piece | string)[]): Piece {
  const out = plain('');
  for (const p of parts) {
    const part = typeof p === 'string' ? plain(p) : p;
    const offset = out.text.length;
    out.marks.push(...part.marks.map((m) => ({ ...m, start: offset + m.start, end: offset + m.end })));
    out.benign.push(...part.benign.map((m) => ({ ...m, start: offset + m.start, end: offset + m.end })));
    out.words.push(...part.words.map((m) => ({ start: offset + m.start, end: offset + m.end })));
    out.text += part.text;
  }
  return out;
}
/** An outer entity may contain separately tagged inner entities (domain/hostname, email/domain, ACL/org). */
export function wrap(entity: LedgerEntity, piece: Piece): Piece {
  return { ...piece, marks: [...piece.marks, { entity, start: 0, end: piece.text.length, variant: 'exact' }] };
}
export class CorpusText {
  ledger: Ledger;
  labels: CaseLabels;
  constructor(caseId: string) {
    this.ledger = { schema: 'ledger-v1', caseId, entities: [] };
    this.labels = { schema: 'labels-v1', caseId, benignSpans: [], freeTextTokens: [] };
  }
  entity(kind: LedgerClass, value: string): LedgerEntity {
    const entity: LedgerEntity = { entityId: `e${this.ledger.entities.length + 1}`, class: kind, value, occurrences: [] };
    this.ledger.entities.push(entity); return entity;
  }
  place(fileId: string, ordinal: number, piece: Piece, location: 'line' | 'name' = 'line'): void {
    for (const m of piece.marks) m.entity.occurrences.push({ fileId, location, ordinal, start: m.start, end: m.end,
      text: piece.text.slice(m.start, m.end), variant: m.variant });
    if (location === 'name') return;
    for (const m of piece.benign) this.labels.benignSpans.push({ id: `b${this.labels.benignSpans.length + 1}`,
      fileId, ordinal, start: m.start, end: m.end, text: piece.text.slice(m.start, m.end), note: m.note });
    for (const m of piece.words) this.labels.freeTextTokens.push({ fileId, ordinal, start: m.start, end: m.end,
      text: piece.text.slice(m.start, m.end) });
  }
}
export class ConfigText {
  corpus: CorpusText;
  fileId: string;
  rows: string[] = [];
  name: string;
  constructor(corpus: CorpusText, fileId: string) { this.corpus = corpus; this.fileId = fileId; this.name = `${fileId}.cfg`; }
  add(...pieces: (Piece | string)[]): void {
    const p = concat(...pieces); this.rows.push(p.text); this.corpus.place(this.fileId, this.rows.length, p);
  }
  rename(piece: Piece): void { this.name = piece.text; this.corpus.place(this.fileId, 0, piece, 'name'); }
  input(): ConfigFileInput { return { fileId: this.fileId, name: this.name, text: `${this.rows.join('\n')}\n` }; }
}

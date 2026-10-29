// Shared helpers for parser tests (not a test file itself). Written in Dirty Mode; never executed yet.
import { parseConfig } from '../../src/core/parser';
import type { LineNode, ParsedFile, ParsedLine } from '../../src/core/model';

/** Joins rows with LF and a trailing newline, like a saved config. */
export function cfg(...rows: string[]): string {
  return `${rows.join('\n')}\n`;
}

export function parseText(text: string, name = 'n01.cfg'): ParsedFile {
  const result = parseConfig({ fileId: 'n01', name, text });
  if (result.file === null) throw new Error(`parse failed: ${result.violations.map((v) => v.code).join(', ')}`);
  return result.file;
}

export function lineAt(file: ParsedFile, ordinal: number): ParsedLine {
  const line = file.lines[ordinal - 1];
  if (line === undefined) throw new Error(`no line ${ordinal}`);
  return line;
}

export function nodeAt<K extends LineNode['kind']>(file: ParsedFile, ordinal: number, kind: K): Extract<LineNode, { kind: K }> {
  const node = lineAt(file, ordinal).node;
  if (node.kind !== kind) throw new Error(`line ${ordinal}: expected ${kind}, got ${node.kind}`);
  return node as Extract<LineNode, { kind: K }>;
}

/** The substring a token span points at, so tests assert spans against the real line text. */
export function spanText(file: ParsedFile, ordinal: number, tok: { start: number; end: number }): string {
  return lineAt(file, ordinal).text.slice(tok.start, tok.end);
}

export function kindAt(file: ParsedFile, ordinal: number): LineNode['kind'] {
  return lineAt(file, ordinal).node.kind;
}

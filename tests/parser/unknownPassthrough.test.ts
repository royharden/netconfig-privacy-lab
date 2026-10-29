import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cfg, lineAt, parseText } from './helpers';
import { parseCase } from '../../src/core/parser';
import { joinLines, splitLines } from '../../src/core/types';
import { unknownLineCount } from '../../src/core/model';

describe('unknown-line passthrough', () => {
  it('keeps unknown lines byte for byte, with ordinals, and counts them', () => {
    const text = cfg('hostname r1', 'service timestamps log datetime msec', '  weird\tspacing  here ', 'end');
    const f = parseText(text);
    expect(lineAt(f, 2).node).toEqual({ kind: 'unknown', forwardingAffecting: false, keyword: null });
    expect(lineAt(f, 3).text).toBe('  weird\tspacing  here ');
    expect(unknownLineCount(f)).toBe(2);
    expect(f.device.unknownLines.map((u) => u.lineOrdinal)).toEqual([2, 3]);
  });

  it('the line model round-trips the exact input, including CRLF, a missing final newline and a BOM', () => {
    for (const text of [
      'hostname r1\r\nlogging buffered 16384\r\nend\r\n',
      'hostname r1\nend',
      '﻿hostname r1\nend\n',
      '',
      '\n\n',
      'mixed\r\nendings\n',
    ]) {
      expect(joinLines(splitLines(text))).toBe(text);
      const f = parseText(text);
      expect(f.lines.map((l) => l.text + l.eol).join('')).toBe(text);
    }
  });

  it('a BOM makes the first line unknown rather than being silently stripped', () => {
    expect(lineAt(parseText('﻿hostname r1\n'), 1).node.kind).toBe('unknown');
  });

  it('harmless unknown lines keep a case semantic-positive', () => {
    const files = ['n01', 'n02', 'n03'].map((id) => ({
      fileId: id,
      name: `${id}.cfg`,
      text: cfg(`hostname h-${id}`, 'logging buffered 16384', 'service password-encryption', 'ntp server 192.0.2.1'),
    }));
    const r = parseCase({ caseId: 'c1', files });
    expect(r.violations).toEqual([]);
    expect(r.stratum).toBe('semantic-positive');
  });

  it('every smoke fixture parses within caps, semantic-positive, with its planted unknown line(s) counted', () => {
    const smoke: Record<string, string[]> = { s01: ['n01', 'n02', 'n03'], s02: ['n01', 'n02', 'n03', 'n04'], s03: ['n01', 'n02', 'n03'] };
    let unknown = 0;
    for (const [caseId, ids] of Object.entries(smoke)) {
      const files = ids.map((id) => ({
        fileId: id,
        name: `${id}.cfg`,
        text: readFileSync(new URL(`../../fixtures/smoke/${caseId}/${id}.cfg`, import.meta.url), 'utf8'),
      }));
      const r = parseCase({ caseId, files });
      expect(r.violations).toEqual([]);
      expect(r.stratum).toBe('semantic-positive');
      for (const f of r.files) unknown += unknownLineCount(f);
    }
    // s01 n01 `service timestamps ...`, s02 n02 `logging buffered`, s02 n03 `service password-encryption`, s03 n01 `ntp server`
    expect(unknown).toBe(4);
  });
});

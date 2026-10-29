import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateLabelSpans, validateLedgerSpans } from '../../src/core/ledgerValidate';
import type { Ledger, LedgerOccurrence } from '../../src/core/ledger';
import { parseLedger } from '../../src/core/ledger';
import { parseLabels } from '../../src/core/labels';
import type { CaseLabels } from '../../src/core/labels';
import { parseSidecar } from '../../src/core/sidecar';
import type { ConfigFileInput } from '../../src/core/types';

const files: ConfigFileInput[] = [
  { fileId: 'n01', name: 'brakefold.cfg', text: 'hostname brakefold\r\nip domain-name brakefold-net.example\n' },
  { fileId: 'n02', name: 'n02.cfg', text: 'hostname kestle-hub\n description to 10.22. 255.5' },
];

const occ = (o: Partial<LedgerOccurrence>): LedgerOccurrence => ({
  fileId: 'n01',
  location: 'line',
  ordinal: 1,
  start: 9,
  end: 18,
  text: 'brakefold',
  variant: 'exact',
  ...o,
});

const ledgerOf = (...occurrenceLists: LedgerOccurrence[][]): Ledger => ({
  schema: 'ledger-v1',
  caseId: 'c1',
  entities: occurrenceLists.map((occurrences, i) => ({
    entityId: `e${i + 1}`,
    class: 'hostname',
    value: 'brakefold',
    occurrences,
  })),
});

const codes = (l: Ledger) => validateLedgerSpans(l, files, 'c1').map((i) => i.code);

describe('ledger-validate: pure string span check', () => {
  it('accepts correct line spans (CRLF terminators excluded) and file-name spans', () => {
    expect(
      codes(
        ledgerOf([
          occ({}),
          occ({ ordinal: 2, start: 15, end: 24, variant: 'embedded' }),
          occ({ location: 'name', ordinal: 0, start: 0, end: 9 }),
        ]),
      ),
    ).toEqual([]);
  });

  it('accepts a split variant whose text spans the space', () => {
    expect(codes(ledgerOf([occ({ fileId: 'n02', ordinal: 2, start: 16, end: 28, text: '10.22. 255.5', variant: 'split' })]))).toEqual([]);
  });

  it('rejects an off-by-one span, a wrong text, a bad ordinal, an unknown file and an out-of-range span', () => {
    expect(codes(ledgerOf([occ({ start: 8, end: 17 })]))).toEqual(['text-mismatch']);
    expect(codes(ledgerOf([occ({ text: 'Brakefold' })]))).toEqual(['text-mismatch']);
    expect(codes(ledgerOf([occ({ ordinal: 3 })]))).toEqual(['bad-ordinal']);
    expect(codes(ledgerOf([occ({ ordinal: 0 })]))).toEqual(['bad-ordinal']);
    expect(codes(ledgerOf([occ({ fileId: 'n09' })]))).toEqual(['unknown-file']);
    expect(codes(ledgerOf([occ({ start: 9, end: 40 })]))).toEqual(['span-out-of-range']);
    expect(codes(ledgerOf([occ({ start: 9, end: 9 })]))).toEqual(['empty-span']);
  });

  it('checks name spans against the display name and requires ordinal 0 for location name (row 41)', () => {
    expect(codes(ledgerOf([occ({ location: 'name', ordinal: 0, start: 0, end: 9, text: 'kestlehub' })]))).toEqual(['text-mismatch']);
    expect(codes(ledgerOf([occ({ location: 'name', ordinal: 1, start: 0, end: 9 })]))).toEqual(['name-ordinal-not-zero']);
    expect(codes(ledgerOf([occ({ location: 'name', ordinal: 0, start: 0, end: 13, text: 'brakefold.cfg' })]))).toEqual([]);
  });

  it('enforces one entity per exact span, allows nesting, forbids partial overlap', () => {
    const domain = occ({ ordinal: 2, start: 15, end: 36, text: 'brakefold-net.example' });
    const nested = occ({ ordinal: 2, start: 15, end: 24, variant: 'embedded' });
    expect(codes(ledgerOf([domain], [nested]))).toEqual([]);
    expect(codes(ledgerOf([occ({})], [occ({})]))).toEqual(['duplicate-span']);
    const partial = occ({ ordinal: 2, start: 20, end: 28, text: 'fold-net' });
    expect(codes(ledgerOf([nested], [partial]))).toEqual(['partial-overlap']);
  });

  it('enforces entity caps and unique entity ids', () => {
    const many = ledgerOf(...Array.from({ length: 65 }, () => [occ({ location: 'name', ordinal: 0, start: 0, end: 9 })]));
    expect(codes(many)).toContain('too-many-entities');
    // nine adjacent one-character spans of 'hostname ' = nine distinct occurrence strings (cap is 8)
    const variants = Array.from({ length: 9 }, (_, i) => occ({ fileId: 'n02', ordinal: 1, start: i, end: i + 1, text: 'hostname '.charAt(i) }));
    expect(codes(ledgerOf(variants))).toContain('too-many-variants');
    const dup = ledgerOf([occ({})]);
    dup.entities.push({ ...dup.entities[0], occurrences: [occ({ ordinal: 2, start: 15, end: 24 })] });
    expect(codes(dup)).toEqual(['duplicate-entity-id']);
    expect(validateLedgerSpans(ledgerOf([occ({})]), files, 'other').map((i) => i.code)).toEqual(['case-id-mismatch']);
  });

  it('never puts occurrence text into an issue', () => {
    const issues = validateLedgerSpans(ledgerOf([occ({ text: 'SECRET-VALUE-XYZ', start: 9, end: 25 })]), files, 'c1');
    expect(JSON.stringify(issues)).not.toContain('SECRET-VALUE-XYZ');
  });

  it('validates label spans the same way', () => {
    const labels: CaseLabels = {
      schema: 'labels-v1',
      caseId: 'c1',
      benignSpans: [{ id: 'b1', fileId: 'n01', ordinal: 1, start: 0, end: 8, text: 'hostname', note: 'keyword' }],
      freeTextTokens: [{ fileId: 'n02', ordinal: 2, start: 13, end: 16, text: 'tox' }],
    };
    expect(validateLabelSpans(labels, files, 'c1').map((i) => [i.code, i.index])).toEqual([['text-mismatch', 0]]);
  });
});

describe('ledger-validate on the three builder smoke fixtures', () => {
  for (const caseId of ['s01', 's02', 's03']) {
    it(`${caseId}: case.json, ledger.json and labels.json parse and every span matches`, () => {
      const read = (f: string) => readFileSync(new URL(`../../fixtures/smoke/${caseId}/${f}`, import.meta.url), 'utf8');
      const sidecar = parseSidecar(JSON.parse(read('case.json')));
      expect(sidecar.ok).toBe(true);
      if (!sidecar.ok) return;
      const caseFiles = sidecar.value.files.map((f) => ({ fileId: f.fileId, name: f.name, text: read(f.path) }));
      const ledger = parseLedger(JSON.parse(read('ledger.json')));
      expect(ledger.ok).toBe(true);
      if (ledger.ok) expect(validateLedgerSpans(ledger.value, caseFiles, caseId)).toEqual([]);
      const labels = parseLabels(JSON.parse(read('labels.json')));
      expect(labels.ok).toBe(true);
      if (labels.ok) expect(validateLabelSpans(labels.value, caseFiles, caseId)).toEqual([]);
    });
  }
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { identity } from '../../src/strategies/identity';
import type { CaseInput, StrategyCtx } from '../../src/strategies/types';

// identity and naive-mask ignore keys; a structurally valid stub keeps the Strategy signature honest.
const ctx: StrategyCtx = {
  cryptopan: { aes: {} as CryptoKey, pad: new Uint8Array(16) },
  rcKey: {} as CryptoKey,
  nameKey: {} as CryptoKey,
  asnKey: {} as CryptoKey,
  secretKey: {} as CryptoKey,
  operatorList: [],
};

const input = (texts: string[], names?: string[]): CaseInput => ({
  caseId: 'c1',
  files: texts.map((text, i) => ({ fileId: `n0${i + 1}`, name: names?.[i] ?? `n0${i + 1}.cfg`, text })),
});

describe('identity strategy', () => {
  it('returns every file byte for byte with its fileId and name (row 41), including CRLF and no final newline', async () => {
    const c = input(['hostname a\r\nend\r\n', 'hostname b\nlogging buffered 16384\nend', 'hostname c\n'], ['A-ROUTER.cfg', 'n02.cfg', 'n03.cfg']);
    const o = await identity.apply(c, ctx);
    expect(o.status).toBe('ok');
    expect(o.arm).toBe('identity');
    expect(o.files).toEqual(c.files);
    expect(o.files).not.toBe(c.files);
  });

  it('an Outcome holds exactly caseId, arm, status, files and diagnostics: no map, no key (rows 28, 29)', async () => {
    const o = await identity.apply(input(['hostname a\n', 'hostname b\n', 'hostname c\n']), ctx);
    expect(Object.keys(o).sort()).toEqual(['arm', 'caseId', 'diagnostics', 'files', 'status']);
    for (const f of o.files) expect(Object.keys(f).sort()).toEqual(['fileId', 'name', 'text']);
  });

  it('reports unknown lines as code + ordinal diagnostics, never their text', async () => {
    const o = await identity.apply(input(['hostname a\nlogging host 10.9.9.9\n', 'hostname b\n', 'hostname c\n']), ctx);
    expect(o.diagnostics).toEqual([{ code: 'unknown-line', fileId: 'n01', ordinal: 2 }]);
    expect(JSON.stringify(o.diagnostics)).not.toContain('10.9.9.9');
  });

  it('marks a forwarding-affecting unknown line as status unsupported but still returns the files', async () => {
    const o = await identity.apply(input(['hostname a\nrouter ospf 1\n', 'hostname b\n', 'hostname c\n']), ctx);
    expect(o.status).toBe('unsupported');
    expect(o.files).toHaveLength(3);
    expect(o.diagnostics).toContainEqual({ code: 'unknown-line-forwarding', fileId: 'n01', ordinal: 2 });
  });

  it('a violated cap is an error with no output files', async () => {
    const o = await identity.apply(input(['hostname a\n', 'hostname b\n']), ctx);
    expect(o.status).toBe('error');
    expect(o.files).toEqual([]);
    expect(o.diagnostics).toEqual([{ code: 'too-few-devices', fileId: '', ordinal: 0 }]);
  });

  it('passes the s01 smoke case through unchanged', async () => {
    const read = (f: string) => readFileSync(new URL(`../../fixtures/smoke/s01/${f}`, import.meta.url), 'utf8');
    const c: CaseInput = {
      caseId: 's01',
      files: [
        { fileId: 'n01', name: 'brakefold.cfg', text: read('n01.cfg') },
        { fileId: 'n02', name: 'n02.cfg', text: read('n02.cfg') },
        { fileId: 'n03', name: 'n03.cfg', text: read('n03.cfg') },
      ],
    };
    const o = await identity.apply(c, ctx);
    expect(o.status).toBe('ok');
    expect(o.files).toEqual(c.files);
  });
});

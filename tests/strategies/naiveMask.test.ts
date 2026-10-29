import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NAIVE_MASK_TOKEN, applyEdits, naiveMask } from '../../src/strategies/naiveMask';
import type { CaseInput, StrategyCtx } from '../../src/strategies/types';
import { caseDiagnostics, parseCase } from '../../src/core/parser';

const ctx: StrategyCtx = {
  cryptopan: { aes: {} as CryptoKey, pad: new Uint8Array(16) },
  rcKey: {} as CryptoKey,
  nameKey: {} as CryptoKey,
  asnKey: {} as CryptoKey,
  secretKey: {} as CryptoKey,
  operatorList: ['brakefold'],
};

const lines = (...rows: string[]) => `${rows.join('\n')}\n`;

const ORIGINAL_N01 = lines(
  'hostname brakefold',
  'ip domain-name brakefold-net.example',
  '!',
  'interface GigabitEthernet0/0',
  ' description LAN 10.11.1.0/24 for Quillfen, split 10.11. 1.1',
  ' ip address 10.11.1.1 255.255.255.0',
  ' ip access-group EDGE-IN in',
  '!',
  'interface GigabitEthernet0/1',
  ' ip address 10.11.255.1 255.255.255.252',
  ' ip access-group 110 out',
  '!',
  'ip route 192.0.2.0 255.255.255.0 10.11.255.2',
  'ip route 0.0.0.0 0.0.0.0 10.11.255.2',
  '!',
  'ip access-list extended EDGE-IN',
  ' remark allow 192.0.2.1 only',
  ' permit tcp host 10.11.1.1 host 192.0.2.1 eq 443',
  ' deny ip 10.0.0.0 0.255.255.255 any',
  '!',
  'access-list 110 permit icmp any any',
  '!',
  'router bgp 110',
  ' neighbor 172.40.3.200 remote-as 65020',
  ' neighbor 172.40.3.200 description Ferrowind transit 172.40.3.200',
  '!',
  'snmp-server community heron RO',
  'username brakefold secret 9 $9$abc',
  'enable secret 5 $1$xyz',
  '! jump host 10.11.1.1',
  'banner motd #Call 192.0.2.7 now#',
  'logging host 10.11.1.99',
  'end',
);

// Row 30, line by line. Masks, wildcards, ports, ACL numbers, ASNs, interface names and unknown lines are untouched.
const EXPECTED_N01 = lines(
  'hostname MASKED',
  'ip domain-name MASKED',
  '!',
  'interface GigabitEthernet0/0',
  ' description LAN 0.0.0.0/24 for Quillfen, split 10.11. 1.1',
  ' ip address 0.0.0.0 255.255.255.0',
  ' ip access-group MASKED in',
  '!',
  'interface GigabitEthernet0/1',
  ' ip address 0.0.0.0 255.255.255.252',
  ' ip access-group 110 out',
  '!',
  'ip route 0.0.0.0 255.255.255.0 0.0.0.0',
  'ip route 0.0.0.0 0.0.0.0 0.0.0.0',
  '!',
  'ip access-list extended MASKED',
  ' remark allow 0.0.0.0 only',
  ' permit tcp host 0.0.0.0 host 0.0.0.0 eq 443',
  ' deny ip 0.0.0.0 0.255.255.255 any',
  '!',
  'access-list 110 permit icmp any any',
  '!',
  'router bgp 110',
  ' neighbor 0.0.0.0 remote-as 65020',
  ' neighbor 0.0.0.0 description MASKED',
  '!',
  'snmp-server community MASKED RO',
  'username MASKED secret 9 MASKED',
  'enable secret 5 MASKED',
  '! jump host 0.0.0.0',
  'banner motd #Call 0.0.0.0 now#',
  'logging host 10.11.1.99',
  'end',
);

const N02 = lines('hostname kestle-hub', 'ip access-list extended ALPHA', ' deny ip any any', 'ip access-list extended BRAVO', ' permit ip any any', 'end');
const N03 = 'hostname sorrel\r\nend\r\n';

const testCase = (): CaseInput => ({
  caseId: 'c1',
  files: [
    { fileId: 'n01', name: 'brakefold.cfg', text: ORIGINAL_N01 },
    { fileId: 'n02', name: 'n02.cfg', text: N02 },
    { fileId: 'n03', name: 'n03.cfg', text: N03 },
  ],
});

describe('naive-mask strategy (row 30)', () => {
  it('applies every row 30 rule and nothing else', async () => {
    const o = await naiveMask.apply(testCase(), ctx);
    expect(o.status).toBe('ok');
    expect(o.arm).toBe('naive-mask');
    expect(o.files[0]?.text).toBe(EXPECTED_N01);
  });

  it('keeps fileIds, file names (row 41), line count and CRLF terminators', async () => {
    const c = testCase();
    const o = await naiveMask.apply(c, ctx);
    expect(o.files.map((f) => [f.fileId, f.name])).toEqual(c.files.map((f) => [f.fileId, f.name]));
    for (let i = 0; i < c.files.length; i++) {
      expect(o.files[i]?.text.split('\n').length).toBe(c.files[i]?.text.split('\n').length);
    }
    expect(o.files[2]?.text).toBe('hostname MASKED\r\nend\r\n');
  });

  it('collapses distinct names into one token: duplicate hostnames and duplicate ACL names on re-parse (row 7 ambiguity)', async () => {
    const o = await naiveMask.apply(testCase(), ctx);
    const reparsed = parseCase({ caseId: 'c1', files: o.files });
    const diag = caseDiagnostics(reparsed).map((d) => `${d.code}@${d.fileId}`);
    expect(diag).toContain('duplicate-hostname@n02');
    expect(diag).toContain('duplicate-hostname@n03');
    expect(diag).toContain('duplicate-acl-name@n02');
  });

  it('keeps its output grammatical: no new unknown lines', async () => {
    const before = parseCase(testCase());
    const after = parseCase({ caseId: 'c1', files: (await naiveMask.apply(testCase(), ctx)).files });
    const unknown = (r: typeof before) => r.files.map((f) => f.device.unknownLines.length);
    expect(after.violations).toEqual([]);
    expect(unknown(after)).toEqual(unknown(before));
  });

  it('does not depend on keys or the operator list', async () => {
    const other: StrategyCtx = { ...ctx, operatorList: [] };
    expect((await naiveMask.apply(testCase(), other)).files).toEqual((await naiveMask.apply(testCase(), ctx)).files);
  });

  it('caps and unsupported strata behave like every arm', async () => {
    const tooFew = await naiveMask.apply({ caseId: 'c1', files: testCase().files.slice(0, 2) }, ctx);
    expect(tooFew.status).toBe('error');
    expect(tooFew.files).toEqual([]);
    const c = testCase();
    c.files[1] = { ...c.files[1], text: `${N02}router ospf 1\n` } as CaseInput['files'][number];
    const unsupported = await naiveMask.apply(c, ctx);
    expect(unsupported.status).toBe('unsupported');
    expect(unsupported.files[1]?.text.endsWith('router ospf 1\n')).toBe(true);
  });

  it('masks the planted s01 smoke identifiers in name/address/secret slots but leaves free-text names (by design)', async () => {
    const read = (f: string) => readFileSync(new URL(`../../fixtures/smoke/s01/${f}`, import.meta.url), 'utf8');
    const o = await naiveMask.apply(
      {
        caseId: 's01',
        files: [
          { fileId: 'n01', name: 'brakefold.cfg', text: read('n01.cfg') },
          { fileId: 'n02', name: 'n02.cfg', text: read('n02.cfg') },
          { fileId: 'n03', name: 'n03.cfg', text: read('n03.cfg') },
        ],
      },
      ctx,
    );
    const [n01, n02, n03] = o.files.map((f) => f.text);
    expect(n01).toContain('hostname MASKED\n');
    expect(n01).toContain('snmp-server community MASKED RO\n');
    expect(n01).not.toContain('$9$Lq0vXe2b');
    expect(n01).toContain(' description link to n02 <script>alert(1)</script>\n');
    expect(n02).toContain(' description uplink to BRAKEFOLD gi0/1\n');
    expect(n02).toContain(' description docs LAN 0.0.0.0/24 serial FTX2231A0KQ\n');
    expect(n03).toContain('router bgp 64512\n');
    expect(n03).toContain(' neighbor 0.0.0.0 description MASKED\n');
    expect(o.files[0]?.name).toBe('brakefold.cfg');
  });

  it('applyEdits applies non-overlapping edits right to left', () => {
    expect(
      applyEdits('ab cd ef', [
        { start: 0, end: 2, replacement: NAIVE_MASK_TOKEN },
        { start: 6, end: 8, replacement: 'X' },
      ]),
    ).toBe('MASKED cd X');
  });

  it('imports nothing from the scoring side (custody import ban, M1 acceptance)', () => {
    for (const file of ['naiveMask.ts', 'identity.ts', 'types.ts']) {
      const src = readFileSync(new URL(`../../src/strategies/${file}`, import.meta.url), 'utf8');
      const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      for (const s of specifiers) {
        expect(s).not.toMatch(/core\/(ledger|ledgerValidate|sidecar|labels|expected)$|\/eval(\/|$)|\/gen(\/|$)|fixtures/);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { labDrop, labScrub, labScrubKey2 } from '../../src/strategies/lab';
import { randomConsistent, randomConsistentIPv4 } from '../../src/strategies/randomConsistent';
import { deriveStrategyCtx } from '../../src/strategies/keys';
import { extractOperatorList } from '../../src/core/operatorList';
import { parseCase } from '../../src/core/parser';
import type { CaseInput } from '../../src/strategies/types';

const input: CaseInput = { caseId: 'unit', files: ['edge', 'branch', 'core'].map((name, i) => ({ fileId: `f${i}`, name: `${name.toUpperCase()}.cfg`, text: `hostname ${name}\ninterface GigabitEthernet0/0\n description contact admin@example.org 10.2.3.1\n ip address 10.2.${i}.1 255.255.255.0\n ip access-group 110 in\n!\naccess-list 110 permit tcp host 10.2.3.1 192.0.2.0 0.0.0.255 eq 110\nip route 0.0.0.0 0.0.0.0 10.2.3.2\nrouter bgp 110\n neighbor 192.0.2.1 remote-as 65535\nusername edge secret 9 oldhash\nsnmp-server community public RO\nend\n` })) };

describe('lab arm role isolation', () => {
  for (const strategy of [labScrub, labDrop, randomConsistent, labScrubKey2]) it(`${strategy.id} preserves typed constants and fileId`, async () => {
    const ctx = await deriveStrategyCtx(new Uint8Array(32), extractOperatorList(input));
    const out = await strategy.apply(input, ctx);
    expect(out.status).not.toBe('error');
    expect(out.files.map((f) => f.fileId)).toEqual(input.files.map((f) => f.fileId));
    expect(out.files[0].name).not.toBe(input.files[0].name);
    expect(out.files[0].text).toContain('255.255.255.0');
    expect(out.files[0].text).toContain('0.0.0.255 eq 110');
    expect(out.files[0].text).toContain('access-list 110');
    expect(out.files[0].text).toContain('ip access-group 110 in');
    expect(out.files[0].text).toContain('ip route 0.0.0.0 0.0.0.0');
    expect(out.diagnostics.some((d) => d.code === 'asn-out-of-range')).toBe(true);
    expect(parseCase({ caseId: out.caseId, files: out.files }).files).toHaveLength(3);
    expect(out.files[0].text).not.toContain('oldhash');
  });
  it('drops free text in place without losing structural ordinals', async () => {
    const ctx = await deriveStrategyCtx(new Uint8Array(32));
    const out = await labDrop.apply(input, ctx);
    expect(out.files[0].text.split('\n')).toHaveLength(input.files[0].text.split('\n').length);
    expect(out.files[0].text).not.toContain('contact');
  });
  it('random-consistent is deterministic and collision-free on a development sample', async () => {
    const { rcKey } = await deriveStrategyCtx(new Uint8Array(32));
    const outputs = await Promise.all(Array.from({ length: 100 }, (_, i) => randomConsistentIPv4(i, rcKey)));
    expect(new Set(outputs).size).toBe(100);
    expect(await randomConsistentIPv4(42, rcKey)).toBe(outputs[42]);
  });
});

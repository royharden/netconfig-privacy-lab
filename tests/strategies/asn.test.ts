import { describe, expect, it } from 'vitest';
import { ASN_POOLS, permuteAsn } from '../../src/strategies/asn';
import { deriveStrategyCtx } from '../../src/strategies/keys';
describe('ASN role permutation', () => {
  for (const pool of ASN_POOLS) it(`is a bijection in pool ${pool.start}-${pool.end}`, async () => {
    const { asnKey } = await deriveStrategyCtx(new Uint8Array(32));
    const seen = new Set<string>();
    for (let n = pool.start; n <= pool.end; n++) {
      if (n === 23456) continue;
      const result = await permuteAsn(String(n), asnKey);
      expect(result.diagnostic).toBeUndefined();
      expect(Number(result.value)).toBeGreaterThanOrEqual(pool.start);
      expect(Number(result.value)).toBeLessThanOrEqual(pool.end);
      expect(Number(result.value)).not.toBe(23456);
      expect(seen.has(result.value)).toBe(false);
      seen.add(result.value);
    }
    expect(seen.size).toBe(pool.size);
  }, 180000);
  it('leaves out-of-range ASN tokens unchanged with a named diagnostic', async () => {
    const { asnKey } = await deriveStrategyCtx(new Uint8Array(32));
    for (const value of ['0', '23456', '65535', '65536', '4294967295']) expect(await permuteAsn(value, asnKey)).toEqual({ value, diagnostic: 'asn-out-of-range' });
  });
});

import { expect, it } from 'vitest';
import { deriveStrategyCtx, parseEvaluationKeys } from '../../src/strategies/keys';
import { hmacBytes } from '../../src/strategies/pseudonym';
it('derives deterministic nonextractable and domain-separated keys with a distinct key2 context', async () => {
  const a = await deriveStrategyCtx(new Uint8Array(32));
  const b = await deriveStrategyCtx(new Uint8Array(32));
  const second = await deriveStrategyCtx(new Uint8Array(32).fill(1));
  expect(await hmacBytes(a.nameKey, 'x')).toEqual(await hmacBytes(b.nameKey, 'x'));
  expect(await hmacBytes(a.nameKey, 'x')).not.toEqual(await hmacBytes(a.asnKey, 'x'));
  expect(await hmacBytes(a.nameKey, 'x')).not.toEqual(await hmacBytes(second.nameKey, 'x'));
  expect(a.nameKey.extractable).toBe(false);
});
it('accepts precisely two synthetic master lines and rejects malformed key text', () => {
  expect(parseEvaluationKeys(`${'00'.repeat(32)}\n${'ff'.repeat(32)}\n`)[1]).toHaveLength(32);
  expect(() => parseEvaluationKeys('private marker')).toThrow('invalid-evaluation-keys');
});
